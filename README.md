# Instagram Clone Backend

Production-ready backend API for Instagram Clone iOS app.

**Tech Stack:** Node.js 20 · Hono · TypeScript · PostgreSQL 16 · Drizzle ORM · Better Auth · Neon Functions · Neon Realtime · Neon Object Storage

## Requirements

- Node.js 20+
- Neon account ([Neon Console](https://console.neon.tech))
- Better Auth secrets (generated via `neon auth secret`)
- Email provider (Resend, SendGrid, etc.) for Better Auth

## Quick Start

### Option A: Local Development with Neon Functions

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and configure
cp .env.example .env
# Edit .env with your Neon DATABASE_URL, Better Auth credentials, etc.

# 3. Push database schema (Drizzle)
npm run drizzle:push

# 4. Start dev servers (run in separate terminals)
npm run dev        # REST API on http://localhost:3000
npm run dev:ws     # WebSocket on ws://localhost:3001/ws
```

### Option B: Neon Functions Development (Recommended)

```bash
# 1. Install dependencies
npm install

# 2. Configure .env with Neon credentials

# 3. Develop locally with Neon Functions runtime
npm run neon:dev
```

This runs both the API and WebSocket functions with the Neon Functions runtime locally.

### Option C: Deploy to Neon (Free Tier)

```bash
# 1. Install dependencies
npm install

# 2. Configure .env with production credentials

# 3. Deploy to Neon
npm run neon:deploy
```

- **REST API**: Deployed as `api` function at `https://<branch>-<project>.neonfunctions.app`
- **WebSocket**: Deployed as `ws` function at `wss://<branch>-<project>.neonfunctions.app/ws`
- Health checks: `GET /health` on both endpoints

Server runs at `http://localhost:3000` (local)

- Health check: `GET /health`
- API base: `/v1`
- WebSocket (local): `ws://localhost:3001/ws`
- WebSocket (Neon): `wss://<your-branch>-<project>.neonfunctions.app/ws`

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload (tsx watch) for REST API |
| `npm run dev:ws` | Dev server with hot reload for WebSocket |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run production build |
| `npm run db:migrate` | Run Prisma migrations (legacy) |
| `npm run db:push` | Push Prisma schema changes (dev only) |
| `npm run db:studio` | Prisma Studio (DB browser) |
| `npm run db:seed` | Seed test data |
| `npm run db:generate` | Generate Prisma client |
| `npm run drizzle:generate` | Generate Drizzle migrations |
| `npm run drizzle:push` | Push Drizzle schema to database |
| `npm run drizzle:studio` | Drizzle Studio (DB browser) |
| `npm run lint` | ESLint check |
| `npm test` | Run tests (Vitest) |
| `npm run neon:deploy` | Deploy to Neon Functions |
| `npm run neon:dev` | Local Neon Functions development |

## Project Structure

```
src/
├── config/           # Configuration (auth, env)
├── db/               # Drizzle schema & relations
├── middleware/       # Auth middleware (Better Auth JWT verification)
├── routes/           # Hono route handlers (REST API)
│   ├── auth.routes.ts    # Better Auth endpoints + custom register/login
│   ├── user.routes.ts    # User profile, settings, social graph
│   ├── post.routes.ts    # Posts CRUD, likes, saves
│   └── ...               # (reel, story, conversation, notification, upload - coming soon)
├── websocket/        # WebSocket server (chat, calls, presence)
│   ├── index.ts          # Neon Function entry point (ws function)
│   └── server.ts         # Legacy Express WebSocket server
├── types/            # Shared TypeScript types
└── utils/            # Helpers, errors, pagination
```

## Architecture Overview

### Dual Runtime Architecture

The project supports two deployment models:

1. **Local Development**: Express + Prisma + Firebase Auth (legacy, being phased out)
2. **Neon Functions**: Hono + Drizzle ORM + Better Auth (primary, production)

Both share the same PostgreSQL database schema (defined in both Prisma and Drizzle).

### Security Hardening

The following security measures are implemented:

| Category | Feature | Implementation |
|----------|---------|----------------|
| **Auth** | Refresh Token Rotation | SHA-256 hashed tokens, rotation on each use, DB-backed |
| **Auth** | Brute Force Protection | 5 failed attempts → 15min lockout (IP+email) |
| **Auth** | Audit Logging | All auth events logged (login, logout, register, token refresh, password change, email verification) |
| **Auth** | Password Reset Validation | Redirect URL validated against CORS_ORIGIN allowlist |
| **Auth** | Device Token Expiry | 90-day TTL with cleanup endpoint |
| **Transport** | CORS | Strict CORS_ORIGIN required (no wildcard), credentials allowed |
| **Transport** | Security Headers | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, COEP, COOP, CORP via `hono/secure-headers` |
| **Transport** | Rate Limiting | Per-endpoint type: Auth 100/min, Upload 30/min, API 100/min |
| **Uploads** | Magic Bytes Validation | JPEG/PNG/WebP/HEIC/MP4/MOV/WebM verified against declared MIME type |
| **Uploads** | Pending Upload Cleanup | Unconfirmed uploads deleted after 24h (cron) |
| **WebSocket** | Auth on Upgrade | JWKS verification during handshake, not first message |
| **WebSocket** | Message Size Limit | 16KB max message size |
| **WebSocket** | Heartbeat Jitter | 30s ping/pong with random jitter |
| **Database** | Raw SQL Replaced | All raw SQL replaced with Drizzle type-safe helpers |
| **Database** | Parameterized Queries | Drizzle ORM prevents SQL injection |

### Neon Functions Configuration

Defined in `neon.ts`:

| Function | Source | Purpose |
|----------|--------|---------|
| `api` | `src/index.ts` | REST API (Hono) |
| `ws` | `src/websocket/index.ts` | WebSocket for chat/calls |

Both functions share:
- Neon Auth (Managed Better Auth) for authentication
- Neon Object Storage (S3-compatible) for uploads
- Neon Realtime for live queries
- PostgreSQL 16 (Lakebase) database

### Authentication

**Better Auth** (via Neon Auth) replaces Firebase Auth:

| Aspect | Configuration |
|--------|---------------|
| **Password Hashing** | scrypt (`N=16384, r=16, p=1, dkLen=64`) — Better Auth defaults |
| **Session Storage** | PostgreSQL `sessions` table |
| **Token Format** | JWT with 7-day expiry |
| **Token Verification** | JWKS at `{BETTER_AUTH_URL}/.well-known/jwks.json` |
| **Email Verification** | Disabled for dev (`requireEmailVerification: false`) |
| **Rate Limiting** | 100 req/min for auth endpoints |

Features:
- Email/password with verification
- JWT tokens with JWKS verification
- Sessions stored in database
- Password reset, email verification built-in

Tokens are verified via JWKS endpoint at `{BETTER_AUTH_URL}/.well-known/jwks.json`

### Database

Two schema definitions (kept in sync):
- **Prisma**: `prisma/schema.prisma` (legacy, for existing migrations)
- **Drizzle**: `src/db/schema.ts` (primary for Neon Functions)

Key models:
- `User` - Profile, counts, settings
- `Post` / `Reel` / `Story` - Content
- `Follow` / `Block` / `CloseFriend` - Social graph
- `Conversation` / `Message` - Chat
- `Notification` - Notifications with post thumbnail
- `PendingUpload` - Upload confirmation pattern (24h cleanup)

## API Endpoints Overview

### Auth (`/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | ❌ | Register with email, password, username, name |
| POST | `/login` | ❌ | Login with email/password |
| POST | `/logout` | ✅ | Sign out current session |
| POST | `/logout-all-devices` | ✅ | Revoke all sessions |
| POST | `/change-password` | ✅ | Change password (verify current) |
| POST | `/forgot-password` | ❌ | Request password reset email |
| POST | `/verify-email` | ❌ | Verify email with token |
| POST | `/resend-verification` | ❌ | Resend verification email |
| GET | `/me` | ✅ | Get current user profile |
| POST | `/refresh` | ❌ | Refresh session |

Better Auth also exposes standard endpoints at `/api/auth/*`:
- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-out`
- `POST /api/auth/forget-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/verify-email`
- `POST /api/auth/send-verification-email`

### User (`/v1/user` & `/v1/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/user/profile` | ✅ | **iOS alias** for current user profile |
| PUT | `/v1/user/profile` | ✅ | **iOS alias** update name only (`{name}`) |
| GET | `/v1/user/settings` | ✅ | Get user preferences |
| PUT | `/v1/user/settings` | ✅ | Update preferences |
| GET | `/v1/users/me` | ✅ | Canonical profile |
| PUT | `/v1/users/me` | ✅ | Full profile update |
| GET | `/v1/users/:id` | ✅ | Public profile + follow status |
| GET | `/v1/users/search` | ✅ | Search users |
| GET | `/v1/users/suggested` | ✅ | Suggested users |
| GET | `/v1/users/:id/followers` | ✅ | List followers |
| GET | `/v1/users/:id/following` | ✅ | List following |
| POST | `/v1/users/:id/follow` | ✅ | Follow user |
| DELETE | `/v1/users/:id/follow` | ✅ | Unfollow user |
| POST | `/v1/users/:id/block` | ✅ | Block user |
| DELETE | `/v1/users/:id/block` | ✅ | Unblock user |
| GET | `/v1/users/me/blocked` | ✅ | List blocked users |
| GET | `/v1/users/me/close-friends` | ✅ | List close friends |
| PUT | `/v1/users/me/close-friends` | ✅ | Replace close friends list (full-set) |

### Device Tokens (Push Notifications)

| Method | Path | Auth | Request Body |
|--------|------|------|--------------|
| POST | `/v1/users/me/device-token` | ✅ | `{ token: string, platform: "IOS" \| "ANDROID" }` |
| DELETE | `/v1/users/me/device-token` | ✅ | `{ token: string }` |

### Posts (`/v1/posts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/feed` | ✅ | Home feed (following + self) |
| GET | `/explore` | ✅ | Explore feed (non-following, popular) |
| GET | `/saved` | ✅ | Saved posts |
| GET | `/user/:userId` | ✅ | User's posts |
| GET | `/:id` | ✅ | Post detail |
| POST | `/` | ✅ | Create post |
| PUT | `/:id` | ✅ | Edit caption/location (author only) |
| DELETE | `/:id` | ✅ | Delete post (author only) |
| POST | `/:id/like` | ✅ | Like post |
| DELETE | `/:id/like` | ✅ | Unlike post |
| POST | `/:id/save` | ✅ | Save post |
| DELETE | `/:id/save` | ✅ | Unsave post |

> Post responses include: `isLiked`, `isSaved`, `author.isFollowing` (computed)

### Reels, Stories, Conversations, Notifications, Uploads

These endpoints are being migrated to Hono/Drizzle. Current Prisma/Express versions exist in the codebase but not yet mounted in the Hono router. See `IMPLEMENTATION_PLAN.md` for status.

## WebSocket

### Connection

**Local Development:**
```
ws://localhost:3001/ws?token=<better_auth_session_token>
```

**Neon Functions (Production/Free Tier):**
```
wss://<branch>-<project>.neonfunctions.app/ws?token=<better_auth_session_token>
```

### Authentication

Token via query param `?token=` (Better Auth session cookie not available on WebSocket upgrade)

### Client → Server Messages

```json
// Chat
{ "type": "send_message", "conversationId": "uuid", "content": "Hello", "contentType": "TEXT" }
{ "type": "typing_start", "conversationId": "uuid" }
{ "type": "typing_stop", "conversationId": "uuid" }
{ "type": "mark_read", "conversationId": "uuid" }
{ "type": "delete_message", "conversationId": "uuid", "to_user_id": "message-uuid" }

// Call Signaling
{ "type": "call_initiate", "callId": "uuid", "to_user_id": "uuid", "callType": "audio|video" }
{ "type": "call_offer", "callId": "uuid", "to_user_id": "uuid", "sdp": "..." }
{ "type": "call_answer", "callId": "uuid", "to_user_id": "uuid", "sdp": "..." }
{ "type": "call_ice_candidate", "callId": "uuid", "to_user_id": "uuid", "candidate": "..." }
{ "type": "call_hangup", "callId": "uuid", "to_user_id": "uuid" }
{ "type": "call_reject", "callId": "uuid", "to_user_id": "uuid" }
{ "type": "call_busy", "callId": "uuid", "to_user_id": "uuid" }
{ "type": "call_ringing", "callId": "uuid", "to_user_id": "uuid" }
```

### Server → Client Messages

```json
{ "type": "new_message", "message": {...} }
{ "type": "typing_start", "conversationId": "uuid", "userId": "uuid" }
{ "type": "typing_stop", "conversationId": "uuid", "userId": "uuid" }
{ "type": "message_read", "conversationId": "uuid", "userId": "uuid" }
{ "type": "message_deleted", "conversationId": "uuid", "messageId": "uuid" }
{ "type": "user_online", "user_id": "uuid" }
{ "type": "user_offline", "user_id": "uuid" }
{ "type": "call_*", "from_user_id": "uuid", "..." }
```

### Features

- **Presence**: 30s heartbeat, 30s offline debounce (multi-device aware)
- **Chat**: Message persistence, typing indicators, read receipts
- **Calls**: Full WebRTC signaling relay (offer/answer/ICE)
- **Validation**: Conversation membership verified before relay

## iOS Client Configuration

In Xcode scheme → Environment Variables:
```
APP_BASE_URL=http://localhost:3000
API_MODE=live
APP_ENVIRONMENT=dev
```

**Important iOS Notes:**
- Use `/v1/user/profile` (not `/v1/users/me`) for profile GET/PUT
- Send `name` field in PUT `/v1/user/profile` (not `fullName`)
- **Backend returns camelCase** — no snake_case decoding needed (remove `.convertFromSnakeCase`)
- Attach Better Auth session token to every request: `Authorization: Bearer <token>`
- WebSocket: Connect with `ws://host/ws?token=<session_token>`
- Use `pendingUploadId` from upload response in Post/Story/Reel creation

## Documentation

- `BACKEND_SYSTEM_DESIGN.md` — Complete system design & implementation details
- `API_ENDPOINTS.md` — Condensed endpoint reference with request/response examples
- `IMPLEMENTATION_PLAN.md` — Task tracking & roadmap
- `prisma/schema.prisma` — Legacy Prisma database schema
- `src/db/schema.ts` — Drizzle database schema (primary)

## Implementation Status

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Database Schema (Prisma + Drizzle) | ✅ Complete |
| 2 | Auth Endpoints (Better Auth) | ✅ Complete |
| 3 | User Profile & Settings | ✅ Complete |
| 4 | Post Endpoints | ✅ Complete |
| 5 | Reel Endpoints | ✅ Complete |
| 6 | Story Endpoints | ✅ Complete |
| 7 | Conversation/Message Endpoints | ✅ Complete |
| 8 | Notification Endpoints | ✅ Complete |
| 9 | Upload Endpoints | ✅ Complete |
| 10 | WebSocket (Chat/Calls) | ✅ Complete (Neon Functions) |
| 11 | Neon Functions Deployment | ✅ Configured |
| 12 | Production Hardening | ✅ Complete |

## Deployment

### Neon Functions (Free Tier) - Recommended

The project is configured with two Neon Functions:
- **`api`** — REST API (`src/index.ts`)
- **`ws`** — WebSocket server for chat/call signaling (`src/websocket/index.ts`)

Deploy both with:
```bash
npm run neon:deploy
```

This deploys to your Neon branch. The WebSocket function will be available at:
```
wss://<branch-name>-<project-name>.neonfunctions.app/ws
```

Free tier limits:
- 1 compute hour/month per function (scales to zero when idle)
- 0.5 GB PostgreSQL storage
- Functions run on Node.js 24
- 512 MB memory per function

### Environment Variables

```bash
# Database (Neon)
DATABASE_URL=postgresql://...

# Better Auth (Neon Auth)
BETTER_AUTH_SECRET=...          # Generated by `neon auth secret`
BETTER_AUTH_URL=https://<branch>-<project>.neonfunctions.app
RESEND_API_KEY=...              # For email verification/reset

# CORS (comma-separated, no spaces)
CORS_ORIGIN=https://yourdomain.com,http://localhost:3000

# Logging
LOG_LEVEL=info
```

### Better Auth Setup

1. Run `neon auth secret` to generate secrets
2. Configure email provider (Resend recommended)
3. Update `neon.ts` auth configuration if needed
4. Run `npm run neon:deploy` to deploy auth tables

### Docker Production Build (Legacy Express)

```bash
docker build -t instagram-backend .
docker run -d -p 3000:3000 --env-file .env instagram-backend
```

## License

MIT