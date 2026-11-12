-- ============================================================
-- RLS POLICIES GENERATED FROM POLICY ENGINE
-- ============================================================

-- This file is auto-generated. Do not edit manually.
-- Run: npx ts-node scripts/sync-rls-policies.ts

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for posts
DROP POLICY IF EXISTS posts_read_allow_policy ON posts;
DROP POLICY IF EXISTS posts_create_allow_policy ON posts;
DROP POLICY IF EXISTS posts_update_allow_policy ON posts;
DROP POLICY IF EXISTS posts_delete_allow_policy ON posts;

CREATE POLICY posts_read_allow_policy ON posts FOR SELECT USING ((audience = 'PUBLIC') OR (author_id = current_user_id()) OR (audience = 'FOLLOWERS' AND EXISTS (
              SELECT 1 FROM follows
              WHERE follows.following_id = posts.author_id AND follows.follower_id = current_user_id() AND follows.status = 'ACCEPTED'
              AND follows.status = 'ACCEPTED'
            )) OR (closefriendsonly = true AND EXISTS (
            SELECT 1 FROM close_friends
            WHERE close_friends.user_id = posts.author_id AND close_friends.friend_id = current_user_id()
          )));
CREATE POLICY posts_create_allow_policy ON posts FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY posts_update_allow_policy ON posts FOR UPDATE USING (author_id = current_user_id()) WITH CHECK (author_id = current_user_id());
CREATE POLICY posts_delete_allow_policy ON posts FOR DELETE USING (author_id = current_user_id());

ALTER TABLE reels ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for reels
DROP POLICY IF EXISTS reels_read_allow_policy ON reels;
DROP POLICY IF EXISTS reels_create_allow_policy ON reels;
DROP POLICY IF EXISTS reels_update_allow_policy ON reels;
DROP POLICY IF EXISTS reels_delete_allow_policy ON reels;

CREATE POLICY reels_read_allow_policy ON reels FOR SELECT USING ((audience = 'PUBLIC') OR (author_id = current_user_id()) OR (audience = 'FOLLOWERS' AND EXISTS (
              SELECT 1 FROM follows
              WHERE follows.following_id = reels.author_id AND follows.follower_id = current_user_id() AND follows.status = 'ACCEPTED'
              AND follows.status = 'ACCEPTED'
            )));
CREATE POLICY reels_create_allow_policy ON reels FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY reels_update_allow_policy ON reels FOR UPDATE USING (author_id = current_user_id()) WITH CHECK (author_id = current_user_id());
CREATE POLICY reels_delete_allow_policy ON reels FOR DELETE USING (author_id = current_user_id());

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for stories
DROP POLICY IF EXISTS stories_read_allow_policy ON stories;
DROP POLICY IF EXISTS stories_create_allow_policy ON stories;
DROP POLICY IF EXISTS stories_delete_allow_policy ON stories;

CREATE POLICY stories_read_allow_policy ON stories FOR SELECT USING ((author_id = current_user_id()) OR (audience = 'followers' AND EXISTS (
              SELECT 1 FROM follows
              WHERE follows.following_id = stories.author_id AND follows.follower_id = current_user_id() AND follows.status = 'ACCEPTED'
              AND follows.status = 'ACCEPTED'
            )) OR (audience = 'close_friends' AND EXISTS (
            SELECT 1 FROM close_friends
            WHERE close_friends.user_id = stories.author_id AND close_friends.friend_id = current_user_id()
          )));
CREATE POLICY stories_create_allow_policy ON stories FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY stories_delete_allow_policy ON stories FOR DELETE USING (author_id = current_user_id());

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for comments
DROP POLICY IF EXISTS comments_read_allow_policy ON comments;
DROP POLICY IF EXISTS comments_create_allow_policy ON comments;
DROP POLICY IF EXISTS comments_update_allow_policy ON comments;
DROP POLICY IF EXISTS comments_delete_allow_policy ON comments;

