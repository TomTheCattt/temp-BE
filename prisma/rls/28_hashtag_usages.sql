-- RLS Policies for hashtag_usages table

ALTER TABLE hashtag_usages ENABLE ROW LEVEL SECURITY;

-- SELECT: Visible if parent content is visible
CREATE POLICY hashtag_usages_select_policy ON hashtag_usages
  FOR SELECT USING (
    CASE usage_type
      WHEN 'post' THEN EXISTS (
        SELECT 1 FROM posts
        WHERE id = hashtag_usages.usage_id
        AND deleted_at IS NULL
        AND (
          author_id = current_user_id()
          OR audience = 'public'
          OR (audience = 'followers' AND EXISTS (
            SELECT 1 FROM follows
            WHERE follower_id = current_user_id()
            AND following_id = posts.author_id
            AND status = 'accepted'
          ))
          OR (close_friends_only AND EXISTS (
            SELECT 1 FROM close_friends
            WHERE user_id = posts.author_id
            AND friend_id = current_user_id()
          ))
        )
      )
      WHEN 'reel' THEN EXISTS (
        SELECT 1 FROM reels
        WHERE id = hashtag_usages.usage_id
        AND deleted_at IS NULL
        AND (
          author_id = current_user_id()
          OR audience = 'public'
          OR (audience = 'followers' AND EXISTS (
            SELECT 1 FROM follows
            WHERE follower_id = current_user_id()
            AND following_id = reels.author_id
            AND status = 'accepted'
          ))
        )
      )
      WHEN 'story' THEN EXISTS (
        SELECT 1 FROM stories
        WHERE id = hashtag_usages.usage_id
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
      ELSE FALSE
    END
  );

-- INSERT/UPDATE/DELETE: Managed by triggers
CREATE POLICY hashtag_usages_modify_policy ON hashtag_usages
  FOR ALL USING (FALSE);