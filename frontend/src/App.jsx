import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { decryptText, deriveConversationKey, encryptText } from "./encryption.js"

const API = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "")

async function request(path, options = {}) {
  const form = options.body instanceof FormData
  const response = await fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: { ...(form ? {} : { "Content-Type": "application/json" }), ...options.headers }
  })
  if (response.status === 204) return null
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(result.message || `Request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return result
}

const initials = name => String(name || "?").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()
const timeLabel = value => {
  if (!value) return ""
  const date = new Date(value)
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}
const lastSeenLabel = value => {
  if (!value) return "Offline"
  const date = new Date(value)
  const sameDay = date.toDateString() === new Date().toDateString()
  return `Last seen ${sameDay ? `today at ${timeLabel(date)}` : date.toLocaleDateString([], { month: "short", day: "numeric" })}`
}
const conversationTitle = (conversation, me) => conversation.type === "group"
  ? conversation.name
  : conversation.members?.find(member => String(member._id || member.id) !== String(me?.id))?.displayName || "New conversation"
const mergeReadState = (states, state) => [
  ...states.filter(item => String(item.userId?._id || item.userId) !== String(state.userId?._id || state.userId)),
  state
]
const emojiChoices = ["😀", "😂", "🥰", "😍", "😎", "😭", "🤔", "👏", "🎉", "🔥", "❤️", "👍", "🙏", "✨", "💯"]
const stickerChoices = ["🥹", "🤗", "😻", "🙌", "💖", "🌈", "☀️", "🍀"]
const isEmojiValue = value => Boolean(value && /\p{Extended_Pictographic}/u.test(value) && !/[\p{L}\p{N}]/u.test(value) && value.length <= 16)

function Avatar({ name, online, small = false }) {
  return <span className={`avatar ${small ? "avatar-small" : ""}`}>{initials(name)}{online && <i className="online-dot" />}</span>
}

function Icon({ name, size = 20 }) {
  const paths = {
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    moon: <path d="M20.5 15A8.7 8.7 0 0 1 9 3.5 9 9 0 1 0 20.5 15Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    paperclip: <path d="m20.5 11.5-8.8 8.8a5 5 0 0 1-7.1-7.1l9.2-9.2a3.3 3.3 0 0 1 4.7 4.7L9 18.2a1.7 1.7 0 0 1-2.4-2.4l8.4-8.4" />,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h12" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z" /></>,
    check: <path d="m5 12 4 4L19 6" />
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function CallOverlay({ call, localStreamRef, remoteStreamRef, onAccept, onEnd }) {
  const localVideo = useRef(null)
  const remoteVideo = useRef(null)
  const remoteAudio = useRef(null)
  useEffect(() => {
    if (localVideo.current && localStreamRef.current) localVideo.current.srcObject = localStreamRef.current
    if (remoteVideo.current && remoteStreamRef.current) remoteVideo.current.srcObject = remoteStreamRef.current
    if (remoteAudio.current && remoteStreamRef.current) remoteAudio.current.srcObject = remoteStreamRef.current
  }, [call.status, call.media, localStreamRef, remoteStreamRef])
  return <div className="call-overlay" role="dialog" aria-modal="true" aria-label="Call">
    <div className="call-card">
      <audio ref={remoteAudio} autoPlay />
      {call.media === "video" && <div className="call-videos">
        <video ref={remoteVideo} autoPlay playsInline muted />
        {call.status !== "incoming" && <video ref={localVideo} autoPlay playsInline muted />}
      </div>}
      <span className="eyebrow">{call.status === "incoming" ? "INCOMING CALL" : call.status === "outgoing" ? "CALLING" : "IN CALL"}</span>
      <h2>{call.name}</h2>
      <p>{call.media === "video" ? "Video call" : "Audio call"}{call.status === "incoming" ? " · answer when you’re ready" : ""}</p>
      <div className="call-actions">
        {call.status === "incoming" && <button className="button button-primary" onClick={onAccept}>Answer</button>}
        <button className="button button-danger" onClick={onEnd}>{call.status === "incoming" ? "Decline" : "End call"}</button>
      </div>
    </div>
  </div>
}

function loadSocketClient() {
  if (window.io) return Promise.resolve()
  return new Promise(resolve => {
    const script = document.createElement("script")
    script.src = "/socket.io/socket.io.js"
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => resolve()
    document.head.appendChild(script)
  })
}

function AuthScreen({ onAuth, startupError }) {
  const [signup, setSignup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async event => {
    event.preventDefault()
    setBusy(true); setError("")
    const form = new FormData(event.currentTarget)
    try {
      const result = await request(`/auth/${signup ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify({ displayName: form.get("displayName"), email: form.get("email"), password: form.get("password") })
      })
      onAuth(result.user)
    } catch (issue) { setError(issue.message) } finally { setBusy(false) }
  }
  return <main className="auth-page">
    <div className="auth-art"><div className="art-sun" /><div className="art-copy"><span className="eyebrow">A little more connected</span><h1>Good conversations<br /><em>live here.</em></h1><p>A calm corner for your people, wherever life takes you.</p><div className="art-bubbles"><span>Hey, you made it ✨</span><span className="bubble-muted">Always good to hear from you</span></div></div><div className="art-footer">A place for your everyday conversations.</div></div>
    <section className="auth-panel"><div className="brand brand-dark"><span className="brand-mark"><Icon name="message" size={19} /></span> little hello</div>
      <div className="auth-form-wrap"><span className="eyebrow">{signup ? "MAKE YOURSELF AT HOME" : "WELCOME BACK"}</span><h2>{signup ? "Your people are waiting." : "Let's catch up."}</h2><p className="auth-subtitle">{signup ? "Create an account to start your conversations." : "Sign in to pick up right where you left off."}</p>
        {startupError && <div className="setup-notice" role="status">The chat service isn’t ready yet: {startupError}</div>}
        <form className="auth-form" onSubmit={submit}>
          {signup && <label>Your name<input name="displayName" autoComplete="name" required maxLength={60} placeholder="How should we call you?" /></label>}
          <label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></label>
          <label>Password<input name="password" type="password" minLength={10} required autoComplete={signup ? "new-password" : "current-password"} placeholder={signup ? "At least 10 characters" : "Your password"} /></label>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? "One moment…" : signup ? "Create account" : "Sign in"} <span>→</span></button>
        </form>
        <p className="auth-switch">{signup ? "Already have an account?" : "New to Little Hello?"} <button type="button" onClick={() => { setSignup(!signup); setError("") }}>{signup ? "Sign in" : "Create an account"}</button></p>
      </div>
      <div className="auth-footnote">Private conversations. Just you and your people.</div>
    </section>
  </main>
}

