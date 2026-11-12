-- RLS Policies for media_items table
-- Polymorphic table - visibility follows the parent entity

ALTER TABLE media_items ENABLE ROW LEVEL SECURITY;

-- SELECT: Visible if parent content is visible
CREATE POLICY media_items_select_policy ON media_items
  FOR SELECT USING (
    CASE mediaable_type
      WHEN 'post' THEN EXISTS (
        SELECT 1 FROM posts
        WHERE id = media_items.mediaable_id
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
      WHEN 'story' THEN EXISTS (
        SELECT 1 FROM stories
        WHERE id = media_items.mediaable_id
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
      WHEN 'reel' THEN EXISTS (
        SELECT 1 FROM reels
        WHERE id = media_items.mediaable_id
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
      WHEN 'message' THEN EXISTS (
        SELECT 1 FROM messages m
        JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
        WHERE m.id = media_items.mediaable_id
        AND m.deleted_at IS NULL
        AND cm.user_id = current_user_id()
        AND cm.left_at IS NULL
      )
      WHEN 'profile' THEN mediaable_id = current_user_id()
      ELSE FALSE
    END
  );

-- INSERT: Users can add media to their own content
CREATE POLICY media_items_insert_policy ON media_items
  FOR INSERT WITH CHECK (
    CASE mediaable_type
      WHEN 'post' THEN EXISTS (SELECT 1 FROM posts WHERE id = mediaable_id AND author_id = current_user_id())
      WHEN 'story' THEN EXISTS (SELECT 1 FROM stories WHERE id = mediaable_id AND author_id = current_user_id())
      WHEN 'reel' THEN EXISTS (SELECT 1 FROM reels WHERE id = mediaable_id AND author_id = current_user_id())
      WHEN 'message' THEN EXISTS (
        SELECT 1 FROM messages m
        JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
        WHERE m.id = mediaable_id AND m.sender_id = current_user_id()
      )
      WHEN 'profile' THEN mediaable_id = current_user_id()
      ELSE FALSE
    END
  );

-- UPDATE: Users can update media for their own content
CREATE POLICY media_items_update_policy ON media_items
  FOR UPDATE USING (
    CASE mediaable_type
      WHEN 'post' THEN EXISTS (SELECT 1 FROM posts WHERE id = mediaable_id AND author_id = current_user_id())
      WHEN 'story' THEN EXISTS (SELECT 1 FROM stories WHERE id = mediaable_id AND author_id = current_user_id())
      WHEN 'reel' THEN EXISTS (SELECT 1 FROM reels WHERE id = mediaable_id AND author_id = current_user_id())
      WHEN 'message' THEN EXISTS (
        SELECT 1 FROM messages m
        WHERE m.id = mediaable_id AND m.sender_id = current_user_id()
      )
      WHEN 'profile' THEN mediaable_id = current_user_id()
      ELSE FALSE
    END
  );

-- DELETE: Users can delete media from their own content
CREATE POLICY media_items_delete_policy ON media_items
  FOR DELETE USING (
    CASE mediaable_type
      WHEN 'post' THEN EXISTS (SELECT 1 FROM posts WHERE id = mediaable_id AND author_id = current_user_id())
      WHEN 'story' THEN EXISTS (SELECT 1 FROM stories WHERE id = mediaable_id AND author_id = current_user_id())
      WHEN 'reel' THEN EXISTS (SELECT 1 FROM reels WHERE id = mediaable_id AND author_id = current_user_id())
      WHEN 'message' THEN EXISTS (
        SELECT 1 FROM messages m
        WHERE m.id = mediaable_id AND m.sender_id = current_user_id()
      )
      WHEN 'profile' THEN mediaable_id = current_user_id()
      ELSE FALSE
    END
  );