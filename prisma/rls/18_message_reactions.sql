-- RLS Policies for message_reactions table

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- SELECT: Visible if parent message is visible
CREATE POLICY message_reactions_select_policy ON message_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
      WHERE m.id = message_reactions.message_id
      AND m.deleted_at IS NULL
      AND m.is_unsent = FALSE
      AND cm.user_id = current_user_id()
      AND cm.left_at IS NULL
    )
  );

-- INSERT: Members can react to messages they can see
CREATE POLICY message_reactions_insert_policy ON message_reactions
  FOR INSERT WITH CHECK (
    user_id = current_user_id()
    AND EXISTS (
      SELECT 1 FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
      WHERE m.id = message_id
      AND m.deleted_at IS NULL
      AND m.is_unsent = FALSE
      AND cm.user_id = current_user_id()
      AND cm.left_at IS NULL
    )
  );

-- DELETE: Users can remove their own reactions
CREATE POLICY message_reactions_delete_policy ON message_reactions
  FOR DELETE USING (user_id = current_user_id());