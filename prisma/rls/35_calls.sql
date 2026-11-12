-- RLS Policies for calls table

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- SELECT:
-- - Initiator can see their calls
-- - Participants can see calls they're part of
CREATE POLICY calls_select_policy ON calls
  FOR SELECT USING (
    initiator_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM call_participants
      WHERE call_id = calls.id
      AND user_id = current_user_id()
    )
  );

-- INSERT: Users can initiate calls
CREATE POLICY calls_insert_policy ON calls
  FOR INSERT WITH CHECK (initiator_id = current_user_id());

-- UPDATE: Initiator and participants can update call status
CREATE POLICY calls_update_policy ON calls
  FOR UPDATE USING (
    initiator_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM call_participants
      WHERE call_id = calls.id
      AND user_id = current_user_id()
    )
  )
  WITH CHECK (
    initiator_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM call_participants
      WHERE call_id = calls.id
      AND user_id = current_user_id()
    )
  );

-- DELETE: Not typically allowed (immutable for history)
CREATE POLICY calls_delete_policy ON calls
  FOR DELETE USING (FALSE);