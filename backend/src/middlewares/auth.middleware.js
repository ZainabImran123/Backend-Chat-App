import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/auth.js"
import { ChatUser } from "../models/chat.models.js"

export async function authenticateToken(req, res, next) {
    const token = req.cookies?.chat_session;

    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const payload = jwt.verify(token, getJwtSecret(), { issuer: "chat-app" })
        const user = await ChatUser.findById(payload.sub)
        if (!user) return res.status(401).json({ message: "Invalid or expired session" })
        req.user = user
        next()
    } catch {
        return res.status(401).json({ message: "Invalid or expired token" })
    }

}
export function requireAdmin(req, res, next) {
    if (req.user.role !== "admin") {
        return res.status(403).json({
            message: "Forbidden"
        })
    }
    next()
}
