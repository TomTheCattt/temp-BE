# Backend System Design — Instagram Clone (Production Ready)

> **Updated:** 2026-11-10  
> **Status:** Migrated to Hono + Drizzle ORM + Better Auth + Neon Functions  
> **Tech Stack:** Node.js 20 LTS + Hono + TypeScript + PostgreSQL 16 + Drizzle ORM + Better Auth + Neon Functions + Neon Realtime + Neon Object Storage  
> **Auth Model:** Better Auth handles entire token lifecycle. **Opaque session tokens verified via database session lookup** (not JWT/JWKS). Sessions stored in database with 7-day sliding expiry. Password reset, email verification built-in. bcrypt password hashing (cost 10).

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        iOS Client (SwiftUI)                          │
│        NetworkService (Alamofire) ←→ WebSocketService (native)       │
└───────────────┬──────────────────────────────┬──────────────────────┘
                │ HTTPS (REST API)             │ WSS (WebSocket)
                ▼                              ▼
┌───────────────────────────────┐  ┌──────────────────────────────────┐
│      Hono REST API (api fn)   │  │   WebSocket Server (ws fn)       │
│   - Better Auth middleware    │  │   - Chat messaging               │
│   - Route handlers (Hono)     │  │   - Call signaling (WebRTC)      │
│   - Validation (Zod)          │  │   - Typing indicators            │
│   - File upload (multipart)   │  │   - Presence (online/offline)    │
│   - Rate limiting (Hono)      │  │                                  │
│   - Security headers          │  │                                  │
└───────────────┬───────────────┘  └──────────────┬───────────────────┘
                │                                  │
                ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Service Layer (In-Route Logic)                  │
│   Auth: Better Auth (register, login, password, email, sessions)      │
│   Users: Profile, settings, social graph, close friends, blocks       │
│   Posts: CRUD, likes, saves, feed, explore, media                    │
│   Reels: CRUD, likes, saves, comments, views                         │
│   Stories: CRUD, views, stickers                                     │
│   Conversations: CRUD, messages, mute, read receipts                 │
│   Notifications: List, read, triggers (like, comment, follow, etc.)  │
│   Uploads: Neon Object Storage (S3-compatible), pending confirmation  │
│   WebSocket: Chat, calls, typing, presence                           │
└───────────────┬──────────────────────────┬───────────────────────────┘
                │                          │
                ▼                          ▼
