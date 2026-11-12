-- RLS Policies for restrictions table

ALTER TABLE restrictions ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own restrictions
CREATE POLICY restrictions_select_policy ON restrictions
  FOR SELECT USING (
    restrictor_id = current_user_id()
    OR restricted_id = current_user_id()
  );

-- INSERT: Users can restrict others
CREATE POLICY restrictions_insert_policy ON restrictions
  FOR INSERT WITH CHECK (restrictor_id = current_user_id());

-- UPDATE: Users can update their own restrictions
CREATE POLICY restrictions_update_policy ON restrictions
  FOR UPDATE USING (restrictor_id = current_user_id())
  WITH CHECK (restrictor_id = current_user_id());

-- DELETE: Users can remove restrictions
CREATE POLICY restrictions_delete_policy ON restrictions
  FOR DELETE USING (restrictor_id = current_user_id());