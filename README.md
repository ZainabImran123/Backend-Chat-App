# Little Hello

A responsive chat app with private accounts, direct and group conversations, live messages, presence, typing, read state, message search, and local-disk attachments.

## Private chat database setup

The existing `backend/.env` is intentionally untouched. The chat backend reads **only** `CHAT_MONGODB_URI`; it never falls back to the storefront's `MONGODB_URI`. Before using the app:

1. Provision a **new MongoDB cluster/database** for chat yourself. Use a least-privilege database user and network access rules appropriate to your environment. This project does not create, access, or migrate any cluster.
2. Privately add `CHAT_MONGODB_URI=<your-new-chat-database-uri>` to `backend/.env`. Do not send the URI in chat, put it in source control, or use the existing storefront URI.
3. Add a private `CHAT_JWT_SECRET` of at least 32 random characters to `backend/.env`. `backend/.env.example` is a placeholder reference only; do not copy any existing storefront credentials.
4. Set `PORT=3001` and `FRONTEND_ORIGIN=http://localhost:5173` for local development. Optionally set `CHAT_UPLOAD_DIR` to a persistent local directory.

Only collections named `chat_users`, `chat_conversations`, and `chat_messages` are used. No database connection is attempted until `CHAT_MONGODB_URI` is supplied. The `/api/health` check reports whether the chat database setting is present, not whether a database connection is available.

## Run locally

The installed dependencies include Socket.IO for live chat. If you reinstall dependencies, run in the backend folder:

```sh
cd backend
npm install
npm run dev
```

The frontend dependencies are already installed. In another terminal:

```sh
cd frontend
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). Socket.IO's browser client is served by the backend at `/socket.io/socket.io.js` and proxied by Vite. Keep the frontend and API on the configured origin or set `FRONTEND_ORIGIN` and `VITE_API_BASE_URL` for your deployment.

On Windows PowerShell, if script execution policy blocks `npm`, use `npm.cmd` for the commands above.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/users?q=...`
- `GET /api/conversations`, `POST /api/conversations`
- `GET /api/conversations/:id/messages?limit=30&before=<ISO timestamp>`
- `GET /api/conversations/:id/search?q=...`, `POST /api/conversations/:id/read`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/attachments`, `GET /api/attachments/:opaqueKey`
- `GET /api/health`

Socket.IO events: `conversation:join`, `message:send` → `message:new`, `typing:update`, `read:update`, and `presence:update`. Socket sessions use the same HTTP-only cookie as the API; room joins and writes require database-backed conversation membership.

Passwords are bcrypt-hashed. Attachments are limited to 10 MB, accepted from an allowlist, stored under opaque generated filenames on local disk, and referenced in MongoDB message metadata. Downloads require authentication and conversation membership. Local disk storage is for a persistent single backend instance; use shared durable object storage and a Socket.IO adapter before deploying ephemeral or multi-instance services.

## Notes

- The backend rate-limits authentication and conversation search in-process.
- Use HTTPS in hosted environments. Keep chat credentials server-side.
- No cloud resources, deployments, destructive migrations, or existing database operations are part of this project.
