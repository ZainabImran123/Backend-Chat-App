import mongoose from "mongoose"

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  displayName: { type: String, required: true, trim: true, maxlength: 60 },
  passwordHash: { type: String, required: true },
  avatar: { type: String, default: "" },
  lastSeenAt: { type: Date, default: null },
  status: { type: String, enum: ["online", "away", "busy"], default: "online" },
  statusMessage: { type: String, trim: true, maxlength: 80, default: "" },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "ChatUser" }]
}, { timestamps: true, collection: "chat_users" })

const attachmentSchema = new mongoose.Schema({
  storageKey: { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  thumbnailKey: { type: String, default: "" }
}, { _id: false })

const reactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatUser", required: true },
  emoji: { type: String, required: true, maxlength: 16 }
}, { _id: false })

const pinnedMessageSchema = new mongoose.Schema({
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatMessage", required: true },
  pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "ChatUser", required: true },
  pinnedAt: { type: Date, default: Date.now }
}, { _id: false })

const muteSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatConversation", required: true },
  mutedUntil: { type: Date, default: null }
}, { _id: false })

const pollOptionSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 100 },
  votes: [{ type: mongoose.Schema.Types.ObjectId, ref: "ChatUser" }]
}, { _id: false })

const pollSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true, maxlength: 240 },
  options: { type: [pollOptionSchema], validate: value => value.length >= 2 && value.length <= 8 },
  endsAt: { type: Date, default: null },
  multipleChoice: { type: Boolean, default: false }
}, { _id: false })

const conversationSchema = new mongoose.Schema({
  type: { type: String, enum: ["direct", "group"], required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "ChatUser", required: true }],
  name: { type: String, trim: true, maxlength: 80, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "ChatUser", required: true },
  lastMessage: {
    text: { type: String, default: "" },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatUser", default: null },
    createdAt: { type: Date, default: null },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatMessage", default: null }
  },
  readStates: [{ userId: mongoose.Schema.Types.ObjectId, lastReadAt: Date }],
  pinnedMessages: { type: [pinnedMessageSchema], default: [] },
  mutedBy: { type: [muteSchema], default: [] },
  encryptionEnabled: { type: Boolean, default: false }
}, { timestamps: true, collection: "chat_conversations" })
conversationSchema.index({ members: 1, updatedAt: -1 })

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatConversation", required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatUser", required: true, index: true },
  text: { type: String, trim: true, maxlength: 5000, default: "" },
  attachments: { type: [attachmentSchema], default: [] },
  reactions: { type: [reactionSchema], default: [] },
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "ChatUser" }],
  ciphertext: { type: String, default: "", maxlength: 12000 },
  encryptionIv: { type: String, default: "", maxlength: 64 },
  poll: { type: pollSchema, default: null },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "ChatMessage", default: null },
  forwardedFrom: {
    displayName: { type: String, default: "" }
  },
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "ChatUser" }],
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null }
}, { timestamps: true, collection: "chat_messages" })
messageSchema.index({ conversationId: 1, createdAt: -1 })
messageSchema.index({ conversationId: 1, text: "text" })

export const ChatUser = mongoose.models.ChatUser || mongoose.model("ChatUser", userSchema)
export const ChatConversation = mongoose.models.ChatConversation || mongoose.model("ChatConversation", conversationSchema)
export const ChatMessage = mongoose.models.ChatMessage || mongoose.model("ChatMessage", messageSchema)

const reportSchema = new mongoose.Schema({
  reporterId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatUser", required: true, index: true },
  reportedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatUser", required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatConversation", default: null },
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatMessage", default: null },
  reason: { type: String, trim: true, maxlength: 500, required: true },
  status: { type: String, enum: ["open", "reviewed"], default: "open" }
}, { timestamps: true, collection: "chat_reports" })

export const ChatReport = mongoose.models.ChatReport || mongoose.model("ChatReport", reportSchema)
