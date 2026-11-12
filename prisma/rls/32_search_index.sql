-- RLS Policies for search_index table

ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can search content they're authorized to see
-- This is enforced at the application level by filtering results
-- The search_index contains denormalized data for performance
-- Application should filter by content_type and check permissions
CREATE POLICY search_index_select_policy ON search_index
  FOR SELECT USING (
    -- For user content: only if user is author or content is public
    -- For public content types (hashtags, locations, audio): all authenticated users
    content_type IN ('hashtag', 'location', 'audio')
    OR author_id = current_user_id()
    OR (
      content_type IN ('post', 'reel')
      AND EXISTS (
        SELECT 1 FROM posts
        WHERE id = search_index.content_id
        AND deleted_at IS NULL
        AND (
          audience = 'public'
          OR author_id = current_user_id()
        )
      )
    )
    -- Note: Full permission check done at application layer
  );

-- INSERT/UPDATE/DELETE: Managed by triggers/services
CREATE POLICY search_index_modify_policy ON search_index
  FOR ALL USING (FALSE);