import "dotenv/config"
import http from "node:http"
import app from "./src/app.js"
import connectDB from "./src/db/db.js"
import { getJwtSecret } from "./src/config/auth.js"
import { attachChatSockets } from "./src/realtime/chat-socket.js"

const port = Number(process.env.PORT) || 3001
const server = http.createServer(app)

async function startServer() {
  try {
    // Validate JWT secret presence before startup
    getJwtSecret()

    // Connect to MongoDB database
    const connected = await connectDB()
    if (!connected) {
      console.warn("Database is not connected; API is running in health-only mode until a valid database connection is established.")
    } else {
      console.log("Database connection established successfully.")
    }

    // Attach Socket.io real-time chat handlers to the HTTP server
    const io = attachChatSockets(server)
    app.set("io", io)

    // Start listening on the assigned port (Render/Railway automatically inject process.env.PORT)
    server.listen(port, () => {
      console.log(`Chat API server is running and listening on port ${port}`)
    })
  } catch (error) {
    console.error("Critical error during server startup:", error?.message || error)
    process.exitCode = 1
  }
}

startServer().catch(error => {
  console.error("Chat server startup failed catastrophically:", error?.message || error)
  process.exitCode = 1
})