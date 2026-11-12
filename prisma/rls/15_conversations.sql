-- RLS Policies for conversations table

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see conversations they're a member of (and haven't left)
CREATE POLICY conversations_select_policy ON conversations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversation_members
      WHERE conversation_id = conversations.id
      AND user_id = current_user_id()
      AND left_at IS NULL
    )
  );

-- INSERT: Users can create conversations (DM or group)
CREATE POLICY conversations_insert_policy ON conversations
  FOR INSERT WITH CHECK (
    -- For DM: is_group = false, members will be added via conversation_members
    -- For group: is_group = true, group_owner_id = current_user_id()
    (NOT is_group)
    OR (is_group AND group_owner_id = current_user_id())
  );

-- UPDATE: Group owners/admins can update group details
CREATE POLICY conversations_update_policy ON conversations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM conversation_members
      WHERE conversation_id = conversations.id
      AND user_id = current_user_id()
      AND left_at IS NULL
      AND role IN ('owner', 'admin')
    )
  );

-- DELETE: Group owners can delete; DM participants can leave (soft delete)
CREATE POLICY conversations_delete_policy ON conversations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM conversation_members
      WHERE conversation_id = conversations.id
      AND user_id = current_user_id()
      AND left_at IS NULL
      AND role = 'owner'
    )
  );