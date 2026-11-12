# API Endpoints Reference — Instagram Clone Backend

> **Base URL:** `http://localhost:8787/v1` (dev) | `https://<branch>-<project>.neonfunctions.app/v1` (prod)
> **Auth:** `Authorization: Bearer <better_auth_session_token>` on all endpoints except `/v1/auth/*` public ones
> **Content-Type:** `application/json` (except multipart uploads)
> **Response Format:** `{ success: true, data: {...} }` or `{ success: false, error: "CODE", message: "..." }`
>
> **Auth Model:** Better Auth (via Neon Auth) with **bcrypt** password hashing (cost 10). Sessions stored in database with 7-day sliding expiry. Token verification via database session lookup. Email verification disabled for dev.
>
> ⚠️ **CRITICAL:** All user endpoints use **singular** `/v1/user/...` NOT plural `/v1/users/...`. See [Migration Guide](#migration-guide---fe-team) for common mistakes.

---

## Auth (`/v1/auth`)

Standard Better Auth endpoints are also available at `/api/auth/*` (see below).

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| POST | `/v1/auth/register` | ❌ | `{ email, password, username, fullName, phone? }` | `{ user: User, accessToken: string, refreshToken: string, expiresAt: number }` |
| POST | `/v1/auth/login` | ❌ | `{ email, password }` | `{ user: User, accessToken: string, refreshToken: string, expiresAt: number }` |
| POST | `/v1/auth/logout` | ✅ | — | `{ message: string }` |
| POST | `/v1/auth/logout-all-devices` | ✅ | — | `{ message: string }` |
| POST | `/v1/auth/change-password` | ✅ | `{ currentPassword, newPassword }` | `{ message: string }` |
| POST | `/v1/auth/forgot-password` | ❌ | `{ email }` | `{ message: string }` |
| POST | `/v1/auth/verify-email` | ❌ | `{ token }` | `{ message: string }` |
| POST | `/v1/auth/resend-verification` | ❌ | `{ email }` | `{ message: string }` |
| GET | `/v1/auth/me` | ✅ | — | `{ user: User }` |
| POST | `/v1/auth/refresh` | ❌ | `Authorization: Bearer <refreshToken>` | `{ accessToken: string, refreshToken: string, expiresAt: number }` |

### Better Auth Standard Endpoints (`/api/auth/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/sign-up/email` | Register (Better Auth native) |
| POST | `/api/auth/sign-in/email` | Login (Better Auth native) |
| POST | `/api/auth/sign-out` | Sign out |
| POST | `/api/auth/forget-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password with token |
| GET | `/api/auth/verify-email` | Verify email (token in query) |
| POST | `/api/auth/send-verification-email` | Resend verification |

### Test Accounts (Seeded)

All 20 seeded users use password: `password123`

| Email | Username | Full Name |
|-------|----------|-----------|
| `minhnguyen1@example.com` | `minhnguyen1` | Minh Nguyen |
| `lantran2@example.com` | `lantran2` | Lan Tran |
| `huyhua3@example.com` | `huyhua3` | Huy Hua |
| `thaopham4@example.com` | `thaopham4` | Thao Pham |
| `ducle5@example.com` | `ducle5` | Duc Le |
| `maipham6@example.com` | `maipham6` | Mai Pham |
| `khoahuynh7@example.com` | `khoahuynh7` | Khoa Huynh |
| `ngocvu8@example.com` | `ngocvu8` | Ngoc Vu |
| `phongdang9@example.com` | `phongdang9` | Phong Dang |
| `hienbui10@example.com` | `hienbui10` | Hien Bui |
| `namdo11@example.com` | `namdo11` | Nam Do |
| `hatruong12@example.com` | `hatruong12` | Ha Truong |
| `tuandinh13@example.com` | `tuandinh13` | Tuan Dinh |
| `linhlam14@example.com` | `linhlam14` | Linh Lam |
| `vinhnguyen15@example.com` | `vinhnguyen15` | Vinh Nguyen |
| `trangle16@example.com` | `trangle16` | Trang Le |
| `khanhduong17@example.com` | `khanhduong17` | Khanh Duong |
| `myly18@example.com` | `myly18` | My Ly |
| `dattruong19@example.com` | `dattruong19` | Dat Truong |
| `quynhpham20@example.com` | `quynhpham20` | Quynh Pham |

**Example Login:**
```bash
curl -X POST http://localhost:8787/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "minhnguyen1@example.com", "password": "password123"}'
```

---

## User Profile & Settings (`/v1/user`)

**Note:** All user endpoints are mounted at `/v1/user` (singular), NOT `/v1/users`. iOS client should use `/v1/user/profile` and `/v1/user/:id`.

| Method | Endpoint | Auth | Request Body | Response | Notes |
|--------|----------|------|--------------|----------|-------|
| GET | `/v1/user/me` | ✅ | — | `{ user: User }` | Canonical current user profile |
| GET | `/v1/user/profile` | ✅ | — | `{ user: User }` | **iOS alias** for `/v1/user/me` |
| PUT | `/v1/user/me` | ✅ | `{ fullName?, bio?, website?, isPrivate? }` | `{ user: User }` | Full update |
| PUT | `/v1/user/profile` | ✅ | `{ name }` | `{ user: User }` | **iOS sends `name` only** |
| GET | `/v1/user/settings` | ✅ | — | `{ settings: UserSettings }` | |
| PUT | `/v1/user/settings` | ✅ | `{ language?, biometricEnabled?, pushEnabled?, darkMode? }` | `{ settings: UserSettings }` | |
| GET | `/v1/user/:id` | ✅ | — | `{ user: User }` (+ `isFollowing`, `isBlocked`) | Get user by ID |

---

## Social Graph (`/v1/user`)

| Method | Endpoint | Auth | Query/Body | Response |
|--------|----------|------|------------|----------|
| GET | `/v1/user/search` | ✅ | `q, page?, perPage?` | Paginated users |
| GET | `/v1/user/suggested` | ✅ | `page?, perPage?` | Paginated users |
| GET | `/v1/user/:id/followers` | ✅ | `page?, perPage?` | Paginated users (+ `followedAt`) |
| GET | `/v1/user/:id/following` | ✅ | `page?, perPage?` | Paginated users (+ `followedAt`) |
| POST | `/v1/user/:id/follow` | ✅ | — | `204` |
| DELETE | `/v1/user/:id/follow` | ✅ | — | `204` |
| POST | `/v1/user/:id/block` | ✅ | — | `204` |
| DELETE | `/v1/user/:id/block` | ✅ | — | `204` |
| GET | `/v1/user/me/blocked` | ✅ | `page?, perPage?` | Paginated users (+ `blockedAt`) |

---

## Close Friends (`/v1/user/me/close-friends`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/v1/user/me/close-friends` | ✅ | — | `{ items: User[] }` |
| PUT | `/v1/user/me/close-friends` | ✅ | `{ friendIds: string[] }` | `204` (full-set replace) |

---

## Device Tokens (Push Notifications)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| POST | `/v1/user/me/device-token` | ✅ | `{ token: string, platform: "IOS" \| "ANDROID" }` | `204` |
| DELETE | `/v1/user/me/device-token` | ✅ | `{ token: string }` | `204` |

---

## Posts (`/v1/posts`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/v1/posts/feed` | ✅ | `cursor?, perPage?` | Cursor paginated posts |
| GET | `/v1/posts/explore` | ✅ | `cursor?, perPage?` | Cursor paginated posts |
| GET | `/v1/posts/saved` | ✅ | `cursor?, perPage?` | Cursor paginated posts |
| GET | `/v1/posts/user/:userId` | ✅ | `page?, perPage?` | Offset paginated posts |
| GET | `/v1/posts/:id` | ✅ | — | `{ post: Post }` |
| POST | `/v1/posts/` | ✅ | `{ caption?, locationName?, locationLat?, locationLng?, media: MediaInput[] }` | `{ post: Post }` |
| PUT | `/v1/posts/:id` | ✅ | `{ caption?, locationName?, locationLat?, locationLng? }` | `{ post: Post }` |
| DELETE | `/v1/posts/:id` | ✅ | — | `204` |
| POST | `/v1/posts/:id/like` | ✅ | — | `204` |
| DELETE | `/v1/posts/:id/like` | ✅ | — | `204` |
| POST | `/v1/posts/:id/save` | ✅ | — | `204` |
| DELETE | `/v1/posts/:id/save` | ✅ | — | `204` |
| GET | `/v1/posts/:id/comments` | ✅ | `page?, perPage?` | Paginated comments |
| POST | `/v1/posts/:id/comments` | ✅ | `{ text, parentId? }` | `{ comment: Comment }` |
| DELETE | `/v1/posts/:id/comments/:commentId` | ✅ | — | `204` |

> **MediaInput:** `{ url, type: "IMAGE" \| "VIDEO", width?, height?, duration?, pendingUploadId? }`

> **Post includes:** `isLiked`, `isSaved`, `author.isFollowing`, `mediaItems[]` (computed)

---

## Reels (`/v1/reels`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/v1/reels/feed` | ✅ | `cursor?, perPage?` | Cursor paginated reels |
| GET | `/v1/reels/user/:userId` | ✅ | `page?, perPage?` | Offset paginated reels |
| POST | `/v1/reels/` | ✅ | `{ videoUrl, thumbnailUrl?, caption?, duration, audioName?, audioArtist?, audioCoverUrl?, isOriginalAudio? }` | `{ reel: Reel }` |
| POST | `/v1/reels/:id/like` | ✅ | — | `204` |
| DELETE | `/v1/reels/:id/like` | ✅ | — | `204` |
| POST | `/v1/reels/:id/save` | ✅ | — | `204` |
| DELETE | `/v1/reels/:id/save` | ✅ | — | `204` |
| DELETE | `/v1/reels/:id` | ✅ | — | `204` (author only) |
| POST | `/v1/reels/:id/view` | ✅ | — | `204` |
| GET | `/v1/reels/:reelId/comments` | ✅ | `page?, perPage?` | Paginated comments |
| POST | `/v1/reels/:reelId/comments` | ✅ | `{ text, parentId? }` | `{ comment: Comment }` |
| DELETE | `/v1/reels/:reelId/comments/:commentId` | ✅ | — | `204` |

> **Reel includes:** `isLiked`, `isSaved`, `author.isFollowing` (computed)

---

## Stories (`/v1/stories`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/v1/stories/feed` | ✅ | — | `{ items: StoryGroup[] }` |
| GET | `/v1/stories/:userId/items` | ✅ | — | `{ stories: StoryItem[] }` |
| POST | `/v1/stories/` | ✅ | `{ mediaUrl, type, duration?, stickerType?, stickerData? }` | `{ story: Story }` |
| POST | `/v1/stories/:storyId/view` | ✅ | — | `204` |
| DELETE | `/v1/stories/:storyId` | ✅ | — | `204` |
| GET | `/v1/stories/:id/comments` | ✅ | `page?, perPage?` | Paginated comments |
| POST | `/v1/stories/:id/comments` | ✅ | `{ text, parentId? }` | `{ comment: Comment }` |
| DELETE | `/v1/stories/:id/comments/:commentId` | ✅ | — | `204` |

> **Stories Feed (`/feed`):** Returns active stories from **self + following** (friend's stories), grouped by author with view status.

---

## Conversations (`/v1/conversations`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/v1/conversations/` | ✅ | `page?, perPage?` | Offset paginated conversations (+ last message) |
| POST | `/v1/conversations/` | ✅ | `{ participantIds: string[], groupName?, groupAvatar? }` | `{ conversation: Conversation }` |
| GET | `/v1/conversations/:id/messages` | ✅ | `cursor?, perPage?` | Cursor paginated messages |
| POST | `/v1/conversations/:id/messages` | ✅ | `{ contentType, textContent?, mediaUrl?, mediaThumbnail?, mediaDuration?, referenceId?, replyToId? }` | `{ message: Message }` |
| POST | `/v1/conversations/:id/read` | ✅ | — | `204` |
| PUT | `/v1/conversations/:id/mute` | ✅ | `{ mute: boolean }` | `204` |
| DELETE | `/v1/conversations/messages/:messageId` | ✅ | — | `204` |

---

## Notifications (`/v1/notifications`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/v1/notifications/` | ✅ | `page?, perPage?` | Paginated notifications |
| GET | `/v1/notifications/unread-count` | ✅ | — | `{ count: number }` |
| POST | `/v1/notifications/read-all` | ✅ | — | `204` |
| POST | `/v1/notifications/:id/read` | ✅ | — | `204` |

> **Notification includes:** `postThumbnailUrl` for LIKE/COMMENT/TAGGED_IN_POST

---

## Reports (`/v1/reports`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| POST | `/v1/reports/` | ✅ | `{ type, reason, description?, postId? \| commentId? \| reelId? \| storyId? \| userId? \| messageId? }` | `{ report: Report }` |
| GET | `/v1/reports/my` | ✅ | `page?, perPage?, status?, type?` | Paginated user's reports |
| GET | `/v1/reports/:id` | ✅ | — | `{ report: Report }` |
| GET | `/v1/reports/` | ✅ (admin) | `page?, perPage?, status?, type?` | Paginated all reports |
| PUT | `/v1/reports/:id` | ✅ (admin) | `{ status, resolution? }` | `{ report: Report }` |

> **Report Types:** `POST`, `COMMENT`, `REEL`, `STORY`, `USER`, `MESSAGE`
> **Report Reasons:** `SPAM`, `INAPPROPRIATE_CONTENT`, `HARASSMENT`, `HATE_SPEECH`, `VIOLENCE`, `SEXUAL_CONTENT`, `SELF_HARM`, `FAKE_ACCOUNT`, `INTELLECTUAL_PROPERTY`, `OTHER`
> **Report Status:** `PENDING`, `REVIEWED`, `RESOLVED`, `DISMISSED`
> **Note:** Exactly one target ID must be provided matching the report type. Admin endpoints require moderator role (to be implemented).

---

## Uploads (`/v1/upload`)

Uses Neon Object Storage (S3-compatible).

| Method | Endpoint | Auth | Request | Response |
|--------|----------|------|---------|----------|
| POST | `/v1/upload/presign` | ✅ | `{ contentType, maxSize?, prefix? }` | `{ uploadUrl, pendingUploadId, storagePath, url, expiresIn }` |
| POST | `/v1/upload/confirm` | ✅ | `{ pendingUploadId, targetType, targetId? }` | `{ pendingUploadId, url, storagePath }` |
| POST | `/v1/upload/image` | ✅ | `file` (max 10MB, image/*) | `{ url, width, height, pendingUploadId }` |
| POST | `/v1/upload/video` | ✅ | `file` (max 100MB, video/*) | `{ url, thumbnailUrl, duration, width, height, pendingUploadId }` |
| POST | `/v1/upload/avatar` | ✅ | `file` (max 10MB, image/*) | `{ url }` |
| GET | `/v1/upload/pending/:id` | ✅ | — | `{ pendingUploadId, url, storagePath, confirmed, createdAt }` |
| DELETE | `/v1/upload/pending/:id` | ✅ | — | `204` |

> Creates `PendingUpload` (confirmed: false). Confirmed when used in Post/Story/Reel/Message. Cron deletes unconfirmed after 24h.

---

## Internal Cleanup Endpoints (`/internal`)

Protected by `INTERNAL_CRON_SECRET` (Bearer token). Called by Neon Functions cron triggers.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/internal/cleanup/pending-uploads` | 🔑 Internal | Delete unconfirmed uploads > 24h from storage & DB |
| POST | `/internal/cleanup/device-tokens` | 🔑 Internal | Delete expired device tokens (expiresAt < now) |

> **Headers:** `Authorization: Bearer <INTERNAL_CRON_SECRET>`

---

## Health Check & Metrics

| Method | Endpoint | Auth | Response |
|--------|----------|------|----------|
| GET | `/health` | ❌ | `{ status: "ok", timestamp: string }` |
| GET | `/metrics` | ❌ | Prometheus metrics (text/plain) |

---

## WebSocket

**Connection:** `wss://<branch>-<project>.neonfunctions.app/ws`

**Token Transmission (in order of preference):**
1. **Authorization header:** `Authorization: Bearer <session_token>`
2. **Sec-WebSocket-Protocol header:** `Sec-WebSocket-Protocol: bearer.<session_token>` (standard for WebSocket auth)
3. **Query parameter (legacy):** `?token=<session_token>` (less secure, visible in logs)

### Client → Server

```json
{ "type": "send_message", "conversationId": "uuid", "content": "Hello", "contentType": "TEXT" }
{ "type": "typing_start", "conversationId": "uuid" }
{ "type": "typing_stop", "conversationId": "uuid" }
{ "type": "mark_read", "conversationId": "uuid" }
{ "type": "delete_message", "conversationId": "uuid", "to_user_id": "message-uuid" }
{ "type": "call_initiate", "callId": "uuid", "to_user_id": "uuid", "callType": "audio|video" }
{ "type": "call_offer", "callId": "uuid", "to_user_id": "uuid", "sdp": "..." }
{ "type": "call_answer", "callId": "uuid", "to_user_id": "uuid", "sdp": "..." }
{ "type": "call_ice_candidate", "callId": "uuid", "to_user_id": "uuid", "candidate": "..." }
{ "type": "call_hangup", "callId": "uuid", "to_user_id": "uuid" }
{ "type": "call_reject", "callId": "uuid", "to_user_id": "uuid" }
{ "type": "call_busy", "callId": "uuid", "to_user_id": "uuid" }
{ "type": "call_ringing", "callId": "uuid", "to_user_id": "uuid" }
```

### Server → Client

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

---

## Key Response Types

```typescript
// User (profile)
interface User {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  website?: string;
  isVerified: boolean;
  isPrivate: boolean;
  postsCount: number;
  followersCount: number;
  followingCount: number;
  createdAt: string;
  isFollowing?: boolean;    // computed
  isBlocked?: boolean;      // computed
}

// UserSettings
interface UserSettings {
  userId: string;
  language: string;
  biometricEnabled: boolean;
  pushEnabled: boolean;
  darkMode: boolean;
}

// Post
interface Post {
  id: string;
  authorId: string;
  caption?: string;
  locationName?: string;
  locationLat?: number;
  locationLng?: number;
  likesCount: number;
  commentsCount: number;
  isSponsored: boolean;
  createdAt: string;
  updatedAt: string;
  author: User;
  mediaItems: MediaItem[];
  isLiked: boolean;
  isSaved: boolean;
}

// Reel
interface Reel {
  id: string;
  authorId: string;
  videoUrl: string;
  thumbnailUrl?: string;
  caption?: string;
  audioName?: string;
  audioArtist?: string;
  isOriginalAudio: boolean;
  duration: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  createdAt: string;
  author: User & { isFollowing: boolean };
  isLiked: boolean;
  isSaved: boolean;
}

// Comment
interface Comment {
  id: string;
  postId?: string;
  reelId?: string;
  storyId?: string;
  authorId: string;
  text: string;
  parentId?: string;
  likesCount: number;
  createdAt: string;
  author: User;
}

// Message
interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  contentType: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "POST" | "STORY" | "REEL" | "LIKE";
  textContent?: string;
  mediaUrl?: string;
  mediaThumbnail?: string;
  mediaDuration?: number;
  referenceId?: string;
  replyToId?: string;
  status: "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  createdAt: string;
  sender?: User;
}

// Conversation
interface Conversation {
  id: string;
  isGroup: boolean;
  groupName?: string;
  groupAvatar?: string;
  createdAt: string;
  updatedAt: string;
  members: ConversationMember[];
  lastMessage?: Message;
}

// Notification
interface Notification {
  id: string;
  recipientId: string;
  actorId: string;
  type: "LIKE" | "COMMENT" | "FOLLOW" | "FOLLOW_REQUEST" | "MENTION" | "TAGGED_IN_POST" | "STORY_MENTION" | "LIVE_VIDEO";
  postId?: string;
  reelId?: string;
  commentText?: string;
  postThumbnailUrl?: string;
  isRead: boolean;
  createdAt: string;
  actor: User;
}

// StoryGroup (feed response)
interface StoryGroup {
  userId: string;
  author: User;
  stories: Story[];
}

// Story
interface Story {
  id: string;
  createdAt: string;
  expiresAt: string;
  items: StoryItem[];
  viewed: boolean;
}

// StoryItem
interface StoryItem {
  id: string;
  mediaUrl: string;
  type: "IMAGE" | "VIDEO";
  duration: number;
  sortOrder: number;
  stickerType?: string;
  stickerData?: string;
}

// Report
interface Report {
  id: string;
  reporterId: string;
  type: "POST" | "COMMENT" | "REEL" | "STORY" | "USER" | "MESSAGE";
  reason: "SPAM" | "INAPPROPRIATE_CONTENT" | "HARASSMENT" | "HATE_SPEECH" | "VIOLENCE" | "SEXUAL_CONTENT" | "SELF_HARM" | "FAKE_ACCOUNT" | "INTELLECTUAL_PROPERTY" | "OTHER";
  description?: string;
  postId?: string;
  commentId?: string;
  reelId?: string;
  storyId?: string;
  userId?: string;
  messageId?: string;
  status: "PENDING" | "REVIEWED" | "RESOLVED" | "DISMISSED";
  reviewedBy?: string;
  reviewedAt?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
  reporter?: User;
}
```

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Invalid/expired token, user not found |
| `TOKEN_EXPIRED` | 401 | Session token expired |
| `INVALID_TOKEN` | 401 | Invalid token format |
| `FORBIDDEN` | 403 | Blocked, private account, not author |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `VALIDATION_ERROR` | 422 | Zod validation failed |
| `CONFLICT` | 409 | Duplicate (username, follow, like, etc.) |
| `USERNAME_TAKEN` | 409 | Username already registered |
| `ALREADY_FOLLOWING` | 409 | Already following user |
| `ALREADY_BLOCKED` | 409 | Already blocked user |
| `SELF_FOLLOW` | 400 | Cannot follow yourself |
| `SELF_BLOCK` | 400 | Cannot block yourself |
| `SELF_REPORT` | 400 | Cannot report yourself |
| `ALREADY_REPORTED` | 409 | You have already reported this content |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password |
| `REGISTRATION_FAILED` | 500 | Account creation failed |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Pagination

**Offset:** `?page=1&perPage=20` (max 50) → `{ items, page, perPage, total, hasMore }`  
**Cursor:** `?cursor=<timestamp>&perPage=20` → `{ items, nextCursor, hasMore }` (feeds — implemented for posts, reels, conversations)

---

## iOS Client Notes

1. **Use `/v1/user/profile`** for GET/PUT profile (not `/v1/users/me`)
2. **Send `name`** not `fullName` in PUT `/v1/user/profile`
3. **Backend returns camelCase** — no snake_case decoding needed (remove `.convertFromSnakeCase`)
4. **Attach Better Auth session token** to every request: `Authorization: Bearer <token>`
5. **WebSocket:** Connect with token via Authorization header or Sec-WebSocket-Protocol (preferred over query param)
6. **Uploads:** Use returned `pendingUploadId` in Post/Story/Reel/Message creation
7. **Reel/Post computed fields:** `isLiked`, `isSaved`, `author.isFollowing` included in responses
8. **Notification preview:** Use `postThumbnailUrl` for badge images
9. **Comments:** Posts, Reels, and Stories all support comments with replies (parentId)

---

*Generated from current Hono/Drizzle/Better Auth implementation — for implementation status see IMPLEMENTATION_PLAN.md*