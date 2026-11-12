-- RLS Policies for posts table

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- SELECT: Complex visibility logic
-- - Author can see their own posts
-- - Public posts are visible to everyone
-- - Followers-only posts visible to accepted followers
-- - Close friends posts visible to close friends
-- - Deleted posts not visible
CREATE POLICY posts_select_policy ON posts
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
          AND following_id = posts.author_id
          AND status = 'accepted'
        )
      )
      OR (
        close_friends_only
        AND EXISTS (
          SELECT 1 FROM close_friends
          WHERE user_id = posts.author_id
          AND friend_id = current_user_id()
        )
      )
    )
  );

-- INSERT: Authenticated users can create posts
CREATE POLICY posts_insert_policy ON posts
  FOR INSERT WITH CHECK (author_id = current_user_id());

-- UPDATE: Authors can update their own posts
CREATE POLICY posts_update_policy ON posts
  FOR UPDATE USING (author_id = current_user_id())
  WITH CHECK (author_id = current_user_id());

-- DELETE: Soft delete - authors can delete their own posts
CREATE POLICY posts_delete_policy ON posts
  FOR DELETE USING (author_id = current_user_id());