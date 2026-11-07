import { Router } from "express"
import { currentUser, login, logout, register } from "../controllers/chat.controller.js"
import { authenticateToken } from "../middlewares/auth.middleware.js"
import { rateLimit } from "../middlewares/rate-limit.js"
const router = Router()
const authLimit = rateLimit({ scope: "auth", windowMs: 15 * 60 * 1000, max: 10 })
router.post("/register", authLimit, register)
router.post("/login", authLimit, login)
router.get("/me", authenticateToken, currentUser)
router.post("/logout", logout)
export default router;