import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_UNPOOLED);

async function verify() {
  // Check materialized view exists - query pg_matviews
  const mv = await sql`SELECT * FROM pg_matviews WHERE matviewname = 'feed_items'`;
  console.log('Materialized view in pg_matviews:', mv.length > 0 ? 'EXISTS' : 'NOT FOUND');

  // Try to query the materialized view directly
  try {
    const result = await sql`SELECT COUNT(*) as count FROM feed_items`;
    console.log('Direct query to feed_items:', result);
  } catch (e) {
    console.log('Direct query error:', e.message);
  }

  // Check pg_cron extension
  const ext = await sql`SELECT * FROM pg_extension WHERE extname = 'pg_cron'`;
  console.log('pg_cron extension:', ext.length > 0 ? 'ENABLED' : 'NOT ENABLED');

  // Check cron schema
  const cronSchema = await sql`SELECT * FROM pg_namespace WHERE nspname = 'cron'`;
  console.log('cron schema:', cronSchema.length > 0 ? 'EXISTS' : 'NOT EXISTS');

  // Check all tables in public schema
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%feed%'`;
  console.log('Feed-related tables:', tables);

  // Check triggers
  const triggers = await sql`SELECT * FROM information_schema.triggers WHERE trigger_name LIKE 'trigger_feed_invalidate%'`;
  console.log('Triggers:', triggers);

  // Check sponsored tables
  const sponsoredTables = await sql`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'sponsored_%'`;
  console.log('Sponsored tables:', sponsoredTables);

  // Check current database and schema
  const dbInfo = await sql`SELECT current_database(), current_schema()`;
  console.log('Current DB/Schema:', dbInfo[0]);
}

verify().catch(console.error);