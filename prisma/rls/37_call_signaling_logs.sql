-- RLS Policies for call_signaling_logs table

ALTER TABLE call_signaling_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: Call participants and initiator can see signaling logs
CREATE POLICY call_signaling_logs_select_policy ON call_signaling_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM calls
      WHERE id = call_signaling_logs.call_id
      AND initiator_id = current_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM call_participants
      WHERE call_id = call_signaling_logs.call_id
      AND user_id = current_user_id()
    )
  );

-- INSERT: System records signaling messages
CREATE POLICY call_signaling_logs_insert_policy ON call_signaling_logs
  FOR INSERT WITH CHECK (FALSE); -- Only via service

-- UPDATE/DELETE: Immutable
CREATE POLICY call_signaling_logs_modify_policy ON call_signaling_logs
  FOR ALL USING (FALSE);