-- RLS Policies for reels table

ALTER TABLE reels ENABLE ROW LEVEL SECURITY;

-- SELECT:
-- - Author can see their own reels
-- - Public reels visible to everyone
-- - Followers-only reels visible to accepted followers
-- - Deleted reels not visible
CREATE POLICY reels_select_policy ON reels
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      author_id = current_user_id()
      OR audience = 'public'
      OR (
        audience = 'followers'
        AND EXISTS (
          SELECT 1 FROM follows
          WHERE follower_id = current_user_id()
          AND following_id = reels.author_id
          AND status = 'accepted'
        )
      )
    )
  );

-- INSERT: Authors can create their own reels
CREATE POLICY reels_insert_policy ON reels
  FOR INSERT WITH CHECK (author_id = current_user_id());

-- UPDATE: Authors can update their own reels
CREATE POLICY reels_update_policy ON reels
  FOR UPDATE USING (author_id = current_user_id())
  WITH CHECK (author_id = current_user_id());

-- DELETE: Authors can delete their own reels
CREATE POLICY reels_delete_policy ON reels
  FOR DELETE USING (author_id = current_user_id());