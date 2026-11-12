-- RLS Policies for likes table
-- Polymorphic: posts, reels, comments, stories

ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- SELECT: Visible if parent content is visible
CREATE POLICY likes_select_policy ON likes
  FOR SELECT USING (
    CASE likeable_type
      WHEN 'post' THEN EXISTS (
        SELECT 1 FROM posts
        WHERE id = likes.likeable_id
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
        WHERE id = likes.likeable_id
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
      WHEN 'comment' THEN EXISTS (
        SELECT 1 FROM comments c
        WHERE c.id = likes.likeable_id
        AND c.deleted_at IS NULL
        AND (c.is_hidden = FALSE OR c.author_id = current_user_id() OR has_role('moderator'))
        AND (
          CASE c.commentable_type
            WHEN 'post' THEN EXISTS (
              SELECT 1 FROM posts
              WHERE id = c.commentable_id
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
              WHERE id = c.commentable_id
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
              WHERE id = c.commentable_id
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
      )
      WHEN 'story' THEN EXISTS (
        SELECT 1 FROM stories
        WHERE id = likes.likeable_id
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

-- INSERT: Users can like content they can view
CREATE POLICY likes_insert_policy ON likes
  FOR INSERT WITH CHECK (
    user_id = current_user_id()
    AND (
      CASE likeable_type
        WHEN 'post' THEN EXISTS (
          SELECT 1 FROM posts
          WHERE id = likes.likeable_id
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
          WHERE id = likes.likeable_id
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
        WHEN 'comment' THEN EXISTS (
          SELECT 1 FROM comments c
          WHERE c.id = likes.likeable_id
          AND c.deleted_at IS NULL
          AND (c.is_hidden = FALSE OR c.author_id = current_user_id() OR has_role('moderator'))
        )
        WHEN 'story' THEN EXISTS (
          SELECT 1 FROM stories
          WHERE id = likes.likeable_id
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

-- DELETE: Users can unlike their own likes
CREATE POLICY likes_delete_policy ON likes
  FOR DELETE USING (user_id = current_user_id());