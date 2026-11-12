-- ============================================================
-- FEED MATERIALIZED VIEW & PG_CRON REFRESH
-- ============================================================

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop existing materialized view if exists
DROP MATERIALIZED VIEW IF EXISTS feed_items CASCADE;

-- Create materialized view for feed items
-- Includes posts from followed users + close friends + suggested posts
-- Filters out: blocked users, private accounts (unless following), deleted/archived posts
-- Only includes posts from last 30 days for performance
CREATE MATERIALIZED VIEW feed_items AS
WITH followed_users AS (
    SELECT following_id AS user_id
    FROM follows
    WHERE follower_id = current_user_id() -- This will be set per query context
      AND status = 'accepted'
),
blocked_users AS (
    SELECT blocked_id AS user_id
    FROM blocks
    WHERE blocker_id = current_user_id()
      AND block_content = TRUE
),
close_friends AS (
    SELECT friend_id AS user_id
    FROM close_friends
    WHERE user_id = current_user_id()
),
post_cte AS (
    SELECT
        p.id AS post_id,
        p.author_id,
        p.caption,
        p.location_name,
        p.location_lat,
        p.location_lng,
        p.likes_count,
        p.comments_count,
        p.shares_count,
        p.saves_count,
        p.views_count,
        p.is_sponsored,
        p.sponsor_user_id,
        p.audience,
        p.close_friends_only,
        p.created_at,
        u.username,
        u.full_name,
        u.avatar_url,
        u.is_verified,
        u.is_private,
        mi.url AS media_url,
        mi.thumbnail_url,
        mi.type AS media_type,
        mi.width,
        mi.height,
        mi.duration,
        mi.sort_order,
        -- Pre-compute engagement score for ranking
        (p.likes_count + p.comments_count * 2 + p.shares_count * 3 + p.saves_count * 4)::numeric AS engagement_score,
        -- Time decay factor (hours since post)
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0 AS hours_since_post
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN LATERAL (
        SELECT *
        FROM media_items
        WHERE mediaable_type = 'post'
          AND mediaable_id = p.id
        ORDER BY sort_order
        LIMIT 1
    ) mi ON TRUE
    WHERE p.deleted_at IS NULL
      AND p.archived_at IS NULL
      AND p.created_at > NOW() - INTERVAL '30 days'
)
SELECT *
FROM post_cte
WHERE
    -- Public posts from followed users
    (audience = 'PUBLIC' AND author_id IN (SELECT user_id FROM followed_users))
    OR
    -- Close friends posts
    (close_friends_only = TRUE AND author_id IN (SELECT user_id FROM close_friends))
    OR
    -- User's own posts
    (author_id = current_user_id())
    -- Exclude blocked users
    AND author_id NOT IN (SELECT user_id FROM blocked_users)
    -- Exclude private accounts unless following or close friend
    AND NOT (is_private = TRUE
             AND author_id != current_user_id()
             AND author_id NOT IN (SELECT user_id FROM followed_users)
             AND author_id NOT IN (SELECT user_id FROM close_friends))
ORDER BY created_at DESC;

-- Create unique index on post_id for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_feed_items_pk ON feed_items(post_id);

-- Index for cursor-based pagination (created_at DESC)
CREATE INDEX idx_feed_items_created ON feed_items(created_at DESC);

-- Index for sponsored content queries
CREATE INDEX idx_feed_items_sponsored ON feed_items(is_sponsored, created_at DESC) WHERE is_sponsored = TRUE;

-- Index for engagement-based queries (explore)
CREATE INDEX idx_feed_items_engagement ON feed_items(engagement_score DESC, created_at DESC);

-- ============================================================
-- REFRESH FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_feed_items() RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY feed_items;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PER-USER FEED REFRESH (for invalidation)
-- ============================================================
-- This function refreshes feed for a specific user by using a temporary table
-- Used when follow/unfollow/block/new post happens
CREATE OR REPLACE FUNCTION refresh_user_feed(p_user_id UUID) RETURNS void AS $$
DECLARE
    v_sql TEXT;
BEGIN
    -- We use a dynamic approach since materialized views can't be parameterized per user
    -- For per-user invalidation, we'll use a different approach (see feed_service.ts)
    -- This function is a placeholder for future optimization
    PERFORM pg_notify('feed_invalidate', p_user_id::text);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PG_CRON JOB - Refresh every 30 seconds (as per BE-060)
-- ============================================================
-- Schedule the materialized view refresh every 30 seconds
-- Note: pg_cron minimum interval is 1 minute, so we use '* * * * *' (every minute)
-- For 30-second refresh, we'd need two cron jobs offset by 30 seconds or use a different approach
SELECT cron.schedule(
    'refresh-feed-items-30s',
    '* * * * *',  -- Every minute (minimum for pg_cron)
    'SELECT refresh_feed_items();'
);

-- Alternative: Two cron jobs for ~30 second refresh
-- SELECT cron.schedule('refresh-feed-items-30s-1', '* * * * *', 'SELECT refresh_feed_items();');
-- SELECT cron.schedule('refresh-feed-items-30s-2', '* * * * *', 'SELECT pg_sleep(30); SELECT refresh_feed_items();');

