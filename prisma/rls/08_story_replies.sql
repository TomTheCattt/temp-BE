-- RLS Policies for story_replies table
-- Story author and reply sender can see replies

ALTER TABLE story_replies ENABLE ROW LEVEL SECURITY;

-- SELECT: Story author and reply sender
CREATE POLICY story_replies_select_policy ON story_replies
  FOR SELECT USING (
    sender_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM stories
      WHERE id = story_replies.story_id
      AND author_id = current_user_id()
    )
  );

-- INSERT: Users can reply to stories they can view
CREATE POLICY story_replies_insert_policy ON story_replies
  FOR INSERT WITH CHECK (
    sender_id = current_user_id()
    AND EXISTS (
      SELECT 1 FROM stories
      WHERE id = story_id
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

-- UPDATE/DELETE: Only sender can modify their reply
CREATE POLICY story_replies_modify_policy ON story_replies
  FOR ALL USING (sender_id = current_user_id());