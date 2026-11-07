import { ChatMessage } from "../models/chat.models.js"

export function emitConversationEvent(io, conversationId, memberIds, eventName, payload) {
  const rooms = [...new Set([
    `conversation:${conversationId}`,
    ...memberIds.map(memberId => `user:${String(memberId?._id || memberId)}`)
  ])]
  let destination = io.to(rooms[0])
  for (const room of rooms.slice(1)) destination = destination.to(room)
  destination.emit(eventName, payload)
}

export async function publishNewMessage(io, conversationId, message, senderId, memberIds) {
  const recipientRooms = [...new Set(memberIds
    .map(memberId => String(memberId?._id || memberId))
    .filter(id => id && id !== String(senderId)))]
    .map(id => `user:${id}`)
  const sockets = recipientRooms.length ? await io.in(recipientRooms).fetchSockets() : []
  const recipientIds = [...new Set(sockets
    .map(socket => String(socket.data.user?._id || ""))
    .filter(id => id && id !== String(senderId)))]
  const deliveredTo = [...new Set([...(message.deliveredTo || []).map(id => String(id?._id || id)), ...recipientIds])]
  if (recipientIds.length) {
    await ChatMessage.updateOne({ _id: message._id }, { $addToSet: { deliveredTo: { $each: recipientIds } } })
  }
  const payload = message.toObject ? message.toObject() : { ...message }
  payload.deliveredTo = deliveredTo
  emitConversationEvent(io, conversationId, memberIds, "message:new", { message: payload, conversationId: String(conversationId) })
  for (const mentionedUserId of message.mentions || []) {
    const recipientId = String(mentionedUserId?._id || mentionedUserId)
    if (recipientId !== String(senderId) && memberIds.some(memberId => String(memberId?._id || memberId) === recipientId)) {
      io.to(`user:${recipientId}`).emit("notification:mention", {
        conversationId: String(conversationId), messageId: String(message._id), senderId: String(senderId)
      })
    }
  }
  return payload
}
