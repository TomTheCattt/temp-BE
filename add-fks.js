import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

async function run() {
  await client.connect();
  console.log('Connected to database');

  // Add foreign keys now that types match
  const foreignKeys = [
    // posts
    `ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "posts" ADD CONSTRAINT "posts_sponsor_user_id_fkey" FOREIGN KEY ("sponsor_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    `ALTER TABLE "posts" ADD CONSTRAINT "posts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL`,
    // media_items
    `ALTER TABLE "media_items" ADD CONSTRAINT "media_items_mediaable_id_fkey" FOREIGN KEY ("mediaable_id") REFERENCES "posts"("id") ON DELETE CASCADE`,
    // comments
    `ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE CASCADE`,
    // likes
    `ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // stories
    `ALTER TABLE "stories" ADD CONSTRAINT "stories_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "stories" ADD CONSTRAINT "stories_reel_id_fkey" FOREIGN KEY ("reel_id") REFERENCES "reels"("id") ON DELETE SET NULL`,
    `ALTER TABLE "stories" ADD CONSTRAINT "stories_shared_from_post_id_fkey" FOREIGN KEY ("shared_from_post_id") REFERENCES "posts"("id") ON DELETE SET NULL`,
    // reels
    `ALTER TABLE "reels" ADD CONSTRAINT "reels_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "reels" ADD CONSTRAINT "reels_audio_id_fkey" FOREIGN KEY ("audio_id") REFERENCES "audio_tracks"("id") ON DELETE SET NULL`,
    // collections
    `ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // saved_items
    `ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL`,
    // story_replies
    `ALTER TABLE "story_replies" ADD CONSTRAINT "story_replies_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE`,
    `ALTER TABLE "story_replies" ADD CONSTRAINT "story_replies_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "story_replies" ADD CONSTRAINT "story_replies_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE`,
    // message_reactions
    `ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE`,
    `ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // reports
    `ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    // moderation_actions
    `ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderator_id_fkey" FOREIGN KEY ("moderator_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // search_history
    `ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // live_videos
    `ALTER TABLE "live_videos" ADD CONSTRAINT "live_videos_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "live_videos" ADD CONSTRAINT "live_videos_co_host_id_fkey" FOREIGN KEY ("co_host_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    // live_comments
    `ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_live_id_fkey" FOREIGN KEY ("live_id") REFERENCES "live_videos"("id") ON DELETE CASCADE`,
    `ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // calls
    `ALTER TABLE "calls" ADD CONSTRAINT "calls_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL`,
    // call_participants
    `ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE`,
    `ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // call_signaling_logs
    `ALTER TABLE "call_signaling_logs" ADD CONSTRAINT "call_signaling_logs_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE`,
    `ALTER TABLE "call_signaling_logs" ADD CONSTRAINT "call_signaling_logs_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "call_participants"("id") ON DELETE SET NULL`,
    // audit_logs
    `ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    // restrictions
    `ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_restrictor_id_fkey" FOREIGN KEY ("restrictor_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_restricted_id_fkey" FOREIGN KEY ("restricted_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // conversations
    `ALTER TABLE "conversations" ADD CONSTRAINT "conversations_group_owner_id_fkey" FOREIGN KEY ("group_owner_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    // conversation_members
    `ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE`,
    `ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // messages
    `ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE`,
    `ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL`,
    // hashtag_usages
    `ALTER TABLE "hashtag_usages" ADD CONSTRAINT "hashtag_usages_hashtag_id_fkey" FOREIGN KEY ("hashtag_id") REFERENCES "hashtags"("id") ON DELETE CASCADE`,
    // accounts
    `ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // sessions
    `ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // refresh_tokens
    `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE`,
    // verifications - user_id doesn't exist in verifications table based on earlier output
    // device_tokens
    `ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // pending_uploads
    `ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // follows
    `ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // blocks
    `ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    // close_friends
    `ALTER TABLE "close_friends" ADD CONSTRAINT "close_friends_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "close_friends" ADD CONSTRAINT "close_friends_friend_id_fkey" FOREIGN KEY ("friend_id") REFERENCES "users"("id") ON DELETE CASCADE`,
  ];

  for (const sql of foreignKeys) {
    try {
      await client.query(sql);
      console.log(`✓ ${sql.substring(0, 80)}...`);
    } catch (e) {
      console.log(`⚠ ${e.message.substring(0, 150)}`);
    }
  }

  await client.end();
  console.log('\n=== FK constraints added ===');
}

run().catch(console.error);