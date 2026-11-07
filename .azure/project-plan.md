# Real-Time Chat App

**Status**: Approved
**Created**: 2026-11-03
**Mode**: Replacement

## 1. Project Overview

Replace the existing storefront frontend and e-commerce backend application code with a modern, responsive real-time chat application. The existing `.env` files, installed `node_modules` directories, and all existing database data are explicitly out of scope for deletion or replacement. Do not inspect, copy, print, or overwrite private environment values.

The application supports authenticated one-to-one and group conversations, with live messaging and collaboration features. The user wants a polished interface with light and dark themes.

## 2. Requirements & User Flows

- Users register, sign in, and sign out. Authentication is required for application features.
- A user can start or continue a direct conversation, create a group, and view their conversation list.
- Conversation members exchange messages in real time over WebSockets.
- Users can see online/last-seen status, typing indicators, and read receipts.
- Users can search messages and attach images or other files.
- The interface is responsive across desktop and mobile layouts and supports light and dark themes.
- Core flow: authenticate → select or create a conversation → exchange messages and attachments → search or review conversation activity.

## 3. Services & Technology

- **Frontend**: React 19 with Vite, JavaScript, and Fluent UI v9.
- **Backend API**: Node.js with Express, JavaScript, and Mongoose.
- **Real-time transport**: Socket.IO over WebSockets, authenticated using the same secure session/token mechanism as the API.
- **File storage**: local backend disk for attachment bytes in the initial single-instance deployment; store attachment metadata and opaque server-generated file references with messages in MongoDB, not binary content. Keep storage behind a small service boundary so persistent shared object storage can be added later without changing chat APIs.
- **Database**: a newly provisioned MongoDB cluster, configured by the user. The application must use a separate chat database and collections; it must not connect to or alter the existing database.

## 4. Data Model & API

- **User**: unique normalized email, display name, password hash, avatar reference (optional), and presence/last-seen metadata.
- **Conversation**: direct or group type, member IDs, optional group name/avatar, and latest-message metadata.
- **Message**: conversation ID, sender ID, text, attachment metadata, created/edited timestamps, and delivery/read state.
- **Membership/read state**: conversation membership and per-member last-read position/timestamp, enabling read receipts without duplicating message content.
- Use indexed, paginated conversation and message queries. Support message search scoped to conversations the authenticated user belongs to.
- REST API responsibilities: authentication, conversation/member management, paginated history and search, and attachment authorization/upload metadata.
- Socket.IO events: message creation, typing state, presence changes, and read-state updates. Enforce conversation membership and authorization on every event; do not trust client-supplied sender IDs.
- For attachments, validate size and allowed content types, use authenticated and authorized upload/download routes, generate opaque server-side filenames, and never trust a client-supplied filesystem path. Local disk storage is for development and a single persistent backend instance; document that persistent shared storage is needed before deploying to ephemeral or multi-instance hosting.

## 5. Architecture, Security & Operations

- Keep the frontend as a single-page application and the Express backend as the sole authority for identity, authorization, conversation membership, and message persistence.
- Authenticate both HTTP and socket connections; validate and authorize every read, mutation, and real-time event. Store passwords using a modern password hash, apply rate limits to authentication and search, validate inputs, and use secure cookie/token settings appropriate to deployment.
- Configure CORS to the approved frontend origin and use HTTPS in hosted environments. Keep MongoDB credentials server-side.
- Configure the new cluster using a placeholder such as `MONGODB_URI=<new-chat-cluster-connection-uri>` in documentation/example configuration only. The user must provision the new MongoDB cluster, create a least-privilege database user, and enter the connection URI privately. No credentials are available to this workflow; no external cluster will be created.
- Keep the current local `.env` private and untouched. Do not delete, replace, or disclose it. Configure the new chat backend to use a separately supplied chat-specific MongoDB URI rather than falling back to the existing storefront database URI. Do not remove `node_modules` or existing database data. The implementation must not run destructive migrations or connect to the existing database.
- Start with a single API instance for Socket.IO room delivery. Before scaling the API horizontally, add a shared Socket.IO adapter/backplane and verify presence/typing consistency across instances.
- Add operational logging that excludes credentials, tokens, message bodies, and attachment contents. Include health checks and clear connection/error states.

## 6. Design System & UI

**Component Library**: Semantic React components with a custom CSS design system

- Establish a refined, consistent visual system with a neutral surface palette, restrained accent color, clear typography, accessible contrast, and cohesive spacing and elevation.
- Provide a theme toggle with persistent light/dark preference and respect the system preference on first visit.
- Main desktop layout: navigation/conversation list, active conversation timeline, and a compact conversation details/member panel where space allows.
- Mobile layout: conversation list and conversation view as separate navigable screens, with touch-friendly controls and a compact composer.
- Include polished sign-in/sign-up screens, empty/loading/error states, message grouping, timestamps, unread markers, typing/presence indicators, attachment previews, search results, and group management.
- Ensure keyboard navigation, visible focus, accessible labels, reduced-motion support, and responsive behavior.

## 7. Implementation & Verification

1. Replace storefront and e-commerce application source with the chat experience while preserving `.env`, `node_modules`, and all database data.
2. Implement authentication, chat collections and authorized conversation APIs against the new MongoDB configuration only.
3. Implement authenticated, size-limited attachment uploads to local disk with metadata stored in MongoDB.
4. Implement authenticated Socket.IO messaging, presence, typing, and read receipts; integrate message search and responsive themed UI.
5. Verify frontend production build, backend startup/health, authentication boundaries, direct/group membership isolation, message history/search, real-time events, attachment authorization, responsive layouts, and both themes.
6. Confirm startup and deployment documentation uses placeholders and never requires committing credentials. No cloud resource provisioning or deployment is included in this planning approval.

## 8. Assumptions & Decisions Needed

- MongoDB is the selected database technology, but the new cluster, database user, network access rules, and private connection URI must be provisioned by the user.
- The user chose the recommended local-disk attachment storage for the initial version; persistent shared object storage is a prerequisite for ephemeral or horizontally scaled hosting.
- The existing local `.env` remains unchanged. The application will document a new chat-specific MongoDB URI placeholder; the user supplies the actual URI privately when configuring the new cluster.
- The user approved replacing the storefront application code. No migration or deletion of current storefront/e-commerce database records is planned.
- The user approved this plan on 2026-11-03.
