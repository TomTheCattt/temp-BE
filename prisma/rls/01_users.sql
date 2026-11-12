-- RLS Policies for users table
-- User A cannot see User B's private data unless authorized

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user ID from JWT
-- This assumes Better Auth sets the user ID in the request context
CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
BEGIN
  RETURN COALESCE(
    current_setting('request.jwt.claims.sub', true)::UUID,
    current_setting('request.user.id', true)::UUID
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SELECT: Users can see public profiles, their own profile, or private profiles they follow
CREATE POLICY users_select_policy ON users
  FOR SELECT USING (
    NOT is_private
    OR id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM follows
      WHERE follower_id = current_user_id()
      AND following_id = users.id
      AND status = 'accepted'
    )
  );

-- INSERT: Users can only create their own profile (handled by auth system)
CREATE POLICY users_insert_policy ON users
  FOR INSERT WITH CHECK (id = current_user_id());

-- UPDATE: Users can only update their own profile
CREATE POLICY users_update_policy ON users
  FOR UPDATE USING (id = current_user_id())
  WITH CHECK (id = current_user_id());

-- DELETE: Soft delete only - users can only delete their own account
CREATE POLICY users_delete_policy ON users
  FOR DELETE USING (id = current_user_id());