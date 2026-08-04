# Instagram Backend

Backend API cho Instagram Clone iOS app.

**Tech stack:** Node.js 20 · Express · TypeScript · PostgreSQL · Prisma · Firebase Auth · Firebase Storage · WebSocket

## Yêu cầu

- Node.js 20+
- Docker Desktop (PostgreSQL local)
- Firebase project ([Firebase Console](https://console.firebase.google.com))

## Quick Start

```bash
# 1. Cài dependencies
npm install

# 2. Copy env
cp .env.example .env
# Sửa .env với Firebase credentials

# 3. Start PostgreSQL
docker compose up -d postgres

# 4. Chạy migration
npm run db:migrate

# 5. Start dev server
npm run dev
```

Server chạy tại `http://localhost:3000`

- Health check: `GET /health`
- API base: `/v1`

## Scripts

| Command | Mô tả |
|---------|-------|
| `npm run dev` | Dev server với hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Chạy production build |
| `npm run db:migrate` | Prisma migrate |
| `npm run db:studio` | Prisma Studio (DB browser) |
| `npm run db:seed` | Seed test data |
| `npm test` | Chạy tests |

## Cấu trúc thư mục

```
src/
├── config/       # env, firebase, database
├── middleware/   # auth, validation, rate limit, errors
├── routes/       # Express route handlers
├── services/     # Business logic
├── websocket/    # WebSocket handlers (Phase 3)
├── jobs/         # Cron jobs (Phase 4)
├── schemas/      # Zod validation schemas
└── utils/        # Helpers
```

## API Endpoints (hiện tại)

### Auth (`/v1/auth`)

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | `/register` | — | Đăng ký user mới |
| POST | `/login` | — | Đăng nhập |
| POST | `/refresh` | — | Refresh Firebase token |
| POST | `/logout-all-devices` | ✓ | Revoke tất cả sessions |
| POST | `/change-password` | ✓ | Hướng dẫn đổi password qua Firebase SDK |

## Kết nối iOS Client

Trong Xcode scheme, set environment variables:

```
APP_BASE_URL=http://localhost:3000
API_MODE=live
APP_ENVIRONMENT=dev
```

## Roadmap

- [x] Phase 0: Scaffold + Docker + Prisma
- [ ] Phase 1: Auth + User + Follow
- [ ] Phase 2: Posts + Comments + Upload
- [ ] Phase 3: WebSocket + Chat
- [ ] Phase 4: Stories + Reels + Push
- [ ] Phase 5: Polish + Tests

Xem thiết kế chi tiết tại repo iOS: `Documentations/BACKEND_SYSTEM_DESIGN.md`

## License

MIT
