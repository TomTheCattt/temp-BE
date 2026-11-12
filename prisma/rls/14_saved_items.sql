-- RLS Policies for saved_items table

ALTER TABLE saved_items ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own saved items
CREATE POLICY saved_items_select_policy ON saved_items
  FOR SELECT USING (user_id = current_user_id());

-- INSERT: Users can save content they can view
CREATE POLICY saved_items_insert_policy ON saved_items
  FOR INSERT WITH CHECK (
    user_id = current_user_id()
    AND (
      CASE saveable_type
        WHEN 'post' THEN EXISTS (
          SELECT 1 FROM posts
          WHERE id = saved_items.saveable_id
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
          WHERE id = saved_items.saveable_id
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
        WHEN 'audio' THEN EXISTS (
          SELECT 1 FROM audio_tracks
          WHERE id = saved_items.saveable_id
        )
        ELSE FALSE
      END
    )
  );

-- DELETE: Users can unsave their own saved items
CREATE POLICY saved_items_delete_policy ON saved_items
  FOR DELETE USING (user_id = current_user_id());