┌──────────────────────────┐   ┌───────────────────────────────────────┐
│    PostgreSQL Database    │   │         Neon Services                  │
│  (Drizzle ORM)           │   │  - Neon Auth (Managed Better Auth)     │
│  - Users, Posts, Comments │   │  - Neon Functions (api, ws)          │
│  - Messages, Stories      │   │  - Neon Realtime (live queries)      │
│  - Notifications, Reels   │   │  - Neon Object Storage (S3)          │
│  - Follows, Blocks        │   └───────────────────────────────────────┘
│  - DeviceTokens           │
│  - UserSettings           │
│  - CloseFriends           │
│  - SavedReels             │
│  - PendingUploads         │
└──────────────────────────┘
```

### Dual Runtime Support

| Environment | Framework | ORM | Auth | Deployment |
|-------------|-----------|-----|------|------------|
| **Local Dev** | Express | Prisma | Firebase | Docker Compose |
| **Neon Functions** | Hono | Drizzle | Better Auth | `neon deploy` |

Both share the **same PostgreSQL schema** (defined in both `prisma/schema.prisma` and `src/db/schema.ts`).

---

## 2. Tech Stack Details

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Node.js | 20 LTS | Async I/O, large ecosystem |
| Language | TypeScript | 5.x | Type safety, refactor-friendly |
| Framework (Neon) | Hono | 4.x | Fast, lightweight, edge-ready |
| Framework (Legacy) | Express | 4.x | Local development compatibility |
| ORM (Neon) | Drizzle ORM | 0.45.x | Type-safe SQL, fast, lightweight |
| ORM (Legacy) | Prisma | 5.x | Migrations, Prisma Studio |
| Database | PostgreSQL | 16 | Relational, JSONB, full-text search |
| Auth | Better Auth | 1.x | Email/password, sessions, opaque tokens, database lookup |
| Auth Provider | Neon Auth | Managed | Better Auth on Neon infrastructure |
| Storage | Neon Object Storage | S3-compatible | Branching file storage |
| Realtime | Neon Realtime | - | Live SQL queries for chat/notifications |
| WebSocket | WebSocketPair | Native | Neon Functions WebSocket support |
| Validation | Zod | 3.x | Runtime validation + TS inference |
| Logging | Pino | 9.x | Structured JSON logging |
| Testing | Vitest + Supertest | 3.x | Fast, TypeScript native |
| Container | Docker + docker-compose | - | Local PostgreSQL setup |
| Rate Limiting | Hono rate-limiter | - | Prevent abuse |
| Image Processing | Sharp | 0.33.x | Resize/optimize avatars, thumbnails |
| Video Processing | fluent-ffmpeg | 2.1.x | Thumbnail, duration for Reels/Stories |
| Scheduled Jobs | node-cron | 3.x | Expire stories, cleanup orphaned uploads |
| Push Notifications | Better Auth + FCM | - | Device token management |
| Search | PostgreSQL pg_trgm | - | Fast ILIKE search |

---

## 3. Project Structure

```
instagram-backend/
├── neon.ts                    # Neon configuration (functions, auth, storage, realtime)
├── drizzle.config.ts          # Drizzle Kit configuration
├── prisma/
│   ├── schema.prisma          # Legacy Prisma schema (kept in sync)
│   └── migrations/            # Version-controlled Prisma migrations
├── src/
│   ├── index.ts               # Hono app entry point (api function)
│   ├── db/
│   │   └── schema.ts          # Drizzle schema with relations (primary)
│   ├── config/
│   │   ├── auth.ts            # Better Auth instance configuration
│   │   └── env.ts             # Environment validation (if needed)
│   ├── middleware/
│   │   └── auth.ts            # Better Auth session verification via database lookup
│   ├── routes/
│   │   ├── auth.routes.ts     # Better Auth endpoints + custom register/login
│   │   ├── user.routes.ts     # Profile, settings, social graph, close friends, blocks
│   │   ├── post.routes.ts     # Posts CRUD, likes, saves, feeds, comments
│   │   ├── reel.routes.ts     # Reels CRUD, likes, saves, views, comments
│   │   ├── story.routes.ts    # Stories CRUD, views, stickers, comments
│   │   ├── conversation.routes.ts # Chat CRUD, messages, mute, read receipts
│   │   ├── notification.routes.ts # Notifications list, read, triggers
│   │   ├── report.routes.ts   # Content moderation reports
│   │   └── upload.routes.ts   # Neon Object Storage uploads
│   ├── websocket/
│   │   ├── index.ts           # Neon Function entry point (ws function)
│   │   └── server.ts          # Legacy Express WebSocket server
│   ├── types/
│   │   └── index.ts           # Shared TypeScript types
│   └── utils/
│       ├── errors.ts          # Custom error classes
│       └── pagination.ts      # Pagination helpers
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. Neon Configuration (`neon.ts`)

```typescript
import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Neon Auth (Managed Better Auth)
  auth: true,

  // Neon Functions
  functions: {
    // REST API
    api: {
      name: "Instagram Clone API",
      source: "src/index.ts",
      env: {
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,
        RESEND_API_KEY: process.env.RESEND_API_KEY!,
        CORS_ORIGIN: process.env.CORS_ORIGIN!,
        LOG_LEVEL: process.env.LOG_LEVEL || "info",
      },
    },
    // WebSocket for chat/calls
    ws: {
      name: "WebSocket Server",
      source: "src/websocket/index.ts",
      env: {
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,
        CORS_ORIGIN: process.env.CORS_ORIGIN!,
        LOG_LEVEL: process.env.LOG_LEVEL || "info",
      },
    },
  },

  // Neon Object Storage (S3-compatible)
  buckets: {
    uploads: { access: "private" },
    public: { access: "public_read" },
  },

  // Neon Realtime
  preview: { realtime: true },

  // Branch policy
  branch: (branch) => {
    if (branch.isDefault) {
      return {
        functions: {
          api: { runtime: "nodejs24" },
          ws: { runtime: "nodejs24" },
        },
      };
    }
    if (!branch.exists) {
      return {
        ttl: "7d",
        functions: {
          api: { runtime: "nodejs24" },
          ws: { runtime: "nodejs24" },
        },
      };
    }
    return {};
  },
});
```

