-- RLS Policies for messages table

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- SELECT: Members of the conversation can see messages (not deleted, not unsent)
CREATE POLICY messages_select_policy ON messages
  FOR SELECT USING (
    deleted_at IS NULL
    AND is_unsent = FALSE
    AND EXISTS (
      SELECT 1 FROM conversation_members
      WHERE conversation_id = messages.conversation_id
      AND user_id = current_user_id()
      AND left_at IS NULL
    )
  );

-- INSERT: Members can send messages to conversations they belong to
CREATE POLICY messages_insert_policy ON messages
  FOR INSERT WITH CHECK (
    sender_id = current_user_id()
    AND EXISTS (
      SELECT 1 FROM conversation_members
      WHERE conversation_id = messages.conversation_id
      AND user_id = current_user_id()
      AND left_at IS NULL
    )
    AND NOT EXISTS (
      -- Check blocks between sender and other members
      SELECT 1 FROM conversation_members cm
      JOIN blocks b ON (b.blocker_id = current_user_id() AND b.blocked_id = cm.user_id)
                      OR (b.blocker_id = cm.user_id AND b.blocked_id = current_user_id())
      WHERE cm.conversation_id = messages.conversation_id
      AND cm.left_at IS NULL
    )
  );

-- UPDATE: Senders can edit their own messages (within time limit)
CREATE POLICY messages_update_policy ON messages
  FOR UPDATE USING (
    sender_id = current_user_id()
    AND is_edited = FALSE
    AND created_at > NOW() - INTERVAL '10 minutes'
  )
  WITH CHECK (sender_id = current_user_id());

-- DELETE: Senders can unsend their own messages (for everyone or just me)
CREATE POLICY messages_delete_policy ON messages
  FOR DELETE USING (sender_id = current_user_id());