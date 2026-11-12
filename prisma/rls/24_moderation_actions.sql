-- RLS Policies for moderation_actions table

ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;

-- SELECT: Moderators can see all; users can see actions against them
CREATE POLICY moderation_actions_select_policy ON moderation_actions
  FOR SELECT USING (
    has_role('moderator')
    OR (
      target_type = 'user'
      AND target_id = current_user_id()
    )
  );

-- INSERT: Only moderators can create moderation actions
CREATE POLICY moderation_actions_insert_policy ON moderation_actions
  FOR INSERT WITH CHECK (has_role('moderator'));

-- UPDATE/DELETE: Only moderators
CREATE POLICY moderation_actions_modify_policy ON moderation_actions
  FOR ALL USING (has_role('moderator'));