---

## 5. Database Schema (Drizzle - Primary)

Defined in `src/db/schema.ts` with full relations.

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | User profiles | id, firebaseUid, username, fullName, email, avatarUrl, bio, isVerified, isPrivate, counts |
| `user_settings` | Preferences | userId (PK), language, biometricEnabled, pushEnabled, darkMode |
| `device_tokens` | Push notifications | id, userId, token, platform |
| `follows` | Social graph | id, followerId, followingId, createdAt |
| `blocks` | Blocked users | id, blockerId, blockedId, createdAt |
| `close_friends` | Close friends list | id, userId, friendId, createdAt |

### Content Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `posts` | Feed posts | id, authorId, caption, location, likesCount, commentsCount |
| `media_items` | Post media | id, postId, url, thumbnailUrl, type, width, height, duration, sortOrder |
| `reels` | Short videos | id, authorId, videoUrl, thumbnailUrl, caption, audio, duration, counts |
| `saved_reels` | Saved reels | id, userId, reelId, createdAt |
| `stories` | Ephemeral content | id, authorId, createdAt, expiresAt |
| `story_items` | Story media | id, storyId, mediaUrl, type, duration, sticker |
| `story_views` | View tracking | id, storyId, viewerId, viewedAt |

### Chat Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `conversations` | Chat rooms | id, isGroup, groupName, groupAvatar, updatedAt |
| `conversation_members` | Participants | id, conversationId, userId, isMuted, lastReadAt |
| `messages` | Chat messages | id, conversationId, senderId, contentType, textContent, mediaUrl, status, replyToId |

### System Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `notifications` | Notifications | id, recipientId, actorId, type, postId, reelId, postThumbnailUrl, isRead |
| `pending_uploads` | Upload confirmation | id, userId, storagePath, url, confirmed, createdAt |
| `sessions` | Better Auth sessions | id, userId, token, expiresAt, ipAddress, userAgent |
| `accounts` | OAuth accounts | id, userId, accountId, providerId, tokens |
| `verifications` | Email verification | id, identifier, value, expiresAt |

### Better Auth Tables (Auto-managed)

- `sessions` - Active sessions with opaque tokens (verified via database lookup)
- `accounts` - Linked OAuth accounts
- `verifications` - Email verification tokens
- `refresh_tokens` - Refresh token rotation with SHA-256 hashing (30-day expiry)

---

## 6. Authentication (Better Auth via Neon Auth)

### Authentication Model

| Aspect | Configuration |
|--------|---------------|
| **Provider** | Better Auth (via Neon Auth - Managed) |
| **Password Hashing** | **bcrypt (cost 10)** — matches seeded password hashes |
| **Session Storage** | PostgreSQL `sessions` table |
| **Token Format** | **Opaque session tokens** (not JWT) |
| **Token Verification** | **Database session lookup** (not JWKS) |
| **Refresh Tokens** | Separate table with SHA-256 hashing, 30-day expiry, rotation |
| **Email Verification** | Disabled for development (`requireEmailVerification: false`) |
| **Rate Limiting** | 100 req/min for auth endpoints |

### Token Verification

Session tokens are **opaque** and verified via **database lookup** in `sessions` table:

Middleware (`src/middleware/auth.ts`):
```typescript
const sessionRecord = await db.query.sessions.findFirst({
  where: and(
    eq(schema.sessions.token, token),
    gt(schema.sessions.expiresAt, new Date())
  ),
});

if (!sessionRecord) {
  throw new HTTPException(401, { message: "Invalid or expired session" });
}
// Attach user and session to context
```

WebSocket function (`src/websocket/index.ts`) also uses database lookup during handshake.

### Auth Endpoints

