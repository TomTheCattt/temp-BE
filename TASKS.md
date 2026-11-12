# TASKS - Instagram Clone Backend Implementation

**Source:** DESIGN_DOCUMENT.md (Production-Grade Backend Design)  
**Last Updated:** 2026-11-11  
**Total Tasks:** 180+ tasks across 12 phases

---

## LEGEND

| Status | Meaning |
|--------|---------|
| `☐` | Not started |
| `◐` | In progress |
| `✅` | Done |
| `⏸️` | Blocked |
| `🔄` | Needs review |

**Priority:** P0 = Critical path, P1 = High, P2 = Medium, P3 = Nice to have

---

## PHASE 1: FOUNDATION (Week 1-2)

### 1.1 Neon Infrastructure Setup
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-001 | Create Neon project with Auth, Functions, Object Storage, Realtime enabled | P0 | ☐ | Backend Dev | - |
| BE-002 | Configure Neon branches: main, staging, dev/<user> | P0 | ☐ | Backend Dev | BE-001 |
| BE-003 | Set up Better Auth (Managed) with email/password, OAuth (Google, Apple) | P0 | ☐ | Backend Dev | BE-001 |
| BE-004 | Configure trusted domains for OAuth callbacks | P0 | ☐ | Backend Dev | BE-003 |
| BE-005 | Set up Neon Object Storage buckets: uploads, media, thumbnails, recordings | P1 | ☐ | Backend Dev | BE-001 |
| BE-006 | Enable Neon Realtime for live queries | P1 | ☐ | Backend Dev | BE-001 |
| BE-007 | Configure AI Gateway for embeddings (search) | P2 | ☐ | Backend Dev | BE-001 |

### 1.2 Database Schema & Migrations
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-008 | Create Prisma schema from DESIGN_DOCUMENT.md §3 (all tables) | P0 | ☐ | Backend Dev | BE-001 |
| BE-009 | Add RLS policies for all tables (users, posts, stories, reels, messages, etc.) | P0 | ☐ | Backend Dev | BE-008 |
| BE-010 | Create materialized view `feed_items` with pg_cron refresh (5 min) | P1 | ☐ | Backend Dev | BE-008 |
| BE-011 | Create search_index table with vector + BM25 indexes | P1 | ☐ | Backend Dev | BE-008 |
| BE-012 | Create audit_logs partitioned table (monthly) | P1 | ☐ | Backend Dev | BE-008 |
| BE-013 | Create rate_limit_buckets table | P1 | ☐ | Backend Dev | BE-008 |
| BE-014 | Add call/livestream tables (calls, call_participants, call_signaling_logs, live_streams, live_stream_viewers, live_stream_comments, live_stream_gifts) | P0 | ☐ | Backend Dev | BE-008 |
| BE-015 | Run initial migration on preview branch, verify | P0 | ☐ | Backend Dev | BE-008, BE-014 |
| BE-016 | Generate Drizzle schema from Prisma | P0 | ☐ | Backend Dev | BE-008 |

### 1.3 Hono API Skeleton & Middleware
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-017 | Create Hono app with middleware: auth, rate-limit, validation, logging, security headers | P0 | ☐ | Backend Dev | BE-016 |
| BE-018 | Implement Better Auth middleware (session verification, user context) | P0 | ☐ | Backend Dev | BE-003 |
| BE-019 | Implement authorization policy engine (OPA-style) with RLS sync | P0 | ☐ | Backend Dev | BE-018 |
| BE-020 | Implement tiered rate limiting (Redis/Upstash) with headers | P0 | ☐ | Backend Dev | BE-017 |
| BE-021 | Implement request ID tracing + OpenTelemetry integration | P1 | ☐ | Backend Dev | BE-017 |
| BE-022 | Implement Zod validation middleware for all endpoints | P0 | ☐ | Backend Dev | BE-017 |
| BE-023 | Implement idempotency key middleware for mutating endpoints | P1 | ☐ | Backend Dev | BE-017 |
| BE-024 | Create error handling with RFC 7807 Problem Details | P0 | ☐ | Backend Dev | BE-017 |