function NewConversation({ onClose, onCreated }) {
  const [type, setType] = useState("direct")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async event => {
    event.preventDefault()
    setBusy(true); setError("")
    const data = new FormData(event.currentTarget)
    const memberEmails = String(data.get("emails") || "").split(",").map(value => value.trim()).filter(Boolean)
    try {
      const result = await request("/conversations", { method: "POST", body: JSON.stringify({ type, name: data.get("name"), memberEmails }) })
      onCreated(result.conversation)
    } catch (issue) { setError(issue.message) } finally { setBusy(false) }
  }
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <form className="modal" onSubmit={submit}>
      <div className="modal-head"><div><span className="eyebrow">MAKE A LITTLE SPACE</span><h2>Start a conversation</h2></div><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
      <div className="segmented"><button type="button" className={type === "direct" ? "selected" : ""} onClick={() => setType("direct")}>One to one</button><button type="button" className={type === "group" ? "selected" : ""} onClick={() => setType("group")}>Group chat</button></div>
      {type === "group" && <label>Group name<input name="name" required maxLength={80} placeholder="The weekend crew" /></label>}
      <label>{type === "group" ? "Members' email addresses" : "Their email address"}<input name="emails" required type="text" placeholder={type === "group" ? "alex@example.com, sam@example.com" : "friend@example.com"} /></label>
      <p className="field-note">{type === "group" ? "Separate email addresses with commas." : "They need a Little Hello account first."}</p>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <button className="button button-primary modal-submit" disabled={busy}>{busy ? "Starting…" : "Start chatting"} <span>→</span></button>
    </form>
  </div>
}

