# FE Migration Guide — Instagram Clone Backend

> **Target:** Frontend team (iOS/Swift)
> **Date:** 2026-11-10
> **Backend Version:** Current (Neon Functions + Hono + Drizzle)

---

## ⚠️ Critical Path Mismatches (Must Fix)

All user endpoints are mounted at **`/v1/user` (singular)**, NOT `/v1/users` (plural).

| ❌ FE Currently Calls | ✅ Correct Path | Notes |
|----------------------|----------------|-------|
| `GET /v1/users/:id` | `GET /v1/user/:id` | Public profile |
| `GET /v1/users/search` | `GET /v1/user/search` | User search |
| `GET /v1/users/suggested` | `GET /v1/user/suggested` | Suggested users |
| `GET /v1/users/:id/followers` | `GET /v1/user/:id/followers` | Followers list |
| `GET /v1/users/:id/following` | `GET /v1/user/:id/following` | Following list |
| `POST /v1/users/:id/follow` | `POST /v1/user/:id/follow` | Follow user |
| `DELETE /v1/users/:id/follow` | `DELETE /v1/user/:id/follow` | Unfollow user |
| `POST /v1/users/:id/block` | `POST /v1/user/:id/block` | Block user |
| `DELETE /v1/users/:id/block` | `DELETE /v1/user/:id/block` | Unblock user |
| `GET /v1/users/me/blocked` | `GET /v1/user/me/blocked` | Blocked users |
| `GET /v1/users/me/close-friends` | `GET /v1/user/me/close-friends` | Close friends |
| `PUT /v1/users/me/close-friends` | `PUT /v1/user/me/close-friends` | Update close friends |

### Why This Matters
- The router is mounted at `app.route("/v1/user", userRouter)` in `src/index.ts:314`
- There is **no** `/v1/users` router — calls return 404 "Route not found"
- API_ENDPOINTS.md has always documented `/v1/user` (singular)

---

## ✅ Verified Working Endpoints (Use These)

### Auth
```bash
POST /v1/auth/register     # {email, password, username, fullName, phone?}
POST /v1/auth/login        # {email, password} → {accessToken, refreshToken, user}
POST /v1/auth/refresh      # Authorization: Bearer <refreshToken>
POST /v1/auth/logout       # Auth required
POST /v1/auth/change-password  # Auth required
GET  /v1/auth/me           # Auth required
```

### User Profile (iOS Aliases)
```bash
GET  /v1/user/me           # Canonical current user profile
GET  /v1/user/profile      # iOS alias for /me (prefer this)
PUT  /v1/user/me           # {fullName?, bio?, website?, isPrivate?}
PUT  /v1/user/profile      # iOS sends {name} instead of {fullName}
GET  /v1/user/settings     # User settings
PUT  /v1/user/settings     # {language?, biometricEnabled?, pushEnabled?, darkMode?}
GET  /v1/user/:id          # Public profile by ID
```

### Posts
```bash
GET  /v1/posts/feed        # Cursor pagination: ?cursor=&perPage=20
GET  /v1/posts/explore     # **NEW:** Fallback to popular posts if no non-followed content
GET  /v1/posts/saved       # Saved posts
GET  /v1/posts/user/:userId  # Offset pagination: ?page=1&perPage=20
GET  /v1/posts/:id         # Single post
POST /v1/posts/            # Create post (requires media array)
PUT  /v1/posts/:id         # Update caption/location
DELETE /v1/posts/:id       # Delete own post
POST /v1/posts/:id/like    # Like post
DELETE /v1/posts/:id/like  # Unlike post
POST /v1/posts/:id/save    # Save post
DELETE /v1/posts/:id/save  # Unsave post
```

### Comments (Posts/Reels/Stories)
```bash
GET  /v1/posts/:id/comments?page=1&perPage=20
POST /v1/posts/:id/comments  # {text, parentId?}
DELETE /v1/posts/:id/comments/:commentId

GET  /v1/reels/:reelId/comments?page=1&perPage=20
POST /v1/reels/:reelId/comments  # {text, parentId?}
DELETE /v1/reels/:reelId/comments/:commentId

GET  /v1/stories/:id/comments?page=1&perPage=20
POST /v1/stories/:id/comments  # {text, parentId?}
DELETE /v1/stories/:id/comments/:commentId
```

### Reels
```bash
GET  /v1/reels/feed        # Cursor pagination
GET  /v1/reels/user/:userId  # Offset pagination
POST /v1/reels/            # Create reel
POST /v1/reels/:id/like    # Like reel
DELETE /v1/reels/:id/like  # Unlike reel
POST /v1/reels/:id/save    # Save reel
DELETE /v1/reels/:id/save  # Unsave reel
DELETE /v1/reels/:id       # Delete own reel
POST /v1/reels/:id/view    # Record view
```

### Stories
```bash
GET  /v1/stories/feed      # Active stories from self + following (grouped by author)
GET  /v1/stories/:userId/items  # All story items for a user
POST /v1/stories/          # Create story
POST /v1/stories/:storyId/view  # Mark viewed
DELETE /v1/stories/:storyId     # Delete own story
```

