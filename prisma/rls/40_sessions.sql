-- RLS Policies for sessions table (Better Auth)

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own sessions
CREATE POLICY sessions_select_policy ON sessions
  FOR SELECT USING (user_id = current_user_id());

-- INSERT/UPDATE/DELETE: Managed by Better Auth
CREATE POLICY sessions_modify_policy ON sessions
  FOR ALL USING (FALSE);