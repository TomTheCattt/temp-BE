-- Search Index Triggers Migration
-- Auto-populate and maintain search_index table for hybrid search
-- Created: 2026-11-12

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to compute tsvector for BM25 search
CREATE OR REPLACE FUNCTION public.compute_search_vector(title text, description text)
RETURNS tsvector AS $$
BEGIN
  RETURN to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to compute popularity score for posts
CREATE OR REPLACE FUNCTION public.compute_post_popularity(
  likes_count integer,
  comments_count integer,
  shares_count integer,
  saves_count integer,
  created_at timestamp with time zone
)
RETURNS numeric AS $$
DECLARE
  hours_since_creation numeric;
  time_decay numeric;
  engagement numeric;
BEGIN
  hours_since_creation := EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600;
  time_decay := GREATEST(0.1, 1 / (1 + hours_since_creation / 24));
  engagement := (likes_count * 1.0) + (comments_count * 2.0) + (shares_count * 3.0) + (saves_count * 4.0);
  RETURN engagement * time_decay;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Function to compute popularity score for reels
CREATE OR REPLACE FUNCTION public.compute_reel_popularity(
  likes_count integer,
  comments_count integer,
  shares_count integer,
  plays_count integer,
  created_at timestamp with time zone
)
RETURNS numeric AS $$
DECLARE
  hours_since_creation numeric;
  time_decay numeric;
  engagement numeric;
BEGIN
  hours_since_creation := EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600;
  time_decay := GREATEST(0.1, 1 / (1 + hours_since_creation / 24));
  engagement := (likes_count * 1.0) + (comments_count * 2.0) + (shares_count * 3.0) + (plays_count * 0.1);
  RETURN engagement * time_decay;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Function to compute popularity score for users
CREATE OR REPLACE FUNCTION public.compute_user_popularity(
  followers_count integer,
  posts_count integer
)
RETURNS numeric AS $$
BEGIN
  RETURN (followers_count * 1.0) + (posts_count * 0.5);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to compute popularity score for hashtags
CREATE OR REPLACE FUNCTION public.compute_hashtag_popularity(
  posts_count integer,
  reels_count integer
)
RETURNS numeric AS $$
BEGIN
  RETURN (posts_count + reels_count)::numeric;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to compute popularity score for locations
CREATE OR REPLACE FUNCTION public.compute_location_popularity(
  posts_count integer
)
RETURNS numeric AS $$
BEGIN
  RETURN posts_count::numeric;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to compute popularity score for audio
CREATE OR REPLACE FUNCTION public.compute_audio_popularity(
  usage_count integer
)
RETURNS numeric AS $$
BEGIN
  RETURN usage_count::numeric;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- Trigger Functions for Each Content Type
-- ============================================================================

-- Posts trigger function
CREATE OR REPLACE FUNCTION public.sync_post_to_search_index()
RETURNS TRIGGER AS $$
DECLARE
  v_title text;
  v_description text;
  v_search_vector tsvector;
  v_popularity_score numeric;
