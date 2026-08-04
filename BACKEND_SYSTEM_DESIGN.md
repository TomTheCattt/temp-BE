# Backend System Design — Instagram Clone

> Tài liệu thiết kế hệ thống Backend & Server cho dự án Instagram Clone iOS.
> Tech Stack: Node.js + Express + TypeScript + PostgreSQL + Firebase (Auth + Storage) + WebSocket
> Auth: Firebase Auth xử lý toàn bộ vòng đời token (idToken + refreshToken riêng của Firebase, multi-device).
> BE verify Firebase idToken trên mọi request qua Firebase Admin SDK (không tự ký JWT, không tự lưu refresh token trong DB).
> BE có endpoint `/v1/auth/refresh` đóng vai trò **proxy**: nhận Firebase refreshToken từ client, gọi hộ Google secure-token API để đổi idToken mới, kèm business check (user còn tồn tại trong DB) trước khi trả về — giữ BE làm điểm kiểm soát trung tâm mà không cần tự quản lý bảng token.

---

## 1. Tổng Quan Kiến Trúc

```
┌─────────────────────────────────────────────────────────────────────┐
│                         iOS Client (SwiftUI)                         │
│        NetworkService (Alamofire) ←→ WebSocketService (native)       │
└───────────────┬──────────────────────────────┬──────────────────────┘
                │ HTTPS (REST API)             │ WSS (WebSocket)
                ▼                              ▼
┌───────────────────────────────┐  ┌──────────────────────────────────┐
│      Express REST Server      │  │     WebSocket Server (ws)        │
│   - Auth middleware           │  │   - Chat messaging               │
│   - Route handlers            │  │   - Call signaling               │
│   - Validation (Zod)          │  │   - Typing indicators            │
│   - File upload (Multer)      │  │   - Presence (online/offline)    │
└───────────────┬───────────────┘  └──────────────┬───────────────────┘
                │                                  │
                ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Service Layer (Business Logic)                  │
│   UserService, PostService, MessageService, NotificationService...    │
└───────────────┬──────────────────────────┬───────────────────────────┘
                │                          │
                ▼                          ▼
┌──────────────────────────┐   ┌───────────────────────────────────────┐
│    PostgreSQL Database    │   │         Firebase Services              │
│  (Prisma ORM)            │   │  - Firebase Auth (JWT verification)    │
│  - Users, Posts, Comments │   │  - Firebase Storage (media files)      │
│  - Messages, Stories      │   │  - Cloud Messaging (push - optional)  │
│  - Notifications, Reels   │   └───────────────────────────────────────┘
└──────────────────────────┘
```

---

## 2. Tech Stack Chi Tiết

| Layer | Công nghệ | Lý do chọn |
|-------|-----------|------------|
| Runtime | Node.js 20 LTS | Async I/O, ecosystem lớn, dễ học |
| Language | TypeScript 5.x | Type safety, autocomplete, refactor-friendly |
| Framework | Express 4.x | Minimal, linh hoạt, tài liệu nhiều |
| ORM | Prisma | Type-safe queries, auto-generate types, migration dễ |
| Database | PostgreSQL 16 | Relational, JSONB support, full-text search, free |
| Auth | Firebase Auth | Free tier generous, SDK handle token verify |
| Storage | Firebase Storage | Free 5GB, no server setup, SDK upload/download |
| WebSocket | ws (npm) | Lightweight, native WebSocket protocol |
| Validation | Zod | Runtime validation + TypeScript type inference |
| Upload | Multer | Middleware xử lý multipart/form-data |
| Logging | Pino | Structured JSON logging, fast |
| Testing | Vitest + Supertest | Fast, TypeScript native |
| Container | Docker + docker-compose | Dễ setup PostgreSQL local |
| Process Mgr | PM2 (production) | Auto-restart, clustering |
| Rate Limiting | express-rate-limit | Chống spam/abuse, đơn giản, không cần Redis ở scale MVP |
| Security Headers | Helmet | Set các header bảo mật chuẩn (CSP, HSTS, X-Frame-Options...) |
| Image Processing | Sharp | Resize/optimize ảnh (avatar, thumbnail), nhanh vì dùng libvips native |
| Video Processing | fluent-ffmpeg + ffmpeg-static | Tạo thumbnail từ video, lấy duration/dimensions cho Reels & Stories |
| Scheduled Jobs | node-cron | Cron job trong-process: dọn story hết hạn, dọn media mồ côi (đủ cho MVP 1 instance) |
| Push Notification | firebase-admin (Cloud Messaging) | Cùng SDK với Auth/Storage, free, gửi tới nhiều device token/user (multi-device) |
| Search (username) | PostgreSQL `pg_trgm` extension | Tăng tốc ILIKE search trên `username`/`full_name`, không cần thêm service riêng (Elasticsearch) ở MVP |

---

## 3. Cấu Trúc Thư Mục Dự Án

