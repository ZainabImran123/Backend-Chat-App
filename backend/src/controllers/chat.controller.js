import path from "node:path"
import fs from "node:fs"
import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { ChatConversation, ChatMessage, ChatReport, ChatUser } from "../models/chat.models.js"
import { getJwtSecret } from "../config/auth.js"
import { emitConversationEvent, publishNewMessage } from "../realtime/publish-message.js"
import { requestAssistantText } from "../services/ai-provider.js"

const COOKIE_NAME = "chat_session"
const ticketExpirySeconds = 60 * 60
const publicUser = user => ({
  id: String(user._id),
  displayName: user.displayName,
  email: user.email,
  lastSeenAt: user.lastSeenAt || null,
  status: user.status || "online",
  statusMessage: user.statusMessage || ""
})

export function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user._id) }, getJwtSecret(), { expiresIn: "7d", issuer: "chat-app" })
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  })
}

export async function register(req, res, next) {
  try {
    const displayName = String(req.body?.displayName || "").trim()
    const email = String(req.body?.email || "").trim().toLowerCase()
    const password = String(req.body?.password || "")
    if (displayName.length < 1 || displayName.length > 60 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 128) {
      return res.status(400).json({ message: "Enter a name, valid email, and password (10–128 characters)." })
    }
    if (await ChatUser.exists({ email })) return res.status(409).json({ message: "An account with that email already exists." })
    const user = await ChatUser.create({ displayName, email, passwordHash: await bcrypt.hash(password, 12) })
    issueSession(res, user)
    res.status(201).json({ user: publicUser(user) })
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "An account with that email already exists." })
    next(error)
  }
}

export async function login(req, res, next) {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase()
    const password = String(req.body?.password || "")
    const user = await ChatUser.findOne({ email })
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: "Email or password is incorrect." })
    }
    issueSession(res, user)
    res.json({ user: publicUser(user) })
  } catch (error) { next(error) }
}

export function logout(req, res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" })
  res.status(204).end()
}

export function currentUser(req, res) {
  res.json({ user: publicUser(req.user) })
}

export async function listConversations(req, res, next) {
  try {
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 30))
    const before = req.query.before ? new Date(req.query.before) : null
    const filter = { members: req.user._id }
    if (before && Number.isFinite(before.getTime())) filter.updatedAt = { $lt: before }
    const rows = await ChatConversation.find(filter)
      .sort({ updatedAt: -1 }).limit(limit + 1)
      .populate("members", "displayName email lastSeenAt status statusMessage")
    res.json({ conversations: rows.slice(0, limit), hasMore: rows.length > limit })
  } catch (error) { next(error) }
}

async function memberConversation(id, userId) {
  if (!/^[a-f\d]{24}$/i.test(String(id))) return null
  return ChatConversation.findOne({ _id: id, members: userId })
}

export async function createConversation(req, res, next) {
  try {
    const type = req.body?.type === "group" ? "group" : "direct"
    const name = String(req.body?.name || "").trim()
    const emails = Array.isArray(req.body?.memberEmails) ? [...new Set(req.body.memberEmails.map(e => String(e).trim().toLowerCase()))].slice(0, 49) : []
    if (type === "group" && (name.length < 1 || name.length > 80)) return res.status(400).json({ message: "Group name must be 1–80 characters." })
    if (emails.length < 1) return res.status(400).json({ message: "Add at least one other member by email." })
    const users = await ChatUser.find({ email: { $in: emails } }).select("_id email displayName lastSeenAt status statusMessage blockedUsers")
    if (users.length !== emails.length) return res.status(400).json({ message: "One or more member emails were not found." })
    const ids = [...new Set([String(req.user._id), ...users.map(user => String(user._id))])]
    if (users.some(user => user.blockedUsers.some(id => String(id) === String(req.user._id))) ||
      ids.some(id => req.user.blockedUsers.some(blockedId => String(blockedId) === id))) {
      return res.status(403).json({ message: "A member has restricted this conversation." })
    }
    if (type === "direct" && ids.length !== 2) return res.status(400).json({ message: "A direct conversation has exactly one other member." })
    if (type === "group" && ids.length < 2) return res.status(400).json({ message: "A group conversation needs at least one other member." })
    if (type === "direct") {
      const existing = await ChatConversation.findOne({ type: "direct", members: { $all: ids, $size: 2 } }).populate("members", "displayName email lastSeenAt status statusMessage")
      if (existing) return res.json({ conversation: existing })
    }
    const conversation = await ChatConversation.create({
      type, members: ids, name: type === "group" ? name : "", createdBy: req.user._id
    })
    await conversation.populate("members", "displayName email lastSeenAt status statusMessage")
    res.status(201).json({ conversation })
  } catch (error) { next(error) }
}