BEGIN
  -- Skip if deleted
  IF NEW.deleted_at IS NOT NULL THEN
    DELETE FROM search_index WHERE content_type = 'posts' AND content_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Only index public posts
  IF NEW.audience != 'PUBLIC' THEN
    DELETE FROM search_index WHERE content_type = 'posts' AND content_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Build search data
  v_title := LEFT(coalesce(NEW.caption, ''), 200);
  v_description := coalesce(NEW.caption, '');
  v_search_vector := compute_search_vector(v_title, v_description);
  v_popularity_score := compute_post_popularity(
    NEW.likes_count, NEW.comments_count, NEW.shares_count, NEW.saves_count, NEW.created_at
  );

  -- Upsert to search_index
  INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
  VALUES ('posts', NEW.id, v_title, v_description, v_search_vector, NEW.author_id, NEW.created_at, v_popularity_score, NOW())
  ON CONFLICT (content_type, content_id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    search_vector = EXCLUDED.search_vector,
    author_id = EXCLUDED.author_id,
    created_at = EXCLUDED.created_at,
    popularity_score = EXCLUDED.popularity_score,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reels trigger function
CREATE OR REPLACE FUNCTION public.sync_reel_to_search_index()
RETURNS TRIGGER AS $$
DECLARE
  v_title text;
  v_description text;
  v_search_vector tsvector;
  v_popularity_score numeric;
BEGIN
  -- Skip if deleted
  IF NEW.deleted_at IS NOT NULL THEN
    DELETE FROM search_index WHERE content_type = 'reels' AND content_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Only index public reels
  IF NEW.audience != 'public' THEN
    DELETE FROM search_index WHERE content_type = 'reels' AND content_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Build search data
  v_title := LEFT(coalesce(NEW.caption, ''), 200);
  v_description := coalesce(NEW.caption, '');
  v_search_vector := compute_search_vector(v_title, v_description);
  v_popularity_score := compute_reel_popularity(
    NEW.likes_count, NEW.comments_count, NEW.shares_count, NEW.plays_count, NEW.created_at
  );

  -- Upsert to search_index
  INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
  VALUES ('reels', NEW.id, v_title, v_description, v_search_vector, NEW.author_id, NEW.created_at, v_popularity_score, NOW())
  ON CONFLICT (content_type, content_id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    search_vector = EXCLUDED.search_vector,
    author_id = EXCLUDED.author_id,
    created_at = EXCLUDED.created_at,
    popularity_score = EXCLUDED.popularity_score,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Users trigger function
CREATE OR REPLACE FUNCTION public.sync_user_to_search_index()
RETURNS TRIGGER AS $$
DECLARE
  v_title text;
  v_description text;
  v_search_vector tsvector;
  v_popularity_score numeric;
BEGIN
  -- Skip if deleted
  IF NEW.deleted_at IS NOT NULL THEN
    DELETE FROM search_index WHERE content_type = 'users' AND content_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Build search data
  v_title := NEW.username;
  v_description := coalesce(NEW.bio, '') || ' ' || coalesce(NEW.full_name, '');
  v_search_vector := compute_search_vector(v_title, v_description);
  v_popularity_score := compute_user_popularity(NEW.followers_count, NEW.posts_count);

  -- Upsert to search_index
  INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
  VALUES ('users', NEW.id, v_title, v_description, v_search_vector, NEW.id, NEW.created_at, v_popularity_score, NOW())
  ON CONFLICT (content_type, content_id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    search_vector = EXCLUDED.search_vector,
    author_id = EXCLUDED.author_id,
    created_at = EXCLUDED.created_at,
    popularity_score = EXCLUDED.popularity_score,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Hashtags trigger function
CREATE OR REPLACE FUNCTION public.sync_hashtag_to_search_index()
RETURNS TRIGGER AS $$
DECLARE
  v_title text;
  v_description text;
  v_search_vector tsvector;
  v_popularity_score numeric;
BEGIN
  -- Skip if blocked
  IF NEW.is_blocked THEN
    DELETE FROM search_index WHERE content_type = 'hashtags' AND content_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Build search data
  v_title := '#' || NEW.tag;
  v_description := 'Posts: ' || NEW.posts_count || ', Reels: ' || NEW.reels_count;
  v_search_vector := compute_search_vector(v_title, v_description);
  v_popularity_score := compute_hashtag_popularity(NEW.posts_count, NEW.reels_count);

  -- Upsert to search_index
  INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
  VALUES ('hashtags', NEW.id, v_title, v_description, v_search_vector, NULL, NEW.created_at, v_popularity_score, NOW())
  ON CONFLICT (content_type, content_id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    search_vector = EXCLUDED.search_vector,
    author_id = EXCLUDED.author_id,
    created_at = EXCLUDED.created_at,
    popularity_score = EXCLUDED.popularity_score,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Locations trigger function
CREATE OR REPLACE FUNCTION public.sync_location_to_search_index()
RETURNS TRIGGER AS $$
DECLARE
  v_title text;
  v_description text;
  v_search_vector tsvector;
  v_popularity_score numeric;
BEGIN
  -- Build search data
  v_title := NEW.name;
  v_description := coalesce(NEW.address, '') || ' ' || coalesce(NEW.category, '');
  v_search_vector := compute_search_vector(v_title, v_description);
  v_popularity_score := compute_location_popularity(NEW.posts_count);

  -- Upsert to search_index
  INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
  VALUES ('locations', NEW.id, v_title, v_description, v_search_vector, NULL, NEW.created_at, v_popularity_score, NOW())
  ON CONFLICT (content_type, content_id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    search_vector = EXCLUDED.search_vector,
    author_id = EXCLUDED.author_id,
    created_at = EXCLUDED.created_at,
    popularity_score = EXCLUDED.popularity_score,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Audio tracks trigger function
CREATE OR REPLACE FUNCTION public.sync_audio_to_search_index()
RETURNS TRIGGER AS $$
DECLARE
  v_title text;
  v_description text;
  v_search_vector tsvector;
  v_popularity_score numeric;
BEGIN
  -- Build search data
  v_title := NEW.name;
  v_description := CASE WHEN NEW.artist IS NOT NULL THEN 'by ' || NEW.artist ELSE '' END;
  v_search_vector := compute_search_vector(v_title, v_description);
  v_popularity_score := compute_audio_popularity(NEW.usage_count);

  -- Upsert to search_index
  INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
  VALUES ('audio', NEW.id, v_title, v_description, v_search_vector, NULL, NEW.created_at, v_popularity_score, NOW())
  ON CONFLICT (content_type, content_id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    search_vector = EXCLUDED.search_vector,
    author_id = EXCLUDED.author_id,
    created_at = EXCLUDED.created_at,
    popularity_score = EXCLUDED.popularity_score,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Create Triggers
-- ============================================================================

-- Posts trigger
DROP TRIGGER IF EXISTS trigger_sync_post_to_search_index ON posts;
CREATE TRIGGER trigger_sync_post_to_search_index
  AFTER INSERT OR UPDATE OR DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION sync_post_to_search_index();

-- Reels trigger
DROP TRIGGER IF EXISTS trigger_sync_reel_to_search_index ON reels;
CREATE TRIGGER trigger_sync_reel_to_search_index
  AFTER INSERT OR UPDATE OR DELETE ON reels
  FOR EACH ROW EXECUTE FUNCTION sync_reel_to_search_index();

-- Users trigger
DROP TRIGGER IF EXISTS trigger_sync_user_to_search_index ON users;
CREATE TRIGGER trigger_sync_user_to_search_index
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION sync_user_to_search_index();

-- Hashtags trigger
DROP TRIGGER IF EXISTS trigger_sync_hashtag_to_search_index ON hashtags;
CREATE TRIGGER trigger_sync_hashtag_to_search_index
  AFTER INSERT OR UPDATE OR DELETE ON hashtags
  FOR EACH ROW EXECUTE FUNCTION sync_hashtag_to_search_index();

-- Locations trigger
DROP TRIGGER IF EXISTS trigger_sync_location_to_search_index ON locations;
CREATE TRIGGER trigger_sync_location_to_search_index
  AFTER INSERT OR UPDATE OR DELETE ON locations
  FOR EACH ROW EXECUTE FUNCTION sync_location_to_search_index();

-- Audio tracks trigger
DROP TRIGGER IF EXISTS trigger_sync_audio_to_search_index ON audio_tracks;
CREATE TRIGGER trigger_sync_audio_to_search_index
  AFTER INSERT OR UPDATE OR DELETE ON audio_tracks
  FOR EACH ROW EXECUTE FUNCTION sync_audio_to_search_index();

-- ============================================================================
-- Initial Backfill (run once after migration)
-- ============================================================================

-- Backfill posts
INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
SELECT
  'posts',
  p.id,
  LEFT(coalesce(p.caption, ''), 200),
  coalesce(p.caption, ''),
  compute_search_vector(LEFT(coalesce(p.caption, ''), 200), coalesce(p.caption, '')),
  p.author_id,
  p.created_at,
  compute_post_popularity(p.likes_count, p.comments_count, p.shares_count, p.saves_count, p.created_at),
  NOW()
FROM posts p
WHERE p.deleted_at IS NULL
  AND p.audience = 'PUBLIC'
  AND NOT EXISTS (SELECT 1 FROM search_index si WHERE si.content_type = 'posts' AND si.content_id = p.id)
ON CONFLICT (content_type, content_id) DO NOTHING;

-- Backfill reels
INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
SELECT
  'reels',
  r.id,
  LEFT(coalesce(r.caption, ''), 200),
  coalesce(r.caption, ''),
  compute_search_vector(LEFT(coalesce(r.caption, ''), 200), coalesce(r.caption, '')),
  r.author_id,
  r.created_at,
  compute_reel_popularity(r.likes_count, r.comments_count, r.shares_count, r.plays_count, r.created_at),
  NOW()
FROM reels r
WHERE r.deleted_at IS NULL
  AND r.audience = 'public'
  AND NOT EXISTS (SELECT 1 FROM search_index si WHERE si.content_type = 'reels' AND si.content_id = r.id)
ON CONFLICT (content_type, content_id) DO NOTHING;

-- Backfill users
INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
SELECT
  'users',
  u.id,
  u.username,
  coalesce(u.bio, '') || ' ' || coalesce(u.full_name, ''),
  compute_search_vector(u.username, coalesce(u.bio, '') || ' ' || coalesce(u.full_name, '')),
  u.id,
  u.created_at,
  compute_user_popularity(u.followers_count, u.posts_count),
  NOW()
FROM users u
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM search_index si WHERE si.content_type = 'users' AND si.content_id = u.id)
ON CONFLICT (content_type, content_id) DO NOTHING;

-- Backfill hashtags
INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
SELECT
  'hashtags',
  h.id,
  '#' || h.tag,
  'Posts: ' || h.posts_count || ', Reels: ' || h.reels_count,
  compute_search_vector('#' || h.tag, 'Posts: ' || h.posts_count || ', Reels: ' || h.reels_count),
  NULL,
  h.created_at,
  compute_hashtag_popularity(h.posts_count, h.reels_count),
  NOW()
FROM hashtags h
WHERE h.is_blocked = FALSE
  AND NOT EXISTS (SELECT 1 FROM search_index si WHERE si.content_type = 'hashtags' AND si.content_id = h.id)
ON CONFLICT (content_type, content_id) DO NOTHING;

-- Backfill locations
INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
SELECT
  'locations',
  l.id,
  l.name,
  coalesce(l.address, '') || ' ' || coalesce(l.category, ''),
  compute_search_vector(l.name, coalesce(l.address, '') || ' ' || coalesce(l.category, '')),
  NULL,
  l.created_at,
  compute_location_popularity(l.posts_count),
  NOW()
FROM locations l
WHERE NOT EXISTS (SELECT 1 FROM search_index si WHERE si.content_type = 'locations' AND si.content_id = l.id)
ON CONFLICT (content_type, content_id) DO NOTHING;

-- Backfill audio tracks
INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score, updated_at)
SELECT
  'audio',
  a.id,
  a.name,
  CASE WHEN a.artist IS NOT NULL THEN 'by ' || a.artist ELSE '' END,
  compute_search_vector(a.name, CASE WHEN a.artist IS NOT NULL THEN 'by ' || a.artist ELSE '' END),
  NULL,
  a.created_at,
  compute_audio_popularity(a.usage_count),
  NOW()
FROM audio_tracks a
WHERE NOT EXISTS (SELECT 1 FROM search_index si WHERE si.content_type = 'audio' AND si.content_id = a.id)
ON CONFLICT (content_type, content_id) DO NOTHING;

-- ============================================================================
-- Grant Permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.compute_search_vector TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_post_popularity TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_reel_popularity TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_user_popularity TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_hashtag_popularity TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_location_popularity TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_audio_popularity TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_post_to_search_index TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_reel_to_search_index TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_user_to_search_index TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_hashtag_to_search_index TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_location_to_search_index TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_audio_to_search_index TO PUBLIC;