function toBase64(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

export async function deriveConversationKey(passphrase, conversationId) {
  if (!globalThis.crypto?.subtle) throw new Error("End-to-end encryption requires a secure browser context.")
  if (String(passphrase).length < 12) throw new Error("Use a shared passphrase with at least 12 characters.")
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode(`little-hello:${conversationId}`), iterations: 210_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text))
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), encryptionIv: toBase64(iv) }
}

export async function decryptText(key, ciphertext, encryptionIv) {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(encryptionIv) }, key, fromBase64(ciphertext))
  return new TextDecoder().decode(plaintext)
}
