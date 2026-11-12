-- RLS Policies for reports table

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- SELECT: Reporters can see their own reports; moderators can see all
CREATE POLICY reports_select_policy ON reports
  FOR SELECT USING (
    reporter_id = current_user_id()
    OR has_role('moderator')
  );

-- INSERT: Users can create reports
CREATE POLICY reports_insert_policy ON reports
  FOR INSERT WITH CHECK (reporter_id = current_user_id());

-- UPDATE: Moderators can update report status
CREATE POLICY reports_update_policy ON reports
  FOR UPDATE USING (has_role('moderator'))
  WITH CHECK (has_role('moderator'));

-- DELETE: Not typically allowed (immutable for audit)
CREATE POLICY reports_delete_policy ON reports
  FOR DELETE USING (FALSE);