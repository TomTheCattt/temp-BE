-- RLS Policies for accounts table (Better Auth)

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own accounts
CREATE POLICY accounts_select_policy ON accounts
  FOR SELECT USING (user_id = current_user_id());

-- INSERT/UPDATE/DELETE: Managed by Better Auth
CREATE POLICY accounts_modify_policy ON accounts
  FOR ALL USING (FALSE);