**Custom endpoints** (`/v1/auth/*`):
- `POST /register` - Register with username, fullName, phone
- `POST /login` - Email/password login
- `POST /logout` - Sign out
- `POST /logout-all-devices` - Revoke all sessions
- `POST /change-password` - Verify current + update
- `POST /forgot-password` - Request reset email
- `POST /verify-email` - Verify with token
- `POST /resend-verification` - Resend email
- `GET /me` - Current user profile
- `POST /refresh` - Refresh session

**Better Auth native** (`/api/auth/*`):
- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-out`
- `POST /api/auth/forget-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/verify-email`
- `POST /api/auth/send-verification-email`

### Session Management

- Sessions stored in `sessions` table
- **Opaque session tokens with 7-day sliding expiry** (not JWT)
- Automatic session refresh via Better Auth (sliding window)
- `revokeOtherSessions` on password change
- **Refresh tokens** in `refresh_tokens` table with SHA-256 hashing, 30-day expiry, rotation

---

## 7. API Routes (Hono)

### Mounted Routes (`src/index.ts`)

```typescript
app.route("/v1/auth", authRouter);
app.route("/v1/user", userRouter);
app.route("/v1/posts", postRouter);
// app.route("/v1/reels", reelRouter);
// app.route("/v1/stories", storyRouter);
// app.route("/v1/conversations", conversationRouter);
// app.route("/v1/notifications", notificationRouter);
// app.route("/v1/upload", uploadRouter);
```

### Response Format

```typescript
// Success
{ success: true, data: { ... } }

// Error
{ success: false, error: "CODE", message: "..." }
```

### Pagination

```
?page=1&perPage=20  →  { items, page, perPage, total, hasMore }
Max perPage: 50
```

---

## 8. WebSocket Server (Neon Functions)

### Entry Point: `src/websocket/index.ts`

Exports default `fetch` handler for Neon Functions runtime.

### Connection

```
wss://<branch>-<project>.neonfunctions.app/ws
```

**Token Transmission (in order of preference):**
1. **Authorization header:** `Authorization: Bearer <session_token>`
2. **Sec-WebSocket-Protocol header:** `Sec-WebSocket-Protocol: bearer.<session_token>`
3. **Query parameter (legacy):** `?token=<session_token>`

### Features

| Feature | Implementation |
|---------|----------------|
| **Auth** | **Token verified via database session lookup BEFORE upgrade** (not JWKS) |
| **Heartbeat** | 30s ping/pong, 30s offline debounce |
| **Presence** | Broadcasts `user_online`/`user_offline` to followers |
| **Chat** | `send_message`, `typing_start/stop`, `mark_read`, `delete_message` |
| **Calls** | Full WebRTC signaling: offer/answer/ICE candidates |
| **Validation** | Conversation membership checked before relay |

### Message Types

**Client → Server:**
```typescript
// Chat
{ type: "send_message", conversationId, content, contentType }
{ type: "typing_start", conversationId }
{ type: "typing_stop", conversationId }
{ type: "mark_read", conversationId }
{ type: "delete_message", conversationId, to_user_id: messageId }