CREATE POLICY comments_read_allow_policy ON comments FOR SELECT USING ((ishidden = false) OR (author_id = current_user_id()));
CREATE POLICY comments_create_allow_policy ON comments FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY comments_update_allow_policy ON comments FOR UPDATE USING (author_id = current_user_id()) WITH CHECK (author_id = current_user_id());
CREATE POLICY comments_delete_allow_policy ON comments FOR DELETE USING (author_id = current_user_id());

ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for likes
DROP POLICY IF EXISTS likes_read_allow_policy ON likes;
DROP POLICY IF EXISTS likes_create_allow_policy ON likes;
DROP POLICY IF EXISTS likes_delete_allow_policy ON likes;

CREATE POLICY likes_read_allow_policy ON likes FOR SELECT USING (TRUE);
CREATE POLICY likes_create_allow_policy ON likes FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY likes_delete_allow_policy ON likes FOR DELETE USING (user_id = current_user_id());

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for conversations
DROP POLICY IF EXISTS conversations_read_allow_policy ON conversations;
DROP POLICY IF EXISTS conversations_create_allow_policy ON conversations;
DROP POLICY IF EXISTS conversations_update_allow_policy ON conversations;

CREATE POLICY conversations_read_allow_policy ON conversations FOR SELECT USING (TRUE);
CREATE POLICY conversations_create_allow_policy ON conversations FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY conversations_update_allow_policy ON conversations FOR UPDATE USING (EXISTS (
              SELECT 1 FROM conversation_members
              WHERE conversation_members.conversation_id = id
              AND conversation_members.user_id = current_user_id()
              AND conversation_members.role IN ('owner', 'admin')
            )) WITH CHECK (EXISTS (
              SELECT 1 FROM conversation_members
              WHERE conversation_members.conversation_id = id
              AND conversation_members.user_id = current_user_id()
              AND conversation_members.role IN ('owner', 'admin')
            ));

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for messages
DROP POLICY IF EXISTS messages_read_allow_policy ON messages;
DROP POLICY IF EXISTS messages_create_allow_policy ON messages;
DROP POLICY IF EXISTS messages_update_allow_policy ON messages;
DROP POLICY IF EXISTS messages_delete_allow_policy ON messages;

CREATE POLICY messages_read_allow_policy ON messages FOR SELECT USING (EXISTS (
            SELECT 1 FROM conversation_members
            WHERE conversation_members.conversation_id = id
            AND conversation_members.user_id = current_user_id()
            AND conversation_members.left_at IS NULL
          ));
CREATE POLICY messages_create_allow_policy ON messages FOR INSERT WITH CHECK (EXISTS (
            SELECT 1 FROM conversation_members
            WHERE conversation_members.conversation_id = id
            AND conversation_members.user_id = current_user_id()
            AND conversation_members.left_at IS NULL
          ));
CREATE POLICY messages_update_allow_policy ON messages FOR UPDATE USING (sender_id = current_user_id() AND created_at > NOW() - INTERVAL '10 minutes') WITH CHECK (sender_id = current_user_id() AND created_at > NOW() - INTERVAL '10 minutes');
CREATE POLICY messages_delete_allow_policy ON messages FOR DELETE USING (sender_id = current_user_id());

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for notifications
DROP POLICY IF EXISTS notifications_read_allow_policy ON notifications;
DROP POLICY IF EXISTS notifications_update_allow_policy ON notifications;

CREATE POLICY notifications_read_allow_policy ON notifications FOR SELECT USING (recipient_id = current_user_id());
CREATE POLICY notifications_update_allow_policy ON notifications FOR UPDATE USING (recipient_id = current_user_id()) WITH CHECK (recipient_id = current_user_id());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for users
DROP POLICY IF EXISTS users_read_allow_policy ON users;
DROP POLICY IF EXISTS users_update_allow_policy ON users;

CREATE POLICY users_read_allow_policy ON users FOR SELECT USING ((isprivate = false) OR (id = current_user_id()) OR (isprivate = true AND EXISTS (
              SELECT 1 FROM follows
              WHERE follows.following_id = users.id AND follows.follower_id = current_user_id() AND follows.status = 'ACCEPTED'
              AND follows.status = 'ACCEPTED'
            )));