```
instagram-backend/
├── prisma/
│   ├── schema.prisma            # Database schema definition
│   └── migrations/              # Auto-generated migrations
├── src/
│   ├── index.ts                 # Entry point — start Express + WebSocket
│   ├── app.ts                   # Express app setup (middleware, routes)
│   ├── config/
│   │   ├── env.ts               # Environment variables (dotenv)
│   │   ├── firebase.ts          # Firebase Admin SDK init
│   │   └── database.ts          # Prisma client singleton
│   ├── middleware/
│   │   ├── auth.ts              # Firebase idToken verification
│   │   ├── errorHandler.ts      # Global error handler
│   │   ├── validate.ts          # Zod validation middleware
│   │   ├── upload.ts            # Multer config for media
│   │   └── rateLimiter.ts       # express-rate-limit configs (default + auth-strict)
│   ├── routes/
│   │   ├── auth.routes.ts       # /v1/auth/*
│   │   ├── user.routes.ts       # /v1/users/* (bao gồm device-token register)
│   │   ├── post.routes.ts       # /v1/posts/*
│   │   ├── comment.routes.ts    # /v1/posts/:id/comments
│   │   ├── story.routes.ts      # /v1/stories/*
│   │   ├── reel.routes.ts       # /v1/reels/*
│   │   ├── message.routes.ts    # /v1/conversations/*
│   │   ├── notification.routes.ts # /v1/notifications/*
│   │   └── upload.routes.ts     # /v1/upload/*
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── user.service.ts
│   │   ├── post.service.ts
│   │   ├── comment.service.ts
│   │   ├── story.service.ts
│   │   ├── reel.service.ts
│   │   ├── message.service.ts
│   │   ├── notification.service.ts
│   │   ├── storage.service.ts   # Firebase Storage upload/URL generation
│   │   ├── media.service.ts     # Sharp resize + ffmpeg thumbnail/metadata (mục 19)
│   │   └── push.service.ts      # Firebase Cloud Messaging — gửi push đa thiết bị (mục 20)
│   ├── jobs/
│   │   ├── index.ts             # Đăng ký tất cả cron jobs khi start server
│   │   ├── expireStories.job.ts # Dọn story hết hạn (mục 21)
│   │   └── cleanupUploads.job.ts # Dọn media mồ côi (mục 21)
│   ├── websocket/
│   │   ├── server.ts            # WebSocket server setup
│   │   ├── handler.ts           # Message routing
│   │   ├── chat.handler.ts      # Chat message handling
│   │   ├── call.handler.ts      # Call signaling relay
│   │   └── presence.handler.ts  # Online/offline tracking
│   ├── schemas/                 # Zod validation schemas
│   │   ├── auth.schema.ts
│   │   ├── post.schema.ts
│   │   ├── user.schema.ts
│   │   └── message.schema.ts
│   ├── types/
│   │   └── index.ts             # Shared TypeScript types
│   └── utils/
│       ├── pagination.ts        # Pagination helper
│       ├── errors.ts            # Custom error classes
│       └── helpers.ts           # Misc utilities
├── .env                         # Environment variables (gitignored)
├── .env.example                 # Template for .env
├── docker-compose.yml           # PostgreSQL + app containers
├── Dockerfile                   # App container
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. Database Schema (Prisma)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// USERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

model User {
  id              String    @id @default(uuid())
  firebaseUid     String    @unique @map("firebase_uid")
  username        String    @unique
  fullName        String    @map("full_name")
  email           String    @unique
  phone           String?
  avatarUrl       String?   @map("avatar_url")
  bio             String?
  website         String?
  isVerified      Boolean   @default(false) @map("is_verified")
  isPrivate       Boolean   @default(false) @map("is_private")
  postsCount      Int       @default(0) @map("posts_count")
  followersCount  Int       @default(0) @map("followers_count")
  followingCount  Int       @default(0) @map("following_count")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  // Relations
  posts           Post[]
  stories         Story[]
  reels           Reel[]
  comments        Comment[]
  sentMessages    Message[]     @relation("sender")
  notifications   Notification[] @relation("recipient")
  actorNotifs     Notification[] @relation("actor")

  followers       Follow[]  @relation("following")  // users who follow ME
  following       Follow[]  @relation("follower")   // users I follow

  likes           Like[]
  savedPosts      SavedPost[]
  blocks          Block[]   @relation("blocker")
  blockedBy       Block[]   @relation("blocked")

  conversationMembers ConversationMember[]
  deviceTokens    DeviceToken[]

  @@map("users")
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Firebase Auth quản lý toàn bộ vòng đời token (idToken + refreshToken riêng
// của Firebase, lưu phía client qua Firebase SDK). BE KHÔNG tự ký JWT, KHÔNG
// tự lưu refresh token trong DB — không cần model riêng cho việc này.
// Multi-device: cho phép nhiều thiết bị đăng nhập cùng lúc (mặc định Firebase).
// Force logout toàn bộ thiết bị (khi đổi mật khẩu / nghi ngờ bị chiếm tài khoản)
// dùng `admin.auth().revokeRefreshTokens(uid)` — xem mục 7.

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEVICE TOKENS — cho Push Notification (mục 20)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Multi-device (mục 7) → 1 user có thể có nhiều token FCM cùng lúc (mỗi
// thiết bị 1 token). Push gửi tới TẤT CẢ token còn hiệu lực của user.

model DeviceToken {
  id        String         @id @default(uuid())
  userId    String         @map("user_id")
  token     String         @unique   // FCM registration token
  platform  DevicePlatform @default(IOS)
  createdAt DateTime       @default(now()) @map("created_at")
  updatedAt DateTime       @updatedAt @map("updated_at")

  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("device_tokens")
}

enum DevicePlatform {
  IOS
  ANDROID
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FOLLOWS & BLOCKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

model Follow {
  id          String   @id @default(uuid())
  followerId  String   @map("follower_id")
  followingId String   @map("following_id")
  createdAt   DateTime @default(now()) @map("created_at")

  follower    User     @relation("follower", fields: [followerId], references: [id], onDelete: Cascade)
  following   User     @relation("following", fields: [followingId], references: [id], onDelete: Cascade)

  @@unique([followerId, followingId])
  @@index([followerId])
  @@index([followingId])
  @@map("follows")
}

model Block {
  id        String   @id @default(uuid())
  blockerId String   @map("blocker_id")
  blockedId String   @map("blocked_id")
  createdAt DateTime @default(now()) @map("created_at")

  blocker   User     @relation("blocker", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked   User     @relation("blocked", fields: [blockedId], references: [id], onDelete: Cascade)

  @@unique([blockerId, blockedId])
  @@map("blocks")
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POSTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

model Post {
  id            String    @id @default(uuid())
  authorId      String    @map("author_id")
  caption       String?
  locationName  String?   @map("location_name")
  locationLat   Float?    @map("location_lat")
  locationLng   Float?    @map("location_lng")
  likesCount    Int       @default(0) @map("likes_count")
  commentsCount Int       @default(0) @map("comments_count")
  isSponsored   Boolean   @default(false) @map("is_sponsored")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  author        User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
  mediaItems    MediaItem[]
  comments      Comment[]
  likes         Like[]
  savedBy       SavedPost[]

  @@index([authorId])
  @@index([createdAt(sort: Desc)])
  @@map("posts")
}

model MediaItem {
  id            String    @id @default(uuid())
  postId        String    @map("post_id")
  url           String
  thumbnailUrl  String?   @map("thumbnail_url")
  type          MediaType
  width         Int?
  height        Int?
  duration      Float?    // seconds, for video
  sortOrder     Int       @default(0) @map("sort_order")

  post          Post      @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@index([postId])
  @@map("media_items")
}

enum MediaType {
  IMAGE
  VIDEO
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIKES & SAVES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

model Like {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  postId    String?  @map("post_id")
  reelId    String?  @map("reel_id")
  commentId String?  @map("comment_id")
  createdAt DateTime @default(now()) @map("created_at")

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  post      Post?    @relation(fields: [postId], references: [id], onDelete: Cascade)
  reel      Reel?    @relation(fields: [reelId], references: [id], onDelete: Cascade)
  comment   Comment? @relation(fields: [commentId], references: [id], onDelete: Cascade)

  @@unique([userId, postId])
  @@unique([userId, reelId])
  @@unique([userId, commentId])
  @@map("likes")
}

model SavedPost {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  postId    String   @map("post_id")
  createdAt DateTime @default(now()) @map("created_at")

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@unique([userId, postId])
  @@map("saved_posts")
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMMENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

model Comment {
  id         String    @id @default(uuid())
  postId     String    @map("post_id")
  authorId   String    @map("author_id")
  text       String
  parentId   String?   @map("parent_id")   // null = top-level comment
  likesCount Int       @default(0) @map("likes_count")
  createdAt  DateTime  @default(now()) @map("created_at")

  post       Post      @relation(fields: [postId], references: [id], onDelete: Cascade)
  author     User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
  parent     Comment?  @relation("replies", fields: [parentId], references: [id], onDelete: Cascade)
  replies    Comment[] @relation("replies")
  likes      Like[]

  @@index([postId, createdAt])
  @@index([parentId])
  @@map("comments")
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STORIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

model Story {
  id        String      @id @default(uuid())
  authorId  String      @map("author_id")
  createdAt DateTime    @default(now()) @map("created_at")
  expiresAt DateTime    @map("expires_at")  // 24h after creation

  author    User        @relation(fields: [authorId], references: [id], onDelete: Cascade)
  items     StoryItem[]
  views     StoryView[]

  @@index([authorId])
  @@index([expiresAt])
  @@map("stories")
}

model StoryItem {
  id          String          @id @default(uuid())
  storyId     String          @map("story_id")
  mediaUrl    String          @map("media_url")
  type        MediaType
  duration    Float           @default(5)   // seconds
  sortOrder   Int             @default(0)   @map("sort_order")
  stickerType String?         @map("sticker_type")  // mention, hashtag, poll, etc.
  stickerData String?         @map("sticker_data")  // JSON payload
  createdAt   DateTime        @default(now()) @map("created_at")

  story       Story           @relation(fields: [storyId], references: [id], onDelete: Cascade)

  @@index([storyId])
  @@map("story_items")
}

model StoryView {
  id        String   @id @default(uuid())
  storyId   String   @map("story_id")
  viewerId  String   @map("viewer_id")
  viewedAt  DateTime @default(now()) @map("viewed_at")

  story     Story    @relation(fields: [storyId], references: [id], onDelete: Cascade)

  @@unique([storyId, viewerId])
  @@map("story_views")
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REELS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

model Reel {
  id            String    @id @default(uuid())
  authorId      String    @map("author_id")
  videoUrl      String    @map("video_url")
  thumbnailUrl  String?   @map("thumbnail_url")
  caption       String?
  audioName     String?   @map("audio_name")
  audioArtist   String?   @map("audio_artist")
  audioCoverUrl String?   @map("audio_cover_url")
  isOriginalAudio Boolean @default(true) @map("is_original_audio")
  duration      Float
  likesCount    Int       @default(0) @map("likes_count")
  commentsCount Int       @default(0) @map("comments_count")
  sharesCount   Int       @default(0) @map("shares_count")
  viewsCount    Int       @default(0) @map("views_count")
  createdAt     DateTime  @default(now()) @map("created_at")

  author        User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
  likes         Like[]

  @@index([authorId])
  @@index([createdAt(sort: Desc)])
  @@map("reels")
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MESSAGES & CONVERSATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

model Conversation {
  id          String    @id @default(uuid())
  isGroup     Boolean   @default(false) @map("is_group")
  groupName   String?   @map("group_name")
  groupAvatar String?   @map("group_avatar")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  members     ConversationMember[]
  messages    Message[]

  @@map("conversations")
}

model ConversationMember {
  id              String    @id @default(uuid())
  conversationId  String    @map("conversation_id")
  userId          String    @map("user_id")
  isMuted         Boolean   @default(false) @map("is_muted")
  lastReadAt      DateTime? @map("last_read_at")
  joinedAt        DateTime  @default(now()) @map("joined_at")

  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([conversationId, userId])
  @@index([userId])
  @@map("conversation_members")
}

model Message {
  id              String        @id @default(uuid())
  conversationId  String        @map("conversation_id")
  senderId        String        @map("sender_id")
  contentType     MessageContentType @map("content_type")
  textContent     String?       @map("text_content")
  mediaUrl        String?       @map("media_url")
  mediaThumbnail  String?       @map("media_thumbnail")
  mediaDuration   Float?        @map("media_duration")
  referenceId     String?       @map("reference_id")  // postId, storyId, reelId
  replyToId       String?       @map("reply_to_id")
  status          MessageStatus @default(SENT)
  createdAt       DateTime      @default(now()) @map("created_at")

  conversation    Conversation  @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender          User          @relation("sender", fields: [senderId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt(sort: Desc)])
  @@index([senderId])
  @@map("messages")
}

enum MessageContentType {
  TEXT
  IMAGE
  VIDEO
  AUDIO
  POST
  STORY
  REEL
  LIKE
}

enum MessageStatus {
  SENDING
  SENT
  DELIVERED
  READ
  FAILED
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NOTIFICATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

model Notification {
  id            String           @id @default(uuid())
  recipientId   String           @map("recipient_id")
  actorId       String           @map("actor_id")
  type          NotificationType
  postId        String?          @map("post_id")
  commentText   String?          @map("comment_text")
  isRead        Boolean          @default(false) @map("is_read")
  createdAt     DateTime         @default(now()) @map("created_at")

  recipient     User             @relation("recipient", fields: [recipientId], references: [id], onDelete: Cascade)
  actor         User             @relation("actor", fields: [actorId], references: [id], onDelete: Cascade)

  @@index([recipientId, createdAt(sort: Desc)])
  @@index([recipientId, isRead])
  @@map("notifications")
}

enum NotificationType {
  LIKE
  COMMENT
  FOLLOW
  FOLLOW_REQUEST
  MENTION
  TAGGED_IN_POST
  STORY_MENTION
  LIVE_VIDEO
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PENDING UPLOADS — dọn media mồ côi (mục 21)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Track file vừa upload qua /v1/upload/* nhưng CHƯA được gắn vào Post/Story/
// Reel/Message nào. Cron job xoá các bản ghi + file trên Storage nếu quá hạn
// mà vẫn confirmed = false (user upload xong rồi bỏ giữa chừng, không tạo post).

model PendingUpload {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  storagePath String   @map("storage_path")   // path trên Firebase Storage, dùng để xoá file
  url         String
  confirmed   Boolean  @default(false)         // true khi đã gắn vào Post/Story/Reel/Message
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([confirmed, createdAt])
  @@map("pending_uploads")
}
```

