import mongoose from "mongoose"

async function connectDB() {
    const connectionString = process.env.CHAT_MONGODB_URI
    if (!connectionString) return false
    await mongoose.connect(connectionString, { serverSelectionTimeoutMS: 8000 })
    console.log("Connected to the chat database")
    return true
}

export default connectDB
