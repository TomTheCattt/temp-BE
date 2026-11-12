import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_UNPOOLED);

async function test() {
  // Drop first if exists
  try {
    await sql`DROP MATERIALIZED VIEW IF EXISTS feed_items CASCADE`;
    console.log('DROP succeeded');
  } catch (e) {
    console.log('DROP error:', e.message);
  }

  // Try to create the materialized view with the actual definition
  const mvSql = `
  CREATE MATERIALIZED VIEW feed_items AS
  SELECT p.id AS post_id, p.author_id, p.caption, p.created_at
  FROM posts p
  WHERE p.deleted_at IS NULL
    AND p.created_at > NOW() - INTERVAL '30 days'
  ORDER BY created_at DESC;
  `;

  try {
    console.log('Creating materialized view...');
    await sql.unsafe(mvSql);
    console.log('CREATE MATERIALIZED VIEW succeeded');
  } catch (e) {
    console.log('CREATE MATERIALIZED VIEW error:', e.message);
  }

  // Verify immediately in same script
  try {
    const mv = await sql`SELECT * FROM pg_matviews WHERE matviewname = 'feed_items'`;
    console.log('Materialized view in pg_matviews:', mv.length > 0 ? 'EXISTS' : 'NOT FOUND');

    const result = await sql`SELECT COUNT(*) as count FROM feed_items`;
    console.log('Direct query to feed_items:', result);
  } catch (e) {
    console.log('Verification error:', e.message);
  }
}

test().catch(console.error);