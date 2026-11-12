-- RLS Policies for pending_uploads table

ALTER TABLE pending_uploads ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own pending uploads
CREATE POLICY pending_uploads_select_policy ON pending_uploads
  FOR SELECT USING (user_id = current_user_id());

-- INSERT: Users can create pending uploads
CREATE POLICY pending_uploads_insert_policy ON pending_uploads
  FOR INSERT WITH CHECK (user_id = current_user_id());

-- UPDATE: Users can update their own pending uploads (confirm)
CREATE POLICY pending_uploads_update_policy ON pending_uploads
  FOR UPDATE USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- DELETE: Users can delete their own pending uploads
CREATE POLICY pending_uploads_delete_policy ON pending_uploads
  FOR DELETE USING (user_id = current_user_id());