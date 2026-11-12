import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

async function test() {
  await client.connect();
  console.log('Connected');

  // Drop first if exists
  try {
    await client.query(`DROP MATERIALIZED VIEW IF EXISTS feed_items CASCADE`);
    console.log('DROP succeeded');
  } catch (e) {
    console.log('DROP error:', e.message);
  }

  // Try to create the materialized view
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
    await client.query(mvSql);
    console.log('CREATE MATERIALIZED VIEW succeeded');
  } catch (e) {
    console.log('CREATE MATERIALIZED VIEW error:', e.message);
  }

  // Verify immediately
  try {
    const mv = await client.query(`SELECT * FROM pg_matviews WHERE matviewname = 'feed_items'`);
    console.log('Materialized view in pg_matviews:', mv.rows.length > 0 ? 'EXISTS' : 'NOT FOUND');
    if (mv.rows.length > 0) {
      console.log('Definition:', mv.rows[0].definition.substring(0, 200));
    }

    const result = await client.query(`SELECT COUNT(*) as count FROM feed_items`);
    console.log('Direct query to feed_items:', result.rows);
  } catch (e) {
    console.log('Verification error:', e.message);
  }

  await client.end();
}

test().catch(console.error);