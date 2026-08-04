# Tiến độ triển khai Backend Instagram Clone

_Cập nhật: 04/08/2026_

Tài liệu này theo dõi mức độ triển khai thực tế của repository, đối chiếu với
[BACKEND_SYSTEM_DESIGN.md](./BACKEND_SYSTEM_DESIGN.md). Trạng thái chỉ phản ánh
mã nguồn hiện có; chưa xác nhận luồng chạy end-to-end với PostgreSQL và Firebase
thật.

## Tổng quan

| Khu vực | Trạng thái | Ghi chú |
|---|---|---|
| Nền tảng Express/TypeScript/Prisma | Đã có | App, cấu hình env, error handler và health check đã sẵn sàng. |
| Firebase Auth | Đã có | Verify id token, register/login, refresh proxy, revoke toàn bộ session. |
| User & social graph | Đã có | Profile, avatar, follow/unfollow, block/unblock, search, suggested users, FCM device token. |
| Post & comment | Đã có | CRUD phần core, feed/explore/save/like và comments/replies. |
| WebSocket | Đã có phần core | Xác thực, heartbeat, presence follower-only, relay typing/call có authorization. |
| Upload/media | Đã có phần core | Multer memory upload, Firebase Storage, Sharp/ffmpeg và PendingUpload. |
| Story/Reel/Chat/Notification | Đã có phần core | Route/service REST đã có; push FCM và event-domain còn thiếu. |
| Jobs, test, deploy | Đang hoàn thiện | Cron cleanup đã có; migration áp dụng, test và CI còn thiếu. |

## Đã hoàn thành

### Foundation

- [x] Express app với `helmet`, CORS, JSON body limit, Pino HTTP logging và rate limit.
- [x] Global error handler với response format thống nhất.
- [x] Prisma schema cho users, posts, comments, stories, reels, chat, notifications và pending uploads.
- [x] Firebase Admin initialization qua biến môi trường.
- [x] `GET /health`.
- [x] WebSocket server được gắn vào HTTP server tại `/ws`.
- [x] Bổ sung `.env.example` cho PostgreSQL và Firebase.
- [x] Sinh SQL migration baseline từ Prisma schema để sẵn sàng áp dụng vào database.
- [x] Thêm seed idempotent cho dữ liệu giả lập (user, social graph, post, comment, story, reel và conversation).

### Authentication

- [x] Đăng ký user từ Firebase `idToken`.
- [x] Login đồng bộ Firebase UID với user trong PostgreSQL.
- [x] Refresh proxy thông qua Google Secure Token API.
- [x] Middleware verify Firebase token với `checkRevoked: true`.
- [x] Force logout tất cả thiết bị qua `revokeRefreshTokens`.

### User & social graph

- [x] `GET /v1/users/me`, `GET /v1/users/:id` và cập nhật profile.
- [x] Follow/unfollow với transaction và atomic counter.
- [x] Block/unblock; block tự động gỡ quan hệ follow theo cả hai chiều.
- [x] Danh sách followers/following và tìm kiếm username/full name.
- [x] Gợi ý user để follow theo followers count, loại trừ user đã follow/blocked.
- [x] Đăng ký/xóa FCM device token theo thiết bị.

### Post & comment

- [x] Tạo post từ danh sách media URL đã có sẵn.
- [x] Feed following, explore, danh sách post của user và saved posts.
- [x] Like/unlike, save/unsave, xóa post với kiểm tra tác giả.
- [x] Kiểm tra block/private account khi đọc content.
- [x] Comment, reply một cấp, xóa comment và like/unlike comment.
- [x] Counter cho post/comment được cập nhật bằng transaction và Prisma atomic increment/decrement.

### Realtime

- [x] Xác thực WebSocket bằng Firebase id token.
- [x] Ping/pong heartbeat mỗi 30 giây.
- [x] Quản lý nhiều socket cho một user, gửi message đến toàn bộ thiết bị của user.
- [x] Relay typing indicator và WebRTC call-signaling.
- [x] Broadcast `user_online` cơ bản.
- [x] Presence chỉ gửi đến followers và có debounce offline 30 giây.
- [x] Relay call/typing chỉ cho các user cùng có mặt trong một conversation.

### Upload & media