### 1.4 WebSocket Server Foundation
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-025 | Implement WebSocket server on Neon Functions (/ws/v1) | P0 | ☐ | Backend Dev | BE-017 |
| BE-026 | Implement ConnectionManager (connections, subscriptions, presence) | P0 | ☐ | Backend Dev | BE-025 |
| BE-027 | Implement channel authorization (canSubscribe) | P0 | ☐ | Backend Dev | BE-026 |
| BE-028 | Implement message handlers: ping, subscribe, unsubscribe | P0 | ☐ | Backend Dev | BE-026 |
| BE-029 | Implement auto-subscribe to user channels on connect | P0 | ☐ | Backend Dev | BE-026 |

### 1.5 CI/CD Pipeline
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-030 | Create GitHub Actions CI: lint, typecheck, test, contract test | P0 | ☐ | Backend Dev | - |
| BE-031 | Create preview deployment workflow (Neon branch per PR) | P0 | ☐ | Backend Dev | BE-002 |
| BE-032 | Create staging deployment workflow | P1 | ☐ | Backend Dev | BE-030 |
| BE-033 | Create production deployment workflow with verification | P0 | ☐ | Backend Dev | BE-030 |
| BE-034 | Add contract testing with Pact | P1 | ☐ | Backend Dev | BE-030 |

---

## PHASE 2: AUTHENTICATION & USER MANAGEMENT (Week 2-3)

### 2.1 Auth Endpoints
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-035 | POST /v1/auth/register (email/phone + password) | P0 | ☐ | Backend Dev | BE-018 |
| BE-036 | POST /v1/auth/login (credentials → access + refresh token) | P0 | ☐ | Backend Dev | BE-018 |
| BE-037 | POST /v1/auth/refresh (token rotation with reuse detection) | P0 | ☐ | Backend Dev | BE-036 |
| BE-038 | POST /v1/auth/logout (revoke refresh token) | P0 | ☐ | Backend Dev | BE-036 |
| BE-039 | POST /v1/auth/forgot-password + reset flow | P1 | ☐ | Backend Dev | BE-036 |
| BE-040 | POST /v1/auth/verify-email (code from shared SMTP) | P1 | ☐ | Backend Dev | BE-003 |
| BE-041 | POST /v1/auth/verify-phone (SMS OTP) | P2 | ☐ | Backend Dev | BE-003 |
| BE-042 | GET/PATCH/DELETE /v1/auth/me (profile CRUD) | P0 | ☐ | Backend Dev | BE-018 |

### 2.2 OAuth & Account Linking
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-043 | GET /v1/auth/oauth/:provider (Google, Apple, Facebook) | P1 | ☐ | Backend Dev | BE-003 |
| BE-044 | GET /v1/auth/oauth/:provider/callback | P1 | ☐ | Backend Dev | BE-043 |
| BE-045 | POST/DELETE /v1/auth/link-account, /unlink-account | P2 | ☐ | Backend Dev | BE-043 |

### 2.3 User Profile & Social Graph
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-046 | GET /v1/users/:username (public profile with privacy checks) | P0 | ☐ | Backend Dev | BE-019 |
| BE-047 | GET /v1/users/:username/posts, /reels, /tagged, /saved, /highlights | P1 | ☐ | Backend Dev | BE-046 |
| BE-048 | GET /v1/users/:username/followers, /following (paginated) | P1 | ☐ | Backend Dev | BE-046 |
| BE-049 | POST/DELETE /v1/users/:username/follow (with private account flow) | P0 | ☐ | Backend Dev | BE-046 |
| BE-050 | POST /v1/users/:username/accept (follow request) | P0 | ☐ | Backend Dev | BE-049 |
| BE-051 | POST/DELETE /v1/users/:username/block | P0 | ☐ | Backend Dev | BE-046 |
| BE-052 | POST/DELETE /v1/users/:username/restrict | P1 | ☐ | Backend Dev | BE-046 |
| BE-053 | POST/DELETE /v1/users/:username/close-friends | P1 | ☐ | Backend Dev | BE-046 |

