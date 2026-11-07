import { Router } from "express"
import multer from "multer"
import path from "node:path"
import fs from "node:fs"
import sharp from "sharp"
import { authenticateToken } from "../middlewares/auth.middleware.js"
import { rateLimit } from "../middlewares/rate-limit.js"
import {
  createAttachmentTicket, createConversation, downloadAttachment, downloadAttachmentThumbnail, findUserByEmail,
  blockUser, deleteMessage, editMessage, forwardMessage, listConversations, listMessages, markRead, reportUser,
  assistantAction, listPinnedMessages, setConversationEncryption, setConversationMute, toggleMessageReaction, togglePinnedMessage, translateMessage, updateUserStatus,
  voteOnPoll, newStorageKey, saveMessage, searchMessages
} from "../controllers/chat.controller.js"
import { ChatConversation } from "../models/chat.models.js"
import { publishNewMessage } from "../realtime/publish-message.js"

const router = Router()
const uploadDir = path.resolve(process.env.CHAT_UPLOAD_DIR || path.join(process.cwd(), "uploads"))
const allowedTypes = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf", "application/json", "text/plain", "text/csv", "text/markdown", "application/rtf", "application/octet-stream", "application/zip", "application/x-zip-compressed",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "audio/mpeg", "audio/ogg", "audio/webm", "audio/mp4", "audio/wav", "audio/x-wav",
  "video/mp4", "video/webm", "video/quicktime"
])
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try { fs.mkdirSync(uploadDir, { recursive: true }); cb(null, uploadDir) } catch (error) { cb(error) }
    },
    filename: (_req, _file, cb) => cb(null, newStorageKey())
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, allowedTypes.has(file.mimetype))
})
const searchLimit = rateLimit({ scope: "search", windowMs: 60_000, max: 40 })

router.use(authenticateToken)
router.get("/users", findUserByEmail)
router.patch("/users/me/status", updateUserStatus)
router.post("/users/:userId/block", blockUser)
router.post("/reports", reportUser)
router.get("/conversations", listConversations)
router.post("/conversations", createConversation)
router.get("/conversations/:id/messages", listMessages)
router.get("/conversations/:id/search", searchLimit, searchMessages)
router.post("/conversations/:id/read", markRead)
router.get("/conversations/:id/pins", listPinnedMessages)
router.patch("/conversations/:id/settings/encryption", setConversationEncryption)
router.patch("/conversations/:id/settings/mute", setConversationMute)
router.post("/conversations/:id/assistant", assistantAction)
router.post("/conversations/:id/messages/:messageId/translate", translateMessage)
router.post("/conversations/:id/messages/:messageId/pin", togglePinnedMessage)
router.post("/conversations/:id/messages/:messageId/poll/votes", voteOnPoll)
router.patch("/conversations/:id/messages/:messageId", editMessage)
router.delete("/conversations/:id/messages/:messageId", deleteMessage)
router.post("/conversations/:id/messages/:messageId/reactions", toggleMessageReaction)
router.post("/conversations/:id/messages/:messageId/forward", forwardMessage)
router.post("/conversations/:id/messages", async (req, res, next) => {
  try {
    const result = await saveMessage({
      conversationId: req.params.id, user: req.user, text: req.body?.text,
      attachmentTickets: req.body?.attachments, replyToId: req.body?.replyToId,
      ciphertext: req.body?.ciphertext, encryptionIv: req.body?.encryptionIv, poll: req.body?.poll
    })
    const io = req.app.get("io")
    if (io) await publishNewMessage(io, req.params.id, result.message, req.user._id, result.conversation.members)
    res.status(201).json({ message: result.message })
  } catch (error) { next(error) }
})
router.post("/conversations/:id/attachments", async (req, res, next) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id) || !await ChatConversation.exists({ _id: req.params.id, members: req.user._id })) {
      return res.status(404).json({ message: "Conversation not found." })
    }
    upload.single("file")(req, res, error => {
      if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "Files are limited to 25 MB." : "This file type is not allowed." })
      if (!req.file) return res.status(400).json({ message: "Choose an allowed file." })
      void (async () => {
        let thumbnailKey = ""
        if (req.file.mimetype.startsWith("image/")) {
          thumbnailKey = `${req.file.filename}.thumb.webp`
          await sharp(req.file.path).rotate().resize({ width: 480, height: 360, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 78 }).toFile(path.join(uploadDir, thumbnailKey))
        }
        const attachment = createAttachmentTicket({
          storageKey: req.file.filename, thumbnailKey, conversationId: req.params.id, userId: req.user._id,
          originalName: path.basename(req.file.originalname).slice(0, 180), mimeType: req.file.mimetype, size: req.file.size
        })
        res.status(201).json({ attachment })
      })().catch(async thumbnailError => {
        await Promise.all([
          fs.promises.unlink(req.file.path).catch(() => {}),
          fs.promises.unlink(path.join(uploadDir, `${req.file.filename}.thumb.webp`)).catch(() => {})
        ])
        next(thumbnailError)
      })
    })
  } catch (error) { next(error) }
})
router.get("/attachments/:key/thumbnail", downloadAttachmentThumbnail)
router.get("/attachments/:key", downloadAttachment)
export default router