### Conversations (Chat)
```bash
GET  /v1/conversations/                    # List conversations
POST /v1/conversations/                    # Create (DM or group)
GET  /v1/conversations/:id/messages        # Cursor pagination
POST /v1/conversations/:id/messages        # Send message
POST /v1/conversations/:id/read            # Mark as read
PUT  /v1/conversations/:id/mute            # Mute/unmute
DELETE /v1/conversations/messages/:messageId  # Delete message
```

### Notifications
```bash
GET  /v1/notifications/                    # Paginated
GET  /v1/notifications/unread-count        # Unread count
POST /v1/notifications/read-all            # Mark all read
POST /v1/notifications/:id/read            # Mark one read
```

### Reports
```bash
POST /v1/reports/           # Create report
GET  /v1/reports/my         # My reports
GET  /v1/reports/:id        # Single report
# Admin endpoints require moderator role
```

### Uploads (Neon Object Storage / S3-compatible)
```bash
POST /v1/upload/presign     # Get presigned URL → returns {uploadUrl, pendingUploadId, url}
POST /v1/upload/confirm     # Confirm upload used in post/story/reel/message
POST /v1/upload/image       # Direct image upload (multipart)
POST /v1/upload/video       # Direct video upload (multipart)
POST /v1/upload/avatar      # Direct avatar upload (multipart)
GET  /v1/upload/pending/:id # Check pending upload status
DELETE /v1/upload/pending/:id # Delete pending upload
```

### WebSocket
```
wss://<branch>-<project>.neonfunctions.app/ws

Token (in order of preference):
1. Authorization: Bearer <session_token>
2. Sec-WebSocket-Protocol: bearer.<session_token>
3. Query: ?token=<session_token> (less secure)

Messages:
{ "type": "send_message", "conversationId": "...", "content": "Hello", "contentType": "TEXT" }
{ "type": "typing_start", "conversationId": "..." }
{ "type": "call_initiate", "callId": "...", "to_user_id": "...", "callType": "audio|video" }
{ "type": "call_offer", "callId": "...", "to_user_id": "...", "sdp": "..." }
{ "type": "call_answer", "callId": "...", "to_user_id": "...", "sdp": "..." }
{ "type": "call_ice_candidate", "callId": "...", "to_user_id": "...", "candidate": "..." }
{ "type": "call_hangup", "callId": "...", "to_user_id": "..." }
```

---

## 🔧 Common Issues & Fixes

### 1. "Decode failed" / snake_case errors
**Backend returns camelCase** — remove `.convertFromSnakeCase` from JSONDecoder.

```swift
// ❌ Old (incorrect)
let decoder = JSONDecoder()
decoder.keyDecodingStrategy = .convertFromSnakeCase

// ✅ New (correct)
let decoder = JSONDecoder()
// No keyDecodingStrategy needed
```

### 2. Empty Explore Feed
**Fixed on backend** — `/v1/posts/explore` now falls back to popular posts when you follow everyone. Response includes `isFallback: true`.

### 3. "Post not found" on Comments
**Cause:** Using stale/incorrect post ID. Only use IDs from `/feed`, `/explore`, `/user/:userId`, or create response.

### 4. 401 Unauthorized / Invalid Session
**Cause:** Expired or invalid Better Auth session token.
- Use `/v1/auth/refresh` with refresh token to get new access token
- Session tokens are opaque (database lookup), not JWT

### 5. WebSocket 401 / Handshake Failed
**Fixed:** Token verified BEFORE upgrade. Use Authorization header or Sec-WebSocket-Protocol (preferred over query param).

---

## 📋 Test Accounts (All password: `password123`)

| Email | Username | Full Name |
|-------|----------|-----------|
| `lanlam1@example.com` | `lanlam1` | Lan Lam |
| `vyho2@example.com` | `vyho2` | Vy Ho |
| `anhuynh3@example.com` | `anhuynh3` | An Huynh |
| ... (20 total, user-1 through user-20) |

```bash
curl -X POST http://localhost:8787/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "lanlam1@example.com", "password": "password123"}'
```

---

## 🔄 Quick Migration Checklist for FE

- [ ] Replace all `/v1/users/` → `/v1/user/` in networking layer
- [ ] Remove `.convertFromSnakeCase` from JSONDecoder
- [ ] Use `/v1/user/profile` for GET/PUT profile (iOS alias)
- [ ] Send `name` not `fullName` in PUT `/v1/user/profile`
- [ ] Attach `Authorization: Bearer <token>` to ALL requests (except `/v1/auth/*`)
- [ ] Use WebSocket Authorization header or Sec-WebSocket-Protocol
- [ ] Use `pendingUploadId` from `/upload/presign` in Post/Story/Reel/Message creation
- [ ] Handle `isLiked`, `isSaved`, `author.isFollowing` in Post/Reel responses
- [ ] Use `postThumbnailUrl` from notifications for badge images
- [ ] Test explore feed — should return posts now (with `isFallback` flag)

---

## 📞 Backend Contact

- **Repo:** This backend (Hono + Drizzle + Better Auth on Neon Functions)
- **API Docs:** `API_ENDPOINTS.md` (this repo)
- **Changes:** All endpoints documented above are implemented and tested

> **Note:** If you find discrepancies between this guide and actual API behavior, check `API_ENDPOINTS.md` first — it's generated from the implementation.