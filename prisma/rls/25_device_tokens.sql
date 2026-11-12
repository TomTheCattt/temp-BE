-- RLS Policies for device_tokens table

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own device tokens
CREATE POLICY device_tokens_select_policy ON device_tokens
  FOR SELECT USING (user_id = current_user_id());

-- INSERT: Users can register their own device tokens
CREATE POLICY device_tokens_insert_policy ON device_tokens
  FOR INSERT WITH CHECK (user_id = current_user_id());

-- UPDATE: Users can update their own device tokens
CREATE POLICY device_tokens_update_policy ON device_tokens
  FOR UPDATE USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- DELETE: Users can remove their own device tokens
CREATE POLICY device_tokens_delete_policy ON device_tokens
  FOR DELETE USING (user_id = current_user_id());