# Implementation Progress — Instagram Clone Backend

> **Updated:** 2026-11-05  
> **Architecture:** Hono + Drizzle ORM + Better Auth + Neon Functions (Primary)  
> **Legacy:** Express + Prisma + Firebase Auth (Kept in sync)

This document tracks the actual implementation status against the [BACKEND_SYSTEM_DESIGN.md](./BACKEND_SYSTEM_DESIGN.md).

---

## Overview

| Area | Status | Notes |
|------|--------|-------|
| Hono REST API (Neon `api` function) | ✅ Complete | Auth, Users, Posts, Reels, Stories, Conversations, Notifications, Uploads all mounted |
| Better Auth (Neon Auth) | ✅ Complete | Email/password, sessions, JWT via JWKS, password reset, email verification |
| Drizzle ORM Schema | ✅ Complete | All tables with relations, indexes, Better Auth tables |
| WebSocket (Neon `ws` function) | ✅ Complete | Chat, calls, typing, presence, JWKS auth, heartbeat |
| Neon Functions Config | ✅ Complete | `neon.ts` with auth, functions, buckets, realtime, branch policy |
| Neon Object Storage | ✅ Configured | `uploads` (private), `public` (public_read) buckets |
| Neon Realtime | ✅ Enabled | Live queries for chat, notifications, presence |
| Legacy Express/Prisma | ✅ Synced | Kept in sync with Drizzle schema |

---

## ✅ Completed

### Foundation
- [x] Hono app with CORS, JSON body parsing, Pino logging, rate limiting
- [x] Global error handler with unified response format
- [x] Drizzle schema for all models (users, posts, reels, stories, chat, notifications, uploads)
- [x] Prisma schema kept in sync for legacy migrations
- [x] Better Auth instance with email/password, verification, password reset
- [x] JWKS-based JWT verification middleware (`src/middleware/auth.ts`)
- [x] `GET /health` on both API and WebSocket functions
- [x] Environment validation via `neon.ts` config
- [x] Drizzle Kit configuration for migrations
- [x] TypeScript strict mode with path aliases

### Authentication (Better Auth via Neon Auth)
- [x] Native Better Auth endpoints at `/api/auth/*` (sign-up, sign-in, sign-out, password reset, email verification)
- [x] Custom iOS-compatible endpoints at `/v1/auth/*` (register, login, logout, logout-all, change-password, forgot-password, verify-email, resend-verification, me, refresh)
- [x] Session management with 7-day JWT expiry
- [x] `revokeOtherSessions` on password change
- [x] JWKS token verification with issuer/audience validation
- [x] User lookup from database on each request

### User Profile & Settings
- [x] `GET /v1/user/profile` (iOS alias)
- [x] `PUT /v1/user/profile` (iOS alias, accepts `{ name }`)
- [x] `GET /v1/user/settings` - Get preferences
- [x] `PUT /v1/user/settings` - Update preferences
- [x] `GET /v1/users/me` - Canonical profile
- [x] `PUT /v1/users/me` - Full profile update
- [x] `GET /v1/users/:id` - Public profile + follow status
- [x] `GET /v1/users/search` - Search users (paginated)
- [x] `GET /v1/users/suggested` - Suggested users (paginated)
- [x] `GET /v1/users/:id/followers` - List followers
- [x] `GET /v1/users/:id/following` - List following
- [x] `POST /v1/users/:id/follow` - Follow user
- [x] `DELETE /v1/users/:id/follow` - Unfollow user
- [x] `POST /v1/users/:id/block` - Block user
- [x] `DELETE /v1/users/:id/block` - Unblock user
- [x] `GET /v1/users/me/blocked` - List blocked users (paginated)
- [x] `GET /v1/users/me/close-friends` - List close friends
- [x] `PUT /v1/users/me/close-friends` - Full-set replace `{ friendIds }`
- [x] `POST /v1/users/me/device-token` - Register push token
- [x] `DELETE /v1/users/me/device-token` - Unregister push token