export async function listMessages(req, res, next) {
  try {
    if (!await memberConversation(req.params.id, req.user._id)) return res.status(404).json({ message: "Conversation not found." })
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 30))
    const before = req.query.before ? new Date(req.query.before) : null
    const filter = { conversationId: req.params.id }
    if (before && Number.isFinite(before.getTime())) filter.createdAt = { $lt: before }
    const messages = await ChatMessage.find(filter).sort({ createdAt: -1 }).limit(limit + 1)
    const hasMore = messages.length > limit
    const page = messages.slice(0, limit)
    const undeliveredIds = page.filter(message => String(message.senderId) !== String(req.user._id) &&
      !message.deliveredTo.some(id => String(id) === String(req.user._id))).map(message => message._id)
    if (undeliveredIds.length) {
      await ChatMessage.updateMany({ _id: { $in: undeliveredIds } }, { $addToSet: { deliveredTo: req.user._id } })
      for (const message of page) {
        if (undeliveredIds.some(id => String(id) === String(message._id))) message.deliveredTo.push(req.user._id)
      }
    }
    await ChatMessage.populate(page, [
      { path: "senderId", select: "displayName" },
      { path: "replyTo", populate: { path: "senderId", select: "displayName" } }
    ])
    res.json({ messages: page.reverse(), hasMore })
  } catch (error) { next(error) }
}

export async function searchMessages(req, res, next) {
  try {
    const q = String(req.query.q || "").trim().slice(0, 100)
    const conversationId = String(req.params.id)
    if (q.length === 1) return res.status(400).json({ message: "Search needs at least two characters." })
    const conversation = await memberConversation(conversationId, req.user._id)
    if (!conversation) return res.status(404).json({ message: "Conversation not found." })
    if (conversation.encryptionEnabled) return res.status(409).json({ message: "Search is unavailable in encrypted conversations." })
    const filter = { conversationId, deletedAt: null }
    const textFilters = []
    if (q) textFilters.push({ text: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } })
    const senderId = String(req.query.sender || "")
    if (senderId) {
      if (!/^[a-f\d]{24}$/i.test(senderId) || !conversation.members.some(id => String(id) === senderId)) {
        return res.status(400).json({ message: "Choose a conversation member as the sender filter." })
      }
      filter.senderId = senderId
    }
    const kind = String(req.query.kind || "")
    if (kind === "media") filter["attachments.mimeType"] = { $regex: "^(image|video)/" }
    else if (kind === "audio") filter["attachments.mimeType"] = { $regex: "^audio/" }
    else if (kind === "documents") filter["attachments.mimeType"] = { $nin: [null], $not: { $regex: "^(image|video|audio)/" } }
    else if (kind === "links") textFilters.push({ text: /https?:\/\/\S+/i })
    else if (kind && kind !== "all") return res.status(400).json({ message: "Unknown search filter." })
    if (textFilters.length) filter.$and = textFilters
    const messages = await ChatMessage.find(filter).sort({ createdAt: -1 }).limit(50).populate("senderId", "displayName")
    res.json({ messages })
  } catch (error) { next(error) }
}

