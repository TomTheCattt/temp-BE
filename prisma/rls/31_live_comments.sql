-- RLS Policies for live_comments table

ALTER TABLE live_comments ENABLE ROW LEVEL SECURITY;

-- SELECT: Visible if parent live video is visible
CREATE POLICY live_comments_select_policy ON live_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM live_videos
      WHERE id = live_comments.live_id
      AND (
        host_id = current_user_id()
        OR co_host_id = current_user_id()
        OR status IN ('live', 'archived')
      )
    )
  );

-- INSERT: Authenticated users can comment on live videos they can view
CREATE POLICY live_comments_insert_policy ON live_comments
  FOR INSERT WITH CHECK (
    user_id = current_user_id()
    AND EXISTS (
      SELECT 1 FROM live_videos
      WHERE id = live_id
      AND (
        host_id = current_user_id()
        OR co_host_id = current_user_id()
        OR status IN ('live', 'archived')
      )
    )
  );

-- UPDATE: Authors can update their own comments (brief window)
CREATE POLICY live_comments_update_policy ON live_comments
  FOR UPDATE USING (
    user_id = current_user_id()
    AND created_at > NOW() - INTERVAL '5 minutes'
  )
  WITH CHECK (user_id = current_user_id());

-- DELETE: Authors can delete their own comments; hosts can delete any
CREATE POLICY live_comments_delete_policy ON live_comments
  FOR DELETE USING (
    user_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM live_videos
      WHERE id = live_comments.live_id
      AND (host_id = current_user_id() OR co_host_id = current_user_id())
    )
  );