### Posts
- [x] `GET /v1/posts/feed` - Home feed (following + self)
- [x] `GET /v1/posts/explore` - Explore feed (popular, non-following)
- [x] `GET /v1/posts/saved` - Saved posts
- [x] `GET /v1/posts/user/:userId` - User's posts
- [x] `GET /v1/posts/:id` - Post detail
- [x] `POST /v1/posts` - Create post with media
- [x] `PUT /v1/posts/:id` - Edit caption/location (author only)
- [x] `DELETE /v1/posts/:id` - Delete post (author only)
- [x] `POST /v1/posts/:id/like` - Like post
- [x] `DELETE /v1/posts/:id/like` - Unlike post
- [x] `POST /v1/posts/:id/save` - Save post
- [x] `DELETE /v1/posts/:id/save` - Unsave post

> **Response includes:** `isLiked`, `isSaved`, `author.isFollowing`, `mediaItems[]` (computed)

### WebSocket (Neon Functions `ws` function)
- [x] Better Auth token verification via JWKS on first message
- [x] Query param auth: `wss://host/ws?token=<session_token>`
- [x] Zod validation for incoming messages
- [x] 16KB message size limit
- [x] 30s heartbeat (ping/pong), 30s offline debounce
- [x] Multi-device support (user → Set<WebSocket>)
- [x] Chat: `send_message`, `typing_start/stop`, `mark_read`, `delete_message`
- [x] Calls: Full WebRTC signaling (`call_initiate`, `call_offer`, `call_answer`, `call_ice_candidate`, `call_hangup`, `call_reject`, `call_busy`, `call_ringing`)
- [x] Presence: `user_online`/`user_offline` broadcast to followers
- [x] Conversation membership validation before relay
- [x] Message persistence to database
- [x] Health check: `GET /health`

### Neon Functions Deployment
- [x] `neon.ts` configuration with:
  - Neon Auth (Managed Better Auth)
  - Function `api` → `src/index.ts` (REST API)
  - Function `ws` → `src/websocket/index.ts` (WebSocket)
  - Buckets: `uploads` (private), `public` (public_read)
  - Neon Realtime enabled
  - Branch policy: main (min 1, max 2 compute), preview (7d TTL, scale to zero)
- [x] Deploy commands: `npm run neon:deploy`, `npm run neon:dev`
- [x] Free tier limits documented

### Documentation
- [x] `README.md` - Updated for Hono/Drizzle/Better Auth/Neon Functions
- [x] `API_ENDPOINTS.md` - Complete reference with current endpoints
- [x] `BACKEND_SYSTEM_DESIGN.md` - Full architecture documentation
- [x] `IMPLEMENTATION_PLAN.md` - Current status tracking

---

## ✅ Completed (All Core Endpoints)

### Reel Endpoints (Hono/Drizzle Migration)
- [x] Mount `reelRouter` in `src/index.ts`
- [x] `GET /v1/reels/feed` - Reels feed
- [x] `GET /v1/reels/user/:userId` - User's reels grid
- [x] `POST /v1/reels` - Create reel
- [x] `POST /v1/reels/:id/like` - Like reel
- [x] `DELETE /v1/reels/:id/like` - Unlike reel
- [x] `POST /v1/reels/:id/save` - Save reel
- [x] `DELETE /v1/reels/:id/save` - Unsave reel
- [x] `DELETE /v1/reels/:id` - Delete reel (author only)
- [x] `POST /v1/reels/:id/view` - Increment view count
- [x] `GET /v1/reels/:reelId/comments` - Reel comments
- [x] `POST /v1/reels/:reelId/comments` - Add reel comment

### Story Endpoints (Hono/Drizzle Migration)
- [x] Mount `storyRouter` in `src/index.ts`
- [x] `GET /v1/stories/feed` - Stories feed
- [x] `GET /v1/stories/:userId/items` - User's story items
- [x] `POST /v1/stories` - Create story
- [x] `POST /v1/stories/:storyId/view` - Mark viewed
- [x] `DELETE /v1/stories/:storyId` - Delete story

