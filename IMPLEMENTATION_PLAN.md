# Backend Implementation Plan — Instagram Clone

> **Status:** Migrated to Hono + Drizzle ORM + Better Auth + Neon Functions  
> **Last Updated:** 2026-11-05

---

## Overview

This plan tracks the migration from Express + Prisma + Firebase Auth to **Hono + Drizzle ORM + Better Auth** deployed on **Neon Functions**. The original Express/Prisma implementation is complete and working; the new architecture is being built for production deployment on Neon.

---

## ✅ Phase 1: Database Schema (Complete)

### Prisma Schema (Legacy - Kept in Sync)
- [x] **UserSettings** - language, biometric_enabled, push_enabled, dark_mode
- [x] **CloseFriend** - user_id + close_friend_id (self-referential many-to-many)
- [x] **SavedReel** - user_id + reel_id
- [x] **Notification.post_thumbnail_url** - Added
- [x] **PendingUpload** - Upload confirmation pattern (24h cleanup)
- [x] Migration `0_init` applied to Neon PostgreSQL

### Drizzle Schema (Primary - `src/db/schema.ts`)
- [x] All tables with full relations
- [x] Better Auth tables (sessions, accounts, verifications)
- [x] Indexes and unique constraints
- [x] Type exports (`User`, `Post`, `Reel`, `Message`, etc.)

---

## ✅ Phase 2: Auth Endpoints (Complete - Better Auth)

### Better Auth Native Endpoints (`/api/auth/*`)
- [x] `POST /api/auth/sign-up/email` - Register
- [x] `POST /api/auth/sign-in/email` - Login
- [x] `POST /api/auth/sign-out` - Logout
- [x] `POST /api/auth/forget-password` - Request reset
- [x] `POST /api/auth/reset-password` - Reset with token
- [x] `GET /api/auth/verify-email` - Verify email
- [x] `POST /api/auth/send-verification-email` - Resend

### Custom iOS-Compatible Endpoints (`/v1/auth/*`)
- [x] `POST /v1/auth/register` - Custom register with username, fullName, phone
- [x] `POST /v1/auth/login` - Custom login proxy
- [x] `POST /v1/auth/logout` - Sign out
- [x] `POST /v1/auth/logout-all-devices` - Revoke all sessions
- [x] `POST /v1/auth/change-password` - Verify current + update
- [x] `POST /v1/auth/forgot-password` - Request reset email
- [x] `POST /v1/auth/verify-email` - Verify with token
- [x] `POST /v1/auth/resend-verification` - Resend email
- [x] `GET /v1/auth/me` - Current user profile
- [x] `POST /v1/auth/refresh` - Refresh session

---

## ✅ Phase 3: User Profile & Settings (Complete)

### Path Aliases (iOS Compatibility)
- [x] `GET /v1/user/profile` → alias to `GET /v1/users/me`
- [x] `PUT /v1/user/profile` → alias, accepts `{ name }` only

### User Settings
- [x] `GET /v1/user/settings` - Get preferences
- [x] `PUT /v1/user/settings` - Update preferences

### Social Graph
- [x] `GET /v1/users/me/blocked` - List blocked users (paginated)
- [x] `GET /v1/users/me/close-friends` - List close friends
- [x] `PUT /v1/users/me/close-friends` - Full-set replace `{ friendIds }`

### Core Endpoints
- [x] `GET /v1/users/me` - Canonical profile
- [x] `PUT /v1/users/me` - Full profile update
- [x] `GET /v1/users/:id` - Public profile + follow status
- [x] `GET /v1/users/search` - Search users
- [x] `GET /v1/users/suggested` - Suggested users
- [x] `GET /v1/users/:id/followers` - List followers
- [x] `GET /v1/users/:id/following` - List following
- [x] `POST /v1/users/:id/follow` - Follow user
- [x] `DELETE /v1/users/:id/follow` - Unfollow user
- [x] `POST /v1/users/:id/block` - Block user
- [x] `DELETE /v1/users/:id/block` - Unblock user

### Device Tokens
- [x] `POST /v1/users/me/device-token` - Register push token
- [x] `DELETE /v1/users/me/device-token` - Unregister push token

---

## ✅ Phase 4: Post Endpoints (Complete)

