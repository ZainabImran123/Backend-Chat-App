export function getJwtSecret() {
    const secret = process.env.CHAT_JWT_SECRET
    if (!secret || secret.length < 32) {
        throw new Error("CHAT_JWT_SECRET must be set to a value at least 32 characters long")
    }
    return secret
}