### Conversation & Message Endpoints (Hono/Drizzle Migration)
- [x] Mount `conversationRouter` in `src/index.ts`
- [x] `GET /v1/conversations` - List conversations (+ last message)
- [x] `POST /v1/conversations` - Create conversation
- [x] `GET /v1/conversations/:id/messages` - Messages (paginated)
- [x] `POST /v1/conversations/:id/messages` - Send message
- [x] `POST /v1/conversations/:id/read` - Mark as read
- [x] `PUT /v1/conversations/:id/mute` - Mute/unmute
- [x] `DELETE /v1/conversations/messages/:messageId` - Delete message

### Notification Endpoints (Hono/Drizzle Migration)
- [x] Mount `notificationRouter` in `src/index.ts`
- [x] `GET /v1/notifications` - List notifications (paginated)
- [x] `GET /v1/notifications/unread-count` - Unread count
- [x] `POST /v1/notifications/read-all` - Mark all read
- [x] `POST /v1/notifications/:id/read` - Mark one read

### Upload Endpoints (Hono/Drizzle + Neon Object Storage)
- [x] Mount `uploadRouter` in `src/index.ts`
- [x] `POST /v1/upload/presign` - Get presigned URL for direct upload
- [x] `POST /v1/upload/confirm` - Confirm pending upload
- [x] `POST /v1/upload/image` - Upload image (max 10MB)
- [x] `POST /v1/upload/video` - Upload video (max 100MB)
- [x] `POST /v1/upload/avatar` - Upload avatar (400x400)
- [x] `GET /v1/upload/pending/:id` - Get pending upload status
- [x] `DELETE /v1/upload/pending/:id` - Delete pending upload
- [x] Presigned URL generation for direct uploads
- [x] `PendingUpload` confirmation pattern (24h cleanup cron)

---

## 📋 To Do

### Production Hardening
- [ ] Rate limiting per endpoint type (Hono rate-limiter)
- [ ] Helmet CSP configuration
- [ ] Cursor-based pagination for feeds (posts, reels, conversations)
- [ ] pg_trgm migration for search
- [ ] Database indexes review
- [ ] Request ID logging
- [ ] Metrics endpoint (Prometheus)
- [ ] Error tracking (Sentry integration)
- [ ] Structured audit logging

### Testing & CI
- [ ] Unit tests for services
- [ ] Integration tests for routes
- [ ] Auth middleware tests
- [ ] CI pipeline (build, lint, test, drizzle validate)
- [ ] GitHub Actions workflow

### Deployment
- [ ] Configure production secrets in Neon dashboard
- [ ] Run `neon auth secret` for Better Auth
- [ ] Deploy to Neon: `npm run neon:deploy`
- [ ] Verify WebSocket and API endpoints
- [ ] Rollback procedures

---

## Key Differences from Legacy Design

1. **Auth**: Better Auth (Neon Auth) replaces Firebase Auth entirely
2. **ORM**: Drizzle ORM replaces Prisma as primary (Prisma kept for legacy migrations)
3. **Framework**: Hono replaces Express for Neon Functions deployment
4. **Storage**: Neon Object Storage (S3-compatible) replaces Firebase Storage
5. **Realtime**: Neon Realtime enables live SQL queries
6. **WebSocket**: Native `WebSocketPair` in Neon Functions runtime
7. **Functions**: Two separate functions (`api`, `ws`) for independent scaling
8. **Branch Policy**: Preview branches auto-expire, scale to zero

---

## Recent Verification

```bash
# TypeScript compilation (excludes websocket function due to Neon-specific APIs)
npm run build

# Drizzle schema validation
npm run drizzle:generate

# Prisma validation (legacy)
npx prisma validate
```

---

## Next Steps Priority

1. **Complete Reel/Story/Conversation/Notification/Upload endpoints** in Hono/Drizzle
2. **Mount all routers** in `src/index.ts`
3. **Add rate limiting** middleware
4. **Configure production secrets** in Neon dashboard
5. **Deploy to Neon** and verify end-to-end
6. **Set up CI/CD** pipeline