---

## 5. API Endpoints Specification

### Base URL: `http://localhost:3000/v1`

### Authentication Header
```
Authorization: Bearer <firebase_id_token>
```
> Mọi request REST (trừ `/auth/refresh`) đều verify trực tiếp Firebase idToken
> qua Firebase Admin SDK — không có access token riêng của BE. Xem mục 7.

### Response Format (chuẩn)
```json
{
  "success": true,
  "data": { ... },
  "message": "optional message"
}
```

### Error Response
```json
{
  "success": false,
  "error": "error_code",
  "message": "Human-readable error message"
}
```

### Pagination Response
```json
{
  "success": true,
  "data": {
    "items": [...],
    "page": 1,
    "perPage": 20,
    "total": 150,
    "hasMore": true
  }
}
```

---

### 5.1 Auth Endpoints (`/v1/auth`)

> **Lưu ý:** email/password không bao giờ đi qua BE. Client dùng Firebase Auth SDK
> để đăng ký/đăng nhập/refresh — Firebase quản lý toàn bộ vòng đời `idToken` +
> `refreshToken`. BE chỉ verify `idToken` (Firebase Admin SDK) trên mọi request,
> và đóng vai trò **proxy có kiểm soát** cho việc refresh (xem luồng bên dưới).
> Multi-device: không giới hạn số thiết bị đăng nhập cùng lúc.

| Method | Path | Body | Response | Mô tả |
|--------|------|------|----------|--------|
| POST | `/register` | `{ idToken, name, phone }` | `{ user }` | Verify idToken → tạo user trong DB (nếu chưa có) |
| POST | `/login` | `{ idToken }` | `{ user }` | Verify idToken → tìm/đồng bộ user trong DB |
| POST | `/refresh` | `{ refreshToken }` (refreshToken của **Firebase**, không phải của BE) | `{ idToken, refreshToken, expiresIn }` | BE proxy: gọi Google secure-token API đổi refreshToken → idToken mới, kèm check user còn tồn tại trong DB |
| POST | `/logout-all-devices` | — (dùng idToken hiện tại) | 204 | Revoke toàn bộ session của user qua `admin.auth().revokeRefreshTokens(uid)` — dùng khi đổi mật khẩu / nghi bị chiếm tài khoản. Logout 1 thiết bị thường thì xử lý phía client (`Auth.auth().signOut()`), không cần gọi BE |
| POST | `/change-password` | — | 200 | Redirect: BE trả về hướng dẫn dùng Firebase SDK `updatePassword()` phía client (BE không xử lý password) |

> Đã bỏ `/forgot-password/phone` + `/reset-password` tự viết — Firebase Auth có
> sẵn `sendPasswordResetEmail()` (email flow) xử lý toàn bộ phía client, không
> cần BE. Nếu sau này cần reset qua SMS OTP thật, phải bật **Phone Auth provider**
> trong Firebase Console trước (hiện tại mục 10 chỉ bật Email/Password).

**Luồng Auth (Firebase Auth trực tiếp, multi-device):**
```
iOS → Firebase Auth SDK (signIn/createUser) → nhận { idToken, refreshToken }
      (SDK tự lưu refreshToken an toàn trong Keychain, tự refresh nền)
iOS → POST /v1/auth/login (body: { idToken })
Server → Firebase Admin SDK (verifyIdToken) → get uid, email
Server → Find/Create user in PostgreSQL by firebase_uid
Server → Return { user }
iOS → Dùng idToken hiện tại cho mọi request (Authorization: Bearer <idToken>)
iOS → Bình thường: gọi user.getIDToken() phía SDK → tự refresh ngầm, không cần BE

--- Khi cần BE kiểm soát việc refresh (ví dụ: muốn log lại hoạt động) ---
iOS → POST /v1/auth/refresh (body: { refreshToken })
Server → Gọi POST https://securetoken.googleapis.com/v1/token?key=<FIREBASE_WEB_API_KEY>
         (grant_type=refresh_token&refresh_token=<refreshToken>)
Server → Nhận { id_token, refresh_token, expires_in } từ Google
Server → Check user còn tồn tại trong DB (nếu không → 401)
Server → Return { idToken, refreshToken, expiresIn }
```

---

### 5.2 User Endpoints (`/v1/users`)

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/me` | Profile hiện tại |
| PUT | `/me` | Update profile (name, bio, website) |
| PUT | `/me/avatar` | Upload avatar (multipart) |
| GET | `/:id` | Profile theo ID |
| GET | `/search?q=&page=&perPage=` | Tìm kiếm users |
| POST | `/:id/follow` | Follow user |
| DELETE | `/:id/follow` | Unfollow user |
| POST | `/:id/block` | Block user |
| DELETE | `/:id/block` | Unblock user |
| GET | `/:id/followers?page=&perPage=` | Danh sách followers |
| GET | `/:id/following?page=&perPage=` | Danh sách following |
| GET | `/suggested?page=&perPage=` | Gợi ý follow |
| POST | `/me/device-token` | Đăng ký FCM token `{ token, platform }` — gọi sau login/mỗi lần app khởi động (mục 20) |
| DELETE | `/me/device-token` | Huỷ đăng ký FCM token `{ token }` — gọi khi logout thiết bị đó |

---

### 5.3 Post Endpoints (`/v1/posts`)

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/feed?page=&perPage=` | Home feed (posts từ following) |
| GET | `/explore?page=&perPage=` | Explore grid (trending/random) |
| GET | `/:id` | Chi tiết 1 post |
| POST | `/` | Tạo post (multipart: caption, media[], location) |
| DELETE | `/:id` | Xóa post (chỉ author) |
| POST | `/:id/like` | Like post |
| DELETE | `/:id/like` | Unlike post |
| POST | `/:id/save` | Save/bookmark |
| DELETE | `/:id/save` | Unsave |
| GET | `/saved?page=&perPage=` | Posts đã save |
| GET | `/user/:userId?page=&perPage=` | Posts của 1 user |

---

