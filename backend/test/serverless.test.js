import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { after, before, test } from "node:test"
import handler from "../api.js"

const originalJwtSecret = process.env.CHAT_JWT_SECRET
const originalMongoUri = process.env.CHAT_MONGODB_URI
let server
let baseUrl

before(async () => {
  process.env.CHAT_JWT_SECRET = "test-secret-with-at-least-32-characters"
  delete process.env.CHAT_MONGODB_URI
  server = createServer((req, res) => handler(req, res))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (originalJwtSecret === undefined) delete process.env.CHAT_JWT_SECRET
  else process.env.CHAT_JWT_SECRET = originalJwtSecret
  if (originalMongoUri === undefined) delete process.env.CHAT_MONGODB_URI
  else process.env.CHAT_MONGODB_URI = originalMongoUri
  server.close()
  await once(server, "close")
})

test("serverless handler serves the health endpoint without a database", async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).status, "ok")
})

test("serverless handler returns a clear unavailable response without a database", async () => {
  const response = await fetch(`${baseUrl}/api/conversations`)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { message: "Chat database is not configured or connected." })
})
