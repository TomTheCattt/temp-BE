-- Search Index Table with pgvector (vector embeddings) + BM25 (full-text search)
-- Hybrid search for users, posts, reels, audio, hashtags, locations

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Search index table
CREATE TABLE search_index (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type    VARCHAR(20) NOT NULL,  -- 'user', 'post', 'reel', 'audio', 'hashtag', 'location'
    content_id      UUID NOT NULL,
    title           TEXT,
    description     TEXT,
    search_vector   TSVECTOR,  -- For BM25/ts_rank
    embedding       VECTOR(1536),  -- text-embedding-3-small (1536 dimensions)
    author_id       UUID,
    created_at      TIMESTAMPTZ,
    popularity_score FLOAT DEFAULT 0,  -- engagement / time decay for ranking
    UNIQUE (content_type, content_id)
);

-- GIN index for full-text search (BM25)
CREATE INDEX idx_search_vector ON search_index USING GIN (search_vector);

-- HNSW index for vector similarity search (cosine similarity)
-- Requires pgvector 0.5.0+
CREATE INDEX idx_search_embedding ON search_index USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Composite index for type + popularity ordering
CREATE INDEX idx_search_type_popularity ON search_index (content_type, popularity_score DESC);

-- Index for author-based queries
CREATE INDEX idx_search_author ON search_index (author_id, created_at DESC);

-- Trigger function to update search_vector from title/description
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.description, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update search_vector on insert/update
CREATE TRIGGER trigger_update_search_vector
BEFORE INSERT OR UPDATE ON search_index
FOR EACH ROW EXECUTE FUNCTION update_search_vector();

-- Function to populate search_index from source tables
-- This should be called periodically or via triggers on source tables
CREATE OR REPLACE FUNCTION populate_search_index() RETURNS void AS $$
BEGIN
    -- Users
    INSERT INTO search_index (content_type, content_id, title, description, author_id, created_at, popularity_score)
    SELECT
        'user', id, username, COALESCE(bio, ''), id, created_at,
        (followers_count * 1.0 + posts_count * 0.5) / EXTRACT(EPOCH FROM (NOW() - created_at)) * 86400
    FROM users
    WHERE deleted_at IS NULL
    ON CONFLICT (content_type, content_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        author_id = EXCLUDED.author_id,
        created_at = EXCLUDED.created_at,
        popularity_score = EXCLUDED.popularity_score;

    -- Posts
    INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score)
    SELECT
        'post', p.id,
        COALESCE(u.username, ''),
        COALESCE(p.caption, '') || ' ' || COALESCE(p.location_name, ''),
        to_tsvector('english', COALESCE(p.caption, '') || ' ' || COALESCE(p.location_name, '')),
        p.author_id, p.created_at,
        (p.likes_count + p.comments_count * 2 + p.shares_count * 3 + p.saves_count * 4) / EXTRACT(EPOCH FROM (NOW() - p.created_at)) * 86400
    FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.deleted_at IS NULL AND p.audience = 'public'
    ON CONFLICT (content_type, content_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        search_vector = EXCLUDED.search_vector,
        author_id = EXCLUDED.author_id,
        created_at = EXCLUDED.created_at,
        popularity_score = EXCLUDED.popularity_score;

    -- Reels
    INSERT INTO search_index (content_type, content_id, title, description, search_vector, author_id, created_at, popularity_score)
    SELECT
        'reel', r.id,
        COALESCE(u.username, ''),
        COALESCE(r.caption, ''),
        to_tsvector('english', COALESCE(r.caption, '')),
        r.author_id, r.created_at,
        (r.likes_count + r.comments_count * 2 + r.shares_count * 3 + r.plays_count * 0.1) / EXTRACT(EPOCH FROM (NOW() - r.created_at)) * 86400
    FROM reels r
    JOIN users u ON u.id = r.author_id
    WHERE r.deleted_at IS NULL AND r.audience = 'public'
    ON CONFLICT (content_type, content_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        search_vector = EXCLUDED.search_vector,
        author_id = EXCLUDED.author_id,
        created_at = EXCLUDED.created_at,
        popularity_score = EXCLUDED.popularity_score;

    -- Audio Tracks
    INSERT INTO search_index (content_type, content_id, title, description, author_id, created_at, popularity_score)
    SELECT
        'audio', a.id,
        a.name || ' - ' || COALESCE(a.artist, ''),
        a.name || ' ' || COALESCE(a.artist, ''),
        a.id, a.created_at, a.usage_count
    FROM audio_tracks a
    ON CONFLICT (content_type, content_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        author_id = EXCLUDED.author_id,
        created_at = EXCLUDED.created_at,
        popularity_score = EXCLUDED.popularity_score;

    -- Hashtags
    INSERT INTO search_index (content_type, content_id, title, description, created_at, popularity_score)
    SELECT
        'hashtag', h.id,
        h.tag,
        h.tag,
        h.created_at, h.posts_count + h.reels_count
    FROM hashtags h
    WHERE h.is_blocked = FALSE
    ON CONFLICT (content_type, content_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        created_at = EXCLUDED.created_at,
        popularity_score = EXCLUDED.popularity_score;

    -- Locations
    INSERT INTO search_index (content_type, content_id, title, description, created_at, popularity_score)
    SELECT
        'location', l.id,
        l.name,
        l.name || ' ' || COALESCE(l.address, '') || ' ' || COALESCE(l.category, ''),
        l.created_at, l.posts_count
    FROM locations l
    ON CONFLICT (content_type, content_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        created_at = EXCLUDED.created_at,
        popularity_score = EXCLUDED.popularity_score;
END;
$$ LANGUAGE plpgsql;

-- Schedule periodic population (every 15 minutes)
SELECT cron.schedule('populate-search-index', '*/15 * * * *', 'SELECT populate_search_index();');

-- Hybrid search function (RRF - Reciprocal Rank Fusion)
CREATE OR REPLACE FUNCTION hybrid_search(
    query_text TEXT,
    query_embedding VECTOR(1536),
    content_types TEXT[],
    limit_count INT DEFAULT 20
) RETURNS TABLE (
    id UUID,
    content_type TEXT,
    content_id UUID,
    title TEXT,
    description TEXT,
    author_id UUID,
    created_at TIMESTAMPTZ,
    search_score FLOAT
) AS $$
BEGIN
    RETURN QUERY
    WITH vector_results AS (
        SELECT
            id, content_type, content_id, title, description, author_id, created_at,
            1.0 / (ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) + 1) AS vector_score
        FROM search_index
        WHERE content_type = ANY(content_types)
        AND embedding IS NOT NULL
        ORDER BY embedding <=> query_embedding
        LIMIT limit_count * 3
    ),
    bm25_results AS (
        SELECT
            id, content_type, content_id, title, description, author_id, created_at,
            1.0 / (ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', query_text)) DESC) + 1) AS bm25_score
        FROM search_index
        WHERE content_type = ANY(content_types)
        AND search_vector @@ plainto_tsquery('english', query_text)
        ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', query_text)) DESC
        LIMIT limit_count * 3
    ),
    combined AS (
        SELECT id, content_type, content_id, title, description, author_id, created_at,
               COALESCE(vector_score, 0) * 0.6 + COALESCE(bm25_score, 0) * 0.4 AS combined_score
        FROM vector_results
        FULL OUTER JOIN bm25_results USING (id, content_type, content_id, title, description, author_id, created_at)
    )
    SELECT id, content_type, content_id, title, description, author_id, created_at, combined_score AS search_score
    FROM combined
    ORDER BY combined_score DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;