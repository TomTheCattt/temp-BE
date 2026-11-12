# BE Repository Audit Report

**Date:** 2026-11-11
**Branch:** Current (not switched per user request)
**Purpose:** Compare existing BE implementation against DESIGN_DOCUMENT.md requirements

---

## Executive Summary

The BE repository at `/Users/tomthecat/temp-BE` has a **solid foundation** with working Hono API routes, Drizzle schema, Better Auth integration, and WebSocket implementations. However, **significant gaps exist** against the DESIGN_DOCUMENT.md requirements, particularly in:

1. **Security/Authorization** - No RLS policies, no policy engine (OPA-style)
2. **Real-time Infrastructure** - Current WebSocket is basic; missing ConnectionManager, channel authorization, event recovery, battery-optimized heartbeat
3. **Call/Video Signaling** - Basic relay only; no mediasoup SFU, no CallKit/VoIP push integration, no connection state machine
4. **Feed Performance** - No materialized views, no pg_cron refresh
5. **Search** - No hybrid search (BM25 + pgvector + graph RRF merge)
6. **Media Pipeline** - No TUS resumable uploads, no transcoding pipeline
7. **Observability** - Basic logging only; no OpenTelemetry, no structured audit logs
8. **Rate Limiting** - In-memory only; no Redis/Upstash tiered buckets
9. **Background Jobs** - Empty directory; no job queue system

---

## Detailed Gap Analysis

### 1. Database Schema & RLS (DESIGN_DOCUMENT.md §3)

| Requirement | Current Status | Gap |
|-------------|----------------|-----|
| Complete Prisma schema from DESIGN_DOCUMENT.md | ✅ Drizzle schema exists (comprehensive) | Need to generate Prisma schema for migrations |
| RLS policies for all tables | ❌ Not implemented | **Critical** - Core security requirement |
| Materialized view `feed_items` + pg_cron | ❌ Not implemented | Required for feed performance |
| `search_index` table (vector + BM25) | ❌ Not implemented | Required for hybrid search |
| `audit_logs` partitioned table | ❌ Not implemented | Required for observability |
| `rate_limit_buckets` table | ❌ Not implemented | Required for tiered rate limiting |
| Call tables (calls, participants, signaling_logs) | ⚠️ Partial in schema | Need verification against design |
| Drizzle schema generated from Prisma | ✅ Drizzle schema exists directly | Reverse of design flow |

**Existing Drizzle Schema Assessment:** The schema in `src/db/schema.ts` is comprehensive with all tables defined (users, posts, reels, stories, conversations, messages, calls, follows, blocks, likes, comments, notifications, device_tokens, etc.). Relations are properly defined. **Missing: RLS policies, materialized views, search indexes, audit logs, rate limit buckets.**

---

### 2. Auth & Authorization (DESIGN_DOCUMENT.md §4, §5)

| Requirement | Current Status | Gap |
|-------------|----------------|-----|
| Better Auth with email/password | ✅ Implemented (`src/config/auth.ts`) | |
| Better Auth middleware (session verification) | ✅ Implemented (`src/middleware/auth.ts`) | |
| OAuth (Google, Apple) | ❌ Not configured | Need to enable in Better Auth config |
| Authorization policy engine (OPA-style) | ❌ Not implemented | **Critical** - Centralized authZ |
| RLS sync with policy engine | ❌ Not implemented | Database-level enforcement |
| Tiered rate limiting (Redis/Upstash) | ❌ In-memory only (auth.routes.ts) | Production needs Redis |
| Request ID tracing + OpenTelemetry | ❌ Not implemented | Observability requirement |
| Idempotency key middleware | ❌ Not implemented | API reliability |
| Error handling (RFC 7807 Problem Details) | ❌ Not implemented | Standardized errors |
| Zod validation middleware | ✅ Per-route validation | Could be centralized |

**Current Auth Implementation:**
- `src/config/auth.ts` - Better Auth with email/password, bcrypt, cookie config
- `src/middleware/auth.ts` - Bearer token validation, session lookup
- `src/routes/auth.routes.ts` - Register, login, logout, refresh, password change, email verification

**Gaps:** No policy engine, no RLS, no Redis rate limiting, no OpenTelemetry, no RFC 7807 errors.

