-- RLS Policies for search_history table

ALTER TABLE search_history ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own search history
CREATE POLICY search_history_select_policy ON search_history
  FOR SELECT USING (user_id = current_user_id());

-- INSERT: Users can record their own searches
CREATE POLICY search_history_insert_policy ON search_history
  FOR INSERT WITH CHECK (user_id = current_user_id());

-- DELETE: Users can delete their own search history
CREATE POLICY search_history_delete_policy ON search_history
  FOR DELETE USING (user_id = current_user_id());