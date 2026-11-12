import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

async function run() {
  await client.connect();

  // Check comments table
  const commentsCols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'comments'
    ORDER BY ordinal_position
  `);
  console.log('Comments columns:', commentsCols.rows);

  // Check likes table
  const likesCols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'likes'
    ORDER BY ordinal_position
  `);
  console.log('Likes columns:', likesCols.rows);

  // Check stories table
  const storiesCols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'stories'
    ORDER BY ordinal_position
  `);
  console.log('Stories columns:', storiesCols.rows);

  // Check if tables exist
  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('collections', 'saved_items', 'story_replies', 'message_reactions',
      'reports', 'moderation_actions', 'search_history', 'search_index',
      'live_videos', 'live_comments', 'calls', 'call_participants',
      'call_signaling_logs', 'audit_logs', 'restrictions')
    ORDER BY table_name
  `);
  console.log('Target tables:', tables.rows.map(r => r.table_name));

  await client.end();
}

run().catch(console.error);