function ForwardDialog({ conversations, user, message, onClose, onForward }) {
  const [targetConversationId, setTargetConversationId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async event => {
    event.preventDefault()
    if (!targetConversationId) return
    setBusy(true); setError("")
    try { await onForward(targetConversationId, message) }
    catch (issue) { setError(issue.message) }
    finally { setBusy(false) }
  }
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <form className="modal" onSubmit={submit}>
      <div className="modal-head"><div><span className="eyebrow">PASS IT ALONG</span><h2>Forward this message</h2></div><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
      <label>Send to<select value={targetConversationId} onChange={event => setTargetConversationId(event.target.value)} required>
        <option value="">Choose a conversation</option>
        {conversations.map(conversation => <option key={conversation._id} value={conversation._id}>{conversationTitle(conversation, user)}</option>)}
      </select></label>
      <p className="field-note">{message.text || "Attachment"} will be shared with everyone in the selected conversation.</p>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <button className="button button-primary modal-submit" disabled={busy || !targetConversationId}>{busy ? "Forwarding…" : "Forward message"} <span>→</span></button>
    </form>
  </div>
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [conversations, setConversations] = useState([])
  const [conversationsHasMore, setConversationsHasMore] = useState(false)
  const [active, setActive] = useState(null)
  const [messages, setMessages] = useState([])
  const [messagesHasMore, setMessagesHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [readStates, setReadStates] = useState([])
  const [draft, setDraft] = useState("")
  const [replyTo, setReplyTo] = useState(null)
  const [editingMessage, setEditingMessage] = useState(null)
  const [forwardingMessage, setForwardingMessage] = useState(null)
  const [call, setCall] = useState(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emojiTab, setEmojiTab] = useState("emoji")
  const [customEmoji, setCustomEmoji] = useState("")
  const [customEmojis, setCustomEmojis] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("little-hello-custom-emojis") || "[]")
      return Array.isArray(saved) ? saved.filter(isEmojiValue).slice(0, 20) : []
    } catch { return [] }
  })
  const [isRecording, setIsRecording] = useState(false)
  const [search, setSearch] = useState("")
  const [searchKind, setSearchKind] = useState("all")
  const [searchSender, setSearchSender] = useState("")
  const [searchResults, setSearchResults] = useState(null)
  const [summary, setSummary] = useState("")
  const [replySuggestions, setReplySuggestions] = useState([])
  const [pinnedMessages, setPinnedMessages] = useState([])
  const [encryptionInput, setEncryptionInput] = useState("")
  const [showEncryptionSetup, setShowEncryptionSetup] = useState(false)
  const [encryptionSetupMode, setEncryptionSetupMode] = useState("unlock")
  const [translationByMessage, setTranslationByMessage] = useState({})
  const [showPollForm, setShowPollForm] = useState(false)
  const [typing, setTyping] = useState("")
  const [onlineUsers, setOnlineUsers] = useState({})
  const [showNew, setShowNew] = useState(false)
  const [mobileChat, setMobileChat] = useState(false)
  const [error, setError] = useState("")
  const [startupError, setStartupError] = useState("")
  const [socketStatus, setSocketStatus] = useState("connecting")
  const [theme, setTheme] = useState(() => localStorage.getItem("little-hello-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"))
  const socketRef = useRef(null)
  const bottomRef = useRef(null)
  const preserveScroll = useRef(false)
  const typingTimer = useRef(null)
  const localTypingTimer = useRef(null)
  const activeRef = useRef(active)
  const conversationsRef = useRef(conversations)
  const callRef = useRef(null)
  const peerRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteStreamRef = useRef(null)
  const pendingOfferRef = useRef(null)
  const pendingCandidatesRef = useRef([])
  const recorderRef = useRef(null)
  const recordingPartsRef = useRef([])
  const encryptionKeysRef = useRef(new Map())
  activeRef.current = active
  conversationsRef.current = conversations
  callRef.current = call

  const hydrateMessage = async (conversationId, message) => {
    if (!message.ciphertext) return message
    const key = encryptionKeysRef.current.get(String(conversationId))
    if (!key) return { ...message, locked: true }
    try { return { ...message, text: await decryptText(key, message.ciphertext, message.encryptionIv), locked: false } }
    catch (issue) {
      setError("Could not decrypt a message. Check the shared passphrase.")
      return { ...message, locked: true }
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem("little-hello-theme", theme)
  }, [theme])

  useEffect(() => { localStorage.setItem("little-hello-custom-emojis", JSON.stringify(customEmojis)) }, [customEmojis])

  useEffect(() => {
    if (!user) return
    const unread = conversations.filter(conversation => {
      const last = conversation.lastMessage
      if (!last?.createdAt || String(last.senderId?._id || last.senderId) === user.id) return false
      const state = conversation.readStates?.find(item => String(item.userId?._id || item.userId) === user.id)
      return !state?.lastReadAt || new Date(last.createdAt) > new Date(state.lastReadAt)
    }).length
    document.title = unread ? `(${unread}) Little Hello` : "Little Hello"
    if (navigator.setAppBadge) navigator.setAppBadge(unread).catch(() => {})
    if (!unread && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {})
  }, [conversations, user])

  const loadConversations = useCallback(async () => {
    const result = await request("/conversations")
    setConversations(result.conversations)
    setConversationsHasMore(result.hasMore)
    if (!activeRef.current && result.conversations[0]) setActive(result.conversations[0])
  }, [])

  useEffect(() => {
    request("/auth/me")
      .then(result => setUser(result.user))
      .catch(issue => {
        if (issue.status !== 401) setStartupError(issue.message)
      })
      .finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    if (!user) return
    let alive = true
    let socket
    loadConversations().catch(issue => alive && setError(issue.message))
    loadSocketClient().then(() => {
      if (!alive) return
      if (!window.io) { setSocketStatus("offline"); return }
      socket = window.io({ withCredentials: true, transports: ["websocket", "polling"] })
      socketRef.current = socket
      socket.on("connect", () => { setSocketStatus("connected"); if (activeRef.current) socket.emit("conversation:join", { conversationId: activeRef.current._id }) })
      socket.on("disconnect", () => setSocketStatus("offline"))
      socket.on("connect_error", () => setSocketStatus("offline"))
      socket.on("message:new", ({ message, conversationId }) => {
        if (String(activeRef.current?._id) === String(conversationId)) {
          void hydrateMessage(conversationId, message).then(ready => setMessages(current => current.some(item => item._id === message._id) ? current : [...current, ready]))
          if (String(message.senderId?._id || message.senderId) !== user.id) socket.emit("read:update", { conversationId })
        }
        loadConversations().catch(issue => setError(issue.message))
      })
      socket.on("message:updated", ({ conversationId, message }) => {
        if (String(activeRef.current?._id) === String(conversationId)) setMessages(current => current.map(item => item._id === message._id ? message : item))
        loadConversations().catch(issue => setError(issue.message))
      })
      socket.on("message:deleted", ({ conversationId, message }) => {
        if (String(activeRef.current?._id) === String(conversationId)) setMessages(current => current.map(item => item._id === message._id ? message : item))
        loadConversations().catch(issue => setError(issue.message))
      })
      socket.on("message:reaction", ({ conversationId, messageId, reactions }) => {
        if (String(activeRef.current?._id) === String(conversationId)) {
          setMessages(current => current.map(message => String(message._id) === String(messageId) ? { ...message, reactions } : message))
        }
      })
      socket.on("poll:updated", ({ conversationId, messageId, poll }) => {
        if (String(activeRef.current?._id) === String(conversationId)) {
          setMessages(current => current.map(message => String(message._id) === String(messageId) ? { ...message, poll } : message))
        }
      })
      socket.on("conversation:pins", ({ conversationId, pins }) => {
        if (String(activeRef.current?._id) === String(conversationId)) setPinnedMessages(pins)
      })
      socket.on("conversation:settings", ({ conversationId, encryptionEnabled }) => {
        setActive(current => String(current?._id) === String(conversationId) ? { ...current, encryptionEnabled } : current)
        setConversations(current => current.map(item => String(item._id) === String(conversationId) ? { ...item, encryptionEnabled } : item))
      })
      socket.on("call:signal", event => {
        if (event.type === "offer") {
          if (callRef.current) {
            socket.emit("call:signal", { conversationId: event.conversationId, type: "busy" })
            return
          }
          pendingOfferRef.current = event.sdp
          const conversation = conversationsRef.current.find(item => String(item._id) === String(event.conversationId))
          if (conversation) setActive(conversation)
          setCall({ status: "incoming", media: event.media || "audio", name: event.displayName, conversationId: event.conversationId, senderId: event.senderId })
          return
        }
        if (event.type === "answer" && peerRef.current) {
          peerRef.current.setRemoteDescription(new RTCSessionDescription(event.sdp)).then(async () => {
            for (const candidate of pendingCandidatesRef.current.splice(0)) await peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate))
            setCall(current => current ? { ...current, status: "active" } : current)
          }).catch(issue => setError(`Could not connect the call: ${issue.message}`))
          return
        }
        if (event.type === "candidate") {
          if (peerRef.current?.remoteDescription) {
            peerRef.current.addIceCandidate(new RTCIceCandidate(event.candidate)).catch(issue => setError(`Could not connect the call: ${issue.message}`))
          } else pendingCandidatesRef.current.push(event.candidate)
          return
        }
        if (["reject", "end", "busy"].includes(event.type)) endCall(false, event.type === "busy" ? "They’re already on another call." : "")
      })
      socket.on("message:delivered", ({ conversationId, userId: recipientId, messageIds }) => {
        if (String(activeRef.current?._id) !== String(conversationId)) return
        const ids = new Set(messageIds)
        setMessages(current => current.map(message => ids.has(String(message._id))
          ? { ...message, deliveredTo: [...new Set([...(message.deliveredTo || []).map(item => String(item._id || item)), recipientId])] }
          : message))
      })
      socket.on("typing:update", event => {
        if (String(activeRef.current?._id) === String(event.conversationId) && event.userId !== user.id) {
          setTyping(event.typing ? event.displayName : "")
          if (event.typing) { clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => setTyping(""), 2200) }
        }
      })
      socket.on("read:update", event => {
        const sameConversation = conversation => String(conversation?._id) === String(event.conversationId)
        if (sameConversation(activeRef.current)) setReadStates(current => mergeReadState(current, event))
        setActive(current => sameConversation(current) ? { ...current, readStates: mergeReadState(current.readStates || [], event) } : current)
        setConversations(current => current.map(conversation => sameConversation(conversation)
          ? { ...conversation, readStates: mergeReadState(conversation.readStates || [], event) }
          : conversation))
      })
      socket.on("presence:update", event => setOnlineUsers(current => ({
        ...current,
        [event.userId]: { online: Boolean(event.online), lastSeenAt: event.lastSeenAt, status: event.status || "online", statusMessage: event.statusMessage || "" }
      })))
    })
    return () => { alive = false; socket?.disconnect() }
  }, [user, loadConversations])

  useEffect(() => {
    if (!active || !user) { setMessages([]); return }
    setReadStates(active.readStates || [])
    setReplyTo(null); setEditingMessage(null); setDraft("")
    setTyping("")
    clearTimeout(typingTimer.current)
    setSearchResults(null); setSearch("")
    setSummary(""); setReplySuggestions([])
    setMessagesHasMore(false)
    request(`/conversations/${active._id}/messages`).then(result => {
      Promise.all(result.messages.map(message => hydrateMessage(active._id, message))).then(setMessages)
      setMessagesHasMore(result.hasMore)
    }).catch(issue => setError(issue.message))
    request(`/conversations/${active._id}/pins`).then(result => setPinnedMessages(result.pins)).catch(issue => setError(issue.message))
    const socket = socketRef.current
    if (socket?.connected) {
      socket.emit("conversation:join", { conversationId: active._id })
      socket.emit("read:update", { conversationId: active._id })
    }
    request(`/conversations/${active._id}/read`, { method: "POST" }).then(state => {
      if (state) {
        setReadStates(current => mergeReadState(current, state))
        setActive(current => String(current?._id) === String(state.conversationId)
          ? { ...current, readStates: mergeReadState(current.readStates || [], state) } : current)
        setConversations(current => current.map(conversation => String(conversation._id) === String(state.conversationId)
          ? { ...conversation, readStates: mergeReadState(conversation.readStates || [], state) } : conversation))
      }
    }).catch(issue => setError(issue.message))
  }, [active?._id, user])

  useEffect(() => {
    if (preserveScroll.current) { preserveScroll.current = false; return }
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, typing])

  const activeTitle = useMemo(() => active ? conversationTitle(active, user) : "", [active, user])
  const activeOther = active?.members?.find(member => String(member._id || member.id) !== String(user?.id))
  const activeOtherId = String(activeOther?._id || activeOther?.id || "")
  const otherPresence = onlineUsers[activeOtherId]
  const isOnline = Boolean(activeOther && (otherPresence?.online || otherPresence === "online"))
  const activeStatus = otherPresence?.status || activeOther?.status || "online"
  const lastSeenAt = otherPresence?.lastSeenAt || (typeof otherPresence === "string" ? otherPresence : activeOther?.lastSeenAt)

  const chooseConversation = conversation => { setActive(conversation); setMobileChat(true); setError("") }
  const signOut = async () => {
    try {
      await request("/auth/logout", { method: "POST" })
      endCall(true)
      socketRef.current?.disconnect()
      setUser(null)
      setActive(null)
      setConversations([])
    } catch (issue) {
      setError(issue.message)
    }
  }

  const submitMessage = async (event, tickets = []) => {
    event?.preventDefault()
    if (editingMessage) {
      const text = draft.trim()
      if (!text) return
      try {
        const result = await request(`/conversations/${active._id}/messages/${editingMessage._id}`, {
          method: "PATCH", body: JSON.stringify({ text })
        })
        setMessages(current => current.map(item => item._id === result.message._id ? result.message : item))
        setEditingMessage(null); setDraft(""); setError("")
        loadConversations().catch(issue => setError(issue.message))
      } catch (issue) { setError(issue.message) }
      return
    }
    if (!active || (!draft.trim() && !tickets.length)) return
    const text = draft.trim()
    let encryptedPayload = {}
    if (active.encryptionEnabled) {
      const key = encryptionKeysRef.current.get(String(active._id))
      if (!key) { setShowEncryptionSetup(true); setEncryptionSetupMode("unlock"); return }
      if (tickets.length) { setError("Attachments are not supported in encrypted conversations yet."); return }
      try { encryptedPayload = await encryptText(key, text) }
      catch (issue) { setError(issue.message); return }
    }
    const requestBody = {
      conversationId: active._id, text: active.encryptionEnabled ? "" : text, attachments: tickets,
      replyToId: replyTo?._id, ...encryptedPayload
    }
    setDraft(""); setError("")
    const socket = socketRef.current
    if (socket?.connected) {
      socket.emit("message:send", requestBody, response => {
        if (!response?.ok) { setError(response?.error || "Message could not be sent."); setDraft(text) }
        else {
          void hydrateMessage(active._id, response.message).then(ready => setMessages(current => current.some(item => item._id === response.message._id) ? current : [...current, { ...ready, text }]))
          setReplyTo(null)
        }
      })
    } else {
      try {
        const result = await request(`/conversations/${active._id}/messages`, { method: "POST", body: JSON.stringify(requestBody) })
        setMessages(current => current.some(item => item._id === result.message._id) ? current : [...current, { ...result.message, text }])
        setReplyTo(null)
        loadConversations().catch(issue => setError(issue.message))
      } catch (issue) { setError(issue.message); setDraft(text) }
    }
  }

  const startReply = message => { setReplyTo(message); setEditingMessage(null) }
  const startEdit = message => { setEditingMessage(message); setReplyTo(null); setDraft(message.text || "") }
  const cancelComposeAction = () => { setEditingMessage(null); setReplyTo(null); setDraft("") }
  const removeMessage = async message => {
    if (!window.confirm("Delete this message for everyone in the conversation?")) return
    try {
      const result = await request(`/conversations/${active._id}/messages/${message._id}`, { method: "DELETE" })
      setMessages(current => current.map(item => item._id === result.message._id ? result.message : item))
      loadConversations().catch(issue => setError(issue.message))
    } catch (issue) { setError(issue.message) }
  }
  const forwardMessage = async (targetConversationId, message) => {
    await request(`/conversations/${active._id}/messages/${message._id}/forward`, {
      method: "POST", body: JSON.stringify({ targetConversationId })
    })
    setForwardingMessage(null)
    loadConversations().catch(issue => setError(issue.message))
  }

  const togglePin = async message => {
    try {
      const result = await request(`/conversations/${active._id}/messages/${message._id}/pin`, { method: "POST" })
      setPinnedMessages(result.pins)
    } catch (issue) { setError(issue.message) }
  }

  const unlockOrEnableEncryption = async event => {
    event.preventDefault()
    try {
      const key = await deriveConversationKey(encryptionInput, String(active._id))
      encryptionKeysRef.current.set(String(active._id), key)
      if (encryptionSetupMode === "enable") {
        await request(`/conversations/${active._id}/settings/encryption`, { method: "PATCH", body: JSON.stringify({ enabled: true }) })
        setActive(current => current ? { ...current, encryptionEnabled: true } : current)
        setConversations(current => current.map(item => String(item._id) === String(active._id) ? { ...item, encryptionEnabled: true } : item))
      } else {
        setMessages(current => current.map(message => message.ciphertext ? { ...message, locked: true } : message))
        const result = await request(`/conversations/${active._id}/messages`)
        const decrypted = await Promise.all(result.messages.map(message => hydrateMessage(active._id, message)))
        setMessages(decrypted)
      }
      setEncryptionInput("")
      setShowEncryptionSetup(false)
    } catch (issue) { setError(issue.message) }
  }

  const updateStatus = async event => {
    const status = event.target.value
    const statusMessage = status === "online" ? "" : window.prompt("Add an optional status message", user.statusMessage || "") || ""
    try {
      const result = await request("/users/me/status", { method: "PATCH", body: JSON.stringify({ status, statusMessage }) })
      setUser(result.user)
    } catch (issue) { setError(issue.message) }
  }

  const runAssistant = async action => {
    if (active?.encryptionEnabled) { setError("AI features are unavailable for encrypted conversations."); return }
    try {
      const result = await request(`/conversations/${active._id}/assistant`, { method: "POST", body: JSON.stringify({ action }) })
      if (action === "summary") setSummary(result.summary)
      else setReplySuggestions(result.suggestions)
    } catch (issue) { setError(issue.message) }
  }

  const translate = async message => {
    const targetLanguage = window.prompt("Translate into which language? (for example: Spanish)")
    if (!targetLanguage) return
    try {
      const result = await request(`/conversations/${active._id}/messages/${message._id}/translate`, { method: "POST", body: JSON.stringify({ targetLanguage }) })
      setTranslationByMessage(current => ({ ...current, [message._id]: result.translation }))
    } catch (issue) { setError(issue.message) }
  }

  const voteOnPoll = async (message, optionIndexes) => {
    try {
      const result = await request(`/conversations/${active._id}/messages/${message._id}/poll/votes`, { method: "POST", body: JSON.stringify({ optionIndexes }) })
      setMessages(current => current.map(item => item._id === message._id ? { ...item, poll: result.poll } : item))
    } catch (issue) { setError(issue.message) }
  }

  const createPoll = async event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const question = String(form.get("question") || "")
    const options = [form.get("option1"), form.get("option2"), form.get("option3"), form.get("option4")].filter(Boolean).map(String)
    try {
      const result = await request(`/conversations/${active._id}/messages`, {
        method: "POST", body: JSON.stringify({ poll: { question, options, multipleChoice: form.get("multipleChoice") === "on" } })
      })
      setMessages(current => [...current, result.message])
      setShowPollForm(false)
    } catch (issue) { setError(issue.message) }
  }

  const endCall = (notifyPeer = true, notification = "") => {
    const currentCall = callRef.current
    if (notifyPeer && currentCall) {
      socketRef.current?.emit("call:signal", {
        conversationId: currentCall.conversationId,
        type: currentCall.status === "incoming" ? "reject" : "end"
      })
    }
    peerRef.current?.close()
    peerRef.current = null
    localStreamRef.current?.getTracks().forEach(track => track.stop())
    localStreamRef.current = null
    remoteStreamRef.current = null
    pendingOfferRef.current = null
    pendingCandidatesRef.current = []
    setCall(null)
    if (notification) setError(notification)
  }

  const makePeerConnection = conversationId => {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] })
    peerRef.current = peer
    localStreamRef.current?.getTracks().forEach(track => peer.addTrack(track, localStreamRef.current))
    remoteStreamRef.current = new MediaStream()
    peer.ontrack = event => {
      event.streams[0]?.getTracks().forEach(track => remoteStreamRef.current?.addTrack(track))
      const video = document.querySelector(".call-videos video")
      if (video && remoteStreamRef.current) video.srcObject = remoteStreamRef.current
    }
    peer.onicecandidate = event => {
      if (event.candidate) socketRef.current?.emit("call:signal", {
        conversationId, type: "candidate", candidate: event.candidate.toJSON()
      })
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") endCall(false, "The call failed.")
    }
    return peer
  }

  const startCall = async media => {
    if (!active || active.type !== "direct" || !socketRef.current?.connected) {
      setError(active?.type === "group" ? "Calls are available in direct conversations." : "Reconnect to start a call.")
      return
    }
    try {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: media === "video" })
      remoteStreamRef.current = new MediaStream()
      const peer = makePeerConnection(String(active._id))
      setCall({ status: "outgoing", media, name: activeTitle, conversationId: String(active._id) })
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      socketRef.current.emit("call:signal", { conversationId: String(active._id), type: "offer", media, sdp: peer.localDescription }, result => {
        if (!result?.ok) endCall(false, result?.error || "Could not start the call.")
      })
    } catch (issue) {
      endCall(false, issue?.name === "NotAllowedError" ? "Allow microphone and camera access to call." : `Could not start the call: ${issue.message}`)
    }
  }

  const answerCall = async () => {
    const currentCall = callRef.current
    if (!currentCall || !pendingOfferRef.current) return
    try {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: currentCall.media === "video" })
      remoteStreamRef.current = new MediaStream()
      const peer = makePeerConnection(currentCall.conversationId)
      await peer.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current))
      for (const candidate of pendingCandidatesRef.current.splice(0)) await peer.addIceCandidate(new RTCIceCandidate(candidate))
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      setCall(current => current ? { ...current, status: "active" } : current)
      socketRef.current?.emit("call:signal", { conversationId: currentCall.conversationId, type: "answer", sdp: peer.localDescription }, result => {
        if (!result?.ok) endCall(false, result?.error || "Could not answer the call.")
      })
    } catch (issue) {
      endCall(true, issue?.name === "NotAllowedError" ? "Allow microphone and camera access to answer." : `Could not answer the call: ${issue.message}`)
    }
  }

  const toggleMessageReaction = async (message, emoji) => {
    try {
      const result = await request(`/conversations/${active._id}/messages/${message._id}/reactions`, {
        method: "POST", body: JSON.stringify({ emoji })
      })
      setMessages(current => current.map(item => item._id === message._id ? { ...item, reactions: result.reactions } : item))
    } catch (issue) { setError(issue.message) }
  }

  const uploadFiles = async files => {
    if (!files.length || !active) return
    const tickets = []
    for (const file of files.slice(0, 5)) {
      const data = new FormData()
      data.append("file", file)
      const response = await request(`/conversations/${active._id}/attachments`, { method: "POST", body: data })
      tickets.push(response.attachment.token)
    }
    await submitMessage(null, tickets)
  }

  const onFiles = async event => {
    const files = Array.from(event.target.files || []).slice(0, 5)
    try { await uploadFiles(files) } catch (issue) { setError(issue.message) }
    event.target.value = ""
  }

  const toggleVoiceRecording = async () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recordingPartsRef.current = []
      recorderRef.current = recorder
      recorder.ondataavailable = event => { if (event.data.size) recordingPartsRef.current.push(event.data) }
      recorder.onerror = event => {
        stream.getTracks().forEach(track => track.stop())
        setIsRecording(false)
        setError(`Voice recording failed: ${event.error?.message || "unknown error"}`)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        setIsRecording(false)
        const blob = new Blob(recordingPartsRef.current, { type: recorder.mimeType || "audio/webm" })
        if (blob.size) {
          const extension = blob.type.includes("mp4") ? "m4a" : "webm"
          try { await uploadFiles([new File([blob], `voice-note.${extension}`, { type: blob.type })]) }
          catch (issue) { setError(issue.message) }
        }
      }
      recorder.start()
      setIsRecording(true)
    } catch (issue) {
      setError(issue?.name === "NotAllowedError" ? "Allow microphone access to record a voice note." : `Could not record a voice note: ${issue.message}`)
    }
  }

  const runSearch = async event => {
    event.preventDefault()
    if (!active || (search.trim().length === 1)) { setSearchResults(null); return }
    try {
      const params = new URLSearchParams({ q: search.trim(), kind: searchKind, sender: searchSender })
      const result = await request(`/conversations/${active._id}/search?${params}`)
      setSearchResults(result.messages)
    } catch (issue) { setError(issue.message) }
  }

  const loadOlderMessages = async () => {
    if (!active || !messages.length || loadingOlder) return
    setLoadingOlder(true)
    preserveScroll.current = true
    try {
      const before = encodeURIComponent(messages[0].createdAt)
      const result = await request(`/conversations/${active._id}/messages?before=${before}`)
      setMessages(current => [...result.messages, ...current])
      setMessagesHasMore(result.hasMore)
    } catch (issue) { setError(issue.message); preserveScroll.current = false }
    finally { setLoadingOlder(false) }
  }

  const loadMoreConversations = async () => {
    const oldest = conversations[conversations.length - 1]
    const before = oldest?.updatedAt
    if (!before) { setConversationsHasMore(false); return }
    try {
      const result = await request(`/conversations?before=${encodeURIComponent(before)}`)
      setConversations(current => [...current, ...result.conversations.filter(item => !current.some(row => row._id === item._id))])
      setConversationsHasMore(result.hasMore)
    } catch (issue) { setError(issue.message) }
  }

  const onDraft = value => {
    setDraft(value)
    if (active && socketRef.current?.connected) {
      socketRef.current.emit("typing:update", { conversationId: active._id, typing: Boolean(value.trim()) })
      clearTimeout(localTypingTimer.current)
      if (value.trim()) localTypingTimer.current = setTimeout(() => socketRef.current?.emit("typing:update", { conversationId: active._id, typing: false }), 1300)
    }
  }

  if (authLoading) return <div className="boot-screen"><span className="loader" />Warming up your space…</div>
  if (!user) return <AuthScreen onAuth={nextUser => { setStartupError(""); setUser(nextUser) }} startupError={startupError} />
  const shownMessages = searchResults || messages

  return <main className={`app-shell ${mobileChat ? "show-chat" : ""}`}>
    <aside className="sidebar">
      <header className="side-header"><a className="brand" href="#" aria-label="Little Hello home"><span className="brand-mark"><Icon name="message" size={19} /></span> little hello</a><button className="theme-toggle" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} onClick={() => setTheme(theme === "light" ? "dark" : "light")}><Icon name={theme === "light" ? "moon" : "sun"} size={18} /></button></header>
      <div className="side-intro"><span className="eyebrow">YOUR LITTLE CORNER</span><h1>Messages<span className="message-count">{conversations.length || ""}</span></h1></div>
      <div className="side-actions"><label className="conversation-search"><Icon name="search" size={17} /><input placeholder="Find a conversation" aria-label="Find a conversation" onChange={event => {
        const query = event.target.value.toLowerCase()
        document.querySelectorAll("[data-title]").forEach(node => { node.hidden = !node.dataset.title.toLowerCase().includes(query) })
      }} /></label><button className="new-button" onClick={() => setShowNew(true)} aria-label="Start a conversation"><Icon name="plus" size={19} /></button></div>
      <div className="conversation-list">
        {conversations.length === 0 && <div className="conversation-empty"><span className="empty-icon"><Icon name="message" size={23} /></span><strong>Your people go here.</strong><p>Start a conversation and say hello.</p><button className="text-button" onClick={() => setShowNew(true)}>Start a chat <span>→</span></button></div>}
        {conversations.map(conversation => {
          const title = conversationTitle(conversation, user)
          const other = conversation.members?.find(member => String(member._id || member.id) !== user.id)
          const presence = onlineUsers[String(other?._id || other?.id)]
          const online = Boolean(presence?.online || presence === "online")
          const last = conversation.lastMessage
          const readState = conversation.readStates?.find(state => String(state.userId?._id || state.userId) === user.id)
          const unread = last?.createdAt && String(last.senderId?._id || last.senderId) !== user.id &&
            (!readState?.lastReadAt || new Date(last.createdAt) > new Date(readState.lastReadAt))
          return <button key={conversation._id} data-title={title} className={`conversation-item ${String(active?._id) === String(conversation._id) ? "active" : ""}`} onClick={() => chooseConversation(conversation)}>
            <Avatar name={conversation.type === "group" ? title : other?.displayName || title} online={online} />
            <span className="conversation-copy"><span className="conversation-title">{title}</span><span className="conversation-preview">{conversation.lastMessage?.text || "Start a little conversation"}</span></span>
            <span className="conversation-trailing"><span className="conversation-time">{timeLabel(conversation.lastMessage?.createdAt)}</span>{unread && <i className="unread-dot" aria-label="Unread messages" />}</span>
          </button>
        })}
        {conversationsHasMore && <button className="load-conversations" onClick={loadMoreConversations}>Load older conversations</button>}
      </div>
      <footer className="side-user"><Avatar name={user.displayName} /><div className="side-user-copy"><strong>{user.displayName}</strong><span>{user.statusMessage || user.status || "Here for a chat"}</span></div><select className="status-select" aria-label="Set your presence" value={user.status || "online"} onChange={updateStatus}><option value="online">Online</option><option value="away">Away</option><option value="busy">Busy</option></select><button className="signout-button" onClick={signOut}>Sign out</button></footer>
    </aside>

    <section className="chat-pane">
      {active ? <>
        <header className="chat-header">
          <button className="mobile-back icon-btn" aria-label="Back to conversations" onClick={() => setMobileChat(false)}><Icon name="back" /></button>
          <Avatar name={activeTitle} online={Boolean(isOnline)} />
          <div className="chat-person"><h2>{activeTitle}</h2><span className={`presence-label ${isOnline && activeStatus === "online" ? "present" : ""}`}>{active?.type === "group" ? `${active.members?.length || 0} people` : isOnline ? `${activeStatus}${otherPresence?.statusMessage ? ` · ${otherPresence.statusMessage}` : ""}` : lastSeenLabel(lastSeenAt)}</span></div>
          <div className="call-buttons">
            <button type="button" className="icon-btn" title="Start an audio call" aria-label="Start an audio call" disabled={active.type !== "direct" || socketStatus !== "connected"} onClick={() => startCall("audio")}>☎</button>
            <button type="button" className="icon-btn" title="Start a video call" aria-label="Start a video call" disabled={active.type !== "direct" || socketStatus !== "connected"} onClick={() => startCall("video")}>▣</button>
          </div>
          <form className="chat-search" onSubmit={runSearch}><Icon name="search" size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search in chat" aria-label="Search in this conversation" /><button aria-label="Search"><span>↵</span></button></form>
          <div className={`connection-indicator ${socketStatus}`} title={`Live connection ${socketStatus}`}><i />{socketStatus === "connected" ? "Live" : "Offline"}</div>
        </header>
        <form className="search-filters" onSubmit={runSearch}>
          <label>In <select value={searchKind} onChange={event => setSearchKind(event.target.value)}><option value="all">all messages</option><option value="media">photos & videos</option><option value="audio">audio</option><option value="documents">documents</option><option value="links">links</option></select></label>
          <label>From <select value={searchSender} onChange={event => setSearchSender(event.target.value)}><option value="">anyone</option>{active.members?.map(member => <option key={member._id || member.id} value={member._id || member.id}>{member.displayName}</option>)}</select></label>
          <button type="submit" className="text-button">Filter search</button>
        </form>
        {searchResults && <div className="search-banner"><span>{searchResults.length} {searchResults.length === 1 ? "match" : "matches"} for “{search}”</span><button className="text-button" onClick={() => { setSearchResults(null); setSearch(""); setSearchKind("all"); setSearchSender("") }}>Back to chat <Icon name="close" size={15} /></button></div>}
        {active.encryptionEnabled && <div className="encryption-notice">🔒 End-to-end encryption is on. Share the same passphrase with every member out of band. Search, AI, translation, and attachments are disabled.</div>}
        {active.encryptionEnabled && !encryptionKeysRef.current.has(String(active._id)) && <form className="encryption-unlock" onSubmit={unlockOrEnableEncryption}>
          <span>Enter the conversation’s shared passphrase to read and send encrypted messages.</span>
          <input type="password" value={encryptionInput} onChange={event => setEncryptionInput(event.target.value)} minLength={12} autoComplete="current-password" placeholder="Shared passphrase (12+ characters)" required />
          <button className="button button-primary">Unlock</button>
        </form>}
        {pinnedMessages.length > 0 && <div className="pinned-banner"><strong>📌 Pinned</strong>{pinnedMessages.slice(0, 3).map(message => <button key={message._id || message.messageId} onClick={() => document.getElementById(`message-${message._id || message.messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{message.text || message.poll?.question || "Attachment"}</button>)}</div>}
        {(summary || replySuggestions.length > 0) && <div className="assistant-result">{summary && <p><strong>Thread summary:</strong> {summary}</p>}{replySuggestions.map((suggestion, index) => <button key={`${suggestion}-${index}`} onClick={() => { setDraft(suggestion); setReplySuggestions([]) }}>{suggestion}</button>)}<button className="assistant-dismiss" onClick={() => { setSummary(""); setReplySuggestions([]) }}>Dismiss</button></div>}
        <div className="timeline">
          {!searchResults && messagesHasMore && <button className="load-older" onClick={loadOlderMessages} disabled={loadingOlder}>{loadingOlder ? "Loading…" : "Load earlier messages"}</button>}
          {messages.length === 0 && !searchResults?.length && <div className="welcome-thread"><div className="welcome-sparkle">✳</div><span className="eyebrow">A FRESH PAGE</span><h3>Every good thing<br />starts with hello.</h3><p>Send the first message and see where it goes.</p></div>}
          {shownMessages.map((message, index) => {
            const own = String(message.senderId?._id || message.senderId) === user.id
            const readCount = own ? readStates.filter(state =>
              String(state.userId?._id || state.userId) !== user.id &&
              state.lastReadAt &&
              new Date(state.lastReadAt) >= new Date(message.createdAt)
            ).length : 0
            const deliveredCount = own ? (message.deliveredTo || []).filter(id =>
              String(id?._id || id) !== user.id
            ).length : 0
            const recipientCount = Math.max(0, (active.members?.length || 1) - 1)
            const isRead = active.type === "group" ? recipientCount > 0 && readCount >= recipientCount : readCount > 0
            const isDelivered = active.type === "group" ? recipientCount > 0 && deliveredCount >= recipientCount : deliveredCount > 0
            const previous = shownMessages[index - 1]
            const grouped = previous && String(previous.senderId?._id || previous.senderId) === String(message.senderId?._id || message.senderId) && (new Date(message.createdAt) - new Date(previous.createdAt) < 5 * 60 * 1000)
            const reactionGroups = Object.values((message.reactions || []).reduce((groups, reaction) => {
              const reactionUserId = String(reaction.userId?._id || reaction.userId)
              groups[reaction.emoji] ||= { emoji: reaction.emoji, count: 0, selected: false }
              groups[reaction.emoji].count += 1
              groups[reaction.emoji].selected ||= reactionUserId === user.id
              return groups
            }, {}))
            const stickerMessage = /^[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(message.text || "") && !message.attachments?.length
            return <article id={`message-${message._id}`} className={`message-row ${own ? "mine" : ""} ${grouped ? "grouped" : ""}`} key={message._id || `${message.createdAt}-${index}`}>
              {!own && !grouped && <Avatar small name={message.senderId?.displayName || activeTitle} />}
              {!own && grouped && <span className="avatar-spacer" />}
              <div className="message-block">{!own && !grouped && <span className="message-author">{message.senderId?.displayName || activeTitle}</span>}
                <div className={`message-bubble ${own ? "bubble-mine" : ""} ${stickerMessage ? "sticker-bubble" : ""}`}>
                  {message.deletedAt ? <p className="deleted-message">This message was deleted.</p> : <>
                    {message.forwardedFrom?.displayName && <span className="forwarded-label">Forwarded from {message.forwardedFrom.displayName}</span>}
                    {message.replyTo && <div className="reply-quote"><strong>{message.replyTo.senderId?.displayName || "A member"}</strong><span>{message.replyTo.deletedAt ? "Message deleted" : message.replyTo.text || "Attachment"}</span></div>}
                    {message.text && <p>{message.text}</p>}
                    {message.locked && <p className="encrypted-placeholder">🔒 Encrypted message</p>}
                    {translationByMessage[message._id] && <p className="translation-text">{translationByMessage[message._id]}</p>}
                    {message.poll && <div className="poll-card"><strong>{message.poll.question}</strong>{message.poll.options.map((option, optionIndex) => {
                      const totalVotes = message.poll.options.reduce((total, item) => total + item.votes.length, 0)
                      const selected = option.votes.some(voter => String(voter?._id || voter) === user.id)
                      const closed = message.poll.endsAt && new Date(message.poll.endsAt) <= new Date()
                      return <button key={`${option.text}-${optionIndex}`} disabled={closed} className={selected ? "voted" : ""} onClick={() => voteOnPoll(message, message.poll.multipleChoice && selected ? message.poll.options.flatMap((item, index) => item.votes.some(voter => String(voter?._id || voter) === user.id) && index !== optionIndex ? [index] : []).concat(selected ? [] : [optionIndex]) : [optionIndex])}><span>{option.text}</span><small>{option.votes.length}{totalVotes ? ` · ${Math.round(option.votes.length / totalVotes * 100)}%` : ""}</small></button>
                    })}<small>{message.poll.multipleChoice ? "Select options to vote" : "Choose one"} · {message.poll.options.reduce((total, item) => total + item.votes.length, 0)} votes</small></div>}
                    {message.attachments?.map(file => {
                      const url = `${API}/attachments/${encodeURIComponent(file.storageKey)}`
                      return <span key={file.storageKey} className="attachment-item">
                        {file.mimeType.startsWith("image/") && <a href={url} target="_blank" rel="noreferrer"><img className="attachment-preview" src={file.mimeType === "image/gif" ? url : `${url}/thumbnail`} alt={file.originalName} loading="lazy" /></a>}
                        {file.mimeType.startsWith("video/") && <video className="attachment-video" src={url} controls preload="metadata" />}
                        {file.mimeType.startsWith("audio/") && <audio className="attachment-audio" src={url} controls preload="metadata" />}
                        <a className="attachment-link" href={url} target="_blank" rel="noreferrer" download={file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/") || file.mimeType.startsWith("audio/") ? undefined : file.originalName}>↗ {file.originalName}<small>{Math.max(1, Math.round(file.size / 1024))} KB</small></a>
                      </span>
                    })}
                  </>}
                </div>
                {reactionGroups.length > 0 && <div className="reaction-list">{reactionGroups.map(reaction => <button key={reaction.emoji} className={`reaction-chip ${reaction.selected ? "selected" : ""}`} aria-label={`${reaction.emoji}, ${reaction.count} reactions`} onClick={() => toggleMessageReaction(message, reaction.emoji)}>{reaction.emoji} <small>{reaction.count}</small></button>)}</div>}
                <span className="message-time">{timeLabel(message.createdAt)} {message.editedAt && !message.deletedAt && <small>edited</small>} {own && <span className={`read-check ${isRead ? "is-read" : isDelivered ? "is-delivered" : ""}`} title={active.type === "group" ? `${readCount}/${recipientCount} read, ${deliveredCount}/${recipientCount} delivered` : isRead ? "Read" : deliveredCount ? "Delivered" : "Sent"}><Icon name="check" size={14} />{(isRead || isDelivered) && <Icon name="check" size={14} />}{active.type === "group" && (readCount > 0 || deliveredCount > 0) && <small>{readCount}/{recipientCount} read</small>}</span>}</span>
                {!message.deletedAt && <div className="message-actions">
                  <button type="button" onClick={() => toggleMessageReaction(message, "👍")} aria-label="React with thumbs up">👍</button>
                  <button type="button" onClick={() => toggleMessageReaction(message, "❤️")} aria-label="React with heart">❤️</button>
                  <button type="button" onClick={() => toggleMessageReaction(message, "😂")} aria-label="React with laughter">😂</button>
                  <button type="button" onClick={() => togglePin(message)}>{pinnedMessages.some(item => String(item._id || item.messageId) === String(message._id)) ? "Unpin" : "Pin"}</button>
                  {!active.encryptionEnabled && Boolean(message.text) && <button type="button" onClick={() => translate(message)}>Translate</button>}
                  {!active.encryptionEnabled && <button type="button" onClick={() => startReply(message)}>Reply</button>}
                  {!active.encryptionEnabled && <button type="button" onClick={() => setForwardingMessage(message)}>Forward</button>}
                  {own && !active.encryptionEnabled && <button type="button" onClick={() => startEdit(message)}>Edit</button>}
                  {own && <button type="button" className="message-delete" onClick={() => removeMessage(message)}>Delete</button>}
                </div>}
              </div>
            </article>
          })}
          {typing && <div className="typing-indicator"><span className="typing-dots"><i /><i /><i /></span>{typing} is typing</div>}
          <div ref={bottomRef} />
        </div>
        {error && <div className="chat-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error"><Icon name="close" size={15} /></button></div>}
        {(replyTo || editingMessage) && <div className="compose-context">
          <div><strong>{editingMessage ? "Editing message" : `Replying to ${replyTo.senderId?.displayName || "message"}`}</strong><span>{editingMessage ? "Make your changes below." : replyTo.text || "Attachment"}</span></div>
          <button type="button" className="icon-btn" aria-label="Cancel" onClick={cancelComposeAction}><Icon name="close" size={17} /></button>
        </div>}
        {showEmojiPicker && <div className="emoji-popover">
          <div className="emoji-tabs"><button type="button" className={emojiTab === "emoji" ? "selected" : ""} onClick={() => setEmojiTab("emoji")}>Emoji</button><button type="button" className={emojiTab === "sticker" ? "selected" : ""} onClick={() => setEmojiTab("sticker")}>Stickers</button></div>
          <div className={`emoji-grid ${emojiTab === "sticker" ? "sticker-grid" : ""}`}>
            {(emojiTab === "sticker" ? stickerChoices : [...new Set([...emojiChoices, ...customEmojis])]).map(emoji => <button type="button" key={emoji} aria-label={`${emojiTab} ${emoji}`} onClick={() => { setDraft(current => `${current}${emoji}`); setShowEmojiPicker(false) }}>{emoji}</button>)}
          </div>
          {emojiTab === "emoji" && <div className="custom-emoji-entry"><label htmlFor="custom-emoji">Add a custom emoji</label><div><input id="custom-emoji" value={customEmoji} maxLength={16} placeholder="Paste an emoji" onChange={event => setCustomEmoji(event.target.value)} /><button type="button" disabled={!isEmojiValue(customEmoji)} onClick={() => { const emoji = customEmoji.trim(); setCustomEmojis(current => [...new Set([...current, emoji])].slice(-20)); setDraft(current => `${current}${emoji}`); setCustomEmoji("") }}>Add</button></div></div>}
        </div>}
        <form className="composer" onSubmit={event => submitMessage(event)}>
          {!editingMessage && !active.encryptionEnabled && <label className="attach-button" aria-label="Attach a file"><Icon name="paperclip" size={20} /><input type="file" multiple accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov,.mp3,.ogg,.wav,.m4a,.pdf,.txt,.csv,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.zip,.json" onChange={onFiles} /></label>}
          {!editingMessage && <button type="button" className="composer-tool" aria-label="Open emoji and sticker picker" aria-expanded={showEmojiPicker} onClick={() => setShowEmojiPicker(value => !value)}>☺</button>}
          {!editingMessage && <button type="button" className={`composer-tool record-tool ${isRecording ? "recording" : ""}`} aria-label={isRecording ? "Stop voice note recording" : "Record a voice note"} title={isRecording ? "Stop recording" : "Record a voice note"} onClick={toggleVoiceRecording}>{isRecording ? "■" : "●"}</button>}
          <input value={draft} onChange={event => onDraft(event.target.value)} placeholder={editingMessage ? "Edit your message…" : `Write a little something to ${activeTitle}…`} aria-label={editingMessage ? "Edit message" : "Write a message"} maxLength={active.encryptionEnabled ? 3500 : 5000} disabled={active.encryptionEnabled && !encryptionKeysRef.current.has(String(active._id))} />
          {!editingMessage && <button type="button" className="composer-tool" title="Create poll" aria-label="Create poll" disabled={active.encryptionEnabled} onClick={() => setShowPollForm(true)}>▤</button>}
          <button className="send-button" disabled={!draft.trim()} aria-label={editingMessage ? "Save edit" : "Send message"}><Icon name={editingMessage ? "check" : "send"} size={18} /></button>
        </form>
        <div className="composer-footnote">{editingMessage ? "Only you can edit your message" : active.encryptionEnabled ? "Encrypted locally; passphrase stays on your device" : "A little kindness goes a long way"} <span>·</span> Enter to send</div>
        <div className="chat-actions-footer"><button type="button" disabled={active.encryptionEnabled} onClick={() => runAssistant("replies")}>Smart replies</button><button type="button" disabled={active.encryptionEnabled} onClick={() => runAssistant("summary")}>Summarize thread</button></div>
      </> : <div className="no-chat"><div className="no-chat-art"><span>✳</span><i /><i /><i /></div><span className="eyebrow">YOUR SPACE, YOUR PEOPLE</span><h2>Make room for<br /><em>a little hello.</em></h2><p>Choose a conversation or start something new.</p><button className="button button-primary" onClick={() => setShowNew(true)}><Icon name="plus" size={17} /> Start a conversation</button><div className="decorative-note">good things happen<br />when we stay in touch</div></div>}
    </section>
    {showNew && <NewConversation onClose={() => setShowNew(false)} onCreated={conversation => { setConversations(current => [conversation, ...current.filter(item => item._id !== conversation._id)]); setActive(conversation); setShowNew(false); setMobileChat(true) }} />}
    {forwardingMessage && <ForwardDialog conversations={conversations} user={user} message={forwardingMessage} onClose={() => setForwardingMessage(null)} onForward={forwardMessage} />}
    {showEncryptionSetup && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setShowEncryptionSetup(false)}>
      <form className="modal" onSubmit={unlockOrEnableEncryption}>
        <div className="modal-head"><div><span className="eyebrow">PRIVATE BY DESIGN</span><h2>{encryptionSetupMode === "enable" ? "Enable encryption" : "Unlock conversation"}</h2></div><button type="button" className="icon-btn" onClick={() => setShowEncryptionSetup(false)} aria-label="Close"><Icon name="close" /></button></div>
        <p className="field-note">Use a unique passphrase of at least 12 characters. Share it with every conversation member out of band. It is never sent to the server, and losing it means messages cannot be recovered.</p>
        <label>Shared passphrase<input type="password" autoComplete="new-password" value={encryptionInput} onChange={event => setEncryptionInput(event.target.value)} minLength={12} required /></label>
        {encryptionSetupMode === "enable" && <p className="field-note">Only new text messages are encrypted. Existing messages and metadata are not re-encrypted; files, search, AI, and translation are unavailable while encryption is on.</p>}
        <button className="button button-primary modal-submit">{encryptionSetupMode === "enable" ? "Enable for this conversation" : "Unlock messages"}</button>
      </form>
    </div>}
    {showPollForm && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setShowPollForm(false)}>
      <form className="modal" onSubmit={createPoll}>
        <div className="modal-head"><div><span className="eyebrow">DECIDE TOGETHER</span><h2>Create a poll</h2></div><button type="button" className="icon-btn" onClick={() => setShowPollForm(false)} aria-label="Close"><Icon name="close" /></button></div>
        <label>Question<input name="question" maxLength={240} required placeholder="What should we do?" /></label>
        {[1, 2, 3, 4].map((number, index) => <label key={number}>Option {number}<input name={`option${number}`} maxLength={100} required={index < 2} placeholder={index < 2 ? "Required option" : "Optional"} /></label>)}
        <label className="poll-checkbox"><input type="checkbox" name="multipleChoice" /> Allow multiple choices</label>
        <button className="button button-primary modal-submit">Post poll</button>
      </form>
    </div>}
    {call && <CallOverlay call={call} localStreamRef={localStreamRef} remoteStreamRef={remoteStreamRef} onAccept={answerCall} onEnd={() => endCall()} />}
  </main>
}
