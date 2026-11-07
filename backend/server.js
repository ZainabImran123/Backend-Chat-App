import "dotenv/config"
import http from "node:http"
import app from "./src/app.js"
import connectDB from "./src/db/db.js"
import { getJwtSecret } from "./src/config/auth.js"
import { attachChatSockets } from "./src/realtime/chat-socket.js"

const port = Number(process.env.PORT) || 3001
const server = http.createServer(app)

async function startServer() {
  getJwtSecret()
  const connected = await connectDB()
  if (!connected) {
    console.warn("CHAT_MONGODB_URI is not configured; API is health-only until a chat database is supplied.")
  }
  const io = attachChatSockets(server)
  app.set("io", io)
  server.listen(port, () => console.log(`Chat API listening on port ${port}`))
}

startServer().catch(error => {
  console.error("Chat server startup failed:", error?.message || error)
  process.exitCode = 1
})