CREATE POLICY users_update_allow_policy ON users FOR UPDATE USING (id = current_user_id()) WITH CHECK (id = current_user_id());

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for follows
DROP POLICY IF EXISTS follows_read_allow_policy ON follows;
DROP POLICY IF EXISTS follows_create_allow_policy ON follows;
DROP POLICY IF EXISTS follows_update_allow_policy ON follows;
DROP POLICY IF EXISTS follows_delete_allow_policy ON follows;
DROP POLICY IF EXISTS follows_create_deny_policy ON follows;

CREATE POLICY follows_read_allow_policy ON follows FOR SELECT USING ((follower_id = current_user_id()) OR (follower_id = current_user_id()));
CREATE POLICY follows_create_allow_policy ON follows FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY follows_update_allow_policy ON follows FOR UPDATE USING (follower_id = current_user_id()) WITH CHECK (follower_id = current_user_id());
CREATE POLICY follows_delete_allow_policy ON follows FOR DELETE USING (follower_id = current_user_id());
CREATE POLICY follows_create_deny_policy ON follows FOR INSERT WITH CHECK (TRUE);

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for blocks
DROP POLICY IF EXISTS blocks_read_allow_policy ON blocks;
DROP POLICY IF EXISTS blocks_create_allow_policy ON blocks;
DROP POLICY IF EXISTS blocks_delete_allow_policy ON blocks;

CREATE POLICY blocks_read_allow_policy ON blocks FOR SELECT USING (blocker_id = current_user_id());
CREATE POLICY blocks_create_allow_policy ON blocks FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY blocks_delete_allow_policy ON blocks FOR DELETE USING (blocker_id = current_user_id());

ALTER TABLE restrictions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for restrictions
DROP POLICY IF EXISTS restrictions_read_allow_policy ON restrictions;
DROP POLICY IF EXISTS restrictions_create_allow_policy ON restrictions;
DROP POLICY IF EXISTS restrictions_delete_allow_policy ON restrictions;

CREATE POLICY restrictions_read_allow_policy ON restrictions FOR SELECT USING (restrictor_id = current_user_id());
CREATE POLICY restrictions_create_allow_policy ON restrictions FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY restrictions_delete_allow_policy ON restrictions FOR DELETE USING (restrictor_id = current_user_id());

ALTER TABLE close_friends ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for close_friends
DROP POLICY IF EXISTS close_friends_read_allow_policy ON close_friends;
DROP POLICY IF EXISTS close_friends_create_allow_policy ON close_friends;
DROP POLICY IF EXISTS close_friends_delete_allow_policy ON close_friends;

CREATE POLICY close_friends_read_allow_policy ON close_friends FOR SELECT USING (user_id = current_user_id());
CREATE POLICY close_friends_create_allow_policy ON close_friends FOR INSERT WITH CHECK (user_id = current_user_id());
CREATE POLICY close_friends_delete_allow_policy ON close_friends FOR DELETE USING (user_id = current_user_id());

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for collections
DROP POLICY IF EXISTS collections_read_allow_policy ON collections;
DROP POLICY IF EXISTS collections_create_allow_policy ON collections;
DROP POLICY IF EXISTS collections_update_allow_policy ON collections;
DROP POLICY IF EXISTS collections_delete_allow_policy ON collections;

CREATE POLICY collections_read_allow_policy ON collections FOR SELECT USING (user_id = current_user_id());
CREATE POLICY collections_create_allow_policy ON collections FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY collections_update_allow_policy ON collections FOR UPDATE USING (user_id = current_user_id()) WITH CHECK (user_id = current_user_id());
CREATE POLICY collections_delete_allow_policy ON collections FOR DELETE USING (user_id = current_user_id());

ALTER TABLE saved_items ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for saved_items
DROP POLICY IF EXISTS saved_items_read_allow_policy ON saved_items;
DROP POLICY IF EXISTS saved_items_create_allow_policy ON saved_items;
DROP POLICY IF EXISTS saved_items_delete_allow_policy ON saved_items;

