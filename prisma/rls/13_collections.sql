-- RLS Policies for collections table

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own collections
CREATE POLICY collections_select_policy ON collections
  FOR SELECT USING (user_id = current_user_id());

-- INSERT: Users can create their own collections
CREATE POLICY collections_insert_policy ON collections
  FOR INSERT WITH CHECK (user_id = current_user_id());

-- UPDATE: Users can update their own collections
CREATE POLICY collections_update_policy ON collections
  FOR UPDATE USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- DELETE: Users can delete their own collections
CREATE POLICY collections_delete_policy ON collections
  FOR DELETE USING (user_id = current_user_id());