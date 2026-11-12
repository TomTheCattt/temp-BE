-- RLS Policies for verifications table (Better Auth)

ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;

-- SELECT: Only accessible by auth system (no direct user access)
CREATE POLICY verifications_select_policy ON verifications
  FOR SELECT USING (FALSE);

-- INSERT/UPDATE/DELETE: Managed by Better Auth
CREATE POLICY verifications_modify_policy ON verifications
  FOR ALL USING (FALSE);