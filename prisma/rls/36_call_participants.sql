-- RLS Policies for call_participants table

ALTER TABLE call_participants ENABLE ROW LEVEL SECURITY;

-- SELECT:
-- - Participants can see other participants in the same call
-- - Initiator can see all participants
CREATE POLICY call_participants_select_policy ON call_participants
  FOR SELECT USING (
    user_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM calls
      WHERE id = call_participants.call_id
      AND initiator_id = current_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM call_participants cp
      WHERE cp.call_id = call_participants.call_id
      AND cp.user_id = current_user_id()
    )
  );

-- INSERT: Call initiator can add participants; users can join (self-insert)
CREATE POLICY call_participants_insert_policy ON call_participants
  FOR INSERT WITH CHECK (
    user_id = current_user_id() -- Self-join
    OR EXISTS (
      SELECT 1 FROM calls
      WHERE id = call_id
      AND initiator_id = current_user_id()
    )
  );

-- UPDATE: Participants can update their own status; initiator can update others
CREATE POLICY call_participants_update_policy ON call_participants
  FOR UPDATE USING (
    user_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM calls
      WHERE id = call_participants.call_id
      AND initiator_id = current_user_id()
    )
  )
  WITH CHECK (
    user_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM calls
      WHERE id = call_participants.call_id
      AND initiator_id = current_user_id()
    )
  );

-- DELETE: Participants can leave; initiator can remove participants
CREATE POLICY call_participants_delete_policy ON call_participants
  FOR DELETE USING (
    user_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM calls
      WHERE id = call_participants.call_id
      AND initiator_id = current_user_id()
    )
  );