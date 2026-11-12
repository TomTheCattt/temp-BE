-- RLS Policies for stories table

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

-- SELECT:
-- - Author can see their own stories
-- - Followers can see stories with audience='followers' if they follow the author
-- - Close friends can see stories with audience='close_friends'
-- - Expired stories not visible
-- - Deleted stories not visible
CREATE POLICY stories_select_policy ON stories
  FOR SELECT USING (
    deleted_at IS NULL
    AND expires_at > NOW()
    AND (
      author_id = current_user_id()
      OR (audience = 'followers' AND EXISTS (
        SELECT 1 FROM follows
        WHERE follower_id = current_user_id()
        AND following_id = stories.author_id
        AND status = 'accepted'
      ))
      OR (audience = 'close_friends' AND EXISTS (
        SELECT 1 FROM close_friends
        WHERE user_id = stories.author_id
        AND friend_id = current_user_id()
      ))
    )
  );

-- INSERT: Authors can create their own stories
CREATE POLICY stories_insert_policy ON stories
  FOR INSERT WITH CHECK (author_id = current_user_id());

-- UPDATE: Authors can update their own stories
CREATE POLICY stories_update_policy ON stories
  FOR UPDATE USING (author_id = current_user_id())
  WITH CHECK (author_id = current_user_id());

-- DELETE: Authors can delete their own stories
CREATE POLICY stories_delete_policy ON stories
  FOR DELETE USING (author_id = current_user_id());