-- RLS Policies for story_items table
-- Visibility follows the parent story

ALTER TABLE story_items ENABLE ROW LEVEL SECURITY;

-- SELECT: Visible if parent story is visible
CREATE POLICY story_items_select_policy ON story_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM stories
      WHERE id = story_items.story_id
      AND deleted_at IS NULL
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
    )
  );

-- INSERT/UPDATE/DELETE: Author of parent story
CREATE POLICY story_items_modify_policy ON story_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM stories
      WHERE id = story_items.story_id
      AND author_id = current_user_id()
    )
  );