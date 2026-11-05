# API Endpoints Reference — Instagram Clone Backend

> **Base URL:** `http://localhost:3000/v1` (dev) | `https://<branch>-<project>.neonfunctions.app/v1` (prod)
> **Auth:** `Authorization: Bearer <better_auth_session_token>` on all endpoints except `/v1/auth/*` public ones
> **Content-Type:** `application/json` (except multipart uploads)
> **Response Format:** `{ success: true, data: {...} }` or `{ success: false, error: "CODE", message: "..." }`

---

## Auth (`/v1/auth`)

Standard Better Auth endpoints are also available at `/api/auth/*` (see below).

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| POST | `/register` | ❌ | `{ email, password, username, fullName, phone? }` | `{ user: User }` |
| POST | `/login` | ❌ | `{ email, password }` | `{ user: User }` |
| POST | `/logout` | ✅ | — | `{ message: string }` |
| POST | `/logout-all-devices` | ✅ | — | `{ message: string }` |
| POST | `/change-password` | ✅ | `{ currentPassword, newPassword }` | `{ message: string }` |
| POST | `/forgot-password` | ❌ | `{ email }` | `{ message: string }` |
| POST | `/verify-email` | ❌ | `{ token }` | `{ message: string }` |
| POST | `/resend-verification` | ❌ | `{ email }` | `{ message: string }` |
| GET | `/me` | ✅ | — | `{ user: User }` |
| POST | `/refresh` | ❌ | — | `{ session: Session }` |

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

---

## User Profile & Settings (`/v1/user` & `/v1/users`)

| Method | Endpoint | Auth | Request Body | Response | Notes |
|--------|----------|------|--------------|----------|-------|
| GET | `/v1/user/profile` | ✅ | — | `{ user: User }` | **Alias** of `/v1/users/me` (iOS uses this) |
| PUT | `/v1/user/profile` | ✅ | `{ name }` | `{ user: User }` | **iOS sends `name` only** |
| GET | `/v1/user/settings` | ✅ | — | `{ settings: UserSettings }` | |
| PUT | `/v1/user/settings` | ✅ | `{ language?, biometricEnabled?, pushEnabled?, darkMode? }` | `{ settings: UserSettings }` | |
| GET | `/v1/users/me` | ✅ | — | `{ user: User }` | Canonical profile |
| PUT | `/v1/users/me` | ✅ | `{ fullName?, bio?, website?, isPrivate? }` | `{ user: User }` | Full update |

---

## Social Graph (`/v1/users`)

| Method | Endpoint | Auth | Query/Body | Response |
|--------|----------|------|------------|----------|
| GET | `/v1/users/:id` | ✅ | — | `{ user: User }` (+ `isFollowing`, `isFollowedBy`) |
| GET | `/v1/users/search` | ✅ | `q, page?, perPage?` | Paginated users |
| GET | `/v1/users/suggested` | ✅ | `page?, perPage?` | Paginated users |
| GET | `/v1/users/:id/followers` | ✅ | `page?, perPage?` | Paginated users (+ `followedAt`) |
| GET | `/v1/users/:id/following` | ✅ | `page?, perPage?` | Paginated users (+ `followedAt`) |
| POST | `/v1/users/:id/follow` | ✅ | — | `204` |
| DELETE | `/v1/users/:id/follow` | ✅ | — | `204` |
| POST | `/v1/users/:id/block` | ✅ | — | `204` |
| DELETE | `/v1/users/:id/block` | ✅ | — | `204` |
| GET | `/v1/users/me/blocked` | ✅ | `page?, perPage?` | Paginated users (+ `blockedAt`) |

---

## Close Friends (`/v1/users/me/close-friends`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/v1/users/me/close-friends` | ✅ | — | `{ items: User[] }` |
| PUT | `/v1/users/me/close-friends` | ✅ | `{ friendIds: string[] }` | `204` (full-set replace) |

---