// Calls
{ type: "call_initiate", callId, to_user_id, callType }
{ type: "call_offer", callId, to_user_id, sdp }
{ type: "call_answer", callId, to_user_id, sdp }
{ type: "call_ice_candidate", callId, to_user_id, candidate }
{ type: "call_hangup", callId, to_user_id }
{ type: "call_reject", callId, to_user_id }
{ type: "call_busy", callId, to_user_id }
{ type: "call_ringing", callId, to_user_id }
```

**Server → Client:**
```typescript
{ type: "new_message", message: {...} }
{ type: "typing_start", conversationId, userId }
{ type: "typing_stop", conversationId, userId }
{ type: "message_read", conversationId, userId }
{ type: "message_deleted", conversationId, messageId }
{ type: "user_online", user_id }
{ type: "user_offline", user_id }
{ type: "call_*", from_user_id, ... }
```

### Scaling Considerations

- In-memory client map (per function instance)
- For multi-instance: use Neon Realtime or Redis for presence
- Messages persisted to database for durability

---

## 9. Neon Object Storage (Uploads)

### Buckets

| Bucket | Access | Purpose |
|--------|--------|---------|
| `uploads` | private | User uploads (avatars, posts, stories, reels) |
| `public` | public_read | CDN-served thumbnails, processed media |

### Upload Flow

1. Client requests presigned URL (or direct upload via API)
2. File uploaded to `uploads` bucket
3. Creates `PendingUpload` record (`confirmed: false`)
4. Client uses `pendingUploadId` in Post/Reel/Story creation
5. Backend marks `PendingUpload.confirmed = true`
6. Cron job deletes unconfirmed uploads after 24h

### Lifecycle Rules

```typescript
lifecycle: [
  { days: 1, action: "delete", prefix: "temp/" },
  { days: 30, action: "delete", prefix: "pending/" },
]
```

---

## 10. Neon Realtime (Live Queries)

Enabled in `neon.ts`:
```typescript
preview: { realtime: true }
```

### Use Cases

- Live chat messages (subscribe to conversation messages)
- Live notifications (subscribe to user notifications)
- Live presence (subscribe to follower online status)
- Live feed updates (subscribe to posts from following)

### Client Usage

```typescript
import { createClient } from "@neon/realtime";

const client = createClient({ url: "wss://..." });
const subscription = client.subscribe(
  db.select().from(messages).where(eq(messages.conversationId, id)),
  { onInsert: (msg) => ... }
);
```

---

## 11. Security Hardening

The following security measures are implemented across the stack:

### Authentication & Session Security

| Measure | Implementation |
|---------|----------------|
| **Refresh Token Rotation** | SHA-256 hashed tokens stored in DB, rotated on each use, revoked on logout/password change |
| **Brute Force Protection** | 5 failed login attempts → 15min lockout (in-memory per IP+email, Redis-ready design) |
| **Audit Logging** | All auth events logged: register, login, logout, logout-all, password change, email verify, token refresh |
| **Password Reset Validation** | Redirect URL validated against CORS_ORIGIN allowlist |
| **Device Token Expiry** | 90-day TTL with cleanup endpoint |
| **Session Storage** | PostgreSQL `sessions` table with IP, user agent, expiry |

### Transport Security

| Measure | Implementation |
|---------|----------------|
| **CORS** | Strict `CORS_ORIGIN` required (comma-separated, no wildcard), credentials allowed |
| **Security Headers** | Via `hono/secure-headers`: CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, Cross-Origin-Embedder-Policy: require-corp, Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Resource-Policy: same-origin |
| **Rate Limiting** | Per-endpoint: Auth 100/min, Upload 30/min, API 100/min (Hono rate-limiter) |

### Upload Security

| Measure | Implementation |
|---------|----------------|
| **Magic Bytes Validation** | JPEG/PNG/WebP/HEIC/MP4/MOV/WebM verified against declared MIME type before storage |
| **Pending Upload Cleanup** | Unconfirmed uploads deleted after 24h via cron |
| **File Size Limits** | Images: 10MB, Videos: 100MB, Avatars: 10MB |

### WebSocket Security

| Measure | Implementation |
|---------|----------------|
| **Auth on Upgrade** | **Database session lookup during handshake** (not deferred, not JWKS) |
| **Message Size Limit** | 16KB max message size |
| **Heartbeat Jitter** | 30s ping/pong with random jitter to prevent timing attacks |

### Database Security

| Measure | Implementation |
|---------|----------------|
| **Raw SQL Replaced** | All raw SQL replaced with Drizzle type-safe query builders |
| **Parameterized Queries** | Drizzle ORM prevents SQL injection by design |
| **Schema Validation** | Zod validation on all route inputs |

---

## 12. Scheduled Jobs

### Story Expiry (Every minute)

```typescript
// Expire stories older than 24h
await db.delete(stories).where(lt(stories.expiresAt, new Date()));
```

### Orphaned Upload Cleanup (Daily)

```typescript
// Delete unconfirmed uploads older than 24h
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
const orphaned = await db.delete(pendingUploads)
  .where(and(eq(pendingUploads.confirmed, false), lt(pendingUploads.createdAt, cutoff)))
  .returning({ id: pendingUploads.id });