function safeOriginalName(value) {
  return path.basename(String(value || "attachment").replace(/[\\/]/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 180) || "attachment"
}

export function createAttachmentTicket({ storageKey, thumbnailKey = "", conversationId, userId, originalName, mimeType, size }) {
  const token = jwt.sign(
    { kind: "attachment", key: storageKey, thumbnailKey, conversationId: String(conversationId), userId: String(userId), originalName, mimeType, size },
    getJwtSecret(), { expiresIn: ticketExpirySeconds, issuer: "chat-app" }
  )
  return { token, storageKey, originalName, mimeType, size }
}

export function verifyAttachmentTicket(token, conversationId, userId) {
  const data = jwt.verify(String(token || ""), getJwtSecret(), { issuer: "chat-app" })
  if (data.kind !== "attachment" || data.conversationId !== String(conversationId) || data.userId !== String(userId) || !/^[a-f\d-]{36}$/i.test(data.key) || (data.thumbnailKey && !/^[a-f\d-]{36}\.thumb\.webp$/i.test(data.thumbnailKey))) {
    throw new Error("Invalid attachment ticket")
  }
  return { storageKey: data.key, thumbnailKey: data.thumbnailKey || "", originalName: safeOriginalName(data.originalName), mimeType: data.mimeType, size: data.size }
}

export async function saveMessage({ conversationId, user, text = "", attachmentTickets = [], replyToId = "", ciphertext = "", encryptionIv = "", poll = null }) {
  const conversation = await memberConversation(conversationId, user._id)
  if (!conversation) throw Object.assign(new Error("Conversation not found."), { status: 404 })
  const memberUsers = await ChatUser.find({ _id: { $in: conversation.members } }).select("_id displayName blockedUsers")
  const recipientUsers = memberUsers.filter(member => String(member._id) !== String(user._id))
  if (recipientUsers.some(member => member.blockedUsers.some(id => String(id) === String(user._id))) ||
    recipientUsers.some(member => user.blockedUsers.some(id => String(id) === String(member._id)))) {
    throw Object.assign(new Error("A member has restricted messages from this account."), { status: 403 })
  }
  const cleanText = String(text).trim().slice(0, 5000)
  const cleanCiphertext = String(ciphertext || "")
  const cleanIv = String(encryptionIv || "")
  if (conversation.encryptionEnabled && (!/^[A-Za-z0-9+/=]{1,12000}$/.test(cleanCiphertext) || !/^[A-Za-z0-9+/=]{16,64}$/.test(cleanIv))) {
    throw Object.assign(new Error("Enter a passphrase and encrypt this message before sending."), { status: 400 })
  }
  if (!conversation.encryptionEnabled && (cleanCiphertext || cleanIv)) {
    throw Object.assign(new Error("This conversation does not have encryption enabled."), { status: 400 })
  }
  if (conversation.encryptionEnabled && attachmentTickets?.length) {
    throw Object.assign(new Error("Attachments are not supported in encrypted conversations yet."), { status: 400 })
  }
  if (!cleanText && !cleanCiphertext && !poll && (!Array.isArray(attachmentTickets) || attachmentTickets.length === 0)) {
    throw Object.assign(new Error("A message needs text or an attachment."), { status: 400 })
  }
  if (Array.isArray(attachmentTickets) && attachmentTickets.length > 5) throw Object.assign(new Error("Attach up to five files per message."), { status: 400 })
  if (!Array.isArray(attachmentTickets)) throw Object.assign(new Error("Invalid attachments."), { status: 400 })
  let attachments
  try { attachments = attachmentTickets.map(ticket => verifyAttachmentTicket(ticket, conversationId, user._id)) }
  catch { throw Object.assign(new Error("One or more attachments are invalid or expired."), { status: 400 }) }
  for (const attachment of attachments) {
    const file = path.resolve(process.env.CHAT_UPLOAD_DIR || path.join(process.cwd(), "uploads"), attachment.storageKey)
    if (!fs.existsSync(file)) throw Object.assign(new Error("Attachment is no longer available."), { status: 400 })
  }
  let replyTo = null
  if (replyToId) {
    if (!/^[a-f\d]{24}$/i.test(String(replyToId))) throw Object.assign(new Error("The message being replied to is invalid."), { status: 400 })
    replyTo = await ChatMessage.findOne({ _id: replyToId, conversationId })
    if (!replyTo) throw Object.assign(new Error("The message being replied to was not found."), { status: 404 })
  }
  let cleanPoll = null
  if (poll) {
    const question = String(poll.question || "").trim().slice(0, 240)
    const options = Array.isArray(poll.options) ? [...new Set(poll.options.map(option => String(option).trim()).filter(Boolean))].slice(0, 8) : []
    if (!question || options.length < 2) throw Object.assign(new Error("A poll needs a question and at least two different options."), { status: 400 })
    cleanPoll = { question, options: options.map(text => ({ text, votes: [] })), multipleChoice: Boolean(poll.multipleChoice) }
  }
  const mentions = new Set()
  if (/@channel\b/i.test(cleanText) && conversation.type === "group") {
    recipientUsers.forEach(member => mentions.add(String(member._id)))
  } else {
    for (const member of recipientUsers) {
      const handle = member.displayName.toLowerCase().replace(/[^a-z0-9_]+/g, "")
      if (handle && new RegExp(`(^|[^\\w])@${handle}(?![\\w])`, "i").test(cleanText)) mentions.add(String(member._id))
    }
  }
  const message = await ChatMessage.create({
    conversationId, senderId: user._id, text: cleanText, ciphertext: cleanCiphertext, encryptionIv: cleanIv,
    mentions: [...mentions], poll: cleanPoll, attachments, replyTo: replyTo?._id
  })
  conversation.lastMessage = {
    text: cleanText || (cleanCiphertext ? "Encrypted message" : cleanPoll ? `Poll: ${cleanPoll.question}` : attachments.length ? "Attachment" : ""),
    senderId: user._id, createdAt: message.createdAt, messageId: message._id
  }
  await conversation.save()
  await message.populate([
    { path: "senderId", select: "displayName" },
    { path: "replyTo", populate: { path: "senderId", select: "displayName" } }
  ])
  return { message, conversation }
}

export async function togglePinnedMessage(req, res, next) {
  try {
    const { id: conversationId, messageId } = req.params
    const conversation = await memberConversation(conversationId, req.user._id)
    if (!conversation || !/^[a-f\d]{24}$/i.test(messageId)) return res.status(404).json({ message: "Conversation or message not found." })
    const message = await ChatMessage.findOne({ _id: messageId, conversationId, deletedAt: null }).select("_id")
    if (!message) return res.status(404).json({ message: "Message not found." })
    const existing = conversation.pinnedMessages.find(item => String(item.messageId) === messageId)
    if (existing) conversation.pinnedMessages = conversation.pinnedMessages.filter(item => String(item.messageId) !== messageId)
    else {
      if (conversation.pinnedMessages.length >= 10) return res.status(409).json({ message: "A conversation can have up to ten pinned messages." })
      conversation.pinnedMessages.push({ messageId, pinnedBy: req.user._id })
    }
    await conversation.save()
    const pins = await ChatMessage.find({ _id: { $in: conversation.pinnedMessages.map(item => item.messageId) } })
      .sort({ createdAt: -1 }).populate("senderId", "displayName")
    const payload = { conversationId, pins }
    const io = req.app.get("io")
    if (io) emitConversationEvent(io, conversationId, conversation.members, "conversation:pins", payload)
    res.json({ pins })
  } catch (error) { next(error) }
}

export async function listPinnedMessages(req, res, next) {
  try {
    const conversation = await memberConversation(req.params.id, req.user._id)
    if (!conversation) return res.status(404).json({ message: "Conversation not found." })
    const pins = await ChatMessage.find({
      _id: { $in: conversation.pinnedMessages.map(item => item.messageId) },
      deletedAt: null
    }).sort({ createdAt: -1 }).populate("senderId", "displayName")
    res.json({ pins })
  } catch (error) { next(error) }
}

export async function setConversationEncryption(req, res, next) {
  try {
    const conversation = await memberConversation(req.params.id, req.user._id)
    if (!conversation) return res.status(404).json({ message: "Conversation not found." })
    if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ message: "Choose whether encryption is enabled." })
    conversation.encryptionEnabled = req.body.enabled
    await conversation.save()
    const payload = { conversationId: String(conversation._id), encryptionEnabled: conversation.encryptionEnabled }
    const io = req.app.get("io")
    if (io) emitConversationEvent(io, conversation._id, conversation.members, "conversation:settings", payload)
    res.json(payload)
  } catch (error) { next(error) }
}