-- ============================================================
-- FEED INVALIDATION TRIGGERS
-- ============================================================

-- Trigger function for feed invalidation on new post
CREATE OR REPLACE FUNCTION notify_feed_invalidation_on_post()
RETURNS TRIGGER AS $$
BEGIN
    -- Notify all followers of the author that feed needs refresh
    PERFORM pg_notify('feed_invalidate_new_post', json_build_object(
        'author_id', NEW.author_id,
        'post_id', NEW.id,
        'created_at', NEW.created_at
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on posts insert
DROP TRIGGER IF EXISTS trigger_feed_invalidate_post ON posts;
CREATE TRIGGER trigger_feed_invalidate_post
    AFTER INSERT ON posts
    FOR EACH ROW
    EXECUTE FUNCTION notify_feed_invalidation_on_post();

-- Trigger function for feed invalidation on follow
CREATE OR REPLACE FUNCTION notify_feed_invalidation_on_follow()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'accepted' THEN
        -- Notify the follower that their feed changed (new followee's posts now visible)
        PERFORM pg_notify('feed_invalidate_follow', json_build_object(
            'follower_id', NEW.follower_id,
            'following_id', NEW.following_id,
            'action', 'follow'
        )::text);
    ELSIF OLD.status = 'accepted' AND NEW.status != 'accepted' THEN
        -- Unfollow or block - notify follower
        PERFORM pg_notify('feed_invalidate_follow', json_build_object(
            'follower_id', NEW.follower_id,
            'following_id', NEW.following_id,
            'action', 'unfollow'
        )::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on follows insert/update
DROP TRIGGER IF EXISTS trigger_feed_invalidate_follow ON follows;
CREATE TRIGGER trigger_feed_invalidate_follow
    AFTER INSERT OR UPDATE ON follows
    FOR EACH ROW
    EXECUTE FUNCTION notify_feed_invalidation_on_follow();

-- Trigger function for feed invalidation on block
CREATE OR REPLACE FUNCTION notify_feed_invalidation_on_block()
RETURNS TRIGGER AS $$
BEGIN
    -- Notify blocker that blocked user's posts should be removed from feed
    PERFORM pg_notify('feed_invalidate_block', json_build_object(
        'blocker_id', NEW.blocker_id,
        'blocked_id', NEW.blocked_id,
        'action', 'block'
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on blocks insert
DROP TRIGGER IF EXISTS trigger_feed_invalidate_block ON blocks;
CREATE TRIGGER trigger_feed_invalidate_block
    AFTER INSERT ON blocks
    FOR EACH ROW
    EXECUTE FUNCTION notify_feed_invalidation_on_block();

-- Trigger function for feed invalidation on unblock
CREATE OR REPLACE FUNCTION notify_feed_invalidation_on_unblock()
RETURNS TRIGGER AS $$
BEGIN
    -- Notify blocker that unblocked user's posts may now appear in feed
    PERFORM pg_notify('feed_invalidate_block', json_build_object(
        'blocker_id', OLD.blocker_id,
        'blocked_id', OLD.blocked_id,
        'action', 'unblock'
    )::text);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger on blocks delete
DROP TRIGGER IF EXISTS trigger_feed_invalidate_unblock ON blocks;
CREATE TRIGGER trigger_feed_invalidate_unblock
    AFTER DELETE ON blocks
    FOR EACH ROW
    EXECUTE FUNCTION notify_feed_invalidation_on_unblock();

-- ============================================================
-- SPONSORED CONTENT INJECTION
-- ============================================================
-- Table to manage sponsored post campaigns
CREATE TABLE IF NOT EXISTS sponsored_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    target_audience JSONB DEFAULT '{}', -- {"interests": [], "locations": [], "age_range": [18, 65]}
    budget_cents BIGINT NOT NULL DEFAULT 0,
    spent_cents BIGINT NOT NULL DEFAULT 0,
    bid_cents BIGINT NOT NULL DEFAULT 100, -- Cost per impression
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'ended', 'archived')),
    -- Frequency capping
    max_impressions_per_user_per_day INT DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sponsored_campaigns_active ON sponsored_campaigns(status, start_at, end_at) WHERE status = 'active';
CREATE INDEX idx_sponsored_campaigns_sponsor ON sponsored_campaigns(sponsor_user_id);

-- Sponsored posts (linking posts to campaigns)
CREATE TABLE IF NOT EXISTS sponsored_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES sponsored_campaigns(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    -- Targeting overrides (optional, falls back to campaign)
    target_audience JSONB,
    bid_cents BIGINT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'rejected', 'archived')),
    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    spent_cents BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (campaign_id, post_id)
);

CREATE INDEX idx_sponsored_posts_campaign ON sponsored_posts(campaign_id, status);
CREATE INDEX idx_sponsored_posts_post ON sponsored_posts(post_id);

-- Impression tracking for sponsored posts
CREATE TABLE IF NOT EXISTS sponsored_impressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsored_post_id UUID NOT NULL REFERENCES sponsored_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    impression_at TIMESTAMPTZ DEFAULT NOW(),
    -- For frequency capping
    impression_date DATE DEFAULT CURRENT_DATE
);

CREATE INDEX idx_sponsored_impressions_post_user_date ON sponsored_impressions(sponsored_post_id, user_id, impression_date);
CREATE INDEX idx_sponsored_impressions_user_date ON sponsored_impressions(user_id, impression_date);

-- Function to get sponsored posts for feed injection
CREATE OR REPLACE FUNCTION get_sponsored_posts_for_feed(
    p_user_id UUID,
    p_limit INT DEFAULT 2
) RETURNS TABLE (
    post_id UUID,
    author_id UUID,
    caption TEXT,
    location_name VARCHAR(200),
    location_lat DECIMAL(10,8),
    location_lng DECIMAL(11,8),
    likes_count INT,
    comments_count INT,
    shares_count INT,
    saves_count INT,
    views_count INT,
    is_sponsored BOOLEAN,
    sponsor_user_id UUID,
    audience VARCHAR(20),
    close_friends_only BOOLEAN,
    created_at TIMESTAMPTZ,
    username VARCHAR(30),
    full_name VARCHAR(100),
    avatar_url VARCHAR(500),
    is_verified BOOLEAN,
    media_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    media_type VARCHAR(10),
    width INT,
    height INT,
    duration DECIMAL(8,3),
    sort_order INT,
    engagement_score NUMERIC,
    hours_since_post NUMERIC,
    campaign_id UUID,
    bid_cents BIGINT
) AS $$
DECLARE
    v_user_interests TEXT[];
    v_user_location JSONB;
BEGIN
    -- Get user interests from search history / engagement (simplified)
    SELECT ARRAY_AGG(DISTINCT tag) INTO v_user_interests
    FROM hashtag_usages hu
    JOIN hashtags h ON h.id = hu.hashtag_id
    WHERE hu.usage_type = 'post'
      AND hu.usage_id IN (
          SELECT p.id FROM posts p
          JOIN likes l ON l.post_id = p.id
          WHERE l.user_id = p_user_id
          AND l.created_at > NOW() - INTERVAL '30 days'
      );

    -- Return sponsored posts matching user criteria, ordered by bid
    RETURN QUERY
    SELECT
        p.id AS post_id,
        p.author_id,
        p.caption,
        p.location_name,
        p.location_lat,
        p.location_lng,
        p.likes_count,
        p.comments_count,
        p.shares_count,
        p.saves_count,
        p.views_count,
        TRUE AS is_sponsored,
        p.sponsor_user_id,
        p.audience,
        p.close_friends_only,
        p.created_at,
        u.username,
        u.full_name,
        u.avatar_url,
        u.is_verified,
        mi.url AS media_url,
        mi.thumbnail_url,
        mi.type AS media_type,
        mi.width,
        mi.height,
        mi.duration,
        mi.sort_order,
        (p.likes_count + p.comments_count * 2 + p.shares_count * 3 + p.saves_count * 4)::numeric AS engagement_score,
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0 AS hours_since_post,
        sp.campaign_id,
        COALESCE(sp.bid_cents, sc.bid_cents) AS bid_cents
    FROM sponsored_posts sp
    JOIN sponsored_campaigns sc ON sc.id = sp.campaign_id
    JOIN posts p ON p.id = sp.post_id
    JOIN users u ON u.id = p.author_id
    LEFT JOIN LATERAL (
        SELECT *
        FROM media_items
        WHERE mediaable_type = 'post'
          AND mediaable_id = p.id
        ORDER BY sort_order
        LIMIT 1
    ) mi ON TRUE
    WHERE sp.status = 'active'
      AND sc.status = 'active'
      AND sc.start_at <= NOW()
      AND (sc.end_at IS NULL OR sc.end_at > NOW())
      AND p.deleted_at IS NULL
      AND p.archived_at IS NULL
      AND p.author_id != p_user_id -- Don't show own sponsored posts
      -- Frequency capping: check impressions today
      AND (
          SELECT COUNT(*)
          FROM sponsored_impressions si
          WHERE si.sponsored_post_id = sp.id
            AND si.user_id = p_user_id
            AND si.impression_date = CURRENT_DATE
      ) < COALESCE(sc.max_impressions_per_user_per_day, 3)
      -- Targeting: basic check (can be expanded)
      AND (
          sc.target_audience IS NULL
          OR sc.target_audience = '{}'
          OR (
              -- Has interest match
              v_user_interests IS NOT NULL
              AND ARRAY_LENGTH(v_user_interests, 1) > 0
              AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(sc.target_audience->'interests') AS interest(tag)
                  WHERE interest.tag = ANY(v_user_interests)
              )
          )
      )
    ORDER BY COALESCE(sp.bid_cents, sc.bid_cents) DESC, RANDOM()
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;