### 5.4 Comment Endpoints (`/v1/posts/:postId/comments`)

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/` | Danh sách comments (page, perPage) |
| POST | `/` | Thêm comment `{ text, parentId? }` |
| DELETE | `/:commentId` | Xóa comment (chỉ author) |
| POST | `/:commentId/like` | Like comment |
| DELETE | `/:commentId/like` | Unlike comment |

---

### 5.5 Story Endpoints (`/v1/stories`)

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/feed` | Stories feed (users có story active) |
| GET | `/:userId/items` | Story items của 1 user |
| POST | `/` | Tạo story (multipart: media, type, duration, sticker?) |
| POST | `/:storyId/view` | Đánh dấu đã xem |
| DELETE | `/:storyId` | Xóa story (chỉ author) |

---

### 5.6 Reel Endpoints (`/v1/reels`)

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/feed?page=&perPage=` | Reels feed |
| POST | `/` | Tạo reel (multipart: video, caption, audioName?) |
| POST | `/:id/like` | Like reel |
| DELETE | `/:id/like` | Unlike reel |
| POST | `/:id/view` | Count view |

---

### 5.7 Message Endpoints (`/v1/conversations`)

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/` | Danh sách conversations (page, perPage) |
| POST | `/` | Tạo conversation `{ participantIds[] }` |
| GET | `/:id/messages?page=&perPage=` | Messages trong conversation |
| POST | `/:id/messages` | Gửi message `{ contentType, text?, mediaUrl? }` |
| POST | `/:id/read` | Đánh dấu đã đọc |
| DELETE | `/messages/:messageId` | Xóa message |
| PUT | `/:id/mute` | Mute/unmute `{ mute: bool }` |

---

### 5.8 Notification Endpoints (`/v1/notifications`)

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/?page=&perPage=` | Danh sách notifications |
| POST | `/:id/read` | Mark as read |
| POST | `/read-all` | Mark all as read |
| GET | `/unread-count` | Số notification chưa đọc |

---

### 5.9 Upload Endpoints (`/v1/upload`)

| Method | Path | Mô tả |
|--------|------|--------|
| POST | `/image` | Upload ảnh → resize (Sharp) → Firebase Storage → return `{ url, pendingUploadId }` |
| POST | `/video` | Upload video → generate thumbnail (ffmpeg) → Firebase Storage → return `{ url, thumbnailUrl, duration, pendingUploadId }` |
| POST | `/avatar` | Upload avatar (auto resize 400x400) → return URL (ghi đè avatar cũ, không cần pendingUpload) |

> Mỗi upload (trừ avatar) tạo 1 bản ghi `PendingUpload` (`confirmed: false`).
> Khi client tạo Post/Story/Reel/Message dùng URL đó, service tương ứng
> **phải** set `confirmed: true` cho `PendingUpload` khớp `url`. Nếu sau
> 24h vẫn `confirmed: false` → cron job (mục 21) xoá file + bản ghi.
> Chi tiết pipeline resize/thumbnail: mục 19.

---

## 6. WebSocket Protocol

### Connection
```
URL: ws://localhost:3000/ws
Headers: { "Authorization": "Bearer <firebase_token>" }
```

### Message Format (JSON)
```json
{ "type": "message_type", ...payload }
```

### 6.1 Chat Messages

**Client → Server:**

| type | Payload | Mô tả |
|------|---------|--------|
| `send_message` | `{ conversation_id, content, content_type }` | Gửi tin nhắn |
| `typing_start` | `{ conversation_id }` | Bắt đầu typing |
| `typing_stop` | `{ conversation_id }` | Dừng typing |
| `mark_read` | `{ conversation_id }` | Đánh dấu đã đọc |
| `delete_message` | `{ conversation_id, message_id }` | Xóa tin nhắn |

**Server → Client:**

| type | Payload | Mô tả |
|------|---------|--------|
| `new_message` | `{ message object }` | Tin nhắn mới |
| `typing_start` | `{ conversation_id, user_id }` | User đang typing |
| `typing_stop` | `{ conversation_id, user_id }` | User dừng typing |
| `message_read` | `{ conversation_id, user_id }` | Đã đọc |
| `message_deleted` | `{ conversation_id, message_id }` | Tin nhắn bị xóa |

### 6.2 Call Signaling

**Client → Server:**

| type | Payload |
|------|---------|
| `call_initiate` | `{ call_id, to_user_id, call_type }` |
| `call_offer` | `{ call_id, to_user_id, sdp }` |
| `call_answer` | `{ call_id, to_user_id, sdp }` |
| `call_ice_candidate` | `{ call_id, to_user_id, candidate, sdp_mid?, sdp_mline_index? }` |
| `call_hangup` | `{ call_id, to_user_id }` |
| `call_reject` | `{ call_id, to_user_id }` |
| `call_busy` | `{ call_id, to_user_id }` |
| `call_ringing` | `{ call_id, to_user_id }` |

**Server xử lý:** Relay trực tiếp tới `to_user_id` (thêm `from_user_id` vào payload).

### 6.3 Presence

**Server → Client:**

| type | Payload | Mô tả |
|------|---------|--------|
| `user_online` | `{ user_id }` | User vào app |
| `user_offline` | `{ user_id }` | User rời app |

**Server tracking:** Khi WebSocket connect → mark online, disconnect → mark offline (với debounce 30s cho reconnect).

---

## 7. Authentication Flow (Firebase Auth trực tiếp, multi-device)

> **Quyết định thiết kế (đã chốt):** Dùng thẳng Firebase Auth cho toàn bộ vòng đời
> token — BE **không** tự ký JWT, **không** tự lưu refresh token trong DB.
> Mọi request REST/WebSocket verify `idToken` qua Firebase Admin SDK.
> Lưu ý: `admin.auth().verifyIdToken()` verify **cục bộ** bằng public key của
> Google (được Admin SDK cache & tự làm mới định kỳ) — không phải network call
> mỗi request, nên không có vấn đề latency như lo ngại ban đầu.
>
> Multi-device: không giới hạn số thiết bị đăng nhập cùng lúc (đúng hành vi
> mặc định của Firebase). Muốn buộc đăng xuất toàn bộ thiết bị (đổi mật khẩu,
> nghi ngờ bị chiếm tài khoản) dùng `admin.auth().revokeRefreshTokens(uid)`
> + verify với `checkRevoked: true` (xem Auth Middleware bên dưới).
>
> `/v1/auth/refresh` vẫn tồn tại phía BE như một **proxy có kiểm soát** tới
> Google secure-token API — để BE có điểm chặn nếu user không còn tồn tại
> trong DB, và để không phải sửa gì phía iOS nếu sau này cần thêm logic
> (vd. log audit, rate-limit refresh theo IP).

### Luồng Register
```
1. iOS → Firebase Auth.createUser(email, password) → { idToken, refreshToken } (Firebase SDK tự lưu)
2. iOS → POST /v1/auth/register (body: { idToken, name, phone })
3. Server → Firebase Admin.verifyIdToken(idToken) → firebaseUid, email
4. Server → prisma.user.create({ firebaseUid, email, name, phone, username: auto-generated })
5. Server → return { user }
```

### Luồng Login
```
1. iOS → Firebase Auth.signIn(email, password) → { idToken, refreshToken } (Firebase SDK tự lưu)
2. iOS → POST /v1/auth/login (body: { idToken })
3. Server → Firebase Admin.verifyIdToken(idToken) → firebaseUid
4. Server → prisma.user.findUnique({ firebaseUid })
5. Server → return { user }
6. iOS → dùng idToken cho mọi request tiếp theo (Authorization: Bearer <idToken>)
```

### Luồng Refresh (qua BE proxy)
```
1. iOS → khi idToken sắp/đã hết hạn → POST /v1/auth/refresh (body: { refreshToken })
2. Server → POST https://securetoken.googleapis.com/v1/token?key=<FIREBASE_WEB_API_KEY>
            (body: grant_type=refresh_token&refresh_token=<refreshToken>)
3. Server → nhận { id_token, refresh_token, expires_in } từ Google
4. Server → prisma.user.findUnique({ firebaseUid: decoded.uid }) → check user tồn tại
5. Server → return { idToken, refreshToken, expiresIn }
```
> Nếu BE proxy lỗi/down, iOS vẫn có fallback: gọi thẳng
> `Auth.auth().currentUser?.getIDToken(forcingRefresh: true)` — Firebase SDK tự
> refresh trực tiếp với Google, không phụ thuộc BE. Nên implement fallback này
> phía iOS để tăng độ ổn định.

### Refresh Proxy Service
```typescript
// src/services/token.service.ts
import { prisma } from '../config/database';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

interface GoogleRefreshResponse {
  id_token: string;
  refresh_token: string;
  expires_in: string;
  user_id: string;
}

