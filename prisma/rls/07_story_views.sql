-- RLS Policies for story_views table
-- Only story author can see views; viewers can see their own view

ALTER TABLE story_views ENABLE ROW LEVEL SECURITY;

-- SELECT: Story author can see all views; viewers can see their own view
CREATE POLICY story_views_select_policy ON story_views
  FOR SELECT USING (
    viewer_id = current_user_id()
    OR EXISTS (
      SELECT 1 FROM stories
      WHERE id = story_views.story_id
      AND author_id = current_user_id()
    )
  );

-- INSERT: Users can record their own view
CREATE POLICY story_views_insert_policy ON story_views
  FOR INSERT WITH CHECK (viewer_id = current_user_id());

-- UPDATE/DELETE: Not typically needed for views
CREATE POLICY story_views_modify_policy ON story_views
  FOR ALL USING (FALSE);