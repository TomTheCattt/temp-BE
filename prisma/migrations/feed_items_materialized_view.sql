-- Materialized View: feed_items
-- Refreshed every 5 minutes via pg_cron for feed performance

-- Create the materialized view
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
    p.shares_count,
    p.saves_count,
    p.views_count,
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
    WHERE mediaable_type = 'post'
    AND mediaable_id = p.id
    ORDER BY sort_order
    LIMIT 1
) mi ON TRUE
WHERE p.deleted_at IS NULL
AND p.audience = 'public'
AND p.created_at > NOW() - INTERVAL '30 days';

-- Unique index for concurrent refresh
CREATE UNIQUE INDEX idx_feed_items_pk ON feed_items(post_id);

-- Index for feed pagination
CREATE INDEX idx_feed_items_created ON feed_items(created_at DESC);

-- Index for author-based queries
CREATE INDEX idx_feed_items_author ON feed_items(author_id, created_at DESC);

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_feed_items() RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY feed_items;
END;
$$ LANGUAGE plpgsql;

-- Schedule via pg_cron (runs every 5 minutes)
-- Note: Requires pg_cron extension to be enabled in Neon
SELECT cron.schedule('refresh-feed-5min', '*/5 * * * *', 'SELECT refresh_feed_items();');

-- To unschedule: SELECT cron.unschedule('refresh-feed-5min');