CREATE POLICY saved_items_read_allow_policy ON saved_items FOR SELECT USING (user_id = current_user_id());
CREATE POLICY saved_items_create_allow_policy ON saved_items FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY saved_items_delete_allow_policy ON saved_items FOR DELETE USING (user_id = current_user_id());

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for device_tokens
DROP POLICY IF EXISTS device_tokens_read_allow_policy ON device_tokens;
DROP POLICY IF EXISTS device_tokens_create_allow_policy ON device_tokens;
DROP POLICY IF EXISTS device_tokens_update_allow_policy ON device_tokens;
DROP POLICY IF EXISTS device_tokens_delete_allow_policy ON device_tokens;

CREATE POLICY device_tokens_read_allow_policy ON device_tokens FOR SELECT USING (user_id = current_user_id());
CREATE POLICY device_tokens_create_allow_policy ON device_tokens FOR INSERT WITH CHECK (user_id = current_user_id());
CREATE POLICY device_tokens_update_allow_policy ON device_tokens FOR UPDATE USING (user_id = current_user_id()) WITH CHECK (user_id = current_user_id());
CREATE POLICY device_tokens_delete_allow_policy ON device_tokens FOR DELETE USING (user_id = current_user_id());

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for calls
DROP POLICY IF EXISTS calls_read_allow_policy ON calls;
DROP POLICY IF EXISTS calls_create_allow_policy ON calls;
DROP POLICY IF EXISTS calls_update_allow_policy ON calls;

CREATE POLICY calls_read_allow_policy ON calls FOR SELECT USING (TRUE);
CREATE POLICY calls_create_allow_policy ON calls FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY calls_update_allow_policy ON calls FOR UPDATE USING (initiator_id = current_user_id()) WITH CHECK (initiator_id = current_user_id());

ALTER TABLE call_participants ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for call_participants
DROP POLICY IF EXISTS call_participants_read_allow_policy ON call_participants;
DROP POLICY IF EXISTS call_participants_update_allow_policy ON call_participants;

CREATE POLICY call_participants_read_allow_policy ON call_participants FOR SELECT USING (EXISTS (
            SELECT 1 FROM call_participants
            WHERE call_participants.call_id = id
            AND call_participants.user_id = current_user_id()
            AND call_participants.status IN ('INVITED', 'JOINING', 'CONNECTED', 'RECONNECTING')
          ));
CREATE POLICY call_participants_update_allow_policy ON call_participants FOR UPDATE USING (user_id = current_user_id()) WITH CHECK (user_id = current_user_id());

ALTER TABLE live_videos ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for live_videos
DROP POLICY IF EXISTS live_videos_read_allow_policy ON live_videos;
DROP POLICY IF EXISTS live_videos_create_allow_policy ON live_videos;

CREATE POLICY live_videos_read_allow_policy ON live_videos FOR SELECT USING ((status = 'LIVE') OR (host_id = current_user_id()));
CREATE POLICY live_videos_create_allow_policy ON live_videos FOR INSERT WITH CHECK ((has_role('user')) AND isverified = true);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for reports
DROP POLICY IF EXISTS reports_read_allow_policy ON reports;
DROP POLICY IF EXISTS reports_create_allow_policy ON reports;
DROP POLICY IF EXISTS reports_update_allow_policy ON reports;

CREATE POLICY reports_read_allow_policy ON reports FOR SELECT USING ((reporter_id = current_user_id()) OR ((has_role('moderator') OR has_role('admin'))));
CREATE POLICY reports_create_allow_policy ON reports FOR INSERT WITH CHECK ((has_role('user')));
CREATE POLICY reports_update_allow_policy ON reports FOR UPDATE USING ((has_role('moderator') OR has_role('admin'))) WITH CHECK ((has_role('moderator') OR has_role('admin')));

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
BEGIN
  -- Try to get from session variable (set by middleware)
  IF current_setting('app.current_user_id', true) != '' THEN
    RETURN current_setting('app.current_user_id')::UUID;
  END IF;

  -- Fallback: try to get from auth.uid() if using Supabase-style auth
  -- This would need to be adapted based on your auth system
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_role(role_name TEXT) RETURNS BOOLEAN AS $$
BEGIN
  -- Check if current user has the specified role
  -- This would need to be implemented based on your role system
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;