### 2.4 Settings & Security
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-054 | GET/PATCH /v1/settings (account, privacy, notifications, security) | P1 | ☐ | Backend Dev | BE-018 |
| BE-055 | GET /v1/settings/blocked, /restricted, /close-friends, /login-activity | P1 | ☐ | Backend Dev | BE-054 |
| BE-056 | DELETE /v1/settings/sessions/:id (revoke session) | P1 | ☐ | Backend Dev | BE-054 |
| BE-057 | Implement 2FA (TOTP) setup/verify/disable | P2 | ☐ | Backend Dev | BE-003 |

---

## PHASE 3: POSTS, FEED & EXPLORE (Week 3-4)

### 3.1 Posts CRUD
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-058 | POST /v1/posts (create with media IDs, caption, location, audience) | P0 | ☐ | Backend Dev | BE-017 |
| BE-059 | GET /v1/posts/:id (single post with media, comments preview) | P0 | ☐ | Backend Dev | BE-058 |
| BE-060 | PATCH /v1/posts/:id (edit caption, location, audience) | P1 | ☐ | Backend Dev | BE-058 |
| BE-061 | DELETE /v1/posts/:id (soft delete) | P1 | ☐ | Backend Dev | BE-058 |
| BE-062 | POST/DELETE /v1/posts/:id/archive | P2 | ☐ | Backend Dev | BE-058 |
| BE-063 | POST/DELETE /v1/posts/:id/like | P0 | ☐ | Backend Dev | BE-058 |
| BE-064 | POST/DELETE /v1/posts/:id/save (with collections) | P1 | ☐ | Backend Dev | BE-058 |
| BE-065 | GET /v1/posts/:id/likes (paginated likers list) | P2 | ☐ | Backend Dev | BE-058 |
| BE-066 | POST /v1/posts/:id/report | P1 | ☐ | Backend Dev | BE-058 |

### 3.2 Feed Algorithm
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-067 | Implement feed candidate selection (followed + suggested, last 7 days) | P0 | ☐ | Backend Dev | BE-010 |
| BE-068 | Implement ranking signals: interest, recency, relationship, quality, diversity | P0 | ☐ | Backend Dev | BE-067 |
| BE-069 | Implement score calculation with weights | P0 | ☐ | Backend Dev | BE-068 |
| BE-070 | Implement diversity filtering (author, content type) | P1 | ☐ | Backend Dev | BE-069 |
| BE-071 | GET /v1/posts/feed (cursor pagination, 30s cache) | P0 | ☐ | Backend Dev | BE-070 |
| BE-072 | Implement feed invalidation on follow/unfollow, new post | P1 | ☐ | Backend Dev | BE-071 |