export async function setConversationMute(req, res, next) {
  try {
    const conversation = await memberConversation(req.params.id, req.user._id)
    if (!conversation) return res.status(404).json({ message: "Conversation not found." })
    const { mutedUntil } = req.body || {}
    let until = null
    if (mutedUntil !== null && mutedUntil !== "forever") {
      until = new Date(mutedUntil)
      if (!Number.isFinite(until.getTime()) || until <= new Date()) return res.status(400).json({ message: "Choose a future mute time." })
    } else if (mutedUntil === undefined) return res.status(400).json({ message: "Choose a mute duration." })
    conversation.mutedBy = conversation.mutedBy.filter(item => String(item.userId) !== String(req.user._id))
    if (mutedUntil !== null) conversation.mutedBy.push({ userId: req.user._id, mutedUntil: until })
    await conversation.save()
    res.json({ conversationId: String(conversation._id), mutedUntil: mutedUntil === null ? null : until || "forever" })
  } catch (error) { next(error) }
}

export async function updateUserStatus(req, res, next) {
  try {
    const status = String(req.body?.status || "")
    const statusMessage = String(req.body?.statusMessage || "").trim().slice(0, 80)
    if (!["online", "away", "busy"].includes(status)) return res.status(400).json({ message: "Choose online, away, or busy." })
    req.user.status = status
    req.user.statusMessage = statusMessage
    await req.user.save()
    const payload = { userId: String(req.user._id), status, statusMessage }
    const io = req.app.get("io")
    if (io) io.emit("presence:update", { ...payload, online: true, lastSeenAt: req.user.lastSeenAt })
    res.json({ user: publicUser(req.user) })
  } catch (error) { next(error) }
}