- [x] `POST /v1/upload/image`, `/video`, `/avatar` với Multer memory storage.
- [x] Validate MIME type và giới hạn 10 MB ảnh, 100 MB video.
- [x] Resize/convert ảnh với Sharp; đọc metadata video và tạo thumbnail với ffmpeg.
- [x] Upload Firebase Storage và tạo `PendingUpload` cho ảnh/video.
- [x] Khi tạo post với `pendingUploadId`, xác thực ownership và confirm upload trong cùng transaction.

### Story, Reel, chat & notifications

- [x] Story create/feed/items/view/delete, tự hết hạn sau 24 giờ.
- [x] Reel create/feed/like/unlike/view.
- [x] Conversation create/list, message list/send/delete, read receipt và mute.
- [x] Notification list/read/read-all/unread-count; bắn WebSocket event cho notification được tạo bởi service.
- [x] Cron job xóa Story hết hạn và PendingUpload mồ côi sau 24 giờ.

## Cần hoàn thiện

### Ưu tiên cao — để chạy được end-to-end

- [x] Tạo `.env.example` đầy đủ cho Firebase/PostgreSQL local.
- [ ] Commit migration Prisma đầu tiên vào `prisma/migrations` và chạy nó trên PostgreSQL local.
- [ ] Cài và kiểm tra PostgreSQL thật; hiện chỉ xác thực schema, chưa chạy migration.
- [x] Có seed data idempotent qua `npm run db:seed` (mục đích là dữ liệu giả lập, không phải clone tài khoản Firebase thật).
- [ ] Viết test cho auth middleware, permission private/block, follow/like idempotency và route responses.
- [x] Hoàn thiện API upload cho image/video/avatar và PendingUpload cho Post.
- [x] Xử lý ảnh với Sharp, video metadata/thumbnail với ffmpeg.

### Tính năng sản phẩm

- [x] Story: create/feed/view tracking/delete và lọc hết hạn.
- [x] Reel: create/feed/view/like.
- [x] Conversations/messages: tạo conversation, kiểm tra membership, gửi/xóa/read/mute qua REST.
- [x] Notifications: list/read/unread count và WebSocket event qua notification service.
- [ ] Tạo notification từ like/comment/follow và gửi FCM push đa thiết bị.
- [ ] User suggestions và avatar endpoint.

### Realtime, security & scale

- [ ] Chỉ broadcast presence tới followers thay vì tất cả user đang kết nối.
- [ ] Thêm offline debounce 30 giây như thiết kế.
- [ ] Xác minh conversation membership trước khi relay WebSocket typing/call.
- [ ] Zod schema cho WebSocket payload; chống malformed/oversized messages.
- [ ] Cursor pagination thay cho offset ở feed lớn.
- [ ] Tạo `pg_trgm` migration và chuyển search sang `similarity()` khi dữ liệu tăng.
- [ ] Tách rate-limit store, presence và WebSocket pub/sub sang Redis khi chạy nhiều instance.

### Vận hành

- [ ] Implement cron expire stories và cleanup orphaned uploads.
- [ ] Graceful shutdown đầy đủ (đóng WebSocket, ngừng jobs trước khi disconnect DB).
- [ ] Docker compose app + PostgreSQL được kiểm tra trong môi trường local.
- [ ] CI chạy `npm run build`, Prisma validate và test.
- [ ] Structured audit logging, metrics và error tracking.

## Khác biệt cần lưu ý với thiết kế

1. `POST /v1/posts` nhận JSON `media[]` sau khi client upload tại `/v1/upload/*`;
   dùng `pendingUploadId` để xác nhận ownership. Không upload multipart trực tiếp vào endpoint post.
2. WebSocket relay signaling/typing có kiểm tra conversation chung, nhưng chưa
   có Zod validation chi tiết hoặc giới hạn payload riêng.
3. Presence chỉ gửi tới followers; state hiện ở memory nên chỉ phù hợp một instance.
4. Story/Reel/Conversation/Notification đã có route/service REST nhưng chưa có
   test end-to-end và một số side-effect domain (notification/push) còn thiếu.

## Kiểm tra gần nhất

Đã chạy thành công:

```bash
npm run build
npx prisma validate
```

## Bước tiếp theo đề xuất

1. Commit/apply migration đầu tiên trên PostgreSQL local, sau đó chạy `npm run db:seed`.
2. Bổ sung Zod schema, message-size limit, Redis adapter và cursor pagination cho realtime/scale.
3. Bổ sung test integration cho upload, authorization và message flow; cấu hình CI.
