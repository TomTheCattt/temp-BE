-- Rate Limit Buckets Table
-- Sliding window rate limiting with PostgreSQL
-- Used as fallback when Redis is unavailable

CREATE TABLE rate_limit_buckets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier      VARCHAR(200) NOT NULL,  -- user_id, IP address, or "global"
    endpoint        VARCHAR(100) NOT NULL,  -- API path pattern (e.g., "/v1/posts")
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    request_count   INT DEFAULT 0,
    limit           INT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (identifier, endpoint, window_start)
);

-- Index for efficient lookups
CREATE INDEX idx_rate_limit_lookup ON rate_limit_buckets(identifier, endpoint, window_end);

-- Index for cleanup of old buckets
CREATE INDEX idx_rate_limit_cleanup ON rate_limit_buckets(window_end);

-- Function to check and increment rate limit
-- Returns (allowed BOOLEAN, remaining INT, reset_time TIMESTAMPTZ)
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_identifier VARCHAR,
    p_endpoint VARCHAR,
    p_limit INT,
    p_window_seconds INT
) RETURNS TABLE (
    allowed BOOLEAN,
    remaining INT,
    reset_time TIMESTAMPTZ,
    retry_after INT
) AS $$
DECLARE
    v_window_start TIMESTAMPTZ;
    v_window_end TIMESTAMPTZ;
    v_current_count INT;
    v_bucket_id UUID;
BEGIN
    v_window_start := date_trunc('second', NOW()) - (EXTRACT(SECOND FROM NOW())::INT % p_window_seconds) * INTERVAL '1 second';
    v_window_end := v_window_start + p_window_seconds * INTERVAL '1 second';

    -- Try to insert or update the bucket
    INSERT INTO rate_limit_buckets (identifier, endpoint, window_start, window_end, request_count, limit)
    VALUES (p_identifier, p_endpoint, v_window_start, v_window_end, 1, p_limit)
    ON CONFLICT (identifier, endpoint, window_start)
    DO UPDATE SET
        request_count = rate_limit_buckets.request_count + 1,
        window_end = EXCLUDED.window_end
    RETURNING id, request_count INTO v_bucket_id, v_current_count;

    IF v_current_count <= p_limit THEN
        RETURN QUERY SELECT TRUE, p_limit - v_current_count, v_window_end, 0;
    ELSE
        RETURN QUERY SELECT FALSE, 0, v_window_end, EXTRACT(EPOCH FROM (v_window_end - NOW()))::INT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Cleanup function for old rate limit buckets
-- Run periodically via pg_cron
CREATE OR REPLACE FUNCTION cleanup_rate_limit_buckets() RETURNS void AS $$
BEGIN
    DELETE FROM rate_limit_buckets
    WHERE window_end < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup (every hour)
SELECT cron.schedule('cleanup-rate-limits', '0 * * * *', 'SELECT cleanup_rate_limit_buckets();');

-- Tiered rate limit configurations (for reference)
/*
Rate Limit Tiers:
| Tier | Scope | Limit | Window | Burst |
|------|-------|-------|--------|-------|
| Anonymous | IP | 60 req | 1 min | 2x |
| Authenticated | User | 300 req | 1 min | 2x |
| Authenticated (burst) | User | 900 req | 30 sec | 3x |
| Media Upload | User | 50 req | 1 hour | 1x |
| Auth Endpoints | IP | 10 req | 15 min | 1x |
| WebSocket | Connection | 100 msg | 1 min | 2x |
| Search | User | 30 req | 1 min | 2x |
| Admin | User | 1000 req | 1 min | 5x |
*/