### 3.3 Explore Feed
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-073 | Implement collaborative filtering (similar users' likes) | P1 | ☐ | Backend Dev | BE-067 |
| BE-074 | Implement content-based signals (hashtags, locations, audio) | P1 | ☐ | Backend Dev | BE-067 |
| BE-075 | Implement trending/viral detection | P2 | ☐ | Backend Dev | BE-073 |
| BE-076 | GET /v1/posts/explore (personalized explore) | P1 | ☐ | Backend Dev | BE-075 |

### 3.4 Comments & Threading
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-077 | GET /v1/posts/:id/comments (threaded, paginated, expandDepth) | P0 | ☐ | Backend Dev | BE-058 |
| BE-078 | POST /v1/posts/:id/comments (with parentId for replies) | P0 | ☐ | Backend Dev | BE-058 |
| BE-079 | PATCH/DELETE /v1/comments/:id (edit/delete with ownership check) | P1 | ☐ | Backend Dev | BE-078 |
| BE-080 | POST/DELETE /v1/comments/:id/like | P1 | ☐ | Backend Dev | BE-078 |
| BE-081 | Implement comment thread expansion (load more replies) | P1 | ☐ | Backend Dev | BE-077 |
| BE-082 | POST /v1/comments/:id/report | P1 | ☐ | Backend Dev | BE-078 |
| BE-083 | Implement comment moderation (hide, hidden_reason, hidden_by) | P2 | ☐ | Backend Dev | BE-082 |

---

## PHASE 4: STORIES & REELS (Week 5-6)

### 4.1 Stories
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-084 | GET /v1/stories/feed (stories tray from following + self) | P0 | ☐ | Backend Dev | BE-025 |
| BE-085 | GET /v1/stories/:userId/items (active stories with view status) | P0 | ☐ | Backend Dev | BE-084 |
| BE-086 | POST /v1/stories (create with TUS upload, stickers) | P0 | ☐ | Backend Dev | BE-100 |
| BE-087 | POST /v1/stories/:storyId/view (mark viewed, create story_views) | P0 | ☐ | Backend Dev | BE-086 |
| BE-088 | POST /v1/stories/:storyId/reply (create DM from story reply) | P1 | ☐ | Backend Dev | BE-086 |
| BE-089 | DELETE /v1/stories/:storyId (author only) | P1 | ☐ | Backend Dev | BE-086 |
| BE-090 | GET /v1/stories/:storyId/views (viewers list, author only) | P2 | ☐ | Backend Dev | BE-086 |
| BE-091 | Implement story expiry cleanup (cron job, 24h TTL) | P1 | ☐ | Backend Dev | BE-086 |
| BE-092 | Story highlights: CRUD endpoints | P2 | ☐ | Backend Dev | BE-086 |

### 4.2 Reels
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-093 | GET /v1/reels/feed (infinite scroll, personalized) | P0 | ☐ | Backend Dev | BE-071 |
| BE-094 | GET /v1/reels/explore (trending + personalized) | P1 | ☐ | Backend Dev | BE-075 |
| BE-095 | GET /v1/reels/:id (single reel with audio info) | P0 | ☐ | Backend Dev | BE-093 |
| BE-096 | POST /v1/reels (create with TUS, audio selection) | P0 | ☐ | Backend Dev | BE-100 |
| BE-097 | PATCH/DELETE /v1/reels/:id | P1 | ☐ | Backend Dev | BE-096 |
| BE-098 | POST/DELETE /v1/reels/:id/like, /save, /share | P1 | ☐ | Backend Dev | BE-096 |
| BE-099 | POST /v1/reels/:id/remix (create derivative reel) | P2 | ☐ | Backend Dev | BE-096 |
| BE-100 | Audio tracks: CRUD, waveform generation, usage counting | P1 | ☐ | Backend Dev | BE-100 |

---

## PHASE 5: MEDIA UPLOAD & PROCESSING (Week 5-6)

| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-101 | Implement TUS endpoint (/v1/upload/tus/*) with S3 datastore | P0 | ☐ | Backend Dev | BE-005 |
| BE-102 | Implement multipart fallback (/v1/upload/multipart, <50MB) | P1 | ☐ | Backend Dev | BE-005 |
| BE-103 | Implement presigned URL endpoint (/v1/upload/presigned) | P1 | ☐ | Backend Dev | BE-005 |
| BE-104 | Create media processing worker (BullMQ/Neon Functions) | P0 | ☐ | Backend Dev | BE-101 |
| BE-105 | Implement virus scan (ClamAV) | P1 | ☐ | Backend Dev | BE-104 |
| BE-106 | Implement video transcoding (FFmpeg: H.264/HEVC, multiple bitrates) | P0 | ☐ | Backend Dev | BE-104 |
| BE-107 | Implement thumbnail generation (multiple sizes) | P1 | ☐ | Backend Dev | BE-104 |
| BE-108 | Implement metadata extraction (EXIF, duration, waveform) | P1 | ☐ | Backend Dev | BE-104 |
| BE-109 | Implement perceptual hashing (pHash for duplicate detection) | P2 | ☐ | Backend Dev | BE-104 |
| BE-110 | Implement NSFW detection (TensorFlow Lite) | P1 | ☐ | Backend Dev | BE-104 |
| BE-111 | Implement processing status WebSocket updates | P1 | ☐ | Backend Dev | BE-025, BE-104 |
| BE-112 | CDN integration for media delivery (Cloudflare/CloudFront) | P1 | ☐ | Backend Dev | BE-107 |

---

## PHASE 6: DIRECT MESSAGES (Week 7-8)

### 6.1 Conversations
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-113 | GET /v1/conversations (list with unread count, last message preview) | P0 | ☐ | Backend Dev | BE-025 |
| BE-114 | POST /v1/conversations (create 1:1 or group) | P0 | ☐ | Backend Dev | BE-113 |
| BE-115 | GET /v1/conversations/:id (details, members, settings) | P0 | ☐ | Backend Dev | BE-113 |
| BE-116 | POST /v1/conversations/:id/mute, /unmute | P1 | ☐ | Backend Dev | BE-115 |
| BE-117 | POST /v1/conversations/:id/leave | P1 | ☐ | Backend Dev | BE-115 |
| BE-118 | POST /v1/conversations/:id/block (block user in conversation) | P1 | ☐ | Backend Dev | BE-115 |
| BE-119 | POST /v1/conversations/:id/report | P1 | ☐ | Backend Dev | BE-115 |
| BE-120 | Group management: add/remove members, transfer ownership, rename | P1 | ☐ | Backend Dev | BE-115 |

### 6.2 Messages
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-121 | GET /v1/conversations/:id/messages (cursor paginated, with sync) | P0 | ☐ | Backend Dev | BE-113 |
| BE-122 | POST /v1/conversations/:id/messages (send: text, media, shares, replies) | P0 | ☐ | Backend Dev | BE-113 |
| BE-123 | Implement message types: text, image, video, audio, file, shares, location, voice, reply, system | P0 | ☐ | Backend Dev | BE-122 |
| BE-124 | PATCH /v1/messages/:id (edit within 10 min) | P1 | ☐ | Backend Dev | BE-122 |
| BE-125 | DELETE /v1/messages/:id (unsend: for everyone / just me) | P1 | ☐ | Backend Dev | BE-122 |
| BE-126 | POST/DELETE /v1/messages/:id/reaction (emoji reactions) | P1 | ☐ | Backend Dev | BE-122 |
| BE-127 | Implement vanish mode (ephemeral messages, 10 min expiry) | P2 | ☐ | Backend Dev | BE-122 |
| BE-128 | Implement read receipts + delivered status | P0 | ☐ | Backend Dev | BE-122 |

### 6.3 Real-time Messaging (WebSocket)
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-129 | WebSocket: message.send, message.read, message.react handlers | P0 | ☐ | Backend Dev | BE-028 |
| BE-130 | WebSocket: typing.start, typing.stop (per conversation) | P0 | ☐ | Backend Dev | BE-028 |
| BE-131 | WebSocket: presence.update (online/away/busy) | P1 | ☐ | Backend Dev | BE-028 |
| BE-132 | WebSocket: sync.request (reconnection catch-up with lastMessageId) | P0 | ☐ | Backend Dev | BE-028 |
| BE-133 | Broadcast message.new, message.updated, message.deleted to conversation channel | P0 | ☐ | Backend Dev | BE-129 |
| BE-134 | Broadcast typing, presence to conversation/user channels | P0 | ☐ | Backend Dev | BE-130, BE-131 |
| BE-135 | Push notifications for offline users (APNs/FCM) | P0 | ☐ | Backend Dev | BE-056 |

### 6.4 E2EE Preparation (Future)
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-136 | Add encryption_type field to conversations (none/e2ee/mls) | P3 | ☐ | Backend Dev | BE-113 |
| BE-137 | Design MLS key schedule integration points | P3 | ☐ | Backend Dev | BE-136 |
| BE-138 | Add message encryption fields (ciphertext, nonce, keyId) | P3 | ☐ | Backend Dev | BE-136 |

---

## PHASE 7: CALL / VIDEO CALL SIGNALING (Week 7-8) ← NEW FROM PDF

### 7.1 Database & Schema
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-139 | Create calls, call_participants, call_signaling_logs tables | P0 | ☐ | Backend Dev | BE-014 |
| BE-140 | Create live_streams, live_stream_viewers, live_stream_comments, live_stream_gifts tables | P0 | ☐ | Backend Dev | BE-014 |
| BE-141 | Add indexes for call/livestream queries | P0 | ☐ | Backend Dev | BE-139, BE-140 |

### 7.2 WebSocket Call Signaling Protocol
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-142 | Implement WS /ws/v1/calls endpoint with auth | P0 | ☐ | Backend Dev | BE-025 |
| BE-143 | Implement Connection State Machine (idle→connecting→connected→authenticated→joined→recovering→reconnecting→closing→closed) | P0 | ☐ | Backend Dev | BE-142 |
| BE-144 | Implement generation-based deduplication (increment on reconnect) | P0 | ☐ | Backend Dev | BE-143 |
| BE-145 | Implement protocol ping/pong (20s interval, 10s timeout) | P0 | ☐ | Backend Dev | BE-142 |
| BE-146 | Implement application heartbeat (ping/ack with session_id, timestamp, 25s/15s) | P0 | ☐ | Backend Dev | BE-145 |
| BE-147 | Implement exponential backoff + jitter reconnect (max 30s, 10 attempts) | P0 | ☐ | Backend Dev | BE-146 |
| BE-148 | Implement reconnect policy (non-retryable: TOKEN_EXPIRED, KICKED, PERMISSION_DENIED, USER_LEFT, APP_BACKGROUND) | P0 | ☐ | Backend Dev | BE-147 |
| BE-149 | Implement event recovery (sequence/event_id, cursor, server replay/snapshot) | P0 | ☐ | Backend Dev | BE-148 |

### 7.3 Call Signaling Messages
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-150 | Implement call.auth, call.join, call.leave, call.reconnect handlers | P0 | ☐ | Backend Dev | BE-142 |
| BE-151 | Implement WebRTC signaling: offer, answer, ice_candidate, renegotiate | P0 | ☐ | Backend Dev | BE-150 |
| BE-152 | Implement media control: mute, switch_camera, enable_screen_share, quality (simulcast layer) | P0 | ☐ | Backend Dev | BE-151 |
| BE-153 | Implement group call management: invite, kick, transfer_host | P1 | ☐ | Backend Dev | BE-151 |
| BE-154 | Implement server→client events: joined, participant_muted, ringing, accepted, declined, active, ended, failed, connection_quality | P0 | ☐ | Backend Dev | BE-150 |

### 7.4 Call REST API
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-155 | POST /v1/calls (initiate: returns callId, roomId, iceServers) | P0 | ☐ | Backend Dev | BE-139 |
| BE-156 | GET /v1/calls/:id, POST /join, /leave, /end | P0 | ☐ | Backend Dev | BE-155 |
| BE-157 | POST /v1/calls/:id/invite, /kick, /transfer-host | P1 | ☐ | Backend Dev | BE-155 |
| BE-158 | GET /v1/calls/:id/participants, PATCH /participants/:userId | P1 | ☐ | Backend Dev | BE-155 |
| BE-159 | GET /v1/calls/history, GET /v1/calls/:id/recording | P2 | ☐ | Backend Dev | BE-155 |

### 7.5 Battery-Optimized Heartbeat & Reconnect (NEW - Replaces old 7.5/7.6)
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-160 | Implement CallHeartbeatManager with state-aware intervals (activeCall: 30s, connecting: 10s, idle: DISABLED, background: DISABLED) | P0 | ☐ | Backend Dev | BE-145 |
| BE-161 | Implement protocol ping/pong only when idle/background (kernel-managed, 25s interval, 15s timeout) | P0 | ☐ | Backend Dev | BE-145 |
| BE-162 | Implement application heartbeat ONLY during active call (RTT monitoring, quality metrics) | P0 | ☐ | Backend Dev | BE-160 |
| BE-163 | Implement network-aware intervals (cellular: 25s during call, WiFi: 30s) | P1 | ☐ | Backend Dev | BE-160 |
| BE-164 | Implement context-aware reconnect policy (aggressive during active call, conservative when idle) | P0 | ☐ | Backend Dev | BE-148 |
| BE-165 | Implement background mode: zero heartbeat, rely on VoIP push for incoming calls | P0 | ☐ | Backend Dev | BE-178 |
| BE-166 | Implement heartbeat metrics: RTT distribution, reconnect frequency, battery impact tracking | P1 | ☐ | Backend Dev | BE-160 |

### 7.7 Media Server Integration (SFU) - Call/Video Call Focus
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-174 | Design MediaServerAdapter interface (createRoom, deleteRoom, transports, produce, consume, simulcast) | P0 | ☐ | Backend Dev | BE-139 |
| BE-175 | Implement mediasoup/LiveKit/Agora integration for 1:1 and group calls | P0 | ☐ | Backend Dev | BE-174 |
| BE-176 | Implement ICE server management (TURN/STUN) + /v1/media/ice-servers endpoint | P0 | ☐ | Backend Dev | BE-174 |
| BE-177 | Implement call recording (start/stop, storage, playback) | P2 | ☐ | Backend Dev | BE-175 |

### 7.8 VoIP Push Notifications (CallKit)
| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-178 | Implement device_tokens table with voip_token, sandbox, topics | P0 | ☐ | Backend Dev | BE-014 |
| BE-179 | Implement APNs VoIP push payload with CallKit fields (uuid, handle, hasVideo, iceServers) | P0 | ☐ | Backend Dev | BE-178 |
| BE-180 | Implement sendIncomingCallPush on call initiation | P0 | ☐ | Backend Dev | BE-155, BE-179 |

---

## PHASE 8: NOTIFICATIONS (Week 6-7)

| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-181 | GET /v1/notifications (grouped feed with group_key) | P0 | ☐ | Backend Dev | BE-025 |
| BE-182 | PATCH /v1/notifications/:id/read, POST /read-all, DELETE /:id | P0 | ☐ | Backend Dev | BE-181 |
| BE-183 | GET /v1/notifications/unread-count (badge) | P1 | ☐ | Backend Dev | BE-181 |
| BE-184 | Implement notification triggers: like, comment, follow, mention, tag, story_reply, dm, live | P0 | ☐ | Backend Dev | BE-181 |
| BE-185 | Implement notification grouping/aggregation (group_key, group_count) | P1 | ☐ | Backend Dev | BE-184 |
| BE-186 | WebSocket: notification.new, notification.read broadcast | P0 | ☐ | Backend Dev | BE-181 |
| BE-187 | Push notifications for all notification types (APNs/FCM) | P0 | ☐ | Backend Dev | BE-056 |

---

## PHASE 9: SEARCH & DISCOVERY (Week 7-8)

| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-188 | Implement search_index population (triggers from posts, reels, users, hashtags, locations, audio) | P0 | ☐ | Backend Dev | BE-011 |
| BE-189 | Implement vector embeddings generation (text-embedding-3-small via AI Gateway) | P1 | ☐ | Backend Dev | BE-007 |
| BE-190 | Implement hybrid search: BM25 + vector + graph (RRF merge) | P0 | ☐ | Backend Dev | BE-188, BE-189 |
| BE-191 | GET /v1/search (unified: users, posts, reels, audio, hashtags, locations) | P0 | ☐ | Backend Dev | BE-190 |
| BE-192 | GET /v1/search/suggestions (typeahead) | P1 | ☐ | Backend Dev | BE-191 |
| BE-193 | GET/DELETE /v1/search/recent (history) | P2 | ☐ | Backend Dev | BE-191 |
| BE-194 | GET /v1/hashtags/:tag (hashtag page with ranked posts/reels) | P1 | ☐ | Backend Dev | BE-188 |
| BE-195 | GET /v1/locations/:id (location page) | P2 | ☐ | Backend Dev | BE-188 |

---

## PHASE 10: ADMIN & MODERATION (Week 9-10)

| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-196 | GET /v1/admin/reports (paginated, filterable) | P1 | ☐ | Backend Dev | BE-082 |
| BE-197 | PATCH /v1/admin/reports/:id (resolve: content_removed, account_warned, suspended, no_violation) | P1 | ☐ | Backend Dev | BE-196 |
| BE-198 | POST /v1/admin/users/:id/action (warn, suspend, ban, shadowban, feature_restrict, restore) | P1 | ☐ | Backend Dev | BE-196 |
| BE-199 | GET /v1/admin/analytics (platform metrics: DAU, posts, messages, calls, revenue) | P2 | ☐ | Backend Dev | BE-196 |
| BE-200 | Implement automated moderation: NSFW detection → hide, spam → shadowban | P2 | ☐ | Backend Dev | BE-110 |
| BE-201 | Implement audit logging for all admin actions | P1 | ☐ | Backend Dev | BE-196 |

---

## PHASE 11: OBSERVABILITY & OPERATIONS (Week 10-11)

| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-202 | Structured logging with Pino + OpenTelemetry (request, audit, error) | P0 | ☐ | Backend Dev | BE-021 |
| BE-203 | Prometheus metrics: http_requests, db_query, ws_connections, media_upload, business | P0 | ☐ | Backend Dev | BE-202 |
| BE-204 | Grafana dashboards: API latency, error rate, DB pool, WS connections, media processing | P1 | ☐ | Backend Dev | BE-203 |
| BE-205 | Alert rules: HighErrorRate, HighLatency, DBExhausted, WSDrop | P0 | ☐ | Backend Dev | BE-203 |
| BE-206 | Distributed tracing (Jaeger/Tempo) with correlation_id | P1 | ☐ | Backend Dev | BE-202 |
| BE-207 | Log aggregation (Neon Logs/Loki) with retention | P1 | ☐ | Backend Dev | BE-202 |

---

## PHASE 12: PRODUCTION HARDENING (Week 11-12)

| ID | Task | Priority | Status | Assignee | Dependencies |
|----|------|----------|--------|----------|--------------|
| BE-208 | Load testing (k6): 10k concurrent users, feed p95<150ms, API p95<200ms | P0 | ☐ | Backend Dev | All |
| BE-209 | Chaos engineering: Neon branch failover, DB connection pool exhaustion | P1 | ☐ | Backend Dev | BE-208 |
| BE-210 | Security audit: penetration testing, dependency scan (npm audit), secrets scan | P0 | ☐ | Backend Dev | BE-208 |
| BE-211 | OpenAPI 3.1 spec generation + SDK generation (TypeScript, Swift) | P1 | ☐ | Backend Dev | All |
| BE-212 | Runbook: incident response, rollback procedures, on-call rotation | P1 | ☐ | Backend Dev | BE-205 |
| BE-213 | Launch checklist: monitoring, alerting, runbooks, capacity planning | P0 | ☐ | Backend Dev | BE-212 |

---

## SUMMARY

| Phase | Tasks | P0 | P1 | P2 | P3 |
|-------|-------|----|----|----|----|
| 1: Foundation | 34 | 15 | 12 | 7 | 0 |
| 2: Auth & Users | 23 | 12 | 8 | 3 | 0 |
| 3: Posts & Feed | 26 | 11 | 10 | 5 | 0 |
| 4: Stories & Reels | 17 | 8 | 7 | 2 | 0 |
| 5: Media Upload | 12 | 5 | 6 | 1 | 0 |
| 6: Direct Messages | 26 | 13 | 10 | 3 | 0 |
| 7: Call/Video Signaling | 35 | 30 | 3 | 2 | 0 |
| 8: Notifications | 7 | 4 | 3 | 0 | 0 |
| 9: Search | 8 | 3 | 4 | 1 | 0 |
| 10: Admin | 6 | 0 | 4 | 2 | 0 |
| 11: Observability | 6 | 3 | 3 | 0 | 0 |
| 12: Hardening | 6 | 4 | 2 | 0 | 0 |
| **TOTAL** | **206** | **98** | **81** | **27** | **0** |

---

## NEXT IMMEDIATE ACTIONS (This Sprint)

1. **BE-001 to BE-007**: Neon infrastructure setup (P0)
2. **BE-008 to BE-016**: Database schema + migrations (P0)
3. **BE-017 to BE-024**: Hono API skeleton + middleware (P0)
4. **BE-025 to BE-029**: WebSocket server foundation (P0)
5. **BE-030 to BE-034**: CI/CD pipeline (P0)

**Total P0 tasks to start:** 34 tasks

---

## PHASE 7 PRIORITY ORDER (After Foundation)

Once Phase 1-3 complete, prioritize Call/Video Signaling in this order:

1. **Database & Schema** (BE-139 to BE-141) - Foundation for calls
2. **WebSocket Call Signaling Protocol** (BE-142 to BE-149) - Core signaling
3. **Battery-Optimized Heartbeat** (BE-160 to BE-166) - **Critical for iOS battery life**
4. **Call Signaling Messages** (BE-150 to BE-154) - WebRTC signaling
5. **Call REST API** (BE-155 to BE-159) - Call initiation/management
6. **Media Server Integration** (BE-174 to BE-177) - SFU for media plane
7. **VoIP Push Notifications** (BE-178 to BE-180) - CallKit integration

---

*This task list is derived from DESIGN_DOCUMENT.md. Update as implementation progresses. Each task should have a corresponding branch: `feat/BE-XXX-short-description`.*