export async function refreshFirebaseToken(refreshToken: string) {
  const url = `https://securetoken.googleapis.com/v1/token?key=${process.env.FIREBASE_WEB_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });

  if (!res.ok) throw new UnauthorizedError('Invalid or expired refresh token');
  const data = (await res.json()) as GoogleRefreshResponse;

  const user = await prisma.user.findUnique({ where: { firebaseUid: data.user_id } });
  if (!user) throw new UnauthorizedError('User not found');

  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

// Force logout toàn bộ thiết bị — dùng khi đổi mật khẩu / nghi bị chiếm tài khoản
export async function revokeAllSessions(firebaseUid: string) {
  const { auth } = await import('../config/firebase');
  await auth.revokeRefreshTokens(firebaseUid);
}
```

### Auth Middleware (mọi request — verify Firebase idToken)
```typescript
// src/middleware/auth.ts
import { auth } from '../config/firebase';
import { prisma } from '../config/database';
import { UnauthorizedError } from '../utils/errors';

export async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    // checkRevoked: true → phát hiện token bị thu hồi qua revokeRefreshTokens()
    const decoded = await auth.verifyIdToken(token, true);
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (error: any) {
    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ error: 'Session revoked, please login again' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```

> WebSocket auth (mục 13) dùng chung cơ chế này — code ở mục 13 đã verify
> bằng `auth.verifyIdToken(token)` từ trước nên **không cần sửa gì thêm**,
> chỉ cần đổi sang bản có `checkRevoked: true` cho nhất quán.

---

## 8. Firebase Storage Integration

### Upload Flow
```
1. iOS select ảnh/video
2. iOS → POST /v1/upload/image (multipart/form-data)
3. Server (Multer) → nhận file vào memory/temp
4. Server → Firebase Storage.bucket().upload(file, { destination: 'posts/{userId}/{uuid}.jpg' })
5. Server → getSignedUrl() hoặc makePublic() → return URL
6. iOS dùng URL trong request tạo post/story/reel
```

### Storage Structure
```
firebase-storage-bucket/
├── avatars/
│   └── {userId}/
│       └── avatar.jpg          (overwrite mỗi lần update)
├── posts/
│   └── {userId}/
│       └── {mediaId}.jpg/.mp4
├── stories/
│   └── {userId}/
│       └── {itemId}.jpg/.mp4
├── reels/
│   └── {userId}/
│       └── {reelId}.mp4
│       └── {reelId}_thumb.jpg
└── messages/
    └── {conversationId}/
        └── {messageId}.jpg/.mp4/.m4a
```

### Firebase Storage Service
```typescript
// src/services/storage.service.ts
import { getStorage } from 'firebase-admin/storage';

export class StorageService {
  private bucket = getStorage().bucket();

  async uploadFile(
    file: Buffer,
    destination: string,
    contentType: string
  ): Promise<string> {
    const blob = this.bucket.file(destination);
    await blob.save(file, { contentType, public: true });
    return blob.publicUrl();
  }

  async deleteFile(destination: string): Promise<void> {
    await this.bucket.file(destination).delete().catch(() => {});
  }

  getPublicUrl(destination: string): string {
    return `https://storage.googleapis.com/${this.bucket.name}/${destination}`;
  }
}
```

### Free Tier Limits (Firebase Spark Plan)
| Resource | Limit |
|----------|-------|
| Storage | 5 GB |
| Download | 1 GB/day |
| Upload | 1 GB/day |
| Operations | 50,000 reads + 20,000 writes/day |

> Đủ cho development và demo. Khi cần scale: chuyển sang Blaze plan (pay-as-you-go) hoặc migrate sang S3.

---

## 9. Environment Configuration

### .env.example
```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/instagram_clone?schema=public"

# Firebase Admin SDK (verify idToken trên mọi request + Storage)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_STORAGE_BUCKET=your-project.appspot.com

# Firebase Web API Key — dùng để BE proxy gọi securetoken.googleapis.com cho
# /v1/auth/refresh (mục 7). Lấy tại Firebase Console → Project Settings →
# General → Web API Key. Không phải secret tuyệt mật (Google cho phép public
# ở client) nhưng vẫn nên để trong .env, không hardcode.
FIREBASE_WEB_API_KEY=your-firebase-web-api-key

# CORS
CORS_ORIGIN=*

# Logging
LOG_LEVEL=debug
```

### docker-compose.yml
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: instagram_clone
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/instagram_clone
    depends_on:
      - postgres
    volumes:
      - ./src:/app/src  # hot reload in dev

volumes:
  postgres_data:
```

---

## 10. Deployment & Setup Guide

### Prerequisites
- Node.js 20+ (recommend: use `nvm`)
- Docker Desktop (cho PostgreSQL)
- Firebase project (free Spark plan)

### Bước 1: Setup Firebase
1. Tạo project tại [Firebase Console](https://console.firebase.google.com)
2. Enable Authentication → Email/Password provider
3. Enable Storage → Set rules cho authenticated users
4. Project Settings → Service Accounts → Generate private key (JSON) → copy values vào .env
5. Project Settings → General → copy **Web API Key** → `FIREBASE_WEB_API_KEY` trong .env (dùng cho `/v1/auth/refresh` proxy — mục 7)
6. Cloud Messaging → không cần bật gì thêm, hoạt động sẵn cùng project (dùng cho push — mục 20)

### Bước 2: Setup Local
```bash
# Clone & install
git clone <repo-url> instagram-backend
cd instagram-backend
npm install

# Cài thêm các package cho các mảng bổ sung (mục 19-24)
npm install sharp fluent-ffmpeg ffmpeg-static node-cron express-rate-limit helmet
npm install -D @types/fluent-ffmpeg @types/node-cron

# Setup environment
cp .env.example .env
# Edit .env với Firebase credentials

# Start PostgreSQL
docker-compose up -d postgres

# Run migrations
npx prisma migrate dev --name init

# Seed data (optional)
npx prisma db seed

# Start dev server
npm run dev
```

### Bước 3: Connect iOS
Trong iOS project, đổi `AppEnvironment.swift`:
```swift
// Development.xcconfig hoặc Scheme Environment Variables
APP_BASE_URL = http://localhost:3000
APP_USE_LOCAL_BACKEND = 1
API_MODE = live
```

### Package.json Scripts
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio",
    "lint": "eslint src/",
    "test": "vitest"
  }
}
```

---

## 11. Feed Algorithm (Đơn giản)

### Home Feed
```sql
-- Posts từ users mình đang follow, sắp xếp theo thời gian
SELECT p.*, u.username, u.avatar_url, u.is_verified
FROM posts p
JOIN users u ON p.author_id = u.id
WHERE p.author_id IN (
  SELECT following_id FROM follows WHERE follower_id = :currentUserId
)
AND p.author_id NOT IN (
  SELECT blocked_id FROM blocks WHERE blocker_id = :currentUserId
)
ORDER BY p.created_at DESC
LIMIT :perPage OFFSET :offset
```

### Explore Feed
```sql
-- Posts trending (nhiều likes gần đây), exclude following
SELECT p.*
FROM posts p
WHERE p.author_id NOT IN (
  SELECT following_id FROM follows WHERE follower_id = :currentUserId
)
AND p.author_id != :currentUserId
ORDER BY p.likes_count DESC, p.created_at DESC
LIMIT :perPage OFFSET :offset
```

### Reels Feed
```sql
-- Reels random/trending, prioritize chưa xem
SELECT r.*
FROM reels r
WHERE r.author_id NOT IN (
  SELECT blocked_id FROM blocks WHERE blocker_id = :currentUserId
)
ORDER BY r.views_count DESC, RANDOM()
LIMIT :perPage OFFSET :offset
```

---

## 12. Error Handling

### Custom Error Classes
```typescript
// src/utils/errors.ts
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} not found`);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(422, 'VALIDATION_ERROR', message);
  }
}
```

### Global Error Handler
```typescript
// src/middleware/errorHandler.ts
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: 'DUPLICATE',
      message: 'Resource already exists',
    });
  }

  // Unknown error
  console.error(err);
  return res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: 'Something went wrong',
  });
}
```

---

## 13. WebSocket Server Implementation