---

### 3. Core Feature Routes Assessment

| Feature | Routes | Status | Design Compliance |
|---------|--------|--------|-------------------|
| **Posts & Feed** | `post.routes.ts` | ✅ Comprehensive | Cursor pagination ✅, Block handling ✅, Private accounts ✅, Likes/saves ✅, Comments ✅ |
| **Explore** | `post.routes.ts` | ✅ Implemented | Non-followed + fallback ✅ |
| **Saved Posts** | `post.routes.ts` | ✅ Implemented | |
| **User Profiles** | `user.routes.ts` | ✅ Comprehensive | Search ✅, Followers/Following ✅, Follow/Unfollow ✅, Block/Unblock ✅, Close Friends ✅, Settings ✅, Device tokens ✅ |
| **Stories** | `story.routes.ts` | ✅ Comprehensive | Feed ✅, Items with views ✅, Create ✅, View tracking ✅, Delete ✅, Comments ✅ |
| **Reels** | `reel.routes.ts` | ✅ Comprehensive | Feed (popular) ✅, User grid ✅, Create ✅, Like/Save ✅, View count ✅, Comments ✅, Delete ✅ |
| **Conversations (DM)** | `conversation.routes.ts` | ✅ Comprehensive | List with last message ✅, Create (mutual follow check) ✅, Messages (cursor) ✅, Send ✅, Read receipts ✅, Mute ✅, Delete ✅ |
| **Notifications** | `notification.routes.ts` | ✅ Basic | List ✅, Unread count ✅, Mark read ✅ |
| **Upload** | `upload.routes.ts` | ✅ Comprehensive | Presign ✅, Confirm ✅, Direct image/video/avatar ✅, Magic bytes validation ✅, Pending uploads ✅ |
| **Reports** | `report.routes.ts` | ✅ Comprehensive | Create ✅, My reports ✅, Admin routes (placeholder) ✅ |

**Strengths:** Routes are well-structured with proper auth middleware, validation, authorization checks (private accounts, blocks, ownership), and consistent response format.

**Gaps vs Design:**
- No materialized view for feed (queries compute on-demand)
- No hybrid search endpoints
- No call/video REST endpoints (only WS signaling)
- No admin/moderation endpoints beyond reports placeholder
- No bulk operations, no export, no analytics

---

### 4. WebSocket Implementation (DESIGN_DOCUMENT.md §7)

| Requirement | Current Status | Gap |
|-------------|----------------|-----|
| **Neon Functions WebSocket (`/ws/v1`)** | ✅ `src/websocket/index.ts` - Hono WS handler | Good foundation |
| **ConnectionManager** (connections, subscriptions, presence) | ❌ Not implemented | Core requirement |
| **Channel authorization** (`canSubscribe`) | ❌ Not implemented | Required for security |
| **Message handlers** (ping, subscribe, unsubscribe) | ✅ Basic ping in `index.ts` | Missing subscribe/unsubscribe |
| **Auto-subscribe to user channels** | ❌ Not implemented | Presence requirement |
| **Battery-optimized heartbeat** | ❌ Constant 30s ping | **Critical** - Design requires adaptive: protocol ping (25s/15s kernel), app heartbeat ONLY during active call (30s active, 10s connecting), background=disabled (VoIP push) |
| **Connection state machine** | ❌ Not implemented | Required for CallKit |
| **Event recovery with sequence IDs** | ❌ Not implemented | Reliability requirement |
| **VoIP push (APNs) integration** | ❌ Not implemented | iOS call integration |
| **mediasoup SFU integration** | ❌ Not implemented | Media plane requirement |
| **Signaling plane separation** | ✅ WS for signaling | Architecture correct |

**Current WebSocket Files:**
- `src/websocket/index.ts` - Neon Functions WebSocket handler with basic chat/call signaling
- `src/websocket/server.ts` - **OLD** Firebase/Prisma implementation (legacy)
- `src/websocket/local-server.ts` - Local development WS with Better Auth token verification

**Critical Issues:**
1. Heartbeat runs constantly (30s interval) - **drains battery**, violates design
2. No connection state machine for calls
3. No event recovery (message ordering, deduplication)
4. No VoIP push for background incoming calls
4. No mediasoup integration for media plane
5. `server.ts` uses Firebase/Prisma - **legacy code should be removed**