export async function blockUser(req, res, next) {
  try {
    const userId = String(req.params.userId)
    if (!/^[a-f\d]{24}$/i.test(userId) || userId === String(req.user._id)) return res.status(400).json({ message: "Choose a valid user to block." })
    if (!await ChatUser.exists({ _id: userId })) return res.status(404).json({ message: "User not found." })
    const blocked = req.body?.blocked !== false
    await ChatUser.updateOne({ _id: req.user._id }, blocked
      ? { $addToSet: { blockedUsers: userId } }
      : { $pull: { blockedUsers: userId } })
    res.json({ userId, blocked })
  } catch (error) { next(error) }
}

export async function reportUser(req, res, next) {
  try {
    const userId = String(req.body?.userId || "")
    const conversationId = String(req.body?.conversationId || "")
    const reason = String(req.body?.reason || "").trim().slice(0, 500)
    if (!/^[a-f\d]{24}$/i.test(userId) || userId === String(req.user._id) || reason.length < 3) {
      return res.status(400).json({ message: "Choose a user and provide a short report reason." })
    }
    if (!await ChatUser.exists({ _id: userId })) return res.status(404).json({ message: "User not found." })
    if (conversationId && !await memberConversation(conversationId, req.user._id)) return res.status(404).json({ message: "Conversation not found." })
    const report = await ChatReport.create({
      reporterId: req.user._id, reportedUserId: userId, conversationId: conversationId || null,
      messageId: req.body?.messageId || null, reason
    })
    res.status(201).json({ reportId: String(report._id), status: report.status })
  } catch (error) { next(error) }
}

export async function voteOnPoll(req, res, next) {
  try {
    const conversation = await memberConversation(req.params.id, req.user._id)
    if (!conversation) return res.status(404).json({ message: "Conversation not found." })
    const message = await ChatMessage.findOne({ _id: req.params.messageId, conversationId: conversation._id, deletedAt: null })
    if (!message?.poll) return res.status(404).json({ message: "Poll not found." })
    if (message.poll.endsAt && message.poll.endsAt <= new Date()) return res.status(409).json({ message: "This poll is closed." })
    const optionIds = Array.isArray(req.body?.optionIndexes) ? [...new Set(req.body.optionIndexes)] : []
    if (!optionIds.length || optionIds.some(index => !Number.isInteger(index) || index < 0 || index >= message.poll.options.length)) {
      return res.status(400).json({ message: "Choose at least one valid poll option." })
    }
    if (!message.poll.multipleChoice && optionIds.length > 1) return res.status(400).json({ message: "This poll allows one choice." })
    for (const option of message.poll.options) option.votes = option.votes.filter(voter => String(voter) !== String(req.user._id))
    for (const index of optionIds) message.poll.options[index].votes.push(req.user._id)
    await message.save()
    const payload = { conversationId: String(conversation._id), messageId: String(message._id), poll: message.poll }
    const io = req.app.get("io")
    if (io) emitConversationEvent(io, conversation._id, conversation.members, "poll:updated", payload)
    res.json({ poll: message.poll })
  } catch (error) { next(error) }
}

