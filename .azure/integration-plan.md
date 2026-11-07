# Integration hand-off

## Backend
- Project: `backend/`
- Start: `npm run dev` (port `3001`; requires `CHAT_JWT_SECRET`, installed `socket.io`, and a user-provisioned `CHAT_MONGODB_URI`)
- Build/check: `node --check server.js` and source checks; health: `GET /api/health`
- Database models: `backend/src/models/chat.models.js`; Mongoose collections `chat_users`, `chat_conversations`, `chat_messages`
- Migrations: no migration framework or migration directory; **do not add seed data**. No database was connected during scaffolding.

## Frontend
- Project: `frontend/`
- Build: `npm --prefix frontend run build`
- Dev: `npm --prefix frontend run dev`
- API seam: `src/App.jsx` `request()` helper (already wired to the chat REST API)
- Mock data/files: none; no mock client, datasets, or preview state switcher

## API route inventory
- `GET /api/health`
- `POST /api/auth/register`; `POST /api/auth/login`; `POST /api/auth/logout`; `GET /api/auth/me`
- `GET /api/users?q=...`
- `GET /api/conversations?limit=30&before=...`; `POST /api/conversations`
- `GET /api/conversations/:id/messages?limit=30&before=...`
- `GET /api/conversations/:id/search?q=...`
- `POST /api/conversations/:id/read`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/attachments`
- `GET /api/attachments/:opaqueKey`
- Socket.IO: `conversation:join`, `message:send` → `message:new`, `typing:update`, `read:update`, `presence:update`

## Configuration and services
- Database: MongoDB via `CHAT_MONGODB_URI` only; set privately in `backend/.env`; never use the storefront URI. `CHAT_JWT_SECRET` is a separate private secret.
- Attachment storage: local `backend/uploads/` by default, overridable with `CHAT_UPLOAD_DIR`; bytes on disk, message metadata in MongoDB.
- Shared types/client: none; JavaScript API calls are local to `frontend/src/App.jsx`.
- Essential: React/Vite frontend, Express/Mongoose backend, MongoDB, Socket.IO, local attachment disk.
- Enhancement before scale-out: durable shared object storage and a Socket.IO adapter for multi-instance delivery.
- No cloud deployment, cluster provisioning, credentials, or seed data are included.