## Device Tokens (Push Notifications)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| POST | `/v1/users/me/device-token` | ✅ | `{ token: string, platform: "IOS" \| "ANDROID" }` | `204` |
| DELETE | `/v1/users/me/device-token` | ✅ | `{ token: string }` | `204` |

---

## Posts (`/v1/posts`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/feed` | ✅ | `cursor?, perPage?` | Cursor paginated posts |
| GET | `/explore` | ✅ | `cursor?, perPage?` | Cursor paginated posts |
| GET | `/saved` | ✅ | `cursor?, perPage?` | Cursor paginated posts |
| GET | `/user/:userId` | ✅ | `page?, perPage?` | Offset paginated posts |
| GET | `/:id` | ✅ | — | `{ post: Post }` |
| POST | `/` | ✅ | `{ caption?, locationName?, locationLat?, locationLng?, media: MediaInput[] }` | `{ post: Post }` |
| PUT | `/:id` | ✅ | `{ caption?, locationName?, locationLat?, locationLng? }` | `{ post: Post }` |
| DELETE | `/:id` | ✅ | — | `204` |
| POST | `/:id/like` | ✅ | — | `204` |
| DELETE | `/:id/like` | ✅ | — | `204` |
| POST | `/:id/save` | ✅ | — | `204` |
| DELETE | `/:id/save` | ✅ | — | `204` |

> **MediaInput:** `{ url, type: "IMAGE" \| "VIDEO", width?, height?, duration?, pendingUploadId? }`

> **Post includes:** `isLiked`, `isSaved`, `author.isFollowing`, `mediaItems[]` (computed)

---

## Reels (`/v1/reels`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/feed` | ✅ | `cursor?, perPage?` | Cursor paginated reels |
| GET | `/user/:userId` | ✅ | `page?, perPage?` | Offset paginated reels |
| POST | `/` | ✅ | `{ videoUrl, thumbnailUrl?, caption?, duration, audioName?, audioArtist?, audioCoverUrl?, isOriginalAudio? }` | `{ reel: Reel }` |
| POST | `/:id/like` | ✅ | — | `204` |
| DELETE | `/:id/like` | ✅ | — | `204` |
| POST | `/:id/save` | ✅ | — | `204` |
| DELETE | `/:id/save` | ✅ | — | `204` |
| DELETE | `/:id` | ✅ | — | `204` (author only) |
| POST | `/:id/view` | ✅ | — | `204` |
| GET | `/:reelId/comments` | ✅ | `page?, perPage?` | Paginated comments |
| POST | `/:reelId/comments` | ✅ | `{ text, parentId? }` | `{ comment: Comment }` |

> **Reel includes:** `isLiked`, `isSaved`, `author.isFollowing` (computed)

---

## Stories (`/v1/stories`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/feed` | ✅ | — | `{ items: Story[] }` |
| GET | `/:userId/items` | ✅ | — | `{ stories: StoryItem[] }` |
| POST | `/` | ✅ | `{ mediaUrl, type, duration?, stickerType?, stickerData? }` | `{ story: Story }` |
| POST | `/:storyId/view` | ✅ | — | `204` |
| DELETE | `/:storyId` | ✅ | — | `204` |

---

## Conversations (`/v1/conversations`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/` | ✅ | `page?, perPage?` | Offset paginated conversations (+ last message) |
| POST | `/` | ✅ | `{ participantIds: string[], groupName?, groupAvatar? }` | `{ conversation: Conversation }` |
| GET | `/:id/messages` | ✅ | `cursor?, perPage?` | Cursor paginated messages |
| POST | `/:id/messages` | ✅ | `{ contentType, textContent?, mediaUrl?, mediaThumbnail?, mediaDuration?, referenceId?, replyToId? }` | `{ message: Message }` |
| POST | `/:id/read` | ✅ | — | `204` |
| PUT | `/:id/mute` | ✅ | `{ mute: boolean }` | `204` |
| DELETE | `/messages/:messageId` | ✅ | — | `204` |

---

## Notifications (`/v1/notifications`)

