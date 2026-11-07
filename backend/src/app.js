import express from "express"
import cookieParser from "cookie-parser"
import cors from "cors"
import mongoose from "mongoose"
import authRoutes from "./routes/auth.routes.js"
import chatRoutes from "./routes/chat.routes.js"

const app = express()
app.disable("x-powered-by")
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff")
  res.set("Referrer-Policy", "same-origin")
  next()
})
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
}))
app.use(express.json({ limit: "64kb" }))
app.use(cookieParser())
app.get("/api/health", (_req, res) => res.json({
  status: "ok",
  databaseConfigured: Boolean(process.env.CHAT_MONGODB_URI),
  databaseConnected: mongoose.connection.readyState === 1
}))
app.use("/api", (req, res, next) => {
  if (req.path === "/health" || (req.path === "/auth/logout" && req.method === "POST") || mongoose.connection.readyState === 1) return next()
  res.status(503).json({ message: "Chat database is not configured or connected." })
})
app.use("/api/auth", authRoutes)
app.use("/api", chatRoutes)
app.use((err, _req, res, _next) => {
  const status = Number(err.status) || (err.name === "ValidationError" ? 400 : 500)
  if (status >= 500) console.error("Request failed.", err?.name || "Error")
  res.status(status).json({ message: status >= 500 ? "Something went wrong." : err.message })
})
export default app