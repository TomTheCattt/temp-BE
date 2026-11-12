-- RLS Policies for live_videos table

ALTER TABLE live_videos ENABLE ROW LEVEL SECURITY;

-- SELECT:
-- - Host/co-host can see their own live videos
-- - Public live videos (status = 'live' or 'archived') visible to all
-- - Scheduled live videos visible to host/co-host only
CREATE POLICY live_videos_select_policy ON live_videos
  FOR SELECT USING (
    host_id = current_user_id()
    OR co_host_id = current_user_id()
    OR status IN ('live', 'archived')
  );

-- INSERT: Authenticated users can create live videos
CREATE POLICY live_videos_insert_policy ON live_videos
  FOR INSERT WITH CHECK (host_id = current_user_id());

-- UPDATE: Host/co-host can update their live videos
CREATE POLICY live_videos_update_policy ON live_videos
  FOR UPDATE USING (
    host_id = current_user_id()
    OR co_host_id = current_user_id()
  )
  WITH CHECK (
    host_id = current_user_id()
    OR co_host_id = current_user_id()
  );

-- DELETE: Host can delete their live videos
CREATE POLICY live_videos_delete_policy ON live_videos
  FOR DELETE USING (host_id = current_user_id());