| Method | Endpoint | Auth | Request Body | Response |
|--------|----------|------|--------------|----------|
| GET | `/` | ✅ | `page?, perPage?` | Paginated notifications |
| GET | `/unread-count` | ✅ | — | `{ count: number }` |
| POST | `/read-all` | ✅ | — | `204` |
| POST | `/:id/read` | ✅ | — | `204` |

> **Notification includes:** `postThumbnailUrl` for LIKE/COMMENT/TAGGED_IN_POST

---

## Uploads (`/v1/upload`)

Uses Neon Object Storage (S3-compatible).

| Method | Endpoint | Auth | Request | Response |
|--------|----------|------|---------|----------|
| POST | `/presign` | ✅ | `{ contentType, maxSize?, prefix? }` | `{ uploadUrl, pendingUploadId, storagePath, url, expiresIn }` |
| POST | `/confirm` | ✅ | `{ pendingUploadId, targetType, targetId? }` | `{ pendingUploadId, url, storagePath }` |
| POST | `/image` | ✅ | `file` (max 10MB, image/*) | `{ url, width, height, pendingUploadId }` |
| POST | `/video` | ✅ | `file` (max 100MB, video/*) | `{ url, thumbnailUrl, duration, width, height, pendingUploadId }` |
| POST | `/avatar` | ✅ | `file` (max 10MB, image/*) | `{ url }` |
| GET | `/pending/:id` | ✅ | — | `{ pendingUploadId, url, storagePath, confirmed, createdAt }` |
| DELETE | `/pending/:id` | ✅ | — | `204` |

> Creates `PendingUpload` (confirmed: false). Confirmed when used in Post/Story/Reel/Message. Cron deletes unconfirmed after 24h.

---

## WebSocket

**Connection:** `wss://<branch>-<project>.neonfunctions.app/ws?token=<session_token>`  
Accepts token via **query param `?token=`** (Better Auth session token).

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
  isFollowedBy?: boolean;   // computed
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
```

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Invalid/expired token, user not found |
| `TOKEN_EXPIRED` | 401 | JWT token expired |
| `INVALID_TOKEN` | 401 | Invalid token signature |
| `FORBIDDEN` | 403 | Blocked, private account, not author |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `VALIDATION_ERROR` | 422 | Zod validation failed |
| `CONFLICT` | 409 | Duplicate (username, follow, like, etc.) |
| `USERNAME_TAKEN` | 409 | Username already registered |
| `ALREADY_FOLLOWING` | 409 | Already following user |
| `ALREADY_BLOCKED` | 409 | Already blocked user |
| `SELF_FOLLOW` | 400 | Cannot follow yourself |
| `SELF_BLOCK` | 400 | Cannot block yourself |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password |
| `REGISTRATION_FAILED` | 500 | Account creation failed |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Pagination

**Offset:** `?page=1&perPage=20` (max 50) → `{ items, page, perPage, total, hasMore }`  
**Cursor:** `?cursor=<timestamp>&perPage=20` → `{ items, nextCursor, hasMore }` (feeds - implemented for posts, reels, conversations)

---

## iOS Client Notes

1. **Use `/v1/user/profile`** for GET/PUT profile (not `/v1/users/me`)
2. **Send `name`** not `fullName` in PUT `/v1/user/profile`
3. **Decode snake_case:** `decoder.keyDecodingStrategy = .convertFromSnakeCase`
4. **Attach Better Auth session token** to every request: `Authorization: Bearer <token>`
5. **WebSocket:** Connect with `wss://host/ws?token=<session_token>`
6. **Uploads:** Use returned `pendingUploadId` in Post/Story/Reel creation
7. **Reel/Post computed fields:** `isLiked`, `isSaved`, `author.isFollowing` included in responses
8. **Notification preview:** Use `postThumbnailUrl` for badge images

---

*Generated from current Hono/Drizzle/Better Auth implementation — for implementation status see IMPLEMENTATION_PLAN.md*