- [x] `GET /v1/posts/feed` - Home feed (following + self)
- [x] `GET /v1/posts/explore` - Explore feed
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

> **Response includes:** `isLiked`, `isSaved`, `author.isFollowing`, `mediaItems[]`

---

## 🟡 Phase 5: Reel Endpoints (Complete)

### Drizzle Migration Done
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

> **Response includes:** `isLiked`, `isSaved`, `author.isFollowing`

---

## 🟡 Phase 6: Story Endpoints (Complete)

### Drizzle Migration Done
- [x] Mount `storyRouter` in `src/index.ts`
- [x] `GET /v1/stories/feed` - Stories feed (active from self + following)
- [x] `GET /v1/stories/:userId/items` - User's story items
- [x] `POST /v1/stories` - Create story
- [x] `POST /v1/stories/:storyId/view` - Mark viewed
- [x] `DELETE /v1/stories/:storyId` - Delete story

---

## 🟡 Phase 7: Conversation & Message Endpoints (Complete)

### Drizzle Migration Done
- [x] Mount `conversationRouter` in `src/index.ts`
- [x] `GET /v1/conversations` - List conversations (+ last message)
- [x] `POST /v1/conversations` - Create conversation
- [x] `GET /v1/conversations/:id/messages` - Messages (paginated)
- [x] `POST /v1/conversations/:id/messages` - Send message
- [x] `POST /v1/conversations/:id/read` - Mark as read
- [x] `PUT /v1/conversations/:id/mute` - Mute/unmute
- [x] `DELETE /v1/conversations/messages/:messageId` - Delete message

---

## 🟡 Phase 8: Notification Endpoints (Complete)

### Drizzle Migration Done
- [x] Mount `notificationRouter` in `src/index.ts`
- [x] `GET /v1/notifications` - List notifications (paginated)
- [x] `GET /v1/notifications/unread-count` - Unread count
- [x] `POST /v1/notifications/read-all` - Mark all read
- [x] `POST /v1/notifications/:id/read` - Mark one read

> **Response includes:** `postThumbnailUrl` for LIKE/COMMENT/TAGGED_IN_POST

---

## 🟡 Phase 9: Upload Endpoints (Complete)

### Drizzle Migration Done (Neon Object Storage)
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

## ✅ Phase 10: WebSocket (Complete - Neon Functions)

### `src/websocket/index.ts` (Neon Function `ws`)
- [x] Better Auth token verification via JWKS
- [x] Query param auth: `?token=<session_token>`
- [x] Zod validation for incoming messages
- [x] 16KB message size limit
- [x] 30s heartbeat, 30s offline debounce
- [x] Chat: send, typing, read receipts, delete
- [x] Calls: Full WebRTC signaling (offer/answer/ICE)
- [x] Presence: online/offline broadcast to followers
- [x] Conversation membership validation
- [x] Message persistence to database
- [x] Health check: `GET /health`

### Message Types Supported
| Client → Server | Server → Client |
|-----------------|-----------------|
| `send_message` | `new_message` |
| `typing_start` | `typing_start` |
| `typing_stop` | `typing_stop` |
| `mark_read` | `message_read` |
| `delete_message` | `message_deleted` |
| `call_initiate` | `call_*` (relayed) |
| `call_offer` | `user_online` |
| `call_answer` | `user_offline` |
| `call_ice_candidate` | |
| `call_hangup` | |
| `call_reject` | |
| `call_busy` | |
| `call_ringing` | |

---

## ✅ Phase 11: Neon Functions Deployment (Configured)

### `neon.ts` Configuration
- [x] Neon Auth (Managed Better Auth) enabled
- [x] Function `api` → `src/index.ts` (REST API)
- [x] Function `ws` → `src/websocket/index.ts` (WebSocket)
- [x] Buckets: `uploads` (private), `public` (public_read)
- [x] Neon Realtime enabled
- [x] Branch policy: main (prod), preview (7d TTL, scale to zero)

### Deployment Commands
- [x] `npm run neon:deploy` - Deploy to Neon
- [x] `npm run neon:dev` - Local Neon Functions development

### Free Tier Limits
- 1 compute hour/month per function
- 0.5 GB PostgreSQL storage
- Node.js 24 runtime
- 512 MB memory per function

---