```typescript
// src/websocket/server.ts
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { auth } from '../config/firebase';
import { prisma } from '../config/database';

interface AuthenticatedSocket extends WebSocket {
  userId: string;
  isAlive: boolean;
}

// Multi-device: 1 user có thể có nhiều socket sống cùng lúc (nhiều thiết bị
// đăng nhập song song, khớp với quyết định multi-device ở mục 7). Vì vậy map
// theo userId → Set<socket> thay vì 1-socket-per-user như bản single-device
// cũ. Không dùng Redis pub/sub — chỉ chạy đúng 1 instance server; nếu sau này
// scale nhiều instance thì đây là nơi đầu tiên cần đổi sang Redis adapter.
const clients = new Map<string, Set<AuthenticatedSocket>>(); // userId → Set<socket>

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Ping/pong heartbeat (30s)
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws: AuthenticatedSocket) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('connection', async (ws: AuthenticatedSocket, req) => {
    // Authenticate on connection — cùng cơ chế với REST (mục 7): verify
    // Firebase idToken, checkRevoked để phát hiện session đã bị force logout.
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return ws.close(4001, 'No token');

    try {
      const decoded = await auth.verifyIdToken(token, true);
      const user = await prisma.user.findUnique({
        where: { firebaseUid: decoded.uid }
      });
      if (!user) return ws.close(4001, 'User not found');

      ws.userId = user.id;
      ws.isAlive = true;

      if (!clients.has(user.id)) clients.set(user.id, new Set());
      clients.get(user.id)!.add(ws);

      // Chỉ báo online khi đây là socket đầu tiên của user (tránh spam presence
      // khi user có nhiều thiết bị connect gần như cùng lúc)
      if (clients.get(user.id)!.size === 1) {
        broadcastPresence(user.id, 'user_online');
      }

      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleMessage(ws, message);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        const userSockets = clients.get(user.id);
        userSockets?.delete(ws);

        // Debounce offline status (30s) — chỉ báo offline nếu KHÔNG còn
        // socket nào khác của user này (đa thiết bị vẫn còn online ở máy khác)
        setTimeout(() => {
          const stillHasSockets = clients.get(user.id)?.size ?? 0;
          if (stillHasSockets === 0) {
            clients.delete(user.id);
            broadcastPresence(user.id, 'user_offline');
          }
        }, 30000);
      });

    } catch (e) {
      ws.close(4001, 'Invalid token');
    }
  });

  wss.on('close', () => clearInterval(heartbeat));
}

// Send to specific user — gửi tới TẤT CẢ thiết bị đang mở của user (multi-device)
export function sendToUser(userId: string, payload: object) {
  const sockets = clients.get(userId);
  if (!sockets) return;
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }
}

// Broadcast presence to user's followers
function broadcastPresence(userId: string, type: string) {
  // TODO: get followers and broadcast
  // For now, broadcast to all connected clients
  clients.forEach((socket, id) => {
    if (id !== userId && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, user_id: userId }));
    }
  });
}
```

### Message Handler
```typescript
// src/websocket/handler.ts
import { sendToUser } from './server';

export function handleMessage(ws: AuthenticatedSocket, message: any) {
  switch (message.type) {
    // Chat
    case 'send_message':
      handleSendMessage(ws.userId, message);
      break;
    case 'typing_start':
    case 'typing_stop':
      relayTyping(ws.userId, message);
      break;
    case 'mark_read':
      handleMarkRead(ws.userId, message);
      break;

    // Call signaling — pure relay
    case 'call_initiate':
    case 'call_offer':
    case 'call_answer':
    case 'call_ice_candidate':
    case 'call_hangup':
    case 'call_reject':
    case 'call_busy':
    case 'call_ringing':
      relayCallSignal(ws.userId, message);
      break;
  }
}

// Relay call signal to target user
function relayCallSignal(fromUserId: string, message: any) {
  const targetUserId = message.to_user_id;
  if (!targetUserId) return;

  sendToUser(targetUserId, {
    ...message,
    from_user_id: fromUserId,
  });
}
```

---

## 14. iOS Client Integration Notes

### Cập nhật iOS khi connect BE thật

| iOS File | Thay đổi cần thiết |
|----------|-------------------|
| `Config/AppEnvironment.swift` | Set `APP_BASE_URL`, `API_MODE = live` |
| `Core/Security/AuthManager.swift` | Integrate Firebase Auth SDK (get idToken) |
| `Core/Networking/RequestInterceptor.swift` | Attach Firebase idToken thay vì mock token |
| `Data/DataSources/Remote/*` | Đã sẵn sàng — chỉ cần đổi API_MODE |
| `Data/DTOs/*` | Verify match với BE response format |
| `Core/WebSocket/WebSocketService.swift` | Set URL `ws://localhost:3000/ws` + auth header |

### iOS Firebase Auth SDK Setup
```swift
// Thêm vào Podfile hoặc SPM:
// firebase-ios-sdk: FirebaseAuth

// Khi login:
Auth.auth().signIn(withEmail: email, password: password) { result, error in
    guard let user = result?.user else { return }
    user.getIDToken { token, error in
        // Gửi token này lên backend
        // Store trong AuthManager
    }
}
```

### Refresh token phía iOS (mục 7)

`RequestInterceptor` nên tự refresh idToken **trước khi hết hạn** thay vì đợi
BE trả về 401 rồi mới refresh (tránh request đầu tiên bị fail):

```swift
// Trước mỗi request, hoặc theo interval:
Auth.auth().currentUser?.getIDToken(completion: { token, error in
    // SDK tự trả token cache nếu còn hạn, tự refresh ngầm nếu sắp hết hạn
    // → cách đơn giản nhất, không cần gọi BE /v1/auth/refresh
})

// Chỉ gọi BE /v1/auth/refresh khi cần luồng có kiểm soát riêng phía BE
// (ví dụ log lại hoạt động, rate-limit) — lấy refreshToken qua:
Auth.auth().currentUser?.refreshToken
```
> Khuyến nghị: dùng `getIDToken()` của SDK làm đường refresh chính (đơn giản,
> ổn định); `/v1/auth/refresh` phía BE dùng như lớp kiểm soát bổ sung hoặc
> fallback, không bắt buộc gọi ở mọi lần refresh.

### DTO Mapping (BE → iOS)

BE response field names (snake_case) sẽ tự động map sang iOS DTOs nhờ:
```swift
// Đã config trong NetworkService
decoder.keyDecodingStrategy = .convertFromSnakeCase
```

---

## 15. Security Checklist

