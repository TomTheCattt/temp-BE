import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

async function run() {
  await client.connect();
  console.log('Connected to database');

  // First, fix comments table - drop and recreate with polymorphic columns
  console.log('\n--- Fixing comments table ---');
  try {
    await client.query(`DROP TABLE IF EXISTS "comments" CASCADE`);
    console.log('✓ Dropped old comments');
  } catch (e) {
    console.log('⚠ Drop comments:', e.message);
  }

  try {
    await client.query(`
      CREATE TABLE "comments" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "commentable_type" VARCHAR(10) NOT NULL,
        "commentable_id" UUID NOT NULL,
        "author_id" UUID NOT NULL,
        "parent_id" UUID,
        "text" TEXT NOT NULL,
        "likes_count" INTEGER DEFAULT 0 NOT NULL,
        "replies_count" INTEGER DEFAULT 0 NOT NULL,
        "is_hidden" BOOLEAN DEFAULT FALSE NOT NULL,
        "hidden_reason" VARCHAR(50),
        "hidden_by" UUID,
        "hidden_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        "deleted_at" TIMESTAMP WITH TIME ZONE
      )
    `);
    console.log('✓ Created comments');
  } catch (e) {
    console.log('⚠ Create comments:', e.message);
  }

  // Fix likes table - drop and recreate with polymorphic columns
  console.log('\n--- Fixing likes table ---');
  try {
    await client.query(`DROP TABLE IF EXISTS "likes" CASCADE`);
    console.log('✓ Dropped old likes');
  } catch (e) {
    console.log('⚠ Drop likes:', e.message);
  }

  try {
    await client.query(`
      CREATE TABLE "likes" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "likeable_type" VARCHAR(10) NOT NULL,
        "likeable_id" UUID NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )
    `);
    console.log('✓ Created likes');
  } catch (e) {
    console.log('⚠ Create likes:', e.message);
  }

  // Fix stories table - add missing columns
  console.log('\n--- Fixing stories table ---');
  const storyAlters = [
    `ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "audience" VARCHAR(20) DEFAULT 'followers' NOT NULL`,
    `ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "views_count" INTEGER DEFAULT 0 NOT NULL`,
    `ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "replies_count" INTEGER DEFAULT 0 NOT NULL`,
    `ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "reel_id" UUID`,
    `ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "shared_from_post_id" UUID`,
    `ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE`,
  ];

  for (const sql of storyAlters) {
    try {
      await client.query(sql);
      console.log(`✓ ${sql.substring(0, 60)}...`);
    } catch (e) {
      console.log(`⚠ ${e.message.substring(0, 100)}`);
    }
  }

  // Fix reels table - add missing audio_id column
  console.log('\n--- Fixing reels table ---');
  try {
    await client.query(`ALTER TABLE "reels" ADD COLUMN IF NOT EXISTS "audio_id" UUID`);
    console.log('✓ Added audio_id to reels');
  } catch (e) {
    console.log('⚠ Add audio_id:', e.message);
  }

  // Create missing tables WITHOUT foreign keys
  console.log('\n--- Creating missing tables (no FKs) ---');
  const tablesNoFK = [
    // collections
    `CREATE TABLE IF NOT EXISTS "collections" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" UUID NOT NULL,
      "name" VARCHAR(100) NOT NULL,
      "is_default" BOOLEAN DEFAULT FALSE NOT NULL,
      "cover_media_id" UUID,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // saved_items
    `CREATE TABLE IF NOT EXISTS "saved_items" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" UUID NOT NULL,
      "collection_id" UUID,
      "saveable_type" VARCHAR(10) NOT NULL,
      "saveable_id" UUID NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // story_replies
    `CREATE TABLE IF NOT EXISTS "story_replies" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "story_id" UUID NOT NULL,
      "sender_id" UUID NOT NULL,
      "message_id" UUID NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // message_reactions
    `CREATE TABLE IF NOT EXISTS "message_reactions" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "message_id" UUID NOT NULL,
      "user_id" UUID NOT NULL,
      "emoji" VARCHAR(10) NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // reports
    `CREATE TABLE IF NOT EXISTS "reports" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "reporter_id" UUID NOT NULL,
      "reported_type" VARCHAR(20) NOT NULL,
      "reported_id" UUID NOT NULL,
      "reason" VARCHAR(20) NOT NULL,
      "description" TEXT,
      "status" VARCHAR(20) DEFAULT 'PENDING' NOT NULL,
      "resolution" VARCHAR(50),
      "resolved_by" UUID,
      "resolved_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // moderation_actions
    `CREATE TABLE IF NOT EXISTS "moderation_actions" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "moderator_id" UUID NOT NULL,
      "target_type" VARCHAR(20) NOT NULL,
      "target_id" UUID NOT NULL,
      "action" VARCHAR(30) NOT NULL,
      "reason" TEXT,
      "duration" VARCHAR(50),
      "expires_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // search_history
    `CREATE TABLE IF NOT EXISTS "search_history" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" UUID NOT NULL,
      "query" TEXT NOT NULL,
      "result_type" VARCHAR(20),
      "result_count" INTEGER,
      "clicked_result_id" UUID,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // search_index (already exists)
    // live_videos
    `CREATE TABLE IF NOT EXISTS "live_videos" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "host_id" UUID NOT NULL,
      "co_host_id" UUID,
      "title" VARCHAR(200),
      "status" VARCHAR(20) DEFAULT 'SCHEDULED' NOT NULL,
      "stream_key" UUID DEFAULT gen_random_uuid() NOT NULL,
      "playback_url" VARCHAR(500),
      "viewer_count" INTEGER DEFAULT 0 NOT NULL,
      "peak_viewers" INTEGER DEFAULT 0 NOT NULL,
      "total_views" INTEGER DEFAULT 0 NOT NULL,
      "scheduled_at" TIMESTAMP WITH TIME ZONE,
      "started_at" TIMESTAMP WITH TIME ZONE,
      "ended_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // live_comments
    `CREATE TABLE IF NOT EXISTS "live_comments" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "live_id" UUID NOT NULL,
      "user_id" UUID NOT NULL,
      "text" TEXT NOT NULL,
      "is_pinned" BOOLEAN DEFAULT FALSE NOT NULL,
      "is_hidden" BOOLEAN DEFAULT FALSE NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // calls
    `CREATE TABLE IF NOT EXISTS "calls" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "type" VARCHAR(20) NOT NULL,
      "status" VARCHAR(20) DEFAULT 'INITIATED' NOT NULL,
      "initiator_id" UUID NOT NULL,
      "conversation_id" UUID,
      "max_participants" INTEGER DEFAULT 2 NOT NULL,
      "is_recording" BOOLEAN DEFAULT FALSE NOT NULL,
      "recording_url" VARCHAR(500),
      "started_at" TIMESTAMP WITH TIME ZONE,
      "ended_at" TIMESTAMP WITH TIME ZONE,
      "duration_seconds" INTEGER DEFAULT 0 NOT NULL,
      "media_server_id" UUID,
      "room_id" VARCHAR(100),
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // call_participants
    `CREATE TABLE IF NOT EXISTS "call_participants" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "call_id" UUID NOT NULL,
      "user_id" UUID NOT NULL,
      "status" VARCHAR(20) DEFAULT 'INVITED' NOT NULL,
      "is_muted" BOOLEAN DEFAULT FALSE NOT NULL,
      "is_video_off" BOOLEAN DEFAULT FALSE NOT NULL,
      "is_screen_share" BOOLEAN DEFAULT FALSE NOT NULL,
      "connection_quality" VARCHAR(20),
      "device_type" VARCHAR(20),
      "app_version" VARCHAR(20),
      "joined_at" TIMESTAMP WITH TIME ZONE,
      "left_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // call_signaling_logs
    `CREATE TABLE IF NOT EXISTS "call_signaling_logs" (
      "id" BIGSERIAL PRIMARY KEY,
      "call_id" UUID NOT NULL,
      "participant_id" UUID,
      "direction" VARCHAR(10) NOT NULL,
      "message_type" VARCHAR(50) NOT NULL,
      "payload" JSONB NOT NULL,
      "sequence_id" BIGINT,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // audit_logs
    `CREATE TABLE IF NOT EXISTS "audit_logs" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "actor_id" UUID,
      "actor_ip" INET,
      "actor_user_agent" TEXT,
      "action" VARCHAR(100) NOT NULL,
      "resource_type" VARCHAR(50),
      "resource_id" UUID,
      "old_values" JSONB,
      "new_values" JSONB,
      "correlation_id" UUID,
      "session_id" UUID,
      "request_id" UUID,
      "metadata" JSONB DEFAULT '{}' NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
    // restrictions
    `CREATE TABLE IF NOT EXISTS "restrictions" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "restrictor_id" UUID NOT NULL,
      "restricted_id" UUID NOT NULL,
      "hide_comments" BOOLEAN DEFAULT TRUE NOT NULL,
      "dm_to_requests" BOOLEAN DEFAULT TRUE NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )`,
  ];

  for (const sql of tablesNoFK) {
    try {
      await client.query(sql);
      console.log('✓ Created table');
    } catch (e) {
      console.log(`⚠ ${e.message.substring(0, 100)}`);
    }
  }

  // Now add foreign keys
  console.log('\n--- Adding foreign keys ---');
  const foreignKeys = [
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
    // media_items - add FKs
    `ALTER TABLE "media_items" ADD CONSTRAINT "media_items_mediaable_id_fkey" FOREIGN KEY ("mediaable_id") REFERENCES "posts"("id") ON DELETE CASCADE`,
    // posts
    `ALTER TABLE "posts" ADD CONSTRAINT "posts_sponsor_user_id_fkey" FOREIGN KEY ("sponsor_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    `ALTER TABLE "posts" ADD CONSTRAINT "posts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL`,
    // hashtag_usages
    `ALTER TABLE "hashtag_usages" ADD CONSTRAINT "hashtag_usages_hashtag_id_fkey" FOREIGN KEY ("hashtag_id") REFERENCES "hashtags"("id") ON DELETE CASCADE`,
  ];

  for (const sql of foreignKeys) {
    try {
      await client.query(sql);
      console.log(`✓ FK`);
    } catch (e) {
      console.log(`⚠ FK: ${e.message.substring(0, 100)}`);
    }
  }

  // Create indexes
  console.log('\n--- Creating indexes ---');
  const indexes = [
    `CREATE INDEX IF NOT EXISTS "comments_thread_idx" ON "comments" USING btree ("commentable_type", "commentable_id", "parent_id", "created_at")`,
    `CREATE INDEX IF NOT EXISTS "comments_author_idx" ON "comments" USING btree ("author_id", "created_at" DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "likes_unique" ON "likes" USING btree ("user_id", "likeable_type", "likeable_id")`,
    `CREATE INDEX IF NOT EXISTS "likes_likeable_idx" ON "likes" USING btree ("likeable_type", "likeable_id")`,
    `CREATE INDEX IF NOT EXISTS "likes_user_idx" ON "likes" USING btree ("user_id", "created_at" DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "collections_unique" ON "collections" USING btree ("user_id", "name")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "saved_items_unique" ON "saved_items" USING btree ("user_id", "saveable_type", "saveable_id")`,
    `CREATE INDEX IF NOT EXISTS "saved_items_user_idx" ON "saved_items" USING btree ("user_id", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "hashtags_tag_idx" ON "hashtags" USING btree ("tag")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "hashtag_usages_unique" ON "hashtag_usages" USING btree ("hashtag_id", "usage_type", "usage_id")`,
    `CREATE INDEX IF NOT EXISTS "hashtag_usages_usage_idx" ON "hashtag_usages" USING btree ("usage_type", "usage_id")`,
    `CREATE INDEX IF NOT EXISTS "locations_geo_idx" ON "locations" USING gist ("lat", "lng")`,
    `CREATE INDEX IF NOT EXISTS "reels_author_created_idx" ON "reels" USING btree ("author_id", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "reels_explore_idx" ON "reels" USING btree ("created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "reels_search_vector_idx" ON "reels" USING gin ("search_vector")`,
    `CREATE INDEX IF NOT EXISTS "stories_author_expires_idx" ON "stories" USING btree ("author_id", "expires_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "stories_expires_idx" ON "stories" USING btree ("expires_at")`,
    `CREATE INDEX IF NOT EXISTS "story_items_story_id_idx" ON "story_items" USING btree ("story_id", "sort_order")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "story_views_unique" ON "story_views" USING btree ("story_id", "viewer_id")`,
    `CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type", "resource_id", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "rate_limit_buckets_unique" ON "rate_limit_buckets" USING btree ("identifier", "endpoint", "window_start")`,
    `CREATE INDEX IF NOT EXISTS "rate_limit_buckets_lookup_idx" ON "rate_limit_buckets" USING btree ("identifier", "endpoint", "window_end")`,
    `CREATE INDEX IF NOT EXISTS "rate_limit_buckets_cleanup_idx" ON "rate_limit_buckets" USING btree ("window_end")`,
    `CREATE INDEX IF NOT EXISTS "pending_uploads_confirmed_idx" ON "pending_uploads" USING btree ("confirmed", "created_at")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "search_index_unique" ON "search_index" USING btree ("content_type", "content_id")`,
    `CREATE INDEX IF NOT EXISTS "search_index_embedding_idx" ON "search_index" USING hnsw ("embedding" vector_l2_ops)`,
    `CREATE INDEX IF NOT EXISTS "search_index_type_popularity_idx" ON "search_index" USING btree ("content_type", "popularity_score" DESC)`,
    `CREATE INDEX IF NOT EXISTS "search_index_vector_idx" ON "search_index" USING gin ("search_vector")`,
  ];

  for (const sql of indexes) {
    try {
      await client.query(sql);
      console.log(`✓ IDX`);
    } catch (e) {
      console.log(`⚠ IDX: ${e.message.substring(0, 100)}`);
    }
  }

  await client.end();
  console.log('\n=== Fix completed ===');
}

run().catch(console.error);