-- RLS Policies for refresh_tokens table (Better Auth)

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own refresh tokens
CREATE POLICY refresh_tokens_select_policy ON refresh_tokens
  FOR SELECT USING (user_id = current_user_id());

-- INSERT/UPDATE/DELETE: Managed by Better Auth
CREATE POLICY refresh_tokens_modify_policy ON refresh_tokens
  FOR ALL USING (FALSE);