// Also delete files from Neon Object Storage
for (const upload of orphaned) {
  await storage.delete(upload.storagePath);
}
```

---

## 12. Error Handling

### Custom Errors (`src/utils/errors.ts`)

```typescript
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500
  ) { super(message); }
}

export class BadRequestError extends AppError { constructor(m: string) { super("VALIDATION_ERROR", m, 400); } }
export class UnauthorizedError extends AppError { constructor(m: string) { super("UNAUTHORIZED", m, 401); } }
export class ForbiddenError extends AppError { constructor(m: string) { super("FORBIDDEN", m, 403); } }
export class NotFoundError extends AppError { constructor(m: string) { super("NOT_FOUND", m, 404); } }
export class ConflictError extends AppError { constructor(m: string) { super("CONFLICT", m, 409); } }
```

### Hono Error Handler

```typescript
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ success: false, error: err.message }, err.status);
  }
  return c.json({ success: false, error: "INTERNAL_ERROR", message: "Unexpected error" }, 500);
});
```

---

## 13. iOS Client Integration

### Configuration

```swift
// Xcode Scheme → Environment Variables
APP_BASE_URL = "https://<branch>-<project>.neonfunctions.app"
API_MODE = "live"
APP_ENVIRONMENT = "prod"
```

### Key Points

| Aspect | iOS Implementation |
|--------|-------------------|
| **Profile Endpoint** | Use `/v1/user/profile` (GET/PUT) |
| **Profile Update** | Send `{ "name": "John" }` (not `fullName`) |
| **JSON Decoding** | `decoder.keyDecodingStrategy = .convertFromSnakeCase` |
| **Auth Header** | `Authorization: Bearer <better_auth_session_token>` |
| **WebSocket** | `wss://host/ws?token=<session_token>` |
| **Uploads** | Use `pendingUploadId` from upload response |
| **Computed Fields** | `isLiked`, `isSaved`, `author.isFollowing` included |

---

## 14. Deployment

### Neon Functions (Production)

```bash
# 1. Set environment variables in Neon dashboard or .env
# 2. Generate Better Auth secrets
neon auth secret

# 3. Deploy
npm run neon:deploy
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...

# Better Auth
BETTER_AUTH_SECRET=...          # From `neon auth secret`
BETTER_AUTH_URL=https://<branch>-<project>.neonfunctions.app
RESEND_API_KEY=...              # Email provider

# CORS
CORS_ORIGIN=https://yourdomain.com,http://localhost:3000

# Logging
LOG_LEVEL=info
```

### Free Tier Limits

| Resource | Limit |
|----------|-------|
| Compute hours | 1 hour/month per function |
| PostgreSQL storage | 0.5 GB |
| Function memory | 512 MB |
| Function timeout | No timeout (long-running) |
| Object Storage | Included in PostgreSQL quota |
| Realtime | Enabled on preview |

### Branch Workflow

- **Main branch**: Production settings (min 1, max 2 compute)
- **Preview branches**: Auto-expire 7d, scale to zero
- **Schema changes**: Use `drizzle-kit generate` + `drizzle-kit push`

---

## 15. Migration Status (Express → Hono)

| Feature | Express/Prisma | Hono/Drizzle | Status |
|---------|---------------|--------------|--------|
| Auth | ✅ | ✅ | Complete |
| User Profile | ✅ | ✅ | Complete |
| User Settings | ✅ | ✅ | Complete |
| Social Graph | ✅ | ✅ | Complete |
| Close Friends | ✅ | ✅ | Complete |
| Blocks | ✅ | ✅ | Complete |
| Posts | ✅ | ✅ | Complete |
| Reels | ✅ | ✅ | Complete |
| Stories | ✅ | ✅ | Complete |
| Conversations | ✅ | ✅ | Complete |
| Messages | ✅ | ✅ | Complete |
| Notifications | ✅ | ✅ | Complete |
| Uploads | ✅ | ✅ | Complete |
| WebSocket | ✅ | ✅ | Complete (Neon) |

---

## 16. License

MIT