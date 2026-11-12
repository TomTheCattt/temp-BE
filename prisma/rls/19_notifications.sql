-- RLS Policies for notifications table

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can only see their own notifications
CREATE POLICY notifications_select_policy ON notifications
  FOR SELECT USING (recipient_id = current_user_id());

-- INSERT: System creates notifications (via triggers/service)
CREATE POLICY notifications_insert_policy ON notifications
  FOR INSERT WITH CHECK (FALSE); -- Only via service/triggers

-- UPDATE: Recipients can mark their own notifications as read
CREATE POLICY notifications_update_policy ON notifications
  FOR UPDATE USING (recipient_id = current_user_id())
  WITH CHECK (recipient_id = current_user_id());

-- DELETE: Recipients can dismiss their own notifications
CREATE POLICY notifications_delete_policy ON notifications
  FOR DELETE USING (recipient_id = current_user_id());