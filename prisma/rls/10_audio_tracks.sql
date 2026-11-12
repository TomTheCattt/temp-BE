-- RLS Policies for audio_tracks table
-- Audio tracks are public (discoverable), but only creators can modify

ALTER TABLE audio_tracks ENABLE ROW LEVEL SECURITY;

-- SELECT: All authenticated users can see audio tracks (for discovery)
CREATE POLICY audio_tracks_select_policy ON audio_tracks
  FOR SELECT USING (current_user_id() IS NOT NULL);

-- INSERT: Authenticated users can create audio tracks
CREATE POLICY audio_tracks_insert_policy ON audio_tracks
  FOR INSERT WITH CHECK (current_user_id() IS NOT NULL);

-- UPDATE: Only creator can update (we don't have creator_id, so use a reasonable default)
-- In practice, you'd add a creator_id column
CREATE POLICY audio_tracks_update_policy ON audio_tracks
  FOR UPDATE USING (FALSE); -- Restrict updates

-- DELETE: Only admins/creators
CREATE POLICY audio_tracks_delete_policy ON audio_tracks
  FOR DELETE USING (FALSE);