---

### 5. Call/Video Signaling (DESIGN_DOCUMENT.md §7.3-7.5)

| Requirement | Current Status | Gap |
|-------------|----------------|-----|
| **Call state machine** (NEW → RINGING → CONNECTING → ACTIVE → ENDED) | ❌ Not implemented | **Critical** |
| **CallKit integration** (iOS) | ❌ Not implemented | Required for iOS |
| **VoIP push (APNs)** for background incoming | ❌ Not implemented | Required for battery |
| **mediasoup SFU** (router, transports, producers, consumers) | ❌ Not implemented | Media plane |
| **WebRTC signaling** (offer/answer/ICE) | ✅ Basic relay in WS | No SFU integration |
| **Call recording** | ❌ Not implemented | Future |
| **Call history/logs** | ⚠️ Schema has tables | No REST/WS endpoints |
| **Group calls** | ❌ Not implemented | Future |

**Current Call Signaling:** Only basic relay in WebSocket (`call_initiate`, `call_offer`, `call_answer`, `call_ice_candidate`, `call_hangup`, `call_reject`, `call_busy`, `call_ringing`). No state machine, no media handling, no CallKit/VoIP.

---

### 6. Search (DESIGN_DOCUMENT.md §8)

| Requirement | Current Status | Gap |
|-------------|----------------|-----|
| Hybrid search (BM25 + pgvector + graph) | ❌ Not implemented | **Critical** |
| RRF (Reciprocal Rank Fusion) merge | ❌ Not implemented | |
| `search_index` table with vectors | ❌ Not implemented | |
| Search API endpoints | ❌ Not implemented | |
| Typeahead/suggestions | ❌ Not implemented | |
| Trending/hashtag search | ❌ Not implemented | |

**Current:** Only basic user search by username/fullName in `user.routes.ts` (ILIKE query).

---

### 7. Media Pipeline (DESIGN_DOCUMENT.md §5)

| Requirement | Current Status | Gap |
|-------------|----------------|-----|
| TUS protocol for resumable uploads | ❌ Not implemented | **Critical** for large videos |
| Presigned URLs (Neon Object Storage) | ✅ Implemented | Good |
| Video transcoding pipeline | ❌ Not implemented | Required for reels/stories |
| Thumbnail generation | ⚠️ Placeholder only | Needs Sharp/FFmpeg |
| Image optimization (Sharp) | ❌ Not implemented | |
| CDN integration | ❌ Not mentioned | |

**Current:** Direct multipart upload with magic bytes validation. Presigned URLs work. No TUS, no transcoding, no thumbnails (placeholder URLs only).

---

### 8. Background Jobs (DESIGN_DOCUMENT.md §9)

| Requirement | Current Status | Gap |
|-------------|----------------|-----|
| Job queue system (Upstash QStash / BullMQ) | ❌ Empty directory | **Critical** |
| Feed refresh job (pg_cron) | ❌ Not implemented | |
| Notification delivery (APNs/FCM) | ❌ Not implemented | |
| Story expiration cleanup | ❌ Not implemented | |
| Call recording processing | ❌ Not implemented | |
| Media transcoding jobs | ❌ Not implemented | |
| Analytics aggregation | ❌ Not implemented | |

**Current:** `src/jobs/` directory is empty except for `node-cron.d.ts` type definition.

---

### 9. Observability (DESIGN_DOCUMENT.md §10)

| Requirement | Current Status | Gap |
|-------------|----------------|-----|
| OpenTelemetry tracing | ❌ Not implemented | **Critical** |
| Structured logging (JSON) | ⚠️ Console.log only | |
| Audit logs (partitioned table) | ❌ Not implemented | |
| Metrics (Prometheus) | ✅ `/metrics` endpoint in index.ts | Basic |
| Health checks | ✅ `/health`, `/ready` | Good |
| Distributed tracing | ❌ Not implemented | |
| Error tracking (Sentry) | ❌ Not implemented | |

**Current:** Basic health/ready/metrics endpoints. Console.log for audit. No OpenTelemetry, no structured logging.

---

### 10. Deployment & Infrastructure (DESIGN_DOCUMENT.md §11)