export async function assistantAction(req, res, next) {
  try {
    const conversation = await memberConversation(req.params.id, req.user._id)
    if (!conversation) return res.status(404).json({ message: "Conversation not found." })
    if (conversation.encryptionEnabled) return res.status(409).json({ message: "AI features are unavailable for encrypted conversations." })
    const action = String(req.body?.action || "")
    if (!["replies", "summary"].includes(action)) return res.status(400).json({ message: "Choose replies or summary." })
    const rows = await ChatMessage.find({ conversationId: conversation._id, deletedAt: null, text: { $ne: "" } })
      .sort({ createdAt: -1 }).limit(action === "summary" ? 30 : 8).populate("senderId", "displayName")
    if (!rows.length) return res.status(400).json({ message: "There are no messages to use yet." })
    const transcript = rows.reverse().map(message => `${message.senderId?.displayName || "Member"}: ${message.text}`).join("\n").slice(-12000)
    const system = action === "summary"
      ? "Summarize this chat thread in concise bullet points. Do not invent details."
      : "Suggest three short, friendly replies to the latest messages. Return only the replies as a JSON array of strings."
    const output = await requestAssistantText({ system, text: transcript, maxTokens: action === "summary" ? 350 : 180 })
    if (action === "summary") return res.json({ summary: output })
    try {
      const suggestions = JSON.parse(output)
      if (!Array.isArray(suggestions) || suggestions.some(item => typeof item !== "string")) throw new Error("Invalid suggestions")
      return res.json({ suggestions: suggestions.slice(0, 3).map(item => item.slice(0, 240)) })
    } catch (error) {
      console.error("Configured AI provider returned invalid reply suggestions.", error?.name || "Error")
      return res.status(502).json({ message: "The configured AI provider returned invalid reply suggestions." })
    }
  } catch (error) { next(error) }
}

export async function translateMessage(req, res, next) {
  try {
    const conversation = await memberConversation(req.params.id, req.user._id)
    if (!conversation) return res.status(404).json({ message: "Conversation not found." })
    if (conversation.encryptionEnabled) return res.status(409).json({ message: "Translation is unavailable for encrypted conversations." })
    const message = await ChatMessage.findOne({ _id: req.params.messageId, conversationId: conversation._id, deletedAt: null })
    const targetLanguage = String(req.body?.targetLanguage || "").trim().slice(0, 40)
    if (!message?.text) return res.status(404).json({ message: "Message not found or has no text to translate." })
    if (!targetLanguage) return res.status(400).json({ message: "Choose a target language." })
    const translation = await requestAssistantText({
      system: `Translate the provided text into ${targetLanguage}. Return only the translation.`,
      text: message.text,
      maxTokens: 700
    })
    res.json({ translation })
  } catch (error) { next(error) }
}

export async function editMessage(req, res, next) {
  try {
    const { id: conversationId, messageId } = req.params
    const conversation = await memberConversation(conversationId, req.user._id)
    if (!/^[a-f\d]{24}$/i.test(messageId) || !conversation) {
      return res.status(404).json({ message: "Message not found." })
    }
    if (conversation.encryptionEnabled) return res.status(409).json({ message: "Editing is unavailable in encrypted conversations." })
    const text = String(req.body?.text || "").trim().slice(0, 5000)
    if (!text) return res.status(400).json({ message: "A message needs text." })
    const message = await ChatMessage.findOneAndUpdate(
      { _id: messageId, conversationId, senderId: req.user._id, deletedAt: null },
      { $set: { text, editedAt: new Date() } },
      { new: true, runValidators: true }
    ).populate([
      { path: "senderId", select: "displayName" },
      { path: "replyTo", populate: { path: "senderId", select: "displayName" } }
    ])
    if (!message) return res.status(404).json({ message: "Message not found or no longer editable." })
    await ChatConversation.updateOne(
      { _id: conversationId, "lastMessage.messageId": message._id },
      { $set: { "lastMessage.text": text } }
    )
    const event = { conversationId: String(conversationId), message }
    const io = req.app.get("io")
    if (io) emitConversationEvent(io, conversationId, conversation.members, "message:updated", event)
    res.json({ message })
  } catch (error) { next(error) }
}

