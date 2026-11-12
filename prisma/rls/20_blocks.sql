-- RLS Policies for blocks table

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own blocks (who they blocked and who blocked them)
CREATE POLICY blocks_select_policy ON blocks
  FOR SELECT USING (
    blocker_id = current_user_id()
    OR blocked_id = current_user_id()
  );

-- INSERT: Users can block others
CREATE POLICY blocks_insert_policy ON blocks
  FOR INSERT WITH CHECK (blocker_id = current_user_id());

-- UPDATE: Users can update their own blocks (change block effects)
CREATE POLICY blocks_update_policy ON blocks
  FOR UPDATE USING (blocker_id = current_user_id())
  WITH CHECK (blocker_id = current_user_id());

-- DELETE: Users can unblock
CREATE POLICY blocks_delete_policy ON blocks
  FOR DELETE USING (blocker_id = current_user_id());