| Requirement | Current Status | Gap |
|-------------|----------------|-----|
| Neon project setup (Auth, Functions, Obj Storage, Realtime, AI Gateway) | ❌ Not verified | Need to check Neon console |
| GitHub Actions CI/CD | ❌ Not implemented | |
| Preview deployments (Neon branch per PR) | ❌ Not implemented | |
| Contract testing (Pact) | ❌ Not implemented | |
| Database branching workflow | ❌ Not implemented | |

---

## File-by-File Assessment

### Keep / Minor Updates Needed
| File | Status | Notes |
|------|--------|-------|
| `src/db/schema.ts` | ✅ Keep | Comprehensive, well-structured |
| `src/config/auth.ts` | ⚠️ Update | Add OAuth providers, verify config |
| `src/middleware/auth.ts` | ✅ Keep | Works with Better Auth |
| `src/routes/post.routes.ts` | ✅ Keep | Solid implementation |
| `src/routes/user.routes.ts` | ✅ Keep | Comprehensive |
| `src/routes/story.routes.ts` | ✅ Keep | Good |
| `src/routes/reel.routes.ts` | ✅ Keep | Good |
| `src/routes/conversation.routes.ts` | ✅ Keep | Good |
| `src/routes/notification.routes.ts` | ✅ Keep | Basic but functional |
| `src/routes/upload.routes.ts` | ✅ Keep | Good presign + magic bytes |
| `src/routes/report.routes.ts` | ✅ Keep | Comprehensive |
| `src/routes/auth.routes.ts` | ⚠️ Update | Add policy engine integration |
| `src/websocket/index.ts` | ⚠️ Major rewrite | Add ConnectionManager, battery heartbeat, event recovery |
| `src/index.ts` | ⚠️ Update | Add OpenTelemetry, rate limiting middleware, RFC 7807 errors |

### Remove (Legacy)
| File | Reason |
|------|--------|
| `src/websocket/server.ts` | Old Firebase/Prisma implementation |
| `src/websocket/local-server.ts` | Superseded by `index.ts` for Neon Functions |

### Create (Missing from Design)
| File/Component | Priority | Design Section |
|----------------|----------|----------------|
| RLS policies (SQL migrations) | **P0** | §3, §5 |
| Policy engine (OPA-style) | **P0** | §5 |
| Materialized view `feed_items` + pg_cron | **P0** | §3.2 |
| `search_index` table + hybrid search | **P0** | §8 |
| `audit_logs` partitioned table | **P0** | §10 |
| `rate_limit_buckets` table + Redis middleware | **P0** | §5.2 |
| ConnectionManager class | **P0** | §7.1 |
| Battery-optimized heartbeat | **P0** | §7.2, PDF |
| Connection state machine | **P0** | §7.3, PDF |
| Event recovery (sequence IDs) | **P0** | §7.1, PDF |
| VoIP push (APNs) service | **P0** | §7.4, PDF |
| mediasoup SFU integration | **P0** | §7.5 |
| Call REST endpoints | **P0** | §7.3 |
| Job queue system | **P1** | §9 |
| OpenTelemetry instrumentation | **P1** | §10 |
| TUS upload handler | **P1** | §5.3 |
| Video transcoding pipeline | **P1** | §5.4 |
| Admin/moderation endpoints | **P1** | §6 |
| CI/CD GitHub Actions | **P1** | §11 |
| Contract tests (Pact) | **P1** | §11 |

---

## Migration Strategy

### Phase 1: Foundation (Security & Database) - **START HERE**
1. **Create Prisma schema** from DESIGN_DOCUMENT.md §3 (source of truth for migrations)
2. **Run migration** on preview branch (Neon branching)
3. **Add RLS policies** for all tables (core security guarantee)
4. **Create materialized view** `feed_items` + pg_cron refresh
5. **Create `search_index` table** with pgvector + BM25 columns
6. **Create `audit_logs` partitioned table**
7. **Create `rate_limit_buckets` table**
8. **Generate Drizzle schema** from Prisma (or keep Drizzle as source, sync Prisma)

