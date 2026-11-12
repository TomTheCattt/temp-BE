-- RLS Policies for hashtags table
-- Hashtags are public for discovery

ALTER TABLE hashtags ENABLE ROW LEVEL SECURITY;

-- SELECT: All authenticated users can see hashtags (for discovery)
CREATE POLICY hashtags_select_policy ON hashtags
  FOR SELECT USING (current_user_id() IS NOT NULL);

-- INSERT/UPDATE/DELETE: Only moderators/admins
CREATE POLICY hashtags_modify_policy ON hashtags
  FOR ALL USING (has_role('moderator'));