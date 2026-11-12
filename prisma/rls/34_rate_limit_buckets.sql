-- RLS Policies for rate_limit_buckets table

ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see their own rate limit buckets; admins can see all
CREATE POLICY rate_limit_buckets_select_policy ON rate_limit_buckets
  FOR SELECT USING (
    identifier = current_user_id()::TEXT
    OR identifier = 'global'
    OR has_role('admin')
  );

-- INSERT/UPDATE/DELETE: Managed by rate limiting middleware
CREATE POLICY rate_limit_buckets_modify_policy ON rate_limit_buckets
  FOR ALL USING (FALSE);