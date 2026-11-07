import assert from "node:assert/strict"
import { once } from "node:events"
import { after, before, test } from "node:test"
import app from "../src/app.js"

let server
let baseUrl

before(async () => {
  server = app.listen(0, "127.0.0.1")
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (!server) return
  server.close()
  await once(server, "close")
})

test("health reports the chat API is available", async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).status, "ok")
})

test("chat routes fail closed until the chat database is connected", async () => {
  const response = await fetch(`${baseUrl}/api/conversations`)
  assert.equal(response.status, 503)
})
