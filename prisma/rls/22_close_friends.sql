-- RLS Policies for close_friends table

ALTER TABLE close_friends ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own close friends list
CREATE POLICY close_friends_select_policy ON close_friends
  FOR SELECT USING (user_id = current_user_id());

-- INSERT: Users can add close friends
CREATE POLICY close_friends_insert_policy ON close_friends
  FOR INSERT WITH CHECK (user_id = current_user_id());

-- DELETE: Users can remove close friends
CREATE POLICY close_friends_delete_policy ON close_friends
  FOR DELETE USING (user_id = current_user_id());