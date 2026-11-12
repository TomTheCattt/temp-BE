-- RLS Policies for audit_logs table (partitioned)

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- SELECT:
-- - Users can see their own audit logs
-- - Moderators/admins can see all audit logs
CREATE POLICY audit_logs_select_policy ON audit_logs
  FOR SELECT USING (
    actor_id = current_user_id()
    OR has_role('moderator')
    OR has_role('admin')
  );

-- INSERT: System/service inserts audit logs
CREATE POLICY audit_logs_insert_policy ON audit_logs
  FOR INSERT WITH CHECK (FALSE); -- Only via service/triggers

-- UPDATE/DELETE: Immutable - no updates or deletes allowed
CREATE POLICY audit_logs_modify_policy ON audit_logs
  FOR ALL USING (FALSE);