### Phase 2: Auth & Policy Engine
1. Implement **OPA-style policy engine** (`src/services/policy.ts`)
2. Integrate policy checks in middleware
3. Sync policies with RLS
4. Add **Redis/Upstash tiered rate limiting**
5. Add **OpenTelemetry** + Request ID tracing
6. Add **RFC 7807 Problem Details** error handling
7. Add **Idempotency key middleware**

### Phase 3: WebSocket & Real-time Overhaul
1. **Rewrite `src/websocket/index.ts`** with:
   - ConnectionManager (connections, subscriptions, presence)
   - Channel authorization (`canSubscribe`)
   - **Battery-optimized heartbeat** (adaptive: protocol ping kernel-managed, app heartbeat ONLY during active call)
   - **Connection state machine** (NEW → RINGING → CONNECTING → ACTIVE → ENDED)
   - **Event recovery** with sequence IDs
   - Auto-subscribe to user channels
2. **Remove legacy** `server.ts` and `local-server.ts`
3. Add **VoIP push (APNs) service** for iOS background calls

### Phase 4: Call/Video with mediasoup
1. Integrate **mediasoup SFU** (router, transports, producers, consumers)
2. Implement **call REST endpoints** (create, join, end, history)
3. Wire WebSocket signaling to mediasoup
4. Add **CallKit integration** (iOS native - FE task, but BE must support)

### Phase 5: Search & Feed Performance
1. Implement **hybrid search** (BM25 + pgvector + graph RRF)
2. Add search API endpoints
3. Verify materialized view refresh latency

### Phase 6: Media Pipeline
1. Add **TUS protocol** handler for resumable uploads
2. Add **video transcoding pipeline** (FFmpeg via job queue)
3. Add **thumbnail generation** (Sharp)
4. Add **image optimization**

### Phase 7: Background Jobs & Notifications
1. Set up **job queue** (Upstash QStash → Neon Functions)
2. Implement jobs: feed refresh, story expiry, notifications, media transcoding
3. Add **APNs/FCM push notification service**

### Phase 8: Observability & Hardening
1. Complete **OpenTelemetry** instrumentation
2. Structured **JSON logging**
3. **Audit log** writers for all mutating operations
4. **Load testing**, **chaos engineering**, **security audit**

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| RLS policies break existing queries | High | High | Test on preview branch first; policy engine mirrors RLS |
| Battery-optimized heartbeat complex | High | Medium | Follow PDF spec exactly; test on device |
| mediasoup integration complexity | High | High | Start with 1:1 calls; add group later |
| Migration data loss | Critical | Low | Neon branching + instant restore; test migration on copy |
| iOS CallKit/VoIP integration | High | High | Coordinate with FE team; BE provides push tokens + call state |

---

## Recommended Next Steps

**Immediate (This Week):**
1. ✅ Audit complete - this report
2. Create **Prisma schema** from DESIGN_DOCUMENT.md §3
3. Set up **Neon preview branch** and run migration
4. Implement **RLS policies** for core tables (users, posts, conversations, messages)
5. Remove legacy WebSocket files (`server.ts`, `local-server.ts`)

**Week 2-3:**
6. Implement **policy engine** + **Redis rate limiting**
7. Build **ConnectionManager** + **battery-optimized heartbeat** in `index.ts`
8. Add **event recovery** with sequence IDs
9. Implement **VoIP push service** (APNs)

**Week 4-6:**
10. Integrate **mediasoup SFU**
11. Build **call state machine** + REST endpoints
12. Implement **hybrid search**
13. Add **TUS upload** + **transcoding pipeline**

---

## Conclusion

The BE repo has **~60% of REST API features implemented** with good code quality. However, the **security foundation (RLS, policy engine) and real-time infrastructure (WebSocket, calls, battery optimization) are ~0-20% complete** against the DESIGN_DOCUMENT.md requirements.

**Recommendation:** Start with **Phase 1 (Foundation)** using **sub-agents** for parallel tracks:
- Agent 1: Prisma schema + RLS + migrations + materialized views
- Agent 2: CI/CD + Preview deployments + Contract testing
- Agent 3: WebSocket foundation (ConnectionManager, battery heartbeat)
- Main: Policy engine + Redis rate limiting + OpenTelemetry

This aligns with the **EFFORT_ESTIMATE_REPORT.md** recommendation for Phase 1.