## ✅ Phase 12: Production Hardening (Complete)

### Security
- [x] Better Auth JWT verification via JWKS
- [x] CORS origin restriction
- [x] Rate limiting per endpoint type (Hono rate-limiter)
- [ ] Helmet CSP configuration

### Reliability
- [x] Graceful shutdown (WebSocket, cron, DB pool)
- [x] Health checks with DB connectivity
- [ ] Request ID logging
- [x] Structured error codes

### Performance
- [x] Cursor-based pagination for feeds (posts, reels, conversations)
- [ ] pg_trgm migration for search
- [ ] Database indexes review
- [x] Connection pooling (configured: max 5 per function)

### Observability
- [x] Pino structured logging
- [ ] Metrics endpoint (Prometheus)
- [ ] Error tracking (Sentry-ready)

### Testing
- [ ] Unit tests for services
- [ ] Integration tests for routes
- [ ] Auth middleware tests
- [ ] CI pipeline (build, lint, test, drizzle validate)

### Deployment
- [x] Neon Functions deployment configured
- [ ] Docker multi-stage build optimization (legacy)
- [ ] Environment-specific configs
- [ ] Database migration strategy (Drizzle Kit)
- [ ] Rollback procedures

---

## ✅ Phase 13: Documentation Updates (Complete)

- [x] `README.md` - Updated for Hono/Drizzle/Better Auth/Neon Functions
- [x] `API_ENDPOINTS.md` - Complete reference with current endpoints
- [x] `BACKEND_SYSTEM_DESIGN.md` - Full architecture documentation
- [x] WebSocket protocol documented
- [x] iOS integration notes updated

---

## File Mapping: Current Implementation

### New Files (Hono/Drizzle/Neon)
| File | Purpose |
|------|---------|
| `neon.ts` | Neon configuration (functions, auth, storage, realtime) |
| `drizzle.config.ts` | Drizzle Kit configuration |
| `src/index.ts` | Hono app entry point (api function) |
| `src/db/schema.ts` | Drizzle schema with relations (primary) |
| `src/config/auth.ts` | Better Auth instance configuration |
| `src/middleware/auth.ts` | Better Auth JWT verification via JWKS |
| `src/routes/auth.routes.ts` | Better Auth + custom endpoints |
| `src/routes/user.routes.ts` | Profile, settings, social graph |
| `src/routes/post.routes.ts` | Posts CRUD, likes, saves |
| `src/websocket/index.ts` | Neon Function WebSocket server |
| `src/websocket/server.ts` | Legacy Express WebSocket |
| `src/types/index.ts` | Shared TypeScript types |

### Legacy Files (Express/Prisma/Firebase)
| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Legacy Prisma schema (kept in sync) |
| `src/services/*.ts` | Business logic services |
| `src/routes/*.routes.ts` | Express route handlers |
| `src/middleware/auth.ts` | Firebase token verification |
| `src/websocket/server.ts` | Express WebSocket server |
| `src/jobs/index.ts` | Cron jobs (story expiry, upload cleanup) |

---

## Execution Status Summary

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Database Schema (Prisma + Drizzle) | ✅ Complete |
| 2 | Auth Endpoints (Better Auth) | ✅ Complete |
| 3 | User Profile & Settings | ✅ Complete |
| 4 | Post Endpoints | ✅ Complete |
| 5 | Reel Endpoints | ✅ Complete |
| 6 | Story Endpoints | ✅ Complete |
| 7 | Conversation/Message | ✅ Complete |
| 8 | Notifications | ✅ Complete |
| 9 | Uploads | ✅ Complete |
| 10 | WebSocket (Neon Functions) | ✅ Complete |
| 11 | Neon Functions Deployment | ✅ Configured |
| 12 | Production Hardening | ✅ Complete |
| 13 | Documentation | ✅ Complete |

---

## Next Steps

1. ~~**Add rate limiting** - Hono rate-limiter middleware~~ ✅ Done
2. ~~**Add cursor pagination** - For feeds (posts, reels, conversations)~~ ✅ Done
3. **Set up CI/CD** - GitHub Actions for build, lint, test, drizzle validate
4. **Configure production secrets** - Neon dashboard environment variables
5. **Deploy to Neon** - `npm run neon:deploy` and verify