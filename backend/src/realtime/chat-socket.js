import { Server } from "socket.io"
import jwt from "jsonwebtoken"
import { getJwtSecret } from "../config/auth.js"
import { ChatConversation, ChatMessage, ChatUser } from "../models/chat.models.js"
import { saveMessage } from "../controllers/chat.controller.js"
import { emitConversationEvent, publishNewMessage } from "./publish-message.js"

function readCookie(request, name) {
  const raw = request.headers.cookie || ""
  const pair = raw.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))
  if (!pair) return ""
  try { return decodeURIComponent(pair.slice(name.length + 1)) } catch { return "" }
}

export function attachChatSockets(server) {
  const allowedOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173"
  const onlineUsers = new Map()
  const io = new Server(server, {
    cors: { origin: allowedOrigin, credentials: true },
    serveClient: true,
    maxHttpBufferSize: 1024 * 1024
  })

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin
      if (origin && origin !== allowedOrigin) return next(new Error("Origin not allowed"))
      const token = readCookie(socket.request, "chat_session")
      if (!token) return next(new Error("Authentication required"))
      const payload = jwt.verify(token, getJwtSecret(), { issuer: "chat-app" })
      const user = await ChatUser.findById(payload.sub)
      if (!user) return next(new Error("Authentication required"))
      socket.data.user = user
      next()
    } catch { next(new Error("Authentication required")) }
  })

  io.on("connection", async socket => {
    const user = socket.data.user
    const userId = String(user._id)
    socket.join(`user:${userId}`)
    for (const [onlineId, details] of onlineUsers) {
      socket.emit("presence:update", { userId: onlineId, online: true, lastSeenAt: details.lastSeenAt })
    }
    onlineUsers.set(userId, { lastSeenAt: null })
    await ChatUser.updateOne({ _id: user._id }, { $set: { lastSeenAt: null } })
    io.emit("presence:update", { userId, online: true, lastSeenAt: null, status: user.status || "online", statusMessage: user.statusMessage || "" })
    let lastAction = 0

    socket.on("conversation:join", async ({ conversationId } = {}, ack = () => {}) => {
      if (!/^[a-f\d]{24}$/i.test(String(conversationId || ""))) return ack({ error: "Invalid conversation." })
      const conversation = await ChatConversation.findOne({ _id: conversationId, members: user._id }).select("members")
      if (!conversation) return ack({ error: "Conversation not found." })
      socket.join(`conversation:${conversationId}`)
      const undelivered = await ChatMessage.find({
        conversationId, senderId: { $ne: user._id }, deliveredTo: { $ne: user._id }
      }).select("_id")
      if (undelivered.length) {
        await ChatMessage.updateMany(
          { _id: { $in: undelivered.map(message => message._id) } },
          { $addToSet: { deliveredTo: user._id } }
        )
        emitConversationEvent(io, conversationId, conversation.members, "message:delivered", {
          conversationId: String(conversationId), userId, messageIds: undelivered.map(message => String(message._id))
        })
      }
      ack({ ok: true })
    })

    socket.on("message:send", async (payload = {}, ack = () => {}) => {
      const now = Date.now()
      if (now - lastAction < 150) return ack({ error: "Please slow down." })
      lastAction = now
      try {
        const { message, conversation } = await saveMessage({
          conversationId: payload.conversationId, user,
          text: payload.text, attachmentTickets: payload.attachments, replyToId: payload.replyToId,
          ciphertext: payload.ciphertext, encryptionIv: payload.encryptionIv, poll: payload.poll
        })
        const publishedMessage = await publishNewMessage(io, conversation._id, message, user._id, conversation.members)
        ack({ ok: true, message: publishedMessage })
      } catch (error) { ack({ error: error.status ? error.message : "Could not send message." }) }
    })

    socket.on("typing:update", async ({ conversationId, typing } = {}) => {
      if (!/^[a-f\d]{24}$/i.test(String(conversationId || ""))) return
      if (!await ChatConversation.exists({ _id: conversationId, members: user._id })) return
      socket.to(`conversation:${conversationId}`).emit("typing:update", {
        conversationId: String(conversationId), userId, displayName: user.displayName, typing: Boolean(typing)
      })
    })

    socket.on("call:signal", async (payload = {}, ack = () => {}) => {
      try {
        if (!payload || typeof payload !== "object") return ack({ error: "Invalid call signal." })
        const { conversationId, type, sdp, candidate } = payload
        if (!/^[a-f\d]{24}$/i.test(String(conversationId || "")) ||
          !["offer", "answer", "candidate", "reject", "end", "busy"].includes(type)) {
          return ack({ error: "Invalid call signal." })
        }
        const conversation = await ChatConversation.findOne({ _id: conversationId, members: user._id }).select("type members")
        if (!conversation || conversation.type !== "direct" || conversation.members.length !== 2) {
          return ack({ error: "Calls are available in direct conversations." })
        }
        if ((type === "offer" || type === "answer") && (!sdp || typeof sdp !== "object" || typeof sdp.sdp !== "string" || sdp.sdp.length > 100_000)) {
          return ack({ error: "Invalid call description." })
        }
        if (type === "candidate" && (!candidate || typeof candidate !== "object" || String(candidate.candidate || "").length > 4096)) {
          return ack({ error: "Invalid call candidate." })
        }
        const recipientId = String(conversation.members.find(memberId => String(memberId) !== userId))
        io.to(`user:${recipientId}`).emit("call:signal", {
          conversationId: String(conversationId),
          senderId: userId,
          displayName: user.displayName,
          type,
          media: type === "offer" ? (payload.media === "video" ? "video" : "audio") : undefined,
          ...(sdp ? { sdp } : {}),
          ...(candidate ? { candidate } : {})
        })
        ack({ ok: true })
      } catch (error) {
        console.error("Call signaling failed.", error?.name || "Error")
        ack({ error: "Call signaling failed." })
      }
    })

    socket.on("read:update", async ({ conversationId } = {}, ack = () => {}) => {
      if (!/^[a-f\d]{24}$/i.test(String(conversationId || ""))) return ack({ error: "Invalid conversation." })
      const conversation = await ChatConversation.findOne({ _id: conversationId, members: user._id })
      if (!conversation) return ack({ error: "Conversation not found." })
      const lastReadAt = new Date()
      await ChatConversation.updateOne({ _id: conversation._id }, { $pull: { readStates: { userId: user._id } } }, { timestamps: false })
      await ChatConversation.updateOne({ _id: conversation._id }, { $push: { readStates: { userId: user._id, lastReadAt } } }, { timestamps: false })
      const event = { conversationId: String(conversation._id), userId, lastReadAt }
      emitConversationEvent(io, conversationId, conversation.members, "read:update", event)
      ack({ ok: true })
    })

    socket.on("disconnect", async () => {
      const remaining = await io.in(`user:${userId}`).fetchSockets()
      if (remaining.length === 0) {
        const lastSeenAt = new Date()
        onlineUsers.delete(userId)
        await ChatUser.updateOne({ _id: user._id }, { $set: { lastSeenAt } })
        io.emit("presence:update", { userId, online: false, lastSeenAt, status: user.status || "online", statusMessage: user.statusMessage || "" })
      }
    })
  })
  return io
}
