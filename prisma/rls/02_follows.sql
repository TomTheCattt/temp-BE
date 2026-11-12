-- RLS Policies for follows table

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own follows/followers, or accepted follows of public users
CREATE POLICY follows_select_policy ON follows
  FOR SELECT USING (
    follower_id = current_user_id()
    OR following_id = current_user_id()
    OR (
      status = 'accepted'
      AND (
        SELECT is_private FROM users WHERE id = follows.follower_id
      ) = FALSE
    )
  );

-- INSERT: Users can only create follow requests for themselves
CREATE POLICY follows_insert_policy ON follows
  FOR INSERT WITH CHECK (follower_id = current_user_id());

-- UPDATE: Users can update their own follow status (accept/decline requests)
CREATE POLICY follows_update_policy ON follows
  FOR UPDATE USING (
    follower_id = current_user_id()
    OR following_id = current_user_id()
  )
  WITH CHECK (
    follower_id = current_user_id()
    OR following_id = current_user_id()
  );

-- DELETE: Users can unfollow (delete their own follow) or remove followers
CREATE POLICY follows_delete_policy ON follows
  FOR DELETE USING (
    follower_id = current_user_id()
    OR following_id = current_user_id()
  );