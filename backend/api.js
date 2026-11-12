import mongoose from "mongoose"
import app from "./src/app.js"
import connectDB from "./src/db/db.js"
import { getJwtSecret } from "./src/config/auth.js"

let connectionAttempt

async function ensureDatabaseConnection() {
  if (!process.env.CHAT_MONGODB_URI || mongoose.connection.readyState === 1) return
  if (!connectionAttempt) {
    connectionAttempt = connectDB().finally(() => {
      connectionAttempt = undefined
    })
  }
  await connectionAttempt
}

export default async function handler(req, res) {
  const path = req.url?.split("?")[0]
  const publicRoute = path === "/api/health" || (path === "/api/auth/logout" && req.method === "POST")

  if (!publicRoute) {
    try {
      getJwtSecret()
      await ensureDatabaseConnection()
    } catch (error) {
      console.error("Chat API initialization failed:", error?.message || error)
      res.statusCode = 503
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ message: "Chat service is not configured or available." }))
      return
    }
  }

  return app(req, res)
}