export async function deleteMessage(req, res, next) {
  try {
    const { id: conversationId, messageId } = req.params
    const conversation = await memberConversation(conversationId, req.user._id)
    if (!/^[a-f\d]{24}$/i.test(messageId) || !conversation) {
      return res.status(404).json({ message: "Message not found." })
    }
    const message = await ChatMessage.findOneAndUpdate(
      { _id: messageId, conversationId, senderId: req.user._id, deletedAt: null },
      { $set: { text: "", ciphertext: "", encryptionIv: "", attachments: [], deletedAt: new Date() } },
      { new: true }
    ).populate([
      { path: "senderId", select: "displayName" },
      { path: "replyTo", populate: { path: "senderId", select: "displayName" } }
    ])
    if (!message) return res.status(404).json({ message: "Message not found or already deleted." })
    await ChatConversation.updateOne(
      { _id: conversationId, "lastMessage.messageId": message._id },
      { $set: { "lastMessage.text": "Message deleted" } }
    )
    const event = { conversationId: String(conversationId), message }
    const io = req.app.get("io")
    if (io) emitConversationEvent(io, conversationId, conversation.members, "message:deleted", event)
    res.json({ message })
  } catch (error) { next(error) }
}

export async function toggleMessageReaction(req, res, next) {
  try {
    const { id: conversationId, messageId } = req.params
    const conversation = await memberConversation(conversationId, req.user._id)
    if (!conversation || !/^[a-f\d]{24}$/i.test(messageId)) return res.status(404).json({ message: "Message not found." })
    const emoji = String(req.body?.emoji || "").trim()
    if (!emoji || emoji.length > 16 || !/\p{Extended_Pictographic}/u.test(emoji)) {
      return res.status(400).json({ message: "Choose a valid emoji reaction." })
    }
    const message = await ChatMessage.findOne({ _id: messageId, conversationId, deletedAt: null })
    if (!message) return res.status(404).json({ message: "Message not found or deleted." })
    const existing = message.reactions.find(reaction => String(reaction.userId) === String(req.user._id) && reaction.emoji === emoji)
    message.reactions = message.reactions.filter(reaction => String(reaction.userId) !== String(req.user._id))
    if (!existing) message.reactions.push({ userId: req.user._id, emoji })
    await message.save()
    const payload = { conversationId: String(conversationId), messageId: String(message._id), reactions: message.reactions }
    const io = req.app.get("io")
    if (io) emitConversationEvent(io, conversationId, conversation.members, "message:reaction", payload)
    res.json({ reactions: message.reactions })
  } catch (error) { next(error) }
}

export async function forwardMessage(req, res, next) {
  try {
    const { id: sourceConversationId, messageId } = req.params
    const targetConversationId = String(req.body?.targetConversationId || "")
    if (!/^[a-f\d]{24}$/i.test(messageId) || !/^[a-f\d]{24}$/i.test(targetConversationId)) {
      return res.status(400).json({ message: "Choose a valid message and conversation." })
    }
    const [source, target] = await Promise.all([
      memberConversation(sourceConversationId, req.user._id),
      memberConversation(targetConversationId, req.user._id)
    ])
    if (!source || !target) return res.status(404).json({ message: "Conversation not found." })
    const original = await ChatMessage.findOne({ _id: messageId, conversationId: source._id, deletedAt: null }).populate("senderId", "displayName")
    if (!original) return res.status(404).json({ message: "Message not found or deleted." })
    if (original.ciphertext) return res.status(409).json({ message: "Encrypted messages cannot be forwarded to another conversation." })
    const attachments = []
    try {
      for (const attachment of original.attachments) {
        const storageKey = randomUUID()
        await fs.promises.copyFile(uploadPath(attachment.storageKey), uploadPath(storageKey))
        const copiedAttachment = { ...attachment.toObject(), storageKey, thumbnailKey: "" }
        attachments.push(copiedAttachment)
        if (attachment.thumbnailKey && fs.existsSync(uploadPath(attachment.thumbnailKey))) {
          copiedAttachment.thumbnailKey = `${storageKey}.thumb.webp`
          await fs.promises.copyFile(uploadPath(attachment.thumbnailKey), uploadPath(copiedAttachment.thumbnailKey))
        }
      }
    } catch (error) {
      await Promise.all(attachments.flatMap(attachment => [
        fs.promises.unlink(uploadPath(attachment.storageKey)).catch(() => {}),
        attachment.thumbnailKey ? fs.promises.unlink(uploadPath(attachment.thumbnailKey)).catch(() => {}) : Promise.resolve()
      ]))
      throw Object.assign(new Error("An attachment could not be forwarded."), { status: 400, cause: error })
    }
    const message = await ChatMessage.create({
      conversationId: target._id,
      senderId: req.user._id,
      text: original.text,
      attachments,
      forwardedFrom: { displayName: original.senderId?.displayName || "A member" }
    })
    target.lastMessage = {
      text: message.text || (message.attachments.length ? "Forwarded attachment" : "Forwarded message"),
      senderId: req.user._id,
      createdAt: message.createdAt,
      messageId: message._id
    }
    await target.save()
    await message.populate("senderId", "displayName")
    const io = req.app.get("io")
    if (io) await publishNewMessage(io, target._id, message, req.user._id, target.members)
    res.status(201).json({ message })
  } catch (error) { next(error) }
}

