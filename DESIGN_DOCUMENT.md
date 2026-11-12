# INSTAGRAM CLONE - PRODUCTION-GRADE BACKEND DESIGN DOCUMENT

**Version:** 1.0  
**Last Updated:** 2026-11-11  
**Author:** Backend Architecture Team  
**Status:** Draft - Pending Security Review

---

## TABLE OF CONTENTS

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Database Schema](#3-database-schema)
4. [API Design](#4-api-design)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Core Feature Logic](#6-core-feature-logic)
7. [Real-Time Infrastructure](#7-real-time-infrastructure)
8. [Media Handling](#8-media-handling)
9. [Search & Discovery](#9-search--discovery)
10. [Observability & Operations](#10-observability--operations)
11. [Deployment & Migrations](#11-deployment--migrations)
12. [Implementation Roadmap](#12-implementation-roadmap)
13. [Key Design Decisions & Trade-offs](#13-key-design-decisions--trade-offs)
14. [Security Checklist](#14-security-checklist)

---

## 1. ARCHITECTURE OVERVIEW

### 1.1 System Context

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        INSTAGRAM CLONE BACKEND                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐            │
│  │  iOS App │    │  Web App │    │  Admin   │    │ 3rd Party│            │
│  │  (Swift) │    │  (React) │    │  Dashboard│   │  Clients │            │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘            │
│       │               │               │               │                   │
│       └───────────────┼───────────────┼───────────────┘                   │
│                       ▼                                               │
│              ┌─────────────────┐                                      │
│              │   API Gateway   │  (Hono on Neon Functions)           │
│              │   (Kong/Envoy)  │  Rate Limit, Auth, Routing, CORS   │
│              └────────┬────────┘                                      │
│                       │                                               │
│        ┌──────────────┼──────────────┐                               │
│        ▼              ▼              ▼                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  REST    │  │WebSocket │  │  GraphQL │  │  Media   │            │
│  │  API     │  │  Server  │  │  (Opt)   │  │  Upload  │            │
│  │  /v1/*   │  │  /ws/*   │  │  /graphql│  │  /upload │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │             │             │             │                   │
│       └─────────────┼─────────────┼─────────────┘                   │
│                     ▼                                             │
│         ┌───────────────────────┐                                 │
│         │   Service Layer       │  (Domain Services)              │
│         │  ┌─────┐ ┌─────┐ ┌───┐│                                 │
│         │  │Post │ │Story│ │DM ││  ...                           │
│         │  │Svc  │ │Svc  │ │Svc││                                 │
│         │  └─────┘ └─────┘ └───┘│                                 │
│         └───────────┬───────────┘                                 │
│                     │                                             │
│         ┌───────────┴───────────┐                                 │
│         │   Data Access Layer   │  (Drizzle ORM + Prisma)         │
│         │  ┌─────────────────┐  │                                 │
│         │  │  PostgreSQL     │  │  (Neon Lakebase - Branchable)  │
│         │  │  + RLS Policies │  │                                 │
│         │  └─────────────────┘  │                                 │
│         └───────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Runtime | Node.js 22+ (Neon Functions) | Long-running, serverless, auto-scale |
| Framework | Hono 4.x | Fast, lightweight, typed, Edge-compatible |
| Database | Neon (Lakebase PostgreSQL) | Branchable, serverless, RLS, instant PITR |
| ORM | Drizzle ORM (primary) + Prisma (migrations) | Type-safe, performant, SQL-like |
| Auth | Better Auth (Neon Managed) | Session management, OAuth, MFA, plugins |
| Real-time | Neon Realtime + WebSocket (ws library) | Live queries, chat, presence, typing |
| Media | Neon Object Storage (S3-compatible) + TUS | Resumable uploads, CDN, branchable |
| Search | Lakebase Search (pgvector + BM25) | Hybrid semantic + lexical search |
| Observability | Neon Logs (Loki) + OpenTelemetry | Structured logging, tracing, metrics |
| Validation | Zod 3.x | Runtime + compile-time validation |
| Testing | Vitest + Playwright + Pact | Unit, integration, contract, E2E |

### 1.3 Non-Functional Requirements

| Requirement | Target | Measurement |
|-------------|--------|-------------|
| API p95 latency | < 200ms | Neon Logs + OpenTelemetry |
| Feed p95 | < 150ms | Cursor pagination + materialized views |
| WebSocket connect | < 100ms | Connection pooling, keep-alive |
| Media upload | Resumable, >100MB | TUS protocol, multipart fallback |
| Availability | 99.9% | Neon SLA + multi-AZ |
| RPO/RTO | < 1min / < 5min | Neon instant restore + branching |
| Rate limit | Tiered (see §4.3) | Headers: X-RateLimit-* |
| Audit retention | 7 years | Immutable audit log table |

---

## 2. DATABASE SCHEMA (ENHANCED)

### 2.1 Core Tables with RLS Policies

```sql
-- ============================================================
-- USERS & AUTH (Better Auth managed + custom extensions)
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        CITEXT NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9._]{1,30}$'),
    email           CITEXT NOT NULL UNIQUE,
    phone           VARCHAR(20) UNIQUE,
    password_hash   TEXT NOT NULL,  -- Argon2id via Better Auth
    full_name       VARCHAR(100),
    bio             TEXT DEFAULT '' CHECK (char_length(bio) <= 150),
    website         VARCHAR(200),
    avatar_url      TEXT,
    avatar_thumb_url TEXT,
    is_verified     BOOLEAN DEFAULT FALSE,
    is_private      BOOLEAN DEFAULT FALSE,
    is_business     BOOLEAN DEFAULT FALSE,
    business_category VARCHAR(50),
    -- Counters (denormalized for performance)
    posts_count     INT DEFAULT 0,
    followers_count INT DEFAULT 0,
    following_count INT DEFAULT 0,
    reels_count     INT DEFAULT 0,
    -- Settings (JSONB for flexibility)
    settings        JSONB DEFAULT '{
        "language": "en",
        "dark_mode": false,
        "push_enabled": true,
        "biometric_enabled": true,
        "story_controls": {"allow_replies": "followers", "allow_sharing": true},
        "comment_controls": {"allow_comments_from": "everyone", "block_keywords": []},
        "privacy": {"activity_status": true, "read_receipts": true}
    }'::jsonb,
    -- Security
    last_login_at   TIMESTAMPTZ,
    failed_login_attempts INT DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    -- Metadata
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- RLS: Users can only see public profile or private if following/approved
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select_policy ON users
    FOR SELECT USING (
        NOT is_private 
        OR id = current_user_id()
        OR EXISTS (SELECT 1 FROM follows WHERE follower_id = current_user_id() AND following_id = users.id AND status = 'accepted')
    );

-- ============================================================
-- FOLLOWS (with status for private accounts)
-- ============================================================
CREATE TABLE follows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          VARCHAR(20) DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (follower_id, following_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id) WHERE status = 'accepted';
CREATE INDEX idx_follows_following ON follows(following_id) WHERE status = 'accepted';
CREATE INDEX idx_follows_pending ON follows(following_id) WHERE status = 'pending';

-- RLS: Users see their own follows + followers (if public or approved)
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY follows_select_policy ON follows
    FOR SELECT USING (
        follower_id = current_user_id()
        OR following_id = current_user_id()
        OR (status = 'accepted' AND (
            SELECT is_private FROM users WHERE id = follows.follower_id
        ) = FALSE)
    );

-- ============================================================
-- POSTS (with full-text search vector)
-- ============================================================
CREATE TABLE posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caption         TEXT,
    location_id     UUID REFERENCES locations(id),
    location_name   VARCHAR(200),
    location_lat    DECIMAL(10, 8),
    location_lng    DECIMAL(11, 8),
    is_sponsored    BOOLEAN DEFAULT FALSE,
    sponsor_user_id UUID REFERENCES users(id),
    -- Denormalized counters
    likes_count     INT DEFAULT 0,
    comments_count  INT DEFAULT 0,
    shares_count    INT DEFAULT 0,
    saves_count     INT DEFAULT 0,
    views_count     INT DEFAULT 0,
    -- Search vector (updated by trigger)
    search_vector   TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', COALESCE(caption, '') || ' ' || COALESCE(location_name, ''))
    ) STORED,
    -- Visibility
    audience        VARCHAR(20) DEFAULT 'public' CHECK (audience IN ('public', 'followers', 'close_friends')),
    close_friends_only BOOLEAN DEFAULT FALSE,
    -- Metadata
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ
);

CREATE INDEX idx_posts_author_created ON posts(author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_posts_search ON posts USING GIN(search_vector);
CREATE INDEX idx_posts_location ON posts USING GIST (ll_to_earth(location_lat, location_lng)) WHERE location_lat IS NOT NULL;

-- RLS: Complex visibility logic
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY posts_select_policy ON posts
    FOR SELECT USING (
        deleted_at IS NULL
        AND (
            author_id = current_user_id()
            OR audience = 'public'
            OR (audience = 'followers' AND EXISTS (
                SELECT 1 FROM follows 
                WHERE follower_id = current_user_id() 
                AND following_id = posts.author_id 
                AND status = 'accepted'
            ))
            OR (close_friends_only AND EXISTS (
                SELECT 1 FROM close_friends 
                WHERE user_id = posts.author_id 
                AND friend_id = current_user_id()
            ))
        )
    );

-- ============================================================
-- MEDIA ITEMS (polymorphic: posts, stories, reels, messages)
-- ============================================================
CREATE TABLE media_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Polymorphic association
    mediaable_type  VARCHAR(20) NOT NULL CHECK (mediaable_type IN ('post', 'story', 'reel', 'message', 'profile')),
    mediaable_id    UUID NOT NULL,
    url             TEXT NOT NULL,
    thumbnail_url   TEXT,
    type            VARCHAR(10) NOT NULL CHECK (type IN ('IMAGE', 'VIDEO', 'CAROUSEL', 'AUDIO')),
    width           INT,
    height          INT,
    duration        DECIMAL(8, 3), -- seconds for video/audio
    sort_order      INT DEFAULT 0,
    -- Processing status
    processing_status VARCHAR(20) DEFAULT 'completed' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    processing_error TEXT,
    -- Metadata (EXIF, color profile, etc.)
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_media_items_polymorphic ON media_items(mediaable_type, mediaable_id, sort_order);
CREATE INDEX idx_media_items_processing ON media_items(processing_status) WHERE processing_status IN ('pending', 'processing');

-- ============================================================
-- STORIES (24h expiry, close friends support)
-- ============================================================
CREATE TABLE stories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    audience        VARCHAR(20) DEFAULT 'followers' CHECK (audience IN ('followers', 'close_friends')),
    expires_at      TIMESTAMPTZ NOT NULL,
    views_count     INT DEFAULT 0,
    replies_count   INT DEFAULT 0,
    -- Reel/share cross-posting
    reel_id         UUID REFERENCES reels(id),
    shared_from_post_id UUID REFERENCES posts(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_stories_author_expires ON stories(author_id, expires_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_stories_expires ON stories(expires_at) WHERE deleted_at IS NULL AND expires_at > NOW();

-- Story Items (multiple per story)
CREATE TABLE story_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    media_url       TEXT NOT NULL,
    thumbnail_url   TEXT,
    type            VARCHAR(10) NOT NULL CHECK (type IN ('IMAGE', 'VIDEO')),
    duration        DECIMAL(6, 3) DEFAULT 5,
    sort_order      INT DEFAULT 0,
    -- Interactive stickers
    sticker_type    VARCHAR(30), -- poll, quiz, question, location, mention, hashtag, link, countdown
    sticker_data    JSONB, -- {"question": "...", "options": ["A","B"], "correct": 0}
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_story_items_story ON story_items(story_id, sort_order);

-- Story Views (for seen-by list)
CREATE TABLE story_views (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (story_id, viewer_id)
);

-- Story Replies (DMs initiated from story)
CREATE TABLE story_replies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- REELS (TikTok-style short video)
-- ============================================================
CREATE TABLE reels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_url       TEXT NOT NULL,
    thumbnail_url   TEXT,
    caption         TEXT,
    audio_id        UUID REFERENCES audio_tracks(id),
    audio_name      VARCHAR(200),
    audio_artist    VARCHAR(200),
    is_original_audio BOOLEAN DEFAULT TRUE,
    duration        DECIMAL(8, 3) NOT NULL,
    -- Denormalized
    likes_count     INT DEFAULT 0,
    comments_count  INT DEFAULT 0,
    shares_count    INT DEFAULT 0,
    saves_count     INT DEFAULT 0,
    views_count     INT DEFAULT 0,
    plays_count     INT DEFAULT 0,
    -- Visibility
    audience        VARCHAR(20) DEFAULT 'public' CHECK (audience IN ('public', 'followers')),
    allow_remix     BOOLEAN DEFAULT TRUE,
    allow_download  BOOLEAN DEFAULT FALSE,
    search_vector   TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', COALESCE(caption, ''))) STORED,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_reels_author_created ON reels(author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_reels_explore ON reels(created_at DESC) WHERE deleted_at IS NULL AND audience = 'public' AND plays_count > 100;
CREATE INDEX idx_reels_search ON reels USING GIN(search_vector);

-- Audio Tracks (for Reels)
CREATE TABLE audio_tracks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    artist          VARCHAR(200),
    audio_url       TEXT NOT NULL,
    duration        DECIMAL(8, 3),
    waveform_data   JSONB, -- peaks for visualization
    is_licensed     BOOLEAN DEFAULT FALSE,
    usage_count     INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- COMMENTS (polymorphic: posts, reels, stories)
-- ============================================================
CREATE TABLE comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Polymorphic
    commentable_type VARCHAR(20) NOT NULL CHECK (commentable_type IN ('post', 'reel', 'story')),
    commentable_id   UUID NOT NULL,
    author_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id        UUID REFERENCES comments(id) ON DELETE CASCADE,
    text             TEXT NOT NULL CHECK (char_length(text) <= 2000),
    -- Denormalized
    likes_count      INT DEFAULT 0,
    replies_count    INT DEFAULT 0,
    -- Moderation
    is_hidden        BOOLEAN DEFAULT FALSE,
    hidden_reason    VARCHAR(50), -- spam, harassment, hate_speech, etc.
    hidden_by        UUID REFERENCES users(id),
    hidden_at        TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ
);

CREATE INDEX idx_comments_thread ON comments(commentable_type, commentable_id, parent_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_author ON comments(author_id, created_at DESC);

-- RLS: Visible if parent content is visible + not hidden (unless author/mod)
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY comments_select_policy ON comments
    FOR SELECT USING (
        deleted_at IS NULL
        AND (is_hidden = FALSE OR author_id = current_user_id() OR has_role('moderator'))
    );

-- ============================================================
-- LIKES (polymorphic)
-- ============================================================
CREATE TABLE likes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    likeable_type   VARCHAR(20) NOT NULL CHECK (likeable_type IN ('post', 'reel', 'comment', 'story')),
    likeable_id     UUID NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, likeable_type, likeable_id)
);

CREATE INDEX idx_likes_likeable ON likes(likeable_type, likeable_id);
CREATE INDEX idx_likes_user ON likes(user_id, created_at DESC);

-- ============================================================
-- SAVES / COLLECTIONS
-- ============================================================
CREATE TABLE collections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    is_default      BOOLEAN DEFAULT FALSE,
    cover_media_id  UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE TABLE saved_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection_id   UUID REFERENCES collections(id) ON DELETE SET NULL,
    saveable_type   VARCHAR(20) NOT NULL CHECK (saveable_type IN ('post', 'reel', 'audio')),
    saveable_id     UUID NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, saveable_type, saveable_id)
);

CREATE INDEX idx_saved_items_user ON saved_items(user_id, created_at DESC);

-- ============================================================
-- DIRECT MESSAGES (Conversations + Messages)
-- ============================================================
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_group        BOOLEAN DEFAULT FALSE,
    group_name      VARCHAR(100),
    group_avatar_url TEXT,
    group_owner_id  UUID REFERENCES users(id),
    -- Encryption (E2EE for future)
    encryption_type VARCHAR(20) DEFAULT 'none' CHECK (encryption_type IN ('none', 'e2ee', 'mls')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE conversation_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    is_muted        BOOLEAN DEFAULT FALSE,
    last_read_at    TIMESTAMPTZ,
    last_delivered_at TIMESTAMPTZ,
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    left_at         TIMESTAMPTZ,
    UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_conv_members_user ON conversation_members(user_id) WHERE left_at IS NULL;

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type    VARCHAR(20) NOT NULL CHECK (content_type IN (
        'text', 'image', 'video', 'audio', 'file', 
        'post_share', 'reel_share', 'story_share', 'profile_share',
        'location', 'contact', 'voice', 'reply', 'system'
    )),
    text_content    TEXT,
    media_url       TEXT,
    media_thumbnail TEXT,
    media_duration  DECIMAL(8, 3),
    media_metadata  JSONB DEFAULT '{}'::jsonb,
    -- Reactions
    reaction_emoji  VARCHAR(10), -- single emoji reaction
    -- Threading
    reply_to_id     UUID REFERENCES messages(id),
    -- Status
    status          VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
    -- Ephemeral (vanish mode)
    is_ephemeral    BOOLEAN DEFAULT FALSE,
    expires_at      TIMESTAMPTZ,
    -- Edit/Unsend
    is_edited       BOOLEAN DEFAULT FALSE,
    edited_at       TIMESTAMPTZ,
    is_unsent       BOOLEAN DEFAULT FALSE,
    unsent_at       TIMESTAMPTZ,
    unsent_for_everyone BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_messages_conv_created ON messages(conversation_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_messages_sender ON messages(sender_id, created_at DESC);
CREATE INDEX idx_messages_reply ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Message Reactions (multiple per message)
CREATE TABLE message_reactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji           VARCHAR(10) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (message_id, user_id, emoji)
);

-- ============================================================
-- NOTIFICATIONS (Unified feed)
-- ============================================================
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL CHECK (type IN (
        'like', 'comment', 'follow', 'follow_request', 'follow_accept',
        'mention', 'tagged_in_post', 'tagged_in_comment', 'tagged_in_story',
        'story_mention', 'story_reply', 'reel_like', 'reel_comment',
        'live_video', 'live_join', 'dm_message', 'dm_reaction',
        'post_reminder', 'achievement', 'security_alert', 'feature_announcement'
    )),
    -- Reference objects (polymorphic)
    reference_type  VARCHAR(20),
    reference_id    UUID,
    -- Content preview
    preview_text    TEXT,
    thumbnail_url   TEXT,
    -- Deep link for navigation
    deep_link       TEXT,
    -- Grouping
    group_key       VARCHAR(100), -- e.g., "like:post:uuid" for aggregation
    group_count     INT DEFAULT 1,
    is_read         BOOLEAN DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, created_at DESC) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_group ON notifications(recipient_id, group_key, created_at DESC);

-- ============================================================
-- BLOCKS & RESTRICTIONS
-- ============================================================
CREATE TABLE blocks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Block effects
    block_profile   BOOLEAN DEFAULT TRUE,    -- Can't view profile
    block_content   BOOLEAN DEFAULT TRUE,    -- Can't see posts/stories/reels
    block_dm        BOOLEAN DEFAULT TRUE,    -- Can't DM
    block_comments  BOOLEAN DEFAULT TRUE,    -- Comments hidden
    block_mentions  BOOLEAN DEFAULT TRUE,    -- Can't mention
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);

-- Restricted accounts (soft block - comments hidden, DMs to requests)
CREATE TABLE restrictions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restrictor_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    restricted_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hide_comments   BOOLEAN DEFAULT TRUE,
    dm_to_requests  BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (restrictor_id, restricted_id)
);

-- ============================================================
-- CLOSE FRIENDS
-- ============================================================
CREATE TABLE close_friends (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, friend_id)
);

CREATE INDEX idx_close_friends_user ON close_friends(user_id);
CREATE INDEX idx_close_friends_friend ON close_friends(friend_id);

-- ============================================================
-- REPORTS & MODERATION
-- ============================================================
CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_type   VARCHAR(20) NOT NULL CHECK (reported_type IN ('user', 'post', 'reel', 'story', 'comment', 'message', 'audio')),
    reported_id     UUID NOT NULL,
    reason          VARCHAR(50) NOT NULL CHECK (reason IN (
        'spam', 'hate_speech', 'harassment', 'violence', 'nudity',
        'self_harm', 'misinformation', 'scam', 'impersonation', 'copyright', 'other'
    )),
    description     TEXT,
    status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')),
    resolution      VARCHAR(50), -- content_removed, account_warned, account_suspended, no_violation
    resolved_by     UUID REFERENCES users(id),
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_reported ON reports(reported_type, reported_id);
CREATE INDEX idx_reports_status ON reports(status, created_at);

-- Moderation Actions Log
CREATE TABLE moderation_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moderator_id    UUID NOT NULL REFERENCES users(id),
    target_type     VARCHAR(20) NOT NULL,
    target_id       UUID NOT NULL,
    action          VARCHAR(50) NOT NULL CHECK (action IN (
        'warn', 'content_remove', 'content_hide', 'account_suspend', 
        'account_ban', 'feature_restrict', 'shadowban', 'restore'
    )),
    reason          TEXT,
    duration        INTERVAL, -- for temporary actions
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DEVICE TOKENS (Push Notifications - APNs/FCM)
-- ============================================================
CREATE TABLE device_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,
    platform        VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    device_id       VARCHAR(200), -- hardware identifier
    app_version     VARCHAR(20),
    os_version      VARCHAR(20),
    -- APNs/FCM specific
    voip_token      TEXT, -- for VoIP push
    sandbox         BOOLEAN DEFAULT FALSE, -- APNs sandbox
    topics          TEXT[], -- subscribed topics
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_device_tokens_user ON device_tokens(user_id, is_active) WHERE is_active = TRUE;

-- ============================================================
-- SEARCH & DISCOVERY
-- ============================================================
CREATE TABLE search_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query           TEXT NOT NULL,
    result_type     VARCHAR(20), -- users, posts, reels, audio, hashtags, locations
    result_count    INT,
    clicked_result_id UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_search_history_user ON search_history(user_id, created_at DESC);

-- Hashtags
CREATE TABLE hashtags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag             CITEXT NOT NULL UNIQUE CHECK (tag ~ '^[a-zA-Z0-9_]{1,50}$'),
    posts_count     INT DEFAULT 0,
    reels_count     INT DEFAULT 0,
    is_blocked      BOOLEAN DEFAULT FALSE,
    blocked_reason  VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE hashtag_usages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hashtag_id      UUID NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
    usage_type      VARCHAR(10) NOT NULL CHECK (usage_type IN ('post', 'reel', 'story')),
    usage_id        UUID NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (hashtag_id, usage_type, usage_id)
);

-- Locations (from Foursquare/Google Places or custom)
CREATE TABLE locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     VARCHAR(100), -- Foursquare/Google Place ID
    name            VARCHAR(200) NOT NULL,
    address         TEXT,
    lat             DECIMAL(10, 8),
    lng             DECIMAL(11, 8),
    category        VARCHAR(100),
    posts_count     INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_locations_geo ON locations USING GIST (ll_to_earth(lat, lng));

-- ============================================================
-- LIVE VIDEO (Instagram Live)
-- ============================================================
CREATE TABLE live_videos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    co_host_id      UUID REFERENCES users(id),
    title           VARCHAR(200),
    status          VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'archived')),
    stream_key      UUID DEFAULT gen_random_uuid(), -- for RTMP/SRT ingestion
    playback_url    TEXT, -- HLS/DASH URL
    viewer_count    INT DEFAULT 0,
    peak_viewers    INT DEFAULT 0,
    total_views     INT DEFAULT 0,
    scheduled_at    TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE live_comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_id         UUID NOT NULL REFERENCES live_videos(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text            TEXT NOT NULL CHECK (char_length(text) <= 500),
    is_pinned       BOOLEAN DEFAULT FALSE,
    is_hidden       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOG (Immutable, append-only)
-- ============================================================
CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    event_id        UUID NOT NULL DEFAULT gen_random_uuid(),
    actor_id        UUID REFERENCES users(id), -- NULL for system events
    actor_ip        INET,
    actor_user_agent TEXT,
    action          VARCHAR(100) NOT NULL, -- e.g., 'user.login', 'post.create', 'dm.send'
    resource_type   VARCHAR(50),
    resource_id     UUID,
    -- Changes (JSONB diff)
    old_values      JSONB,
    new_values      JSONB,
    -- Context
    correlation_id  UUID, -- for tracing related events
    session_id      UUID,
    request_id      UUID,
    -- Metadata
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Monthly partitions
CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- ... create monthly partitions

CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX idx_audit_correlation ON audit_logs(correlation_id) WHERE correlation_id IS NOT NULL;

-- ============================================================
-- RATE LIMITING (Sliding window with Redis)
-- ============================================================
CREATE TABLE rate_limit_buckets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier      VARCHAR(200) NOT NULL, -- user_id, IP, or "global"
    endpoint        VARCHAR(100) NOT NULL, -- API path pattern
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    request_count   INT DEFAULT 0,
    limit           INT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (identifier, endpoint, window_start)
);

CREATE INDEX idx_rate_limit_lookup ON rate_limit_buckets(identifier, endpoint, window_end);
```

### 2.2 Materialized Views for Feed Performance

```sql
-- Feed Materialized View (refreshed every 5 min via pg_cron)
CREATE MATERIALIZED VIEW feed_items AS
SELECT 
    p.id AS post_id,
    p.author_id,
    p.caption,
    p.location_name,
    p.location_lat,
    p.location_lng,
    p.likes_count,
    p.comments_count,
    p.created_at,
    u.username,
    u.full_name,
    u.avatar_url,
    u.is_verified,
    mi.url AS media_url,
    mi.type AS media_type,
    mi.width,
    mi.height,
    mi.duration,
    mi.sort_order
FROM posts p
JOIN users u ON u.id = p.author_id
LEFT JOIN LATERAL (
    SELECT * FROM media_items 
    WHERE mediaable_type = 'post' AND mediaable_id = p.id 
    ORDER BY sort_order LIMIT 1
) mi ON TRUE
WHERE p.deleted_at IS NULL 
AND p.audience = 'public'
AND p.created_at > NOW() - INTERVAL '30 days';

CREATE UNIQUE INDEX idx_feed_items_pk ON feed_items(post_id);
CREATE INDEX idx_feed_items_created ON feed_items(created_at DESC);

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_feed_items() RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY feed_items;
END;
$$ LANGUAGE plpgsql;

-- Schedule via pg_cron
SELECT cron.schedule('refresh-feed-5min', '*/5 * * * *', 'SELECT refresh_feed_items();');
```

---

## 3. API DESIGN (REST + WEBSOCKET)

### 3.1 REST API Conventions

| Aspect | Standard |
|--------|----------|
| Versioning | URL path `/v1/` + `Accept-Version` header for breaking changes |
| Format | JSON (`application/json`) + Problem Details (`application/problem+json`) |
| Pagination | Cursor-based (opaque base64 tokens) + `X-Pagination-*` headers |
| Errors | RFC 7807 + custom `extensions.error_code` |
| Rate Limits | Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` |
| Idempotency | `Idempotency-Key` header for mutating operations |
| Request ID | `X-Request-ID` (generated if missing) for tracing |
| Compression | `Accept-Encoding: gzip, br` |
| ETags | For GET endpoints with `If-None-Match` support |

### 3.2 Core Endpoints

```
# AUTHENTICATION
POST   /v1/auth/register              # Email/phone + password
POST   /v1/auth/login                 # Credentials → access + refresh token
POST   /v1/auth/refresh               # Refresh token rotation
POST   /v1/auth/logout                # Revoke refresh token
POST   /v1/auth/forgot-password       # Initiate reset
POST   /v1/auth/reset-password        # Complete reset
POST   /v1/auth/verify-email          # Email verification code
POST   /v1/auth/verify-phone          # SMS verification
GET    /v1/auth/me                    # Current user profile
PATCH  /v1/auth/me                    # Update profile
DELETE /v1/auth/me                    # Delete account (soft)

# OAUTH
GET    /v1/auth/oauth/:provider       # Initiate OAuth (google, apple, facebook)
GET    /v1/auth/oauth/:provider/callback
POST   /v1/auth/link-account          # Link OAuth to existing account
DELETE /v1/auth/unlink-account        # Unlink OAuth

# USERS
GET    /v1/users/:username            # Public profile
GET    /v1/users/:username/posts      # User's posts (paginated)
GET    /v1/users/:username/reels      # User's reels
GET    /v1/users/:username/tagged     # Tagged posts
GET    /v1/users/:username/saved      # Saved posts (own only)
GET    /v1/users/:username/followers  # Followers list
GET    /v1/users/:username/following  # Following list
GET    /v1/users/:username/highlights # Story highlights
POST   /v1/users/:username/follow     # Follow user
DELETE /v1/users/:username/follow     # Unfollow
POST   /v1/users/:username/accept     # Accept follow request
POST   /v1/users/:username/block      # Block user
DELETE /v1/users/:username/block      # Unblock
POST   /v1/users/:username/restrict   # Restrict user
DELETE /v1/users/:username/restrict   # Unrestrict
POST   /v1/users/:username/close-friends  # Add to close friends
DELETE /v1/users/:username/close-friends  # Remove from close friends

# POSTS
GET    /v1/posts/feed                 # Home feed (cursor paginated)
GET    /v1/posts/explore              # Explore page (popular + personalized)
GET    /v1/posts/:id                  # Single post
POST   /v1/posts                      # Create post (multipart or JSON + media IDs)
PATCH  /v1/posts/:id                  # Edit caption/location
DELETE /v1/posts/:id                  # Delete post
POST   /v1/posts/:id/archive          # Archive post
DELETE /v1/posts/:id/archive          # Unarchive
POST   /v1/posts/:id/like             # Like post
DELETE /v1/posts/:id/like             # Unlike post
POST   /v1/posts/:id/save             # Save to collection
DELETE /v1/posts/:id/save             # Unsave
GET    /v1/posts/:id/likes            # List likers
GET    /v1/posts/:id/comments         # Comments (threaded, paginated)
POST   /v1/posts/:id/comments         # Add comment
PATCH  /v1/comments/:id               # Edit comment
DELETE /v1/comments/:id               # Delete comment
POST   /v1/comments/:id/like          # Like comment
DELETE /v1/comments/:id/like          # Unlike comment
POST   /v1/posts/:id/report           # Report post
POST   /v1/comments/:id/report        # Report comment

# REELS
GET    /v1/reels/feed                 # Reels feed (infinite scroll)
GET    /v1/reels/explore              # Reels explore
GET    /v1/reels/:id                  # Single reel
POST   /v1/reels                      # Create reel (TUS upload)
PATCH  /v1/reels/:id                  # Edit caption
DELETE /v1/reels/:id                  # Delete reel
POST   /v1/reels/:id/like             # Like reel
POST   /v1/reels/:id/save             # Save reel
POST   /v1/reels/:id/share            # Share to DM
POST   /v1/reels/:id/remix            # Create remix
GET    /v1/reels/:id/comments         # Comments
POST   /v1/reels/:id/report           # Report

# STORIES
GET    /v1/stories/feed               # Stories tray (from following)
GET    /v1/stories/:userId/items      # User's active stories
POST   /v1/stories                    # Create story (TUS)
POST   /v1/stories/:storyId/view      # Mark viewed
POST   /v1/stories/:storyId/reply     # Reply to story (creates DM)
DELETE /v1/stories/:storyId           # Delete story
GET    /v1/stories/:storyId/views     # Viewers list (author only)
GET    /v1/stories/highlights         # Story highlights
POST   /v1/stories/highlights         # Create highlight
PATCH  /v1/stories/highlights/:id     # Edit highlight
DELETE /v1/stories/highlights/:id     # Delete highlight

# DIRECT MESSAGES
GET    /v1/conversations              # Conversation list (with unread count)
POST   /v1/conversations              # Create DM (or group)
GET    /v1/conversations/:id          # Conversation details
GET    /v1/conversations/:id/messages # Messages (cursor paginated, with sync)
POST   /v1/conversations/:id/messages # Send message
PATCH  /v1/messages/:id               # Edit message
DELETE /v1/messages/:id               # Unsend (for everyone or just me)
POST   /v1/messages/:id/reaction      # Add reaction
DELETE /v1/messages/:id/reaction      # Remove reaction
POST   /v1/conversations/:id/read     # Mark as read
POST   /v1/conversations/:id/mute     # Mute notifications
DELETE /v1/conversations/:id/mute     # Unmute
POST   /v1/conversations/:id/leave    # Leave group
POST   /v1/conversations/:id/block    # Block user in conversation
POST   /v1/conversations/:id/report   # Report conversation

# NOTIFICATIONS
GET    /v1/notifications              # Notification feed (grouped)
PATCH  /v1/notifications/:id/read     # Mark single read
POST   /v1/notifications/read-all     # Mark all read
DELETE /v1/notifications/:id          # Dismiss
GET    /v1/notifications/unread-count # Badge count

# SEARCH & DISCOVER
GET    /v1/search                     # Unified search (q, type=users|posts|reels|audio|hashtags|locations)
GET    /v1/search/suggestions         # Typeahead suggestions
GET    /v1/search/recent              # Recent searches
DELETE /v1/search/recent              # Clear history
GET    /v1/hashtags/:tag              # Hashtag page
GET    /v1/locations/:id              # Location page

# MEDIA UPLOAD (TUS Protocol)
POST   /v1/upload/tus/*               # TUS endpoints (create, patch, head, options)
POST   /v1/upload/multipart           # Fallback multipart (<50MB)
GET    /v1/upload/:id/status          # Processing status
POST   /v1/upload/presigned           # Get S3 presigned URL for direct upload

# SETTINGS
GET    /v1/settings                   # All settings
PATCH  /v1/settings/account           # Account settings
PATCH  /v1/settings/privacy           # Privacy settings
PATCH  /v1/settings/notifications     # Push/email preferences
PATCH  /v1/settings/security          # 2FA, login activity, passwords
GET    /v1/settings/blocked           # Blocked users
GET    /v1/settings/restricted        # Restricted users
GET    /v1/settings/close-friends     # Close friends list
GET    /v1/settings/login-activity    # Active sessions
DELETE /v1/settings/sessions/:id      # Revoke session

# ADMIN / MODERATION (requires role)
GET    /v1/admin/reports              # Pending reports
PATCH  /v1/admin/reports/:id          # Resolve report
POST   /v1/admin/users/:id/action     # Moderation action
GET    /v1/admin/analytics            # Platform metrics
```

### 3.3 WebSocket API (`/ws/v1`)

```typescript
// Connection: Upgrade with Authorization header
// wss://api.instagram-clone.com/ws/v1?token=<access_token>

// Message Format
interface WSMessage<T = any> {
  type: string;           // Event type
  payload: T;             // Event data
  requestId?: string;     // For request-response correlation
  timestamp: string;      // ISO 8601
}

// Client → Server
type ClientMessage =
  | { type: 'ping' }
  | { type: 'subscribe'; channels: string[] }  // e.g., ["conversation:uuid", "notifications"]
  | { type: 'unsubscribe'; channels: string[] }
  | { type: 'message.send'; payload: SendMessagePayload }
  | { type: 'message.read'; conversationId: string; messageId: string }
  | { type: 'message.react'; messageId: string; emoji: string }
  | { type: 'message.typing.start'; conversationId: string }
  | { type: 'message.typing.stop'; conversationId: string }
  | { type: 'presence.update'; status: 'online' | 'away' | 'busy' }
  | { type: 'sync.request'; conversationId: string; lastMessageId?: string };

// Server → Client
type ServerMessage =
  | { type: 'pong' }
  | { type: 'connected'; userId: string; serverTime: string }
  | { type: 'subscribed'; channels: string[] }
  | { type: 'message.new'; payload: Message }
  | { type: 'message.updated'; payload: Message }
  | { type: 'message.deleted'; messageId: string; conversationId: string; forEveryone: boolean }
  | { type: 'message.reaction'; messageId: string; emoji: string; userId: string; count: number }
  | { type: 'typing.start'; userId: string; conversationId: string }
  | { type: 'typing.stop'; userId: string; conversationId: string }
  | { type: 'presence.changed'; userId: string; status: string; lastSeen?: string }
  | { type: 'notification.new'; payload: Notification }
  | { type: 'notification.read'; notificationId: string }
  | { type: 'sync.response'; conversationId: string; messages: Message[]; hasMore: boolean; nextCursor: string }
  | { type: 'live.update'; liveId: string; event: 'started' | 'ended' | 'viewer_count'; data: any }
  | { type: 'error'; code: string; message: string; requestId?: string };

// Channel Naming Convention
// - User-scoped: "user:{userId}" (notifications, presence)
// - Conversation: "conversation:{conversationId}" (messages, typing)
// - Live: "live:{liveId}" (comments, viewer count)
// - Global: "global:announcements" (system broadcasts)
```

---

## 4. AUTHENTICATION & AUTHORIZATION (SECURITY GUARD WALL)

### 4.1 Authentication Architecture (Better Auth + Neon)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATION FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CLIENT                                                        NEON AUTH    │
│  ─────                                                         ─────────    │
│                                                                             │
│  1. POST /auth/login ──────────────────────────►                           │
│     { email, password, deviceId }                                          │
│                                                                             │
│  2. ◄──────────────────────────── { accessToken, refreshToken, user }       │
│     - accessToken: JWT (15 min, EdDSA)                                     │
│     - refreshToken: Opaque (30 days, rotating)                             │
│     - user: { id, username, email, isVerified, ... }                       │
│                                                                             │
│  3. API Requests: Authorization: Bearer <accessToken>                      │
│                                                                             │
│  4. Token Expiry → POST /auth/refresh ──────────►                          │
│     { refreshToken, deviceId }                                             │
│                                                                             │
│  5. ◄──────────────────────────── { accessToken, refreshToken } (NEW)       │
│     - Old refreshToken REVOKED (rotation)                                  │
│     - Reuse detection → revoke ALL sessions                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 JWT Token Structure

```json
// Access Token (JWT) - 15 minutes
{
  "iss": "https://auth.instagram-clone.com",
  "sub": "user-uuid",
  "aud": "instagram-clone-api",
  "exp": 1731340800,
  "iat": 1731340700,
  "jti": "token-uuid",
  "sid": "session-uuid",
  "device_id": "device-uuid",           // For device binding
  "biometric_verified": true,           // If biometric auth used
  "scope": "read write dm upload",      // Permission scopes
  "auth_time": 1731340700,
  "amr": ["pwd", "mfa"]                 // Authentication methods
}

// Refresh Token (Opaque, stored hashed in DB)
{
  "token": "rt_abc123...",              // Client sees this
  "token_hash": "sha256(...)"           // Stored in DB
}
```

### 4.3 Authorization Policy Engine

```typescript
// Policy Definition Language (inspired by OPA/Rego)
interface AuthorizationPolicy {
  resource: string;           // e.g., "posts", "conversations", "users"
  action: string;             // e.g., "read", "create", "update", "delete", "list"
  effect: "allow" | "deny";
  conditions: PolicyCondition[];
  priority: number;           // Higher = evaluated first
}

interface PolicyCondition {
  type: "ownership" | "relationship" | "attribute" | "role" | "custom";
  // ownership: resource.owner_id == user.id
  // relationship: EXISTS follows WHERE follower=user AND following=resource.owner
  // attribute: resource.is_private == false
  // role: user.roles.includes('moderator')
  // custom: SQL expression or function call
}

// Example Policies
const policies: AuthorizationPolicy[] = [
  // Posts
  { resource: "posts", action: "read", effect: "allow", priority: 100,
    conditions: [{ type: "attribute", field: "audience", operator: "eq", value: "public" }] },
  { resource: "posts", action: "read", effect: "allow", priority: 90,
    conditions: [
      { type: "ownership" },
      { type: "relationship", relation: "follows", status: "accepted" }
    ] },
  { resource: "posts", action: "read", effect: "allow", priority: 80,
    conditions: [
      { type: "relationship", relation: "close_friends" }
    ] },
  { resource: "posts", action: "create", effect: "allow", priority: 100,
    conditions: [{ type: "role", roles: ["user"] }] },
  { resource: "posts", action: "update", effect: "allow", priority: 100,
    conditions: [{ type: "ownership" }] },
  { resource: "posts", action: "delete", effect: "allow", priority: 100,
    conditions: [{ type: "ownership" }] },
  
  // Conversations (DMs)
  { resource: "conversations", action: "read", effect: "allow", priority: 100,
    conditions: [{ type: "membership" }] },
  { resource: "conversations", action: "create", effect: "allow", priority: 100,
    conditions: [{ type: "role", roles: ["user"] }] },
  { resource: "messages", action: "read", effect: "allow", priority: 100,
    conditions: [
      { type: "membership", via: "conversation" }
    ] },
  { resource: "messages", action: "update", effect: "allow", priority: 100,
    conditions: [
      { type: "ownership", via: "sender_id" },
      { type: "custom", expression: "NOW() - messages.created_at < INTERVAL '10 minutes'" }
    ] },
  { resource: "messages", action: "delete", effect: "allow", priority: 100,
    conditions: [
      { type: "ownership", via: "sender_id" }
    ] },
  
  // Users
  { resource: "users", action: "read", effect: "allow", priority: 100,
    conditions: [{ type: "attribute", field: "is_private", operator: "eq", value: false }] },
  { resource: "users", action: "read", effect: "allow", priority: 90,
    conditions: [
      { type: "relationship", relation: "follows", direction: "following", status: "accepted" }
    ] },
  { resource: "users", action: "update", effect: "allow", priority: 100,
    conditions: [{ type: "ownership" }] },
  
  // Blocks (DENY takes precedence)
  { resource: "*", action: "*", effect: "deny", priority: 1000,
    conditions: [
      { type: "relationship", relation: "blocks", direction: "blocker" }
    ] },
  { resource: "conversations", action: "*", effect: "deny", priority: 1000,
    conditions: [
      { type: "relationship", relation: "blocks", direction: "either" }
    ] },
];

// Policy Evaluator (runs in middleware)
async function authorize(
  user: UserContext,
  resource: string,
  action: string,
  resourceData?: any
): Promise<AuthorizationResult> {
  const applicable = policies
    .filter(p => p.resource === resource || p.resource === "*")
    .filter(p => p.action === action || p.action === "*")
    .sort((a, b) => b.priority - a.priority);
  
  for (const policy of applicable) {
    const result = await evaluateConditions(policy.conditions, user, resourceData);
    if (result) {
      return { allowed: policy.effect === "allow", policy: policy.resource };
    }
  }
  return { allowed: false, reason: "No matching policy" };
}

// RLS Policy Translation (auto-generated from policies)
function generateRLSPolicies(policies: AuthorizationPolicy[]): string {
  // Generates PostgreSQL RLS policies from policy definitions
  // Ensures database-level enforcement matches application-level
}
```

### 4.4 Rate Limiting Tiers

| Tier | Scope | Limit | Window | Burst | Headers |
|------|-------|-------|--------|-------|---------|
| Anonymous | IP | 60 req | 1 min | 2x | Standard |
| Authenticated | User | 300 req | 1 min | 2x | Standard |
| Authenticated (burst) | User | 900 req | 30 sec | 3x | `X-RateLimit-Burst-Multiplier: 3` |
| Media Upload | User | 50 req | 1 hour | 1x | Standard |
| Auth Endpoints | IP | 10 req | 15 min | 1x | Strict |
| WebSocket | Connection | 100 msg | 1 min | 2x | Custom |
| Search | User | 30 req | 1 min | 2x | Standard |
| Admin | User | 1000 req | 1 min | 5x | Standard |

### 4.5 Security Headers & Hardening

```typescript
// Applied via Hono middleware
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      mediaSrc: ["'self'", "https:", "blob:"],
      connectSrc: ["'self'", "wss:", "https:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: "require-corp",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
  referrerPolicy: "strict-origin-when-cross-origin",
  xContentTypeOptions: "nosniff",
  xFrameOptions: "DENY",
  xXssProtection: "1; mode=block",
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  permissionsPolicy: {
    camera: ["'self'"],
    microphone: ["'self'"],
    geolocation: ["'self'"],
  },
}));

// Input validation on ALL endpoints
app.use('*', zValidator('json', schema, (result, c) => {
  if (!result.success) {
    throw new HTTPException(400, {
      message: "Validation failed",
      cause: result.error.flatten()
    });
  }
}));
```

---

## 5. CORE FEATURE LOGIC

### 5.1 Feed Algorithm (Home Feed)

```typescript
// Feed Ranking Signals (weighted)
interface FeedRankingSignals {
  // Interest signals
  userInterestScore: number;        // ML model: user's historical engagement with author/content type
  contentTypeAffinity: number;      // User prefers reels vs posts vs carousels
  
  // Recency
  timeDecay: number;                // Exponential decay: e^(-λ * hoursSincePost)
  
  // Relationship
  interactionFrequency: number;     // How often user interacts with author
  directInteractions: number;       // DMs, profile visits, shares
  isCloseFriend: boolean;           // Boost for close friends
  
  // Content Quality
  engagementRate: number;           // (likes + comments * 2 + shares * 3 + saves * 4) / impressions
  mediaQualityScore: number;        // Resolution, aspect ratio, caption length
  originalityScore: number;         // Duplicate detection
  
  // Diversity
  authorDiversity: number;          // Prevent same author dominating
  contentTypeDiversity: number;     // Mix of posts, reels, suggested
}

// Feed Generation (per request, cached 30s)
async function generateFeed(userId: string, cursor?: string, limit = 20): Promise<FeedResult> {
  // 1. Get candidate posts (last 7 days from followed + suggested)
  const candidates = await getFeedCandidates(userId, cursor);
  
  // 2. Score each candidate
  const scored = await Promise.all(candidates.map(async (post) => {
    const signals = await computeSignals(userId, post);
    const score = calculateScore(signals);
    return { post, score, signals };
  }));
  
  // 3. Sort by score, apply diversity
  const ranked = applyDiversity(scored.sort((a, b) => b.score - a.score));
  
  // 4. Paginate
  const items = ranked.slice(0, limit + 1);
  const hasMore = items.length > limit;
  const nextCursor = hasMore ? encodeCursor(items[limit - 1]) : null;
  
  return { items: items.slice(0, limit), nextCursor, hasMore };
}

// Explore Feed (Discover)
async function generateExploreFeed(userId: string): Promise<FeedResult> {
  // Collaborative filtering + content-based
  // Sources: liked posts of similar users, trending in network, viral content
}
```

### 5.2 Follow System (Private Account Flow)

```typescript
// Follow States
enum FollowStatus {
  NONE = "none",
  PENDING = "pending",      // Request sent, awaiting approval
  ACCEPTED = "accepted",    // Following
  BLOCKED = "blocked",      // Blocked by target
  RESTRICTED = "restricted" // Soft blocked
}

// Follow Request Logic
async function requestFollow(actorId: string, targetId: string): Promise<FollowResult> {
  const target = await getUser(targetId);
  
  // Check blocks
  if (await isBlocked(actorId, targetId) || await isBlocked(targetId, actorId)) {
    throw new ForbiddenError("Cannot follow this user");
  }
  
  // Check existing relationship
  const existing = await getFollow(actorId, targetId);
  if (existing) {
    if (existing.status === FollowStatus.ACCEPTED) throw new ConflictError("Already following");
    if (existing.status === FollowStatus.PENDING) throw new ConflictError("Request already sent");
    // If blocked/restricted, allow re-request after unblock
  }
  
  if (target.isPrivate) {
    // Create pending request
    await createFollow({ followerId: actorId, followingId: targetId, status: FollowStatus.PENDING });
    await notifyUser(targetId, { type: "follow_request", actorId });
    return { status: FollowStatus.PENDING };
  } else {
    // Direct follow
    await createFollow({ followerId: actorId, followingId: targetId, status: FollowStatus.ACCEPTED });
    await updateCounters(actorId, targetId, +1);
    await notifyUser(targetId, { type: "follow", actorId });
    return { status: FollowStatus.ACCEPTED };
  }
}

// Accept Follow Request
async function acceptFollowRequest(actorId: string, requesterId: string): Promise<void> {
  await updateFollow(requesterId, actorId, { status: FollowStatus.ACCEPTED });
  await updateCounters(requesterId, actorId, +1);
  await notifyUser(requesterId, { type: "follow_accept", actorId });
}
```

### 5.3 Comment Threading (Infinite Depth with Pagination)

```typescript
// Comment Tree Structure (Materialized Path for efficient queries)
interface CommentNode {
  id: string;
  parentId: string | null;
  path: string;           // e.g., "root.123.456.789" for ancestor traversal
  depth: number;          // 0 = top-level, max 10
  author: UserSummary;
  text: string;
  likesCount: number;
  repliesCount: number;
  isLikedByCurrentUser: boolean;
  createdAt: string;
  children?: CommentNode[]; // Only for expanded threads
}

// Fetch Comments (paginated, with thread expansion)
async function getComments(
  commentableId: string,
  commentableType: string,
  options: { cursor?: string; limit?: number; expandDepth?: number } = {}
): Promise<PaginatedComments> {
  const { cursor, limit = 20, expandDepth = 1 } = options;
  
  // 1. Get top-level comments
  let query = db.select().from(comments)
    .where(and(
      eq(comments.commentableId, commentableId),
      eq(comments.commentableType, commentableType),
      isNull(comments.parentId),
      isNull(comments.deletedAt),
      eq(comments.isHidden, false)
    ))
    .orderBy(desc(comments.createdAt))
    .limit(limit + 1);
  
  if (cursor) {
    const decoded = decodeCursor(cursor);
    query = query.where(lt(comments.createdAt, decoded.timestamp));
  }
  
  const topLevel = await query;
  const hasMore = topLevel.length > limit;
  const items = hasMore ? topLevel.slice(0, limit) : topLevel;
  
  // 2. Fetch preview replies for each (first 2 per thread)
  const commentIds = items.map(c => c.id);
  const replies = await getReplyPreviews(commentIds, 2);
  
  // 3. Build tree
  const commentMap = new Map(items.map(c => [c.id, { ...c, children: [] }]));
  for (const reply of replies) {
    const parent = commentMap.get(reply.parentId!);
    if (parent) parent.children.push(reply);
  }
  
  return {
    items: Array.from(commentMap.values()),
    nextCursor: hasMore ? encodeCursor({ timestamp: items[items.length - 1].createdAt }) : null,
    hasMore
  };
}

// Expand Thread (load more replies)
async function expandThread(
  parentId: string,
  cursor?: string,
  limit = 10
): Promise<PaginatedComments> {
  // Similar to getComments but with parentId filter
}
```

### 5.4 Direct Messaging (E2EE Ready)

```typescript
// Message Encryption (Future: MLS - Message Layer Security)
interface EncryptedMessage {
  ciphertext: string;      // Base64 encrypted content
  nonce: string;           // Base64 nonce
  keyId: string;           // Sender's key ID for rotation
  algorithm: "AES-GCM" | "XChaCha20-Poly1305";
}

// Message Sending Flow
async function sendMessage(
  senderId: string,
  conversationId: string,
  payload: SendMessagePayload
): Promise<Message> {
  // 1. Verify membership
  const membership = await getConversationMember(conversationId, senderId);
  if (!membership || membership.leftAt) throw new ForbiddenError("Not a member");
  
  // 2. Check blocks/restrictions
  const otherMembers = await getConversationMembers(conversationId);
  for (const member of otherMembers) {
    if (await isBlocked(senderId, member.userId) || await isBlocked(member.userId, senderId)) {
      throw new ForbiddenError("Cannot message this user");
    }
  }
  
  // 3. Create message
  const message = await db.insert(messages).values({
    conversationId,
    senderId,
    contentType: payload.contentType,
    textContent: payload.text,
    mediaUrl: payload.mediaUrl,
    replyToId: payload.replyToId,
    isEphemeral: payload.isEphemeral,
    expiresAt: payload.isEphemeral ? addMinutes(new Date(), 10) : null,
  }).returning();
  
  // 4. Update conversation timestamp
  await updateConversationTimestamp(conversationId);
  
  // 5. Update unread counts for other members
  await incrementUnreadCounts(conversationId, senderId);
  
  // 6. Broadcast via WebSocket
  await broadcastToConversation(conversationId, {
    type: "message.new",
    payload: serializeMessage(message[0])
  });
  
  // 7. Send push notifications to offline members
  await sendPushNotifications(conversationId, senderId, message[0]);
  
  return message[0];
}

// Message Sync (Reconnection Catch-up)
async function syncMessages(
  userId: string,
  conversationId: string,
  lastMessageId?: string,
  lastReadAt?: string
): Promise<SyncResponse> {
  // Verify membership
  await assertConversationMember(conversationId, userId);
  
  // Build query
  let query = db.select().from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      isNull(messages.deletedAt),
      eq(messages.isUnsent, false)
    ))
    .orderBy(desc(messages.createdAt))
    .limit(50);
  
  if (lastMessageId) {
    const lastMsg = await getMessage(lastMessageId);
    query = query.where(lt(messages.createdAt, lastMsg.createdAt));
  }
  
  const messages = await query;
  
  // Mark as delivered
  await updateLastDelivered(conversationId, userId, messages[0]?.id);
  
  return {
    messages: messages.reverse(), // Chronological
    hasMore: messages.length === 50,
    nextCursor: messages.length === 50 ? messages[messages.length - 1].id : null
  };
}
```

### 5.5 Media Upload (TUS + Processing Pipeline)

```typescript
// Upload Flow
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MEDIA UPLOAD PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CLIENT                          API                          WORKERS       │
│  ─────                          ───                          ──────       │
│                                                                             │
│  1. POST /upload/tus/ ─────────► Create upload URL (TUS)                    │
│     Tus-Resumable: 1.0.0                                                   │
│     Upload-Length: 52428800                                                │
│     Upload-Metadata: filename, type, checksum                              │
│                                                                             │
│  2. ◄────────────────────────── { location: "/upload/tus/abc123" }         │
│                                                                             │
│  3. PATCH /upload/tus/abc123 ──► Stream chunks (resumable)                 │
│     Offset: 0                                                               │
│     Upload-Offset: 1048576                                                 │
│     ... (repeat until complete)                                            │
│                                                                             │
│  4. ◄────────────────────────── 204 No Content (Upload complete)           │
│                                                                             │
│  5. POST /upload/process ──────► Queue processing job                      │
│     { uploadId: "abc123", mediaType: "reel", options: {...} }              │
│                                                                             │
│  6. Worker picks job ──►                                                    │
│     - Download from Object Storage                                         │
│     - Virus scan (ClamAV)                                                  │
│     - Transcode (FFmpeg: H.264/HEVC, multiple bitrates)                    │
│     - Generate thumbnails (multiple sizes)                                 │
│     - Extract metadata (EXIF, duration, waveform)                          │
│     - Perceptual hashing (pHash for duplicate detection)                   │
│     - NSFW detection (TensorFlow Lite)                                     │
│     - Upload processed variants to Object Storage                          │
│     - Update media_items record                                            │
│                                                                             │
│  7. ◄────────────────────────── WebSocket: processing.complete             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

// TUS Endpoint Implementation
const tusHandler = tus()
  .datastore(new S3Datastore({ bucket: "uploads", prefix: "tus/" }))
  .maxSize(500 * 1024 * 1024) // 500MB
  .onUploadComplete(async (file) => {
    await queueProcessingJob({
      uploadId: file.id,
      originalUrl: file.url,
      metadata: file.metadata
    });
  });

// Processing Job (BullMQ/Neon Functions)
interface ProcessingJob {
  uploadId: string;
  mediaType: "post" | "reel" | "story" | "dm" | "profile";
  options: {
    generateThumbnails: boolean;
    transcodeVideo: boolean;
    bitrates: number[]; // [1080p, 720p, 480p]
    extractWaveform: boolean;
    nsfwCheck: boolean;
  };
}
```

---

## 6. REAL-TIME INFRASTRUCTURE

### 6.1 WebSocket Server Architecture

```typescript
// Neon Functions WebSocket Server
// src/websocket/index.ts

import { Hono } from "hono";
import { upgradeWebSocket, WebSocket } from "hono/ws";
import { authMiddleware } from "../middleware/auth";

const wsApp = new Hono();

// Connection Manager
class ConnectionManager {
  private connections = new Map<string, Set<WebSocket>>(); // userId -> connections
  private subscriptions = new Map<WebSocket, Set<string>>(); // ws -> channels
  private presence = new Map<string, { status: string; lastSeen: Date }>(); // userId -> presence
  
  addConnection(userId: string, ws: WebSocket) {
    if (!this.connections.has(userId)) this.connections.set(userId, new Set());
    this.connections.get(userId)!.add(ws);
    this.subscriptions.set(ws, new Set());
    this.updatePresence(userId, "online");
  }
  
  removeConnection(userId: string, ws: WebSocket) {
    this.connections.get(userId)?.delete(ws);
    this.subscriptions.delete(ws);
    if (this.connections.get(userId)?.size === 0) {
      this.connections.delete(userId);
      this.updatePresence(userId, "offline", new Date());
    }
  }
  
  subscribe(ws: WebSocket, channels: string[]) {
    const subs = this.subscriptions.get(ws);
    for (const ch of channels) subs.add(ch);
  }
  
  broadcast(channel: string, message: any, exclude?: WebSocket) {
    for (const [ws, subs] of this.subscriptions) {
      if (ws !== exclude && subs.has(channel) && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  }
  
  broadcastToUser(userId: string, message: any) {
    const conns = this.connections.get(userId);
    if (conns) {
      for (const ws of conns) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      }
    }
  }
  
  async updatePresence(userId: string, status: string, lastSeen?: Date) {
    this.presence.set(userId, { status, lastSeen: lastSeen || new Date() });
    // Persist to DB periodically
    // Broadcast to friends
    const friends = await getFriends(userId);
    for (const friend of friends) {
      this.broadcastToUser(friend.id, {
        type: "presence.changed",
        userId,
        status,
        lastSeen: lastSeen?.toISOString()
      });
    }
  }
}

const manager = new ConnectionManager();

// WebSocket Endpoint
wsApp.get("/ws/v1", authMiddleware, upgradeWebSocket((c) => {
  const user = c.get("user");
  let ws: WebSocket;
  
  return {
    onOpen: (evt, ws) => {
      ws = ws;
      manager.addConnection(user.id, ws);
      ws.send(JSON.stringify({
        type: "connected",
        userId: user.id,
        serverTime: new Date().toISOString()
      }));
      
      // Auto-subscribe to user channels
      manager.subscribe(ws, [
        `user:${user.id}`,           // Notifications, direct messages
        `presence:${user.id}`        // Presence updates
      ]);
    },
    onMessage: async (evt, ws) => {
      try {
        const msg = JSON.parse(evt.data);
        await handleMessage(user.id, ws, msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", code: "INVALID_MESSAGE", message: e.message }));
      }
    },
    onClose: () => manager.removeConnection(user.id, ws),
    onError: (err) => console.error("WS Error:", err)
  };
}));

// Message Handler
async function handleMessage(userId: string, ws: WebSocket, msg: any) {
  switch (msg.type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
      break;
      
    case "subscribe":
      // Validate channel access
      const allowedChannels = msg.channels.filter(ch => canSubscribe(userId, ch));
      manager.subscribe(ws, allowedChannels);
      ws.send(JSON.stringify({ type: "subscribed", channels: allowedChannels }));
      break;
      
    case "message.send":
      const message = await sendMessage(userId, msg.conversationId, msg.payload);
      // Broadcast handled in sendMessage
      break;
      
    case "message.read":
      await markMessagesRead(userId, msg.conversationId, msg.messageId);
      break;
      
    case "message.typing.start":
      manager.broadcast(`conversation:${msg.conversationId}`, {
        type: "typing.start",
        userId,
        conversationId: msg.conversationId
      }, ws);
      break;
      
    case "message.typing.stop":
      manager.broadcast(`conversation:${msg.conversationId}`, {
        type: "typing.stop",
        userId,
        conversationId: msg.conversationId
      }, ws);
      break;
      
    case "presence.update":
      await manager.updatePresence(userId, msg.status);
      break;
      
    case "sync.request":
      const sync = await syncMessages(userId, msg.conversationId, msg.lastMessageId, msg.lastReadAt);
      ws.send(JSON.stringify({ type: "sync.response", ...sync }));
      break;
      
    default:
      ws.send(JSON.stringify({ type: "error", code: "UNKNOWN_TYPE", message: `Unknown type: ${msg.type}` }));
  }
}

// Channel Authorization
function canSubscribe(userId: string, channel: string): boolean {
  if (channel.startsWith("user:")) return channel === `user:${userId}`;
  if (channel.startsWith("conversation:")) {
    const convId = channel.split(":")[1];
    return isConversationMember(userId, convId);
  }
  if (channel.startsWith("live:")) return true; // Public live streams
  if (channel === "global:announcements") return true;
  return false;
}
```

### 6.2 Live Queries (Neon Realtime)

```typescript
// Subscribe to live feed updates
// Client uses @neon/realtime SDK

import { createClient } from "@neon/realtime";

const realtime = createClient({
  url: "wss://realtime.neon.tech",
  token: accessToken
});

// Live feed subscription
const feedSubscription = realtime.subscribe(
  `SELECT * FROM feed_items WHERE created_at > $1 ORDER BY created_at DESC LIMIT 20`,
  [lastFeedItemTimestamp],
  {
    onInsert: (row) => {
      // New post appeared in feed
      feedStore.prepend(row);
    },
    onUpdate: (row) => {
      // Post updated (likes count, etc.)
      feedStore.update(row);
    },
    onDelete: (row) => {
      // Post deleted/hidden
      feedStore.remove(row.id);
    }
  }
);

// Live conversation messages
const messagesSubscription = realtime.subscribe(
  `SELECT * FROM messages WHERE conversation_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`,
  [conversationId],
  {
    onInsert: (row) => chatStore.addMessage(row),
    onUpdate: (row) => chatStore.updateMessage(row),
    onDelete: (row) => chatStore.removeMessage(row.id)
  }
);

// Live notifications
const notificationsSubscription = realtime.subscribe(
  `SELECT * FROM notifications WHERE recipient_id = $1 AND is_read = FALSE ORDER BY created_at DESC LIMIT 20`,
  [userId],
  {
    onInsert: (row) => notificationStore.add(row),
    onUpdate: (row) => notificationStore.update(row)
  }
);
```

---

## 7. CALL / VIDEO CALL SIGNALING (WEBRTCC + WEBSOCKET)

Based on the iOS Realtime Optimization Guide (Cam_nang_iOS_Realtime_Optimization_v2.pdf), this section defines the signaling plane for audio/video calls. **Key principle: WebSocket handles signaling/event plane only; media plane uses WebRTC/SFU via dedicated media servers. Livestream is out of scope for this version.**

### 7.1 Architecture: Media Plane vs Signaling Plane

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CALL / VIDEO CALL ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   SIGNALING PLANE (WebSocket)           MEDIA PLANE (WebRTC/SFU)           │
│   ─────────────────────────────         ──────────────────────────          │
│                                                                             │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐   │
│   │   Caller    │───►│  Signaling  │◄──►│    SFU/     │───►│  Callee  │   │
│   │   (iOS)     │    │  (WebSocket)│    │  Media Srv  │    │  (iOS)   │   │
│   └─────────────┘    └─────────────┘    └─────────────┘    └──────────┘   │
│         │                   │                    │                  ▲      │
│         │  join_room        │  offer/answer      │  RTP/ICE         │      │
│         │  offer/answer     │  ice_candidate     │  SRTP/DTLS       │      │
│         │  ice_candidate    │  mute/unmute       │                  │      │
│         │  mute/unmute      │  switch_camera     │                  │      │
│         │  switch_camera    │  end_call          │                  │      │
│         │  end_call         │                    │                  │      │
│         ▼                   ▼                    ▼                  │      │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                    STATE MACHINE (per connection)                   │  │
│   │  idle → connecting → connected → authenticated/joined → recovering  │  │
│   │                                            → closing/closed          │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                    HEARTBEAT & RECOVERY                             │  │
│   │  Protocol ping/pong: 15-30s interval (keep-alive, half-open detect)│  │
│   │  Application heartbeat: ping/ack with timestamp, session_id        │  │
│   │  Reconnect: exponential backoff + jitter (max 30s, cap 10 attempts)│  │
│   │  Event recovery: sequence/event_id + cursor + server replay/snapshot│  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Database Schema Extensions for Calls

```sql
-- ============================================================
-- CALLS (1:1 and group video/audio calls)
-- ============================================================
CREATE TABLE calls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(20) NOT NULL CHECK (type IN ('audio', 'video', 'group_audio', 'group_video')),
    status          VARCHAR(20) DEFAULT 'initiated' CHECK (status IN (
        'initiated', 'ringing', 'connecting', 'active', 'ended', 'missed', 'declined', 'failed'
    )),
    initiator_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- For group calls
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    -- Call settings
    max_participants INT DEFAULT 2,
    is_recording    BOOLEAN DEFAULT FALSE,
    recording_url   TEXT,
    -- Timing
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    duration_seconds INT DEFAULT 0,
    -- Media server
    media_server_id UUID, -- SFU/media server identifier
    room_id         VARCHAR(100), -- Media server room ID
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calls_initiator ON calls(initiator_id, created_at DESC);
CREATE INDEX idx_calls_conversation ON calls(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX idx_calls_status ON calls(status) WHERE status IN ('initiated', 'ringing', 'connecting', 'active');

-- Call Participants
CREATE TABLE call_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id         UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          VARCHAR(20) DEFAULT 'invited' CHECK (status IN (
        'invited', 'ringing', 'joining', 'connected', 'reconnecting', 'left', 'declined', 'failed'
    )),
    -- Media state
    is_muted        BOOLEAN DEFAULT FALSE,
    is_video_off    BOOLEAN DEFAULT FALSE,
    is_screen_share BOOLEAN DEFAULT FALSE,
    -- Connection quality
    connection_quality VARCHAR(20) CHECK (connection_quality IN ('excellent', 'good', 'poor', 'disconnected')),
    -- Device info
    device_type     VARCHAR(20), -- ios, android, web
    app_version     VARCHAR(20),
    joined_at       TIMESTAMPTZ,
    left_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (call_id, user_id)
);

CREATE INDEX idx_call_participants_call ON call_participants(call_id);
CREATE INDEX idx_call_participants_user ON call_participants(user_id, created_at DESC);

-- Call Signaling Messages (for debugging/recovery)
CREATE TABLE call_signaling_logs (
    id              BIGSERIAL PRIMARY KEY,
    call_id         UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    participant_id  UUID REFERENCES call_participants(id) ON DELETE SET NULL,
    direction       VARCHAR(10) NOT NULL CHECK (direction IN ('sent', 'received')),
    message_type    VARCHAR(50) NOT NULL, -- offer, answer, ice_candidate, mute, etc.
    payload         JSONB NOT NULL,
    sequence_id     BIGINT, -- for ordering/recovery
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_call_signaling_call ON call_signaling_logs(call_id, created_at);
CREATE INDEX idx_call_signaling_sequence ON call_signaling_logs(call_id, sequence_id);

-- Note: Livestream (Instagram Live style) is out of scope for this version.
-- Tables for live_streams, live_stream_viewers, live_stream_comments, live_stream_gifts
-- are defined in a separate specification for future implementation.
```

### 7.3 WebSocket Signaling Protocol

```typescript
// WebSocket Connection: wss://api.instagram-clone.com/ws/v1/calls?token=<access_token>

// Message Envelope (from PDF: event_id, sequence, receivedAt for deduplication/recovery)
interface WSEnvelope<T = any> {
  eventId: string;           // UUID v4 for deduplication
  sequence?: number;         // Monotonic sequence for ordering
  timestamp: string;         // ISO 8601 source timestamp
  type: string;              // Event type
  payload: T;
  ackRequired?: boolean;     // Server should acknowledge
  correlationId?: string;    // For request-response correlation
}

// Client → Server: Call Signaling
type CallClientMessage =
  // Connection lifecycle
  | { type: 'call.ping'; timestamp: string }
  | { type: 'call.auth'; token: string }                    // Authenticate after connect
  | { type: 'call.join'; callId: string; roomId: string }   // Join call room
  | { type: 'call.leave'; callId: string; reason?: string }
  | { type: 'call.reconnect'; callId: string; lastSequence: number; cursor?: string } // Recovery
  
  // WebRTC Signaling
  | { type: 'call.offer'; callId: string; sdp: RTCSessionDescriptionInit; to: string }      // to = participant_id
  | { type: 'call.answer'; callId: string; sdp: RTCSessionDescriptionInit; to: string }
  | { type: 'call.ice_candidate'; callId: string; candidate: RTCIceCandidateInit; to: string }
  | { type: 'call.renegotiate'; callId: string; reason: 'add_track' | 'remove_track' | 'restart_ice' }
  
  // Media control
  | { type: 'call.mute'; callId: string; audio: boolean; video: boolean }
  | { type: 'call.switch_camera'; callId: string; facingMode: 'user' | 'environment' }
  | { type: 'call.enable_screen_share'; callId: string; enabled: boolean }
  | { type: 'call.quality'; callId: string; layer: 'high' | 'medium' | 'low' } // Simulcast layer
  
  // Group call management
  | { type: 'call.invite'; callId: string; userIds: string[] }
  | { type: 'call.kick'; callId: string; userId: string; reason?: string }
  | { type: 'call.transfer_host'; callId: string; newHostId: string }

// Server → Client: Call Events
type CallServerMessage =
  // Connection lifecycle
  | { type: 'call.pong'; timestamp: string; serverTime: string }
  | { type: 'call.authenticated'; userId: string; callId?: string; capabilities: CallCapabilities }
  | { type: 'call.joined'; callId: string; participants: CallParticipant[]; roomId: string; iceServers: RTCIceServer[] }
  | { type: 'call.left'; callId: string; userId: string; reason: string }
  | { type: 'call.recovery'; callId: string; events: WSEnvelope[]; snapshot: CallSnapshot }
  | { type: 'call.error'; code: string; message: string; recoverable: boolean; retryAfter?: number }
  
  // WebRTC Signaling
  | { type: 'call.offer'; callId: string; from: string; sdp: RTCSessionDescriptionInit; fromName: string }
  | { type: 'call.answer'; callId: string; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'call.ice_candidate'; callId: string; from: string; candidate: RTCIceCandidateInit }
  | { type: 'call.renegotiate_needed'; callId: string; reason: string }
  
  // Media state changes
  | { type: 'call.participant_muted'; callId: string; userId: string; audio: boolean; video: boolean }
  | { type: 'call.participant_camera'; callId: string; userId: string; facingMode: string }
  | { type: 'call.screen_share'; callId: string; userId: string; enabled: boolean; streamId?: string }
  | { type: 'call.quality_changed'; callId: string; userId: string; layer: string; bandwidth: number }
  
  // Call state
  | { type: 'call.ringing'; callId: string; caller: CallParticipant; calleeIds: string[] }
  | { type: 'call.accepted'; callId: string; by: string }
  | { type: 'call.declined'; callId: string; by: string; reason?: string }
  | { type: 'call.active'; callId: string; startedAt: string }
  | { type: 'call.ended'; callId: string; endedBy: string; duration: number; reason: string }
  | { type: 'call.failed'; callId: string; error: string; recoverable: boolean }
  
  // Participant connection quality
  | { type: 'call.connection_quality'; callId: string; userId: string; quality: 'excellent' | 'good' | 'poor' | 'disconnected'; stats: MediaStats }
  
  // Group events
  | { type: 'call.invited'; callId: string; inviter: string; invitees: string[] }
  | { type: 'call.kicked'; callId: string; kicked: string; by: string; reason?: string }
  | { type: 'call.host_transferred'; callId: string; newHost: string }

interface CallCapabilities {
  maxParticipants: number;
  supportsVideo: boolean;
  supportsScreenShare: boolean;
  supportsRecording: boolean;
  supportsSimulcast: boolean;
  iceServers: RTCIceServer[];
  mediaServerRegion: string;
}

interface CallParticipant {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  connectionQuality: string;
  joinedAt: string;
  isHost: boolean;
}

interface CallSnapshot {
  callId: string;
  status: string;
  participants: CallParticipant[];
  startedAt?: string;
  mediaSettings: { videoCodec: string; audioCodec: string; simulcastLayers: number };
}

interface MediaStats {
  bitrate: number;
  packetLoss: number;
  rtt: number;
  jitter: number;
  fps?: number;
  resolution?: { width: number; height: number };
}
```

### 7.4 Connection State Machine (from PDF)

```typescript
// Connection State Machine (per PDF section 3.2, 5.4)
enum CallConnectionState {
  IDLE = 'idle',                           // No connection
  CONNECTING = 'connecting',               // WebSocket handshake in progress
  CONNECTED = 'connected',                 // WS connected, not yet authenticated
  AUTHENTICATED = 'authenticated',         // Token verified, no room joined
  JOINED = 'joined',                       // Joined call room, ready for signaling
  RECOVERING = 'recovering',               // Reconnecting, fetching missed events
  RECONNECTING = 'reconnecting',           // Actively reconnecting with backoff
  CLOSING = 'closing',                     // Graceful close initiated
  CLOSED = 'closed'                        // Connection closed
}

interface CallConnectionContext {
  state: CallConnectionState;
  generation: number;              // Incremented on each reconnect (for deduplication)
  callId?: string;
  roomId?: string;
  lastSequence: number;            // Last processed event sequence
  lastEventId: string;             // Last processed event ID
  retryAttempt: number;
  maxRetries: number;              // Default: 10
  heartbeatInterval: number;       // Default: 20000ms (20s)
  heartbeatTimeout: number;        // Default: 30000ms (30s)
  pendingAcks: Map<string, NodeJS.Timeout>; // eventId -> timeout
  receiveLoop?: AsyncIterator<WSEnvelope>;
  closeReason?: { code: number; reason: string; recoverable: boolean };
}

// State Transitions (valid only)
const VALID_TRANSITIONS: Record<CallConnectionState, CallConnectionState[]> = {
  [CallConnectionState.IDLE]: [CallConnectionState.CONNECTING],
  [CallConnectionState.CONNECTING]: [CallConnectionState.CONNECTED, CallConnectionState.CLOSED],
  [CallConnectionState.CONNECTED]: [CallConnectionState.AUTHENTICATED, CallConnectionState.CLOSED],
  [CallConnectionState.AUTHENTICATED]: [CallConnectionState.JOINED, CallConnectionState.CLOSED],
  [CallConnectionState.JOINED]: [CallConnectionState.RECOVERING, CallConnectionState.RECONNECTING, CallConnectionState.CLOSING],
  [CallConnectionState.RECOVERING]: [CallConnectionState.JOINED, CallConnectionState.RECONNECTING, CallConnectionState.CLOSED],
  [CallConnectionState.RECONNECTING]: [CallConnectionState.CONNECTED, CallConnectionState.CLOSED],
  [CallConnectionState.CLOSING]: [CallConnectionState.CLOSED],
  [CallConnectionState.CLOSED]: [CallConnectionState.IDLE],
};
```

### 7.5 Optimized Heartbeat & Reconnect (Battery-Aware)

**Design Goal:** Minimize battery impact while maintaining connection reliability. Key principle: **Rely on protocol-level ping/pong (kernel-managed) instead of application heartbeats; adapt intervals based on call state and network conditions.**

```typescript
// Battery-Optimized Heartbeat Configuration
interface HeartbeatConfig {
  // Protocol-level (WebSocket ping/pong) - handled by OS/kernel, minimal battery cost
  protocolPingInterval: number;
  protocolPongTimeout: number;
  
  // Application-level - ONLY during active call, disabled otherwise
  appPingInterval: {
    activeCall: number;      // 30s during active call
    connecting: number;      // 15s during call setup (ICE negotiation)
    idle: number;            // DISABLED - rely on protocol ping only
    background: number;      // DISABLED - use VoIP push for incoming calls
  };
  appPongTimeout: number;
  
  // Load balancer considerations
  lbIdleTimeout: number;     // Typically 60s - protocol ping must be < this
}

// Default configuration (battery-optimized)
const HEARTBEAT_CONFIG: HeartbeatConfig = {
  // Protocol ping/pong - kernel handles this efficiently
  // iOS/macOS: NWConnection handles ping/pong in kernel
  // Android: OkHttp/WebSocket handles in native layer
  protocolPingInterval: 25000,   // 25s - keeps NAT/firewall mappings alive
  protocolPongTimeout: 15000,    // 15s - if no pong, connection is dead
  
  // Application heartbeat - ONLY when needed
  appPingInterval: {
    activeCall: 30000,       // 30s during active call (media quality monitoring)
    connecting: 10000,       // 10s during ICE negotiation (detect failures fast)
    idle: 0,                 // DISABLED - no app heartbeat when not in call
    background: 0,           // DISABLED - VoIP push handles incoming calls
  },
  appPongTimeout: 10000,
  
  lbIdleTimeout: 55000,      // Must be < LB timeout (typically 60s)
};

// Heartbeat Manager - State-aware
class CallHeartbeatManager {
  private config: HeartbeatConfig;
  private callState: CallConnectionState = CallConnectionState.IDLE;
  private appPingTimer?: NodeJS.Timeout;
  private networkType: 'wifi' | 'cellular' | 'unknown' = 'unknown';
  private isBackground = false;
  
  constructor(config: HeartbeatConfig = HEARTBEAT_CONFIG) {
    this.config = config;
  }
  
  // Call when call state changes
  setCallState(state: CallConnectionState) {
    const oldState = this.callState;
    this.callState = state;
    this.updateAppHeartbeat();
    
    // Log state transitions for debugging
    if (oldState !== state) {
      console.log(`[Heartbeat] Call state: ${oldState} → ${state}`);
    }
  }
  
  // Call when app enters background/foreground
  setBackground(background: boolean) {
    this.isBackground = background;
    this.updateAppHeartbeat();
  }
  
  // Call when network changes (via NWPathMonitor or equivalent)
  setNetworkType(type: 'wifi' | 'cellular' | 'unknown') {
    this.networkType = type;
    // On cellular, slightly more aggressive to detect handover failures
    if (type === 'cellular' && this.callState === CallConnectionState.JOINED) {
      this.config.appPingInterval.activeCall = 25000;
    } else {
      this.config.appPingInterval.activeCall = 30000;
    }
  }
  
  private updateAppHeartbeat() {
    // Clear existing timer
    if (this.appPingTimer) {
      clearInterval(this.appPingTimer);
      this.appPingTimer = undefined;
    }
    
    // Determine interval based on state
    let interval = 0;
    
    if (this.isBackground) {
      interval = this.config.appPingInterval.background; // 0 = disabled
    } else {
      switch (this.callState) {
        case CallConnectionState.JOINED:
          interval = this.config.appPingInterval.activeCall;
          break;
        case CallConnectionState.CONNECTING:
        case CallConnectionState.AUTHENTICATED:
          interval = this.config.appPingInterval.connecting;
          break;
        case CallConnectionState.CONNECTED:
        case CallConnectionState.IDLE:
        default:
          interval = this.config.appPingInterval.idle; // 0 = disabled
          break;
      }
    }
    
    // Start timer if interval > 0
    if (interval > 0) {
      this.appPingTimer = setInterval(() => this.sendAppPing(), interval);
      // Send immediately on state change to active
      this.sendAppPing();
    }
  }
  
  private async sendAppPing() {
    // Application ping carries: timestamp, callId, sequence for RTT measurement
    const ping = {
      type: 'call.ping' as const,
      timestamp: new Date().toISOString(),
      callId: this.currentCallId,
      sequence: this.nextSequence++,
      // Include network quality hint for server-side adaptation
      clientNetworkType: this.networkType,
    };
    
    try {
      await this.ws.send(JSON.stringify(ping));
      this.pendingPings.set(ping.sequence, Date.now());
      
      // Set timeout for pong
      setTimeout(() => this.handlePongTimeout(ping.sequence), this.config.appPongTimeout);
    } catch (e) {
      console.error('[Heartbeat] Failed to send app ping:', e);
    }
  }
  
  private handlePongTimeout(sequence: number) {
    if (this.pendingPings.has(sequence)) {
      const sentAt = this.pendingPings.get(sequence)!;
      const rtt = Date.now() - sentAt;
      this.pendingPings.delete(sequence);
      
      // RTT > timeout means connection issue
      if (rtt >= this.config.appPongTimeout) {
        this.onAppHeartbeatFailed();
      }
    }
  }
  
  private onAppHeartbeatFailed() {
    // Trigger reconnect logic
    this.reconnectManager.scheduleReconnect('APP_HEARTBEAT_TIMEOUT');
  }
  
  // Handle incoming pong
  handlePong(pong: { sequence: number; serverTime: string }) {
    const sentAt = this.pendingPings.get(pong.sequence);
    if (sentAt) {
      const rtt = Date.now() - sentAt;
      this.pendingPings.delete(pong.sequence);
      this.metrics.recordRtt(rtt);
      
      // Server time for clock sync
      this.clockOffset = Date.now() - new Date(pong.serverTime).getTime();
    }
  }
  
  private currentCallId?: string;
  private nextSequence = 0;
  private pendingPings = new Map<number, number>();
  private metrics = { rttSamples: [] as number[] };
  private clockOffset = 0;
  private reconnectManager: ReconnectManager;
}

// Reconnect with Exponential Backoff + Jitter (Optimized)
function calculateReconnectDelay(attempt: number, maxDelay = 30000): number {
  const exponent = Math.min(Math.max(attempt, 0), 10);
  const cap = Math.min(Math.pow(2, exponent), maxDelay);
  // Equal jitter: [cap / 2, cap] - prevents thundering herd
  return cap / 2 + Math.random() * (cap / 2);
}

// Reconnect Policy - Battery & Context Aware
interface ReconnectPolicy {
  shouldReconnect(error: WSError, context: ReconnectContext): boolean;
  getMaxRetries(error: WSError, context: ReconnectContext): number;
  getDelay(attempt: number, error: WSError, context: ReconnectContext): number;
}

interface ReconnectContext {
  callState: CallConnectionState;
  isBackground: boolean;
  networkType: 'wifi' | 'cellular' | 'unknown';
  hasActiveCall: boolean;
  callId?: string;
}

const RECONNECT_POLICY: ReconnectPolicy = {
  shouldReconnect: (error, context) => {
    // NON-RETRYABLE: Never reconnect
    if (error.code === 'TOKEN_EXPIRED' || error.code === 'TOKEN_REVOKED') return false;
    if (error.code === 'KICKED_FROM_ROOM' || error.code === 'PERMISSION_DENIED') return false;
    if (error.code === 'USER_LEFT_ROOM') return false;
    if (error.code === 'CALL_ENDED') return false;
    
    // BACKGROUND: Only reconnect if we have an active call (VoIP will handle incoming)
    if (context.isBackground && !context.hasActiveCall) return false;
    
    // RETRYABLE: Network issues, server restart, temporary errors
    return true;
  },
  
  getMaxRetries: (error, context) => {
    // More retries during active call
    if (context.hasActiveCall) {
      if (error.code === 'SERVER_UNAVAILABLE') return 30;
      if (error.code === 'NETWORK_ERROR') return 20;
      return 15;
    }
    
    // Fewer retries when idle (battery saving)
    if (error.code === 'SERVER_UNAVAILABLE') return 10;
    if (error.code === 'NETWORK_ERROR') return 5;
    return 3;
  },
  
  getDelay: (attempt, error, context) => {
    const baseDelay = calculateReconnectDelay(attempt);
    
    // Faster retry during active call
    if (context.hasActiveCall) {
      if (error.code === 'NETWORK_ERROR') return Math.min(baseDelay, 3000);
      return Math.min(baseDelay, 10000);
    }
    
    // Slower retry when idle (battery saving)
    if (error.code === 'NETWORK_ERROR') return Math.min(baseDelay, 10000);
    return Math.min(baseDelay, 30000);
  }
};

// Event Recovery (from PDF section 3.7) - unchanged
async function recoverEvents(callId: string, lastSequence: number, lastEventId: string): Promise<RecoveryResult> {
  const response = await sendWithAck({
    type: 'call.reconnect',
    callId,
    lastSequence,
    cursor: lastEventId
  });
  
  if (response.type === 'call.recovery') {
    const newEvents = response.events.filter(e => 
      !processedEventIds.has(e.eventId) && e.sequence > lastSequence
    );
    
    for (const event of newEvents.sort((a, b) => a.sequence - b.sequence)) {
      await processEvent(event);
      processedEventIds.add(event.eventId);
      lastSequence = event.sequence;
      lastEventId = event.eventId;
    }
    
    if (response.snapshot) {
      await applySnapshot(response.snapshot);
    }
    
    return { success: true, lastSequence, lastEventId };
  }
  
  throw new Error('Recovery failed: ' + response.message);
}

/**
 * BATTERY OPTIMIZATION SUMMARY:
 * 
 * 1. PROTOCOL PING/PONG ONLY when idle/background (kernel-managed, ~0 battery cost)
 *    - WebSocket ping/pong frames are handled by OS network stack
 *    - No application wake-ups, no JS execution
 * 
 * 2. APPLICATION HEARTBEAT ONLY DURING ACTIVE CALL
 *    - 30s interval during call (RTT monitoring for quality)
 *    - 10s during ICE negotiation (fast failure detection)
 *    - DISABLED when idle or backgrounded
 * 
 * 3. BACKGROUND = NO HEARTBEAT
 *    - Incoming calls via VoIP push (APNs/FCM high-priority)
 *    - App wakes only when call actually incoming
 * 
 * 4. NETWORK-AWARE INTERVALS
 *    - Cellular: slightly more aggressive (handover detection)
 *    - WiFi: standard intervals
 * 
 * 5. RECONNECT POLICY ADAPTS TO CONTEXT
 *    - Active call: aggressive retry (30 max, faster delays)
 *    - Idle/background: conservative retry (3-5 max, slower delays)
 *    - Non-retryable errors detected early (no wasted retries)
 * 
 * 6. METRICS FOR TUNING
 *    - Track RTT distribution, reconnect frequency, battery impact
 *    - Adjust intervals based on real-world data
 */

### 7.6 REST API Endpoints for Calls

```
# CALLS (1:1 and Group)
POST   /v1/calls                          # Initiate call (returns callId, roomId, iceServers)
GET    /v1/calls/:id                      # Get call details
POST   /v1/calls/:id/join                 # Join call (returns iceServers, participants)
POST   /v1/calls/:id/leave                # Leave call
POST   /v1/calls/:id/end                  # End call (host only)
POST   /v1/calls/:id/invite               # Invite participants (group calls)
POST   /v1/calls/:id/kick                 # Kick participant (host only)
POST   /v1/calls/:id/transfer-host        # Transfer host (host only)
GET    /v1/calls/:id/participants         # List participants
PATCH  /v1/calls/:id/participants/:userId # Update participant (mute, video, etc.)
GET    /v1/calls/history                  # Call history (paginated)
GET    /v1/calls/:id/recording            # Get recording URL

# CALL SIGNALING (via WebSocket - see §7.3)
WS     /ws/v1/calls?token=<access_token>  # Signaling connection

# Note: Livestream endpoints are out of scope for this version.
# A separate specification will cover /v1/live/streams endpoints.
```
POST   /v1/live/streams/:id/gifts         # Send gift
GET    /v1/live/streams/:id/viewers       # List viewers (paginated)
GET    /v1/live/streams/:id/comments      # Get comments (paginated, filtered)
GET    /v1/live/streams/:id/gifts         # Get gifts leaderboard
POST   /v1/live/streams/:id/pin-comment   # Pin comment (host only)
POST   /v1/live/streams/:id/hide-comment  # Hide comment (host/mod only)
POST   /v1/live/streams/:id/add-cohost    # Add co-host
DELETE /v1/live/streams/:id/remove-cohost # Remove co-host

# LIVESTREAM SIGNALING (via WebSocket)
WS     /ws/v1/live/:streamId?token=<access_token>  # Viewer/host events

# MEDIA SERVER CONFIG
GET    /v1/media/ice-servers              # Get TURN/STUN servers (authenticated)
GET    /v1/media/regions                  # Available media server regions
```

### 7.8 Media Server Integration (SFU)

```typescript
// Media Server Interface (e.g., mediasoup, LiveKit, Agora, custom SFU)
interface MediaServerAdapter {
  // Room management
  createRoom(callId: string, options: RoomOptions): Promise<RoomInfo>;
  deleteRoom(roomId: string): Promise<void>;
  getRoom(roomId: string): Promise<RoomInfo | null>;
  
  // Transport
  createWebRtcTransport(roomId: string, participantId: string): Promise<TransportInfo>;
  connectTransport(transportId: string, dtlsParameters: DTLSParameters): Promise<void>;
  
  // Producer/Consumer
  produce(transportId: string, kind: 'audio' | 'video', rtpParameters: RTPParameters): Promise<ProducerInfo>;
  consume(transportId: string, producerId: string, rtpCapabilities: RTPCapabilities): Promise<ConsumerInfo>;
  
  // Simulcast/SVC
  setPreferredLayers(consumerId: string, layers: number): Promise<void>;
  requestKeyFrame(producerId: string): Promise<void>;
  
  // Recording
  startRecording(roomId: string, options: RecordingOptions): Promise<RecordingInfo>;
  stopRecording(recordingId: string): Promise<RecordingInfo>;
  
  // Stats
  getProducerStats(producerId: string): Promise<ProducerStats>;
  getConsumerStats(consumerId: string): Promise<ConsumerStats>;
  getRoomStats(roomId: string): Promise<RoomStats>;
}

// Room Options
interface RoomOptions {
  maxParticipants: number;
  videoCodecs: VideoCodec[];      // VP8, VP9, H.264, AV1
  audioCodecs: AudioCodec[];      // Opus, PCMU
  enableSimulcast: boolean;
  simulcastLayers: number;        // 3 (high/medium/low)
  enableSVC: boolean;             // For AV1/VP9
  recordingEnabled: boolean;
  region: string;                 // Media server region
}
```

### 7.9 VoIP Push Notifications (iOS CallKit Integration)

```typescript
// CallKit Integration Requirements (from PDF: background, interruption handling)
// APNs VoIP push payload for incoming calls

interface VoIPPushPayload {
  aps: {
    alert?: { title: string; body: string };
    badge?: number;
    sound?: string;
    'content-available': 1;
    'mutable-content': 1;
  };
  callkit: {
    uuid: string;                    // Call UUID for CallKit
    handle: string;                  // Caller identifier (username/phone)
    handleType: 'generic' | 'phoneNumber' | 'emailAddress';
    hasVideo: boolean;
    isGroupCall: boolean;
    callId: string;                  // Backend call ID
    roomId: string;                  // Media server room ID
    iceServers: RTCIceServer[];      // Pre-fetched for faster connect
    callerName: string;
    callerAvatar: string;
  };
}

// Server: Send VoIP Push when call initiated
async function sendIncomingCallPush(callId: string, callerId: string, calleeIds: string[]) {
  const call = await getCall(callId);
  const caller = await getUser(callerId);
  
  for (const calleeId of calleeIds) {
    const devices = await getActiveVoIPDevices(calleeId);
    for (const device of devices) {
      const payload: VoIPPushPayload = {
        aps: { 'content-available': 1, 'mutable-content': 1 },
        callkit: {
          uuid: call.id,
          handle: caller.username,
          handleType: 'generic',
          hasVideo: call.type.includes('video'),
          isGroupCall: call.type.startsWith('group'),
          callId: call.id,
          roomId: call.roomId!,
          iceServers: await getICEServers(),
          callerName: caller.fullName || caller.username,
          callerAvatar: caller.avatarUrl || ''
        }
      };
      
      await apns.send(device.token, payload, { topic: 'com.instagram-clone.voip', pushType: 'voip' });
    }
  }
}
```

---

## 8. SEARCH & DISCOVERY

### 7.1 Hybrid Search (Vector + BM25 + Graph)

```typescript
// Search Service
class SearchService {
  // Unified search across all content types
  async search(query: string, options: SearchOptions = {}): Promise<SearchResults> {
    const { 
      types = ["users", "posts", "reels", "hashtags", "locations", "audio"],
      limit = 20,
      cursor,
      userId 
    } = options;
    
    // 1. Query understanding (intent detection)
    const intent = await this.analyzeQuery(query);
    
    // 2. Execute searches in parallel
    const results = await Promise.all(
      types.map(type => this.searchType(type, query, intent, { limit, cursor, userId }))
    );
    
    // 3. Merge and rank
    return this.mergeResults(results, intent, userId);
  }
  
  // Vector search for semantic similarity
  async vectorSearch(embedding: number[], type: string, limit: number): Promise<any[]> {
    return db.select()
      .from(search_index)
      .where(and(
        eq(search_index.content_type, type),
        sql`embedding <=> ${embedding} < 0.3` // Cosine similarity threshold
      ))
      .orderBy(sql`embedding <=> ${embedding}`)
      .limit(limit);
  }
  
  // BM25 full-text search
  async textSearch(query: string, type: string, limit: number): Promise<any[]> {
    const tsQuery = plainto_tsquery('english', query);
    return db.select()
      .from(search_index)
      .where(and(
        eq(search_index.content_type, type),
        sql`search_vector @@ ${tsQuery}`
      ))
      .orderBy(sql`ts_rank_cd(search_vector, ${tsQuery}) DESC`)
      .limit(limit);
  }
  
  // Graph-based (social signals)
  async graphSearch(userId: string, query: string, limit: number): Promise<any[]> {
    // Friends' interactions, co-engagement patterns
    return db.select()
      .from(search_index)
      .where(sql`
        content_id IN (
          SELECT DISTINCT post_id FROM likes WHERE user_id IN (
            SELECT following_id FROM follows WHERE follower_id = ${userId} AND status = 'accepted'
          )
          UNION
          SELECT post_id FROM comments WHERE author_id IN (...)
        )
      `)
      .limit(limit);
  }
  
  // Merge with Reciprocal Rank Fusion (RRF)
  mergeResults(results: SearchResults[], intent: QueryIntent, userId: string): SearchResults {
    const k = 60; // RRF constant
    const scores = new Map<string, number>();
    
    for (const [typeIdx, result] of results.entries()) {
      const typeWeight = this.getTypeWeight(result.type, intent);
      for (const [rank, item] of result.items.entries()) {
        const key = `${item.type}:${item.id}`;
        const rrfScore = typeWeight / (k + rank + 1);
        scores.set(key, (scores.get(key) || 0) + rrfScore);
      }
    }
    
    // Sort by combined score
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, score]) => ({ ...this.getItem(key), searchScore: score }));
  }
}

// Search Index Table (materialized, updated via triggers)
CREATE TABLE search_index (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type    VARCHAR(20) NOT NULL,
  content_id      UUID NOT NULL,
  title           TEXT,
  description     TEXT,
  search_vector   TSVECTOR,
  embedding       VECTOR(1536), // text-embedding-3-small
  author_id       UUID,
  created_at      TIMESTAMPTZ,
  popularity_score FLOAT DEFAULT 0, // engagement / time decay
  UNIQUE (content_type, content_id)
);

CREATE INDEX idx_search_vector ON search_index USING GIN (search_vector);
CREATE INDEX idx_search_embedding ON search_index USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_search_type_popularity ON search_index (content_type, popularity_score DESC);
```

---

## 8. OBSERVABILITY & OPERATIONS

### 8.1 Structured Logging

```typescript
// Logging Middleware (Pino + OpenTelemetry)
import pino from "pino";
import { trace, context } from "@opentelemetry/api";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    bindings: (bindings) => ({
      service: "instagram-clone-api",
      version: process.env.APP_VERSION,
      environment: process.env.NODE_ENV,
      ...bindings
    })
  }
});

// Request logging
app.use("*", async (c, next) => {
  const start = Date.now();
  const requestId = c.req.header("X-Request-ID") || crypto.randomUUID();
  c.set("requestId", requestId);
  
  const tracer = trace.getTracer("api");
  await tracer.startActiveSpan(`${c.req.method} ${c.req.path}`, async (span) => {
    try {
      span.setAttribute("http.request_id", requestId);
      span.setAttribute("http.method", c.req.method);
      span.setAttribute("http.url", c.req.url);
      span.setAttribute("user.id", c.get("user")?.id || "anonymous");
      
      await next();
      
      span.setAttribute("http.status_code", c.res.status);
      const duration = Date.now() - start;
      span.setAttribute("http.duration_ms", duration);
      
      logger.info({
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: duration,
        userId: c.get("user")?.id,
        ip: c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For")
      }, "Request completed");
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
});

// Audit logging (for sensitive operations)
async function auditLog(params: {
  action: string;
  userId?: string;
  resourceType: string;
  resourceId?: string;
  oldValues?: any;
  newValues?: any;
  metadata?: any;
}) {
  await db.insert(audit_logs).values({
    actor_id: params.userId,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    old_values: params.oldValues,
    new_values: params.newValues,
    metadata: {
      ...params.metadata,
      requestId: params.metadata?.requestId
    }
  });
}
```

### 8.2 Metrics & Alerting

```yaml
# Key Metrics (Prometheus format)
metrics:
  # API
  - name: http_requests_total
    type: counter
    labels: [method, path, status]
  - name: http_request_duration_seconds
    type: histogram
    labels: [method, path]
    buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5]
  
  # Auth
  - name: auth_login_total
    type: counter
    labels: [provider, result]
  - name: auth_refresh_total
    type: counter
    labels: [result]
  
  # Database
  - name: db_query_duration_seconds
    type: histogram
    labels: [query_type, table]
  - name: db_pool_connections
    type: gauge
    labels: [state] # active, idle, waiting
  
  # Real-time
  - name: ws_connections_active
    type: gauge
    labels: [shard]
  - name: ws_messages_total
    type: counter
    labels: [direction, type]
  
  # Media
  - name: media_upload_total
    type: counter
    labels: [type, result]
  - name: media_processing_duration_seconds
    type: histogram
    labels: [media_type, operation]
  
  # Business
  - name: posts_created_total
    type: counter
  - name: messages_sent_total
    type: counter
  - name: active_users_daily
    type: gauge

# Alert Rules
alerts:
  - name: HighErrorRate
    expr: |
      sum(rate(http_requests_total{status=~"5.."}[5m])) 
      / sum(rate(http_requests_total[5m])) > 0.05
    for: 2m
    severity: critical
    
  - name: HighLatency
    expr: |
      histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
    for: 5m
    severity: warning
    
  - name: DatabaseConnectionsExhausted
    expr: |
      db_pool_connections{state="waiting"} > 10
    for: 1m
    severity: critical
    
  - name: WebSocketConnectionDrop
    expr: |
      rate(ws_connections_active[5m]) < -10
    for: 2m
    severity: warning
```

---

## 9. DEPLOYMENT & MIGRATIONS

### 9.1 Neon Branch Strategy

```
main (production)
  ├── preview/pr-123 (auto-expire 7d)
  ├── preview/pr-124 (auto-expire 7d)
  ├── staging (long-lived, shared)
  └── dev/<username> (personal, auto-expire 3d)

# Migration Flow
1. Create preview branch from main
2. Run migrations on preview
3. Deploy preview function
4. Test against preview DB
5. Merge PR → auto-deploy to main
```

### 9.2 Migration Strategy

```typescript
// Prisma Migration (schema changes)
/prisma
  /migrations
    /20260115000000_add_reels/
      migration.sql
    /20260115000001_add_live_video/
      migration.sql

// Drizzle (query layer) - auto-generated from Prisma schema
// drizzle.config.ts
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED }
});

// Migration Commands
npm run db:generate    // Generate Drizzle schema from Prisma
npm run db:migrate     // Run migrations (uses Prisma Migrate)
npm run db:studio      // Prisma Studio for inspection
npm run db:seed        // Seed development data

// Neon CLI Commands
neon branches create preview/pr-123 --parent main
neon branches create dev/alice --parent main --ttl 3d
neon branches delete preview/pr-123
neon diff main preview/pr-123 --schema
neon checkout staging
```

### 9.3 CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI/CD

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: test }
        ports: [5432:5432]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate deploy
      - run: pnpm test --coverage
      - uses: codecov/codecov-action@v3

  contract-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm pact:verify

  build-and-deploy-preview:
    needs: [lint-and-typecheck, test, contract-test]
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Create Neon Preview Branch
        run: |
          BRANCH=preview/pr-${{ github.event.number }}
          neon branches create $BRANCH --parent main
          neon checkout $BRANCH
      - name: Deploy to Neon Functions
        run: neon deploy --env .env.preview
      - name: Post Preview URL
        run: |
          URL=$(neon functions list --json | jq -r '.[] | select(.name=="API") | .url')
          gh pr comment ${{ github.event.number }} --body "Preview: $URL"

  deploy-staging:
    needs: [lint-and-typecheck, test, contract-test]
    if: github.ref == 'refs/heads/staging'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Staging
        run: |
          neon checkout staging
          neon deploy --env .env.staging

  deploy-production:
    needs: [lint-and-typecheck, test, contract-test]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Production
        run: |
          neon checkout main
          neon deploy --env .env.production
      - name: Verify Deployment
        run: |
          sleep 30
          curl -f https://api.instagram-clone.com/health || exit 1
```

---

## 10. IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Week 1-2)
- [ ] Neon project setup with auth, functions, object storage, realtime
- [ ] Better Auth configuration (email/password, OAuth, MFA)
- [ ] Database schema migration (all tables + RLS policies)
- [ ] Hono API skeleton with middleware (auth, rate limit, validation, logging)
- [ ] WebSocket server with connection manager
- [ ] CI/CD pipeline with preview deployments

### Phase 2: Core Social (Week 3-4)
- [ ] Users: profiles, follow/unfollow, block/restrict, close friends
- [ ] Posts: CRUD, feed (cursor pagination), explore, likes, saves, comments
- [ ] Comments: threading, pagination, likes, mentions
- [ ] Notifications: unified feed, grouping, push (APNs/FCM)
- [ ] Search: users, hashtags, locations (BM25 + vector)

### Phase 3: Media & Stories (Week 5-6)
- [ ] TUS upload endpoint + processing pipeline (FFmpeg, thumbnails, NSFW)
- [ ] Stories: create, view, replies, highlights, close friends
- [ ] Reels: create, feed, remix, audio library, video processing
- [ ] CDN integration for media delivery

### Phase 4: Messaging (Week 7-8)
- [ ] Conversations: 1:1, groups, membership management
- [ ] Messages: text, media, replies, reactions, edit, unsend
- [ ] Real-time: WebSocket sync, typing indicators, presence
- [ ] Push notifications for messages
- [ ] E2EE preparation (MLS integration points)

### Phase 5: Advanced Features (Week 9-10)
- [ ] Live video: RTMP ingest, HLS playback, live comments
- [ ] Explore: ML-based recommendations, collaborative filtering
- [ ] Hashtag/Location pages with ranked content
- [ ] Analytics: insights for creators/business accounts
- [ ] Moderation: reports queue, automated actions, audit logs

### Phase 6: Production Hardening (Week 11-12)
- [ ] Load testing (k6): 10k concurrent users
- [ ] Chaos engineering: Neon branch failover, DB connection pooling
- [ ] Security audit: penetration testing, dependency scan
- [ ] Documentation: OpenAPI spec, SDK generation
- [ ] Runbook: incident response, rollback procedures
- [ ] Launch checklist: monitoring, alerting, on-call rotation

---

## 11. KEY DESIGN DECISIONS & TRADE-OFFS

| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| **Cursor pagination** | Stable, no offset drift, works with real-time | Opaque tokens, can't jump to page N |
| **RLS policies** | Defense in depth, DB-level security | Complexity in policy sync with app logic |
| **Polymorphic tables** (comments, likes, media) | DRY, single query for all types | No FK enforcement, requires app-level integrity |
| **Denormalized counters** | Read performance (feed, profiles) | Write complexity, eventual consistency |
| **TUS for uploads** | Resumable, large files, standard | More complex than multipart |
| **Better Auth (managed)** | Battle-tested, OAuth, MFA, plugins | Less control than custom, vendor lock-in |
| **Neon Realtime** | Type-safe live queries, no separate infra | Vendor-specific, learning curve |
| **Materialized feed view** | Sub-100ms feed reads | 5-min staleness, extra storage |
| **Audit log partitioning** | Query performance, retention | Operational complexity |

---

## 12. SECURITY CHECKLIST (Per Feature)

| Feature | AuthZ Checks | Rate Limits | Audit Log | Encryption |
|---------|--------------|-------------|-----------|------------|
| Posts CRUD | Ownership + audience policy | 300/min | ✓ | TLS |
| Stories | Audience + close friends | 100/min | ✓ | TLS |
| Reels | Audience + remix policy | 50/min | ✓ | TLS |
| DMs | Membership + blocks | 100/min | ✓ | TLS + E2EE (future) |
| Comments | Parent visibility + ownership | 60/min | ✓ | TLS |
| Search | Public content only | 30/min | ✓ | TLS |
| Upload | Auth + quota | 50/hr | ✓ | TLS + at-rest |
| Notifications | Recipient only | N/A | ✓ | TLS |
| Profile | Privacy + follow status | 300/min | ✓ | TLS |

---

**This design document provides a production-ready foundation for an Instagram clone backend. Every component includes security considerations, scalability patterns, and operational concerns. The schema uses PostgreSQL advanced features (RLS, partitioning, materialized views, vector search) while the API follows REST best practices with real-time WebSocket augmentation. The authentication system leverages Better Auth for battle-tested security with Neon's managed infrastructure.**