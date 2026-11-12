-- RLS Policies for conversation_members table

ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see members of conversations they belong to
CREATE POLICY conversation_members_select_policy ON conversation_members
  FOR SELECT USING (
    user_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = conversation_members.conversation_id
      AND cm.user_id = current_user_id()
      AND cm.left_at IS NULL
    )
  );

-- INSERT: Users can be added to conversations (by existing members)
-- This is typically done via application logic, not direct insert
CREATE POLICY conversation_members_insert_policy ON conversation_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = conversation_members.conversation_id
      AND cm.user_id = current_user_id()
      AND cm.left_at IS NULL
      AND cm.role IN ('owner', 'admin')
    )
    OR user_id = current_user_id() -- Self-join for DM creation
  );

-- UPDATE: Users can update their own membership (mute, leave); owners/admins can update others
CREATE POLICY conversation_members_update_policy ON conversation_members
  FOR UPDATE USING (
    user_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = conversation_members.conversation_id
      AND cm.user_id = current_user_id()
      AND cm.left_at IS NULL
      AND cm.role IN ('owner', 'admin')
    )
  );

-- DELETE: Users can leave conversations; owners/admins can remove members
CREATE POLICY conversation_members_delete_policy ON conversation_members
  FOR DELETE USING (
    user_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = conversation_members.conversation_id
      AND cm.user_id = current_user_id()
      AND cm.left_at IS NULL
      AND cm.role IN ('owner', 'admin')
    )
  );