export async function markRead(req, res, next) {
  try {
    const conversation = await memberConversation(req.params.id, req.user._id)
    if (!conversation) return res.status(404).json({ message: "Conversation not found." })
    const timestamp = new Date()
    await ChatConversation.updateOne(
      { _id: conversation._id, members: req.user._id },
      { $pull: { readStates: { userId: req.user._id } } }, { timestamps: false }
    )
    await ChatConversation.updateOne(
      { _id: conversation._id, members: req.user._id },
      { $push: { readStates: { userId: req.user._id, lastReadAt: timestamp } } }, { timestamps: false }
    )
    const state = { conversationId: String(conversation._id), userId: String(req.user._id), lastReadAt: timestamp }
    const io = req.app.get("io")
    if (io) emitConversationEvent(io, conversation._id, conversation.members, "read:update", state)
    res.json(state)
  } catch (error) { next(error) }
}

export async function downloadAttachment(req, res, next) {
  try {
    const key = String(req.params.key)
    if (!/^[a-f\d-]{36}$/i.test(key)) return res.status(404).json({ message: "Attachment not found." })
    const message = await ChatMessage.findOne({ "attachments.storageKey": key })
    if (!message || !await memberConversation(message.conversationId, req.user._id)) return res.status(404).json({ message: "Attachment not found." })
    const metadata = message.attachments.find(item => item.storageKey === key)
    const file = path.resolve(process.env.CHAT_UPLOAD_DIR || path.join(process.cwd(), "uploads"), key)
    if (!fs.existsSync(file)) return res.status(404).json({ message: "Attachment not found." })
    res.set({ "X-Content-Type-Options": "nosniff", "Content-Type": metadata.mimeType })
    res.download(file, safeOriginalName(metadata.originalName), error => { if (error && !res.headersSent) next(error) })
  } catch (error) { next(error) }
}

export async function downloadAttachmentThumbnail(req, res, next) {
  try {
    const key = String(req.params.key)
    if (!/^[a-f\d-]{36}$/i.test(key)) return res.status(404).json({ message: "Thumbnail not found." })
    const message = await ChatMessage.findOne({ "attachments.storageKey": key })
    if (!message || !await memberConversation(message.conversationId, req.user._id)) return res.status(404).json({ message: "Thumbnail not found." })
    const metadata = message.attachments.find(item => item.storageKey === key)
    if (!metadata?.thumbnailKey) return res.status(404).json({ message: "Thumbnail not found." })
    const file = uploadPath(metadata.thumbnailKey)
    if (!fs.existsSync(file)) return res.status(404).json({ message: "Thumbnail not found." })
    res.set({ "X-Content-Type-Options": "nosniff", "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600" })
    res.sendFile(file, error => { if (error && !res.headersSent) next(error) })
  } catch (error) { next(error) }
}

export async function findUserByEmail(req, res, next) {
  try {
    const q = String(req.query.q || "").trim().toLowerCase().slice(0, 100)
    if (q.length < 2) return res.json({ users: [] })
    const users = await ChatUser.find({ _id: { $ne: req.user._id }, email: { $regex: `^${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` } })
      .select("displayName email lastSeenAt").limit(8)
    res.json({ users: users.map(publicUser) })
  } catch (error) { next(error) }
}

export function uploadPath(storageKey) {
  return path.resolve(process.env.CHAT_UPLOAD_DIR || path.join(process.cwd(), "uploads"), storageKey)
}

export function newStorageKey() { return randomUUID() }
