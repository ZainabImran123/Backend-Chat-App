function configuredProvider() {
  const endpoint = String(process.env.CHAT_AI_ENDPOINT || "").trim()
  const apiKey = String(process.env.CHAT_AI_API_KEY || "").trim()
  const model = String(process.env.CHAT_AI_MODEL || "").trim()
  if (!endpoint || !apiKey || !model) {
    throw Object.assign(new Error("AI and translation providers are not configured."), { status: 503 })
  }
  const url = new URL(endpoint)
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw Object.assign(new Error("The configured AI provider must use HTTPS."), { status: 503 })
  }
  return { endpoint: url.toString(), apiKey, model }
}

export async function requestAssistantText({ system, text, maxTokens = 500 }) {
  const provider = configuredProvider()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "system", content: system }, { role: "user", content: text }],
        max_tokens: maxTokens,
        temperature: 0.3
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      console.error("Configured AI provider returned an error.", response.status)
      throw Object.assign(new Error("The configured AI provider could not complete the request."), { status: 502 })
    }
    const result = await response.json()
    const output = result?.choices?.[0]?.message?.content
    if (typeof output !== "string" || !output.trim()) {
      throw Object.assign(new Error("The configured AI provider returned an invalid response."), { status: 502 })
    }
    return output.trim().slice(0, 4000)
  } catch (error) {
    if (error.status) throw error
    if (error.name === "AbortError") throw Object.assign(new Error("The AI provider timed out."), { status: 504 })
    console.error("Configured AI provider request failed.", error?.name || "Error")
    throw Object.assign(new Error("The configured AI provider is unavailable."), { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}
