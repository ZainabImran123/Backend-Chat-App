import "dotenv/config"
import http from "node:http"
import mongoose from "mongoose"
import app from "./src/app.js"
import connectDB from "./src/db/db.js"
import { getJwtSecret } from "./src/config/auth.js"
import { attachChatSockets } from "./src/realtime/chat-socket.js"

const port = Number(process.env.PORT) || 3001
const server = http.createServer(app)

function listen() {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(port)
  })
}

async function startServer() {
  try {
    getJwtSecret()

    try {
      const connected = await connectDB()
      if (!connected) {
        console.warn("Database is not configured; API is running in health-only mode.")
      } else {
        console.log("Database connection established successfully.")
      }
    } catch (error) {
      console.error(`Database connection failed (${error?.name || "Error"}); API is running in health-only mode.`)
    }

    await listen()
    const io = attachChatSockets(server)
    app.set("io", io)
    console.log(`Chat API server is running and listening on port ${port}`)
  } catch (error) {
    const detail = error?.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Stop the other backend process or set PORT to an available port.`
      : error?.message || error
    console.error("Chat API startup failed:", detail)
    try {
      await mongoose.disconnect()
    } catch (disconnectError) {
      console.error("Could not close the database connection after startup failure:", disconnectError?.name || "Error")
    }
    process.exitCode = 1
  }
}

startServer()