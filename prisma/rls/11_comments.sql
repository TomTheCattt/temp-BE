-- RLS Policies for comments table
-- Polymorphic: posts, reels, stories

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- SELECT: Visible if parent content is visible AND comment is not hidden (unless author/mod)
CREATE POLICY comments_select_policy ON comments
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      is_hidden = FALSE
      OR author_id = current_user_id()
      OR has_role('moderator') -- Requires a helper function
    )
    AND (
      CASE commentable_type
        WHEN 'post' THEN EXISTS (
          SELECT 1 FROM posts
          WHERE id = comments.commentable_id
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
          WHERE id = comments.commentable_id
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
          WHERE id = comments.commentable_id
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
    )
  );

-- INSERT: Users can comment on content they can view
CREATE POLICY comments_insert_policy ON comments
  FOR INSERT WITH CHECK (
    author_id = current_user_id()
    AND (
      CASE commentable_type
        WHEN 'post' THEN EXISTS (
          SELECT 1 FROM posts
          WHERE id = comments.commentable_id
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
          WHERE id = comments.commentable_id
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
          WHERE id = comments.commentable_id
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
    )
  );

-- UPDATE: Authors can update their own comments (within time limit)
CREATE POLICY comments_update_policy ON comments
  FOR UPDATE USING (author_id = current_user_id())
  WITH CHECK (author_id = current_user_id());

-- DELETE: Authors can delete their own comments; moderators can delete any
CREATE POLICY comments_delete_policy ON comments
  FOR DELETE USING (
    author_id = current_user_id()
    OR has_role('moderator')
  );