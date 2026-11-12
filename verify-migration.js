import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_UNPOOLED);

async function verify() {
  // Check materialized view exists
  const mv = await sql`SELECT * FROM pg_matviews WHERE matviewname = 'feed_items'`;
  console.log('Materialized view:', mv.length > 0 ? 'EXISTS' : 'NOT FOUND');
  if (mv.length > 0) {
    console.log('  Definition:', mv[0].definition.substring(0, 200) + '...');
  }

  // Check pg_cron jobs
  const cron = await sql`SELECT * FROM cron.job WHERE jobname LIKE '%feed%'`;
  console.log('pg_cron jobs:', cron);

  // Check triggers
  const triggers = await sql`SELECT * FROM information_schema.triggers WHERE trigger_name LIKE 'trigger_feed_invalidate%'`;
  console.log('Triggers:', triggers);

  // Check sponsored tables
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'sponsored_%'`;
  console.log('Sponsored tables:', tables);

  // Check columns of feed_items
  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'feed_items' ORDER BY ordinal_position`;
  console.log('feed_items columns:', cols);
}

verify().catch(console.error);