| Item | Status | Implementation |
|------|--------|---------------|
| Firebase idToken verify trên mọi request | ☐ | Auth middleware, dùng `checkRevoked: true` (mục 7) |
| Rate limiting | ☐ | express-rate-limit — default + siết chặt riêng cho `/v1/auth/*` (mục 24) |
| Input validation | ☐ | Zod schemas trên mọi endpoint |
| SQL injection prevention | ☐ | Prisma parameterized queries (tự động); riêng search dùng `$queryRaw` cần bind param đúng cách, không nối chuỗi thủ công (mục 23) |
| File type validation | ☐ | Multer fileFilter (image/*, video/*) |
| File size limit | ☐ | Multer limits (10MB image, 100MB video) |
| CORS | ☐ | Restrict origins in production |
| Helmet.js | ☐ | Security headers (mục 24) |
| Block check | ☐ | Không hiển thị content từ blocked users |
| Private account | ☐ | Check isPrivate + isFollowing trước khi return posts |
| Firebase Web API Key | ☐ | `FIREBASE_WEB_API_KEY` để trong .env, không commit vào git (không phải bí mật tuyệt đối nhưng vẫn nên quản lý qua env) |
| Firebase service account key | ☐ | `FIREBASE_PRIVATE_KEY` bảo mật nghiêm ngặt (dùng để verify + revoke token, KHÔNG được lộ) |
| Force logout khi cần | ☐ | `revokeRefreshTokens(uid)` khi đổi mật khẩu / phát hiện đăng nhập bất thường |
| Atomic counter updates | ☐ | Dùng Prisma `increment`/`decrement` + `$transaction`, không đọc-rồi-cộng ở app (mục 22) |
| Device token cleanup | ☐ | Xoá token FCM không hợp lệ khi push thất bại (mục 20), tránh gửi push vô ích |
| Orphaned media cleanup | ☐ | Cron job dọn `PendingUpload` quá hạn 24h chưa confirm (mục 21) |

---

## 16. Development Roadmap

### Phase 1: Foundation (Tuần 1-2)
- [  ] Setup project (TypeScript, Express, Prisma, Docker)
- [  ] Firebase project + Admin SDK
- [  ] Auth endpoints (register, login, refresh proxy — mục 7)
- [  ] User CRUD (profile, update, avatar upload)
- [  ] Follow/unfollow + followers/following lists (atomic counters — mục 22)
- [  ] Helmet + rate limiting cơ bản (mục 24)

### Phase 2: Content (Tuần 3-4)
- [  ] Post CRUD (create with media upload, delete, feed)
- [  ] Image resize pipeline (Sharp — mục 19)
- [  ] Like/unlike + save/unsave posts (atomic counters — mục 22)
- [  ] Comments (add, list, threaded replies)
- [  ] Explore feed (trending posts)
- [  ] Search users + `pg_trgm` index (mục 23)
- [  ] PendingUpload tracking khi upload media (mục 21)

### Phase 3: Real-time (Tuần 5-6)
- [  ] WebSocket server setup (multi-device — mục 13)
- [  ] Chat messaging (send, receive, typing, read receipts)
- [  ] Call signaling (relay offer/answer/ICE/hangup)
- [  ] Presence (online/offline, multi-device aware)

### Phase 4: Media Features (Tuần 7-8)
- [  ] Video processing pipeline (ffmpeg thumbnail/metadata — mục 19)
- [  ] Stories (create, feed, view tracking)
- [  ] Cron job: auto-expire stories (mục 21)
- [  ] Reels (upload video, feed, like, view count)
- [  ] Notifications (create on events, list, mark read)
- [  ] Push notifications qua FCM (device token register + gửi push — mục 20)

### Phase 5: Polish (Tuần 9-10)
- [  ] Pagination optimization (cursor-based)
- [  ] Cron job: dọn media mồ côi (mục 21)
- [  ] Error handling refinement
- [  ] Performance (query optimization, indexes)
- [  ] Seed data script (realistic test data)
- [  ] Rate limiting riêng cho `/v1/auth/*` (mục 24)

---

## 17. Mapping: iOS Client ↔ Backend

| iOS Entity | DB Table | Notes |
|------------|----------|-------|
| `User` | `users` | `isFollowing`/`isFollowedBy` computed per-request |
| `Post` | `posts` + `media_items` | `isLiked`/`isSaved` computed per-request |
| `Comment` | `comments` | `replies` loaded via `parentId` |
| `Story` | `stories` + `story_items` | `isViewed` from `story_views` |
| `Reel` | `reels` | `isLiked` computed per-request |
| `Message` | `messages` | `status` updated via WebSocket |
| `Conversation` | `conversations` + `conversation_members` | `unreadCount` computed |
| `AppNotification` | `notifications` | `postThumbnailURL` joined from posts |

### Computed Fields (không lưu DB, tính mỗi request)

```typescript
// Khi return Post cho user X:
{
  ...post,
  isLiked: await prisma.like.findUnique({
    where: { userId_postId: { userId: currentUserId, postId: post.id } }
  }) !== null,
  isSaved: await prisma.savedPost.findUnique({
    where: { userId_postId: { userId: currentUserId, postId: post.id } }
  }) !== null,
}

// Khi return User cho user X:
{
  ...user,
  isFollowing: await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: currentUserId, followingId: user.id } }
  }) !== null,
  isFollowedBy: await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: user.id, followingId: currentUserId } }
  }) !== null,
}
```

---

## 18. Quick Reference Commands

```bash
# Development
npm run dev                      # Start server with hot reload
npm run db:studio                # Open Prisma Studio (visual DB browser)
npm run db:migrate               # Create & apply migration
npx prisma generate              # Regenerate Prisma client types

# Database
docker-compose up -d postgres    # Start PostgreSQL
docker-compose down              # Stop all
docker-compose logs postgres     # View DB logs

# Testing
npm run test                     # Run tests
npm run lint                     # Lint check

# Production
npm run build                    # Compile TypeScript
npm run start                    # Run compiled code
```

---

## 19. Media Processing Pipeline (Sharp + ffmpeg)

> Bổ sung xử lý ảnh/video thực sự thay vì chỉ upload raw file lên Storage —
> cần thiết để tránh app hiển thị ảnh gốc quá nặng, video không có thumbnail.

### Ảnh (Sharp)
```typescript
// src/services/media.service.ts
import sharp from 'sharp';

export async function resizeImage(
  buffer: Buffer,
  variant: 'avatar' | 'post' | 'thumbnail'
): Promise<Buffer> {
  const presets = {
    avatar: { width: 400, height: 400, fit: 'cover' as const },
    post: { width: 1080, height: 1350, fit: 'inside' as const },     // giữ tỉ lệ, max 1080x1350
    thumbnail: { width: 300, height: 300, fit: 'cover' as const },
  };
  const { width, height, fit } = presets[variant];

  return sharp(buffer)
    .resize(width, height, { fit })
    .jpeg({ quality: 85 })
    .toBuffer();
}
```

### Video (fluent-ffmpeg)
```typescript
// src/services/media.service.ts (tiếp)
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegPath!);

interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  thumbnailBuffer: Buffer;
}

export async function processVideo(buffer: Buffer): Promise<VideoMeta> {
  const tmpInput = path.join(tmpdir(), `${crypto.randomUUID()}.mp4`);
  const tmpThumb = path.join(tmpdir(), `${crypto.randomUUID()}.jpg`);
  await writeFile(tmpInput, buffer);

  try {
    const metadata = await new Promise<any>((resolve, reject) => {
      ffmpeg.ffprobe(tmpInput, (err, data) => (err ? reject(err) : resolve(data)));
    });
    const stream = metadata.streams.find((s: any) => s.codec_type === 'video');

    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpInput)
        .screenshots({ timestamps: ['1'], filename: path.basename(tmpThumb), folder: tmpdir() })
        .on('end', () => resolve())
        .on('error', reject);
    });

    const thumbnailBuffer = await require('fs/promises').readFile(tmpThumb);

    return {
      duration: metadata.format.duration,
      width: stream.width,
      height: stream.height,
      thumbnailBuffer,
    };
  } finally {
    await unlink(tmpInput).catch(() => {});
    await unlink(tmpThumb).catch(() => {});
  }
}
```

> **Lưu ý hiệu năng:** xử lý video (ffmpeg) tốn CPU và có thể block event loop
> nếu file lớn — với MVP 1 instance chấp nhận được (video ngắn, dung lượng nhỏ).
> Nếu cần scale, tách phần này ra thành worker/queue riêng (BullMQ + Redis)
> thay vì xử lý đồng bộ trong request.

### Cập nhật Upload Service
```typescript
// src/services/storage.service.ts — bổ sung
export class StorageService {
  // ... (giữ nguyên uploadFile/deleteFile/getPublicUrl như mục 8)

  async uploadImageResized(file: Buffer, destination: string, variant: 'avatar' | 'post' | 'thumbnail') {
    const resized = await resizeImage(file, variant);
    return this.uploadFile(resized, destination, 'image/jpeg');
  }

  async uploadVideoWithThumbnail(file: Buffer, videoDestination: string, thumbDestination: string) {
    const meta = await processVideo(file);
    const videoUrl = await this.uploadFile(file, videoDestination, 'video/mp4');
    const thumbnailUrl = await this.uploadFile(meta.thumbnailBuffer, thumbDestination, 'image/jpeg');
    return { videoUrl, thumbnailUrl, duration: meta.duration, width: meta.width, height: meta.height };
  }
}
```

---

## 20. Push Notifications (Firebase Cloud Messaging)

> Sơ đồ kiến trúc (mục 1) đã đề cập FCM nhưng chưa có thiết kế cụ thể. Bổ sung
> đầy đủ ở đây: đăng ký device token, gửi push khi có notification mới.

### Đăng ký / huỷ Device Token
```typescript
// src/services/user.service.ts — bổ sung
export async function registerDeviceToken(userId: string, token: string, platform: 'IOS' | 'ANDROID') {
  await prisma.deviceToken.upsert({
    where: { token },
    create: { userId, token, platform },
    update: { userId, platform, updatedAt: new Date() }, // token có thể được user khác claim lại (đổi máy)
  });
}

export async function unregisterDeviceToken(token: string) {
  await prisma.deviceToken.deleteMany({ where: { token } });
}
```

### Push Service
```typescript
// src/services/push.service.ts
import { getMessaging } from 'firebase-admin/messaging';
import { prisma } from '../config/database';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;   // vd. { type: 'LIKE', postId, actorId }
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const tokens = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
  if (tokens.length === 0) return;

  const res = await getMessaging().sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
  });

  // Dọn token không còn hợp lệ (app bị gỡ, token hết hạn...)
  const invalidTokens = res.responses
    .map((r, i) => (!r.success && isUnregisteredError(r.error?.code) ? tokens[i].token : null))
    .filter((t): t is string => t !== null);

  if (invalidTokens.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: invalidTokens } } });
  }
}

function isUnregisteredError(code?: string) {
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
}
```

### Tích hợp vào Notification Service (khi tạo notification mới)
```typescript
// src/services/notification.service.ts — bổ sung vào hàm createNotification()
export async function createNotification(input: CreateNotificationInput) {
  const notification = await prisma.notification.create({ data: input });

  // Không await — fire-and-forget, lỗi push không được làm fail request chính
  sendPushToUser(input.recipientId, buildPushPayload(input)).catch((err) =>
    logger.error({ err }, 'Failed to send push notification')
  );

  // Cũng bắn qua WebSocket nếu user đang online (mục 6/13)
  sendToUser(input.recipientId, { type: 'new_notification', notification });

  return notification;
}

function buildPushPayload(input: CreateNotificationInput): PushPayload {
  const messages: Record<string, string> = {
    LIKE: 'đã thích bài viết của bạn',
    COMMENT: 'đã bình luận về bài viết của bạn',
    FOLLOW: 'đã bắt đầu theo dõi bạn',
    MENTION: 'đã nhắc đến bạn',
  };
  return {
    title: 'Instagram Clone',
    body: `${input.actorUsername} ${messages[input.type] ?? 'đã tương tác với bạn'}`,
    data: { type: input.type, postId: input.postId ?? '', actorId: input.actorId },
  };
}
```

---

## 21. Scheduled Jobs (node-cron)

> MVP chạy 1 instance duy nhất → dùng cron **trong-process** (`node-cron`) là đủ,
> không cần hệ thống job queue riêng (BullMQ/Agenda). Nếu sau này scale nhiều
> instance, phải chuyển sang cron chạy ở 1 instance chỉ định hoặc dùng
> distributed lock để tránh chạy trùng job.

### 21.1 Dọn Story hết hạn
```typescript
// src/jobs/expireStories.job.ts
import cron from 'node-cron';
import { prisma } from '../config/database';
import { storageService } from '../services/storage.service';

// Chạy mỗi giờ
export function scheduleExpireStories() {
  cron.schedule('0 * * * *', async () => {
    const expired = await prisma.story.findMany({
      where: { expiresAt: { lt: new Date() } },
      include: { items: true },
    });

    for (const story of expired) {
      await Promise.all(
        story.items.map((item) => storageService.deleteFile(extractPathFromUrl(item.mediaUrl)))
      );
      // Cascade xoá StoryItem + StoryView nhờ onDelete: Cascade trong schema
      await prisma.story.delete({ where: { id: story.id } });
    }
  });
}
```
> **Lưu ý:** query feed story (mục 5.5 `/stories/feed`) vẫn nên filter
> `expiresAt > now()` ở tầng API — không phụ thuộc hoàn toàn vào cron (cron
> chạy theo giờ, có độ trễ tối đa ~1h so với thời điểm hết hạn thực tế).

### 21.2 Dọn Media mồ côi (PendingUpload)
```typescript
// src/jobs/cleanupUploads.job.ts
import cron from 'node-cron';
import { prisma } from '../config/database';
import { storageService } from '../services/storage.service';

const GRACE_PERIOD_HOURS = 24;

// Chạy mỗi ngày lúc 3h sáng
export function scheduleCleanupUploads() {
  cron.schedule('0 3 * * *', async () => {
    const cutoff = new Date(Date.now() - GRACE_PERIOD_HOURS * 60 * 60 * 1000);
    const orphaned = await prisma.pendingUpload.findMany({
      where: { confirmed: false, createdAt: { lt: cutoff } },
    });

    for (const upload of orphaned) {
      await storageService.deleteFile(upload.storagePath);
    }

    await prisma.pendingUpload.deleteMany({
      where: { id: { in: orphaned.map((u) => u.id) } },
    });
  });
}
```

### Đăng ký jobs khi start server
```typescript
// src/jobs/index.ts
import { scheduleExpireStories } from './expireStories.job';
import { scheduleCleanupUploads } from './cleanupUploads.job';

export function registerJobs() {
  scheduleExpireStories();
  scheduleCleanupUploads();
}

// src/index.ts — gọi registerJobs() sau khi server start thành công
```

---

## 22. Data Consistency: Atomic Counters & Transactions

> Các field đếm (`likesCount`, `followersCount`, `commentsCount`...) trong
> schema (mục 4) dễ bị lệch nếu update không cẩn thận khi nhiều request chạy
> đồng thời (double-like, double-follow). Nguyên tắc: dùng **Prisma
> `increment`/`decrement`** (dịch sang `UPDATE ... SET x = x + 1` ở SQL —
> atomic ở tầng row, không có race condition read-modify-write) + bọc trong
> `$transaction` cùng với thao tác tạo/xoá record liên quan, và dựa vào
> **unique constraint** để chặn double-action thay vì check tồn tại trước.

### Like / Unlike Post
```typescript
// src/services/post.service.ts
import { Prisma } from '@prisma/client';

export async function likePost(userId: string, postId: string) {
  try {
    await prisma.$transaction([
      prisma.like.create({ data: { userId, postId } }),
      prisma.post.update({ where: { id: postId }, data: { likesCount: { increment: 1 } } }),
    ]);
  } catch (err) {
    // P2002 = unique constraint violation ([userId, postId]) → user đã like rồi, coi như no-op
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
    throw err;
  }
}

export async function unlikePost(userId: string, postId: string) {
  const deleted = await prisma.like.deleteMany({ where: { userId, postId } });
  if (deleted.count === 0) return; // chưa từng like → no-op, không trừ count

  await prisma.post.update({ where: { id: postId }, data: { likesCount: { decrement: 1 } } });
}
```

### Follow / Unfollow (cập nhật 2 counter cùng lúc, phải atomic với nhau)
```typescript
// src/services/user.service.ts
export async function followUser(followerId: string, followingId: string) {
  try {
    await prisma.$transaction([
      prisma.follow.create({ data: { followerId, followingId } }),
      prisma.user.update({ where: { id: followerId }, data: { followingCount: { increment: 1 } } }),
      prisma.user.update({ where: { id: followingId }, data: { followersCount: { increment: 1 } } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
    throw err;
  }
}
```

> Cùng pattern áp dụng cho: save/unsave post, like/unlike comment, like/unlike
> reel, comment count khi thêm/xoá comment. Không liệt kê hết ở đây để tránh
> lặp — implement theo đúng khuôn trên.

> **Vì sao không cần lo lệch số dù nhiều request đồng thời:** `increment`/
> `decrement` của Prisma dịch thành 1 câu `UPDATE` duy nhất trên PostgreSQL,
> PostgreSQL tự khoá row đó trong lúc update — 2 request tăng cùng lúc vẫn
> cho ra kết quả đúng (không giống việc đọc giá trị cũ rồi +1 ở tầng app).

---

## 23. Search Optimization (`pg_trgm`)

> `GET /v1/users/search?q=` (mục 5.2) dùng `ILIKE '%query%'` sẽ **full table
> scan** khi số user lớn — cần trigram index để PostgreSQL dùng được index
> cho tìm kiếm dạng "chứa chuỗi con" (không phải chỉ prefix).

### Migration (raw SQL — Prisma schema không hỗ trợ khai báo GIN trigram trực tiếp)
```sql
-- prisma/migrations/xxxx_add_username_search_index/migration.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX users_username_trgm_idx ON users USING GIN (username gin_trgm_ops);
CREATE INDEX users_full_name_trgm_idx ON users USING GIN (full_name gin_trgm_ops);
```
> Tạo migration rỗng bằng `npx prisma migrate dev --create-only --name add_username_search_index`
> rồi dán SQL trên vào file `migration.sql` được sinh ra, sau đó `npx prisma migrate dev` để áp dụng.

### Query Service
```typescript
// src/services/user.service.ts
export async function searchUsers(query: string, page: number, perPage: number) {
  return prisma.$queryRaw`
    SELECT id, username, full_name, avatar_url, is_verified
    FROM users
    WHERE username ILIKE ${'%' + query + '%'} OR full_name ILIKE ${'%' + query + '%'}
    ORDER BY similarity(username, ${query}) DESC
    LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
  `;
}
```
> Dùng `$queryRaw` (thay vì Prisma query builder) vì cần hàm `similarity()`
> của `pg_trgm` để sắp xếp theo độ khớp — Prisma chưa hỗ trợ hàm này native.

---

## 24. Rate Limiting & Security Middleware

> Bổ sung code thực tế cho các mục đã liệt kê trong Security Checklist (mục 15)
> nhưng trước đó chưa có snippet.

```typescript
// src/middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';

// Mặc định cho toàn bộ API
export const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Vui lòng thử lại sau' },
});

// Siết chặt hơn cho các endpoint liên quan auth (chống brute-force / lạm dụng proxy refresh)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Quá nhiều yêu cầu xác thực' },
});
```

```typescript
// src/app.ts — áp dụng
import helmet from 'helmet';
import { defaultLimiter, authLimiter } from './middleware/rateLimiter';

app.use(helmet());
app.use(defaultLimiter);
app.use('/v1/auth', authLimiter);   // riêng auth routes bị siết chặt hơn
```

---
