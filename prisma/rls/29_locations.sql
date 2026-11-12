-- RLS Policies for locations table
-- Locations are public for discovery

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- SELECT: All authenticated users can see locations (for discovery)
CREATE POLICY locations_select_policy ON locations
  FOR SELECT USING (current_user_id() IS NOT NULL);

-- INSERT/UPDATE/DELETE: Only moderators/admins
CREATE POLICY locations_modify_policy ON locations
  FOR ALL USING (has_role('moderator'));