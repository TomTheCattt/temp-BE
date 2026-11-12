import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

async function test() {
  await client.connect();

  // Check all tables
  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log('All tables:', tables.rows.map(r => r.table_name));

  // Check specific new tables
  for (const table of ['locations', 'hashtags', 'hashtag_usages', 'collections', 'saved_items',
    'stories', 'story_items', 'story_views', 'story_replies', 'reels', 'audio_tracks',
    'comments', 'likes', 'conversations', 'conversation_members', 'messages',
    'message_reactions', 'notifications', 'reports', 'moderation_actions',
    'search_history', 'search_index', 'live_videos', 'live_comments',
    'calls', 'call_participants', 'call_signaling_logs', 'audit_logs',
    'rate_limit_buckets', 'pending_uploads', 'accounts', 'sessions',
    'refresh_tokens', 'verifications', 'restrictions', 'device_tokens']) {
    try {
      const cols = await client.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = '${table}'
        ORDER BY ordinal_position
      `);
      console.log(`${table}: ${cols.rows.length} columns`);
    } catch (e) {
      console.log(`${table}: NOT FOUND`);
    }
  }

  await client.end();
}

test().catch(console.error);