import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

async function run() {
  await client.connect();

  // Create function
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION current_user_id() RETURNS TEXT AS $$
      BEGIN
        IF current_setting('app.current_user_id', true) != '' THEN
          RETURN current_setting('app.current_user_id');
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);
    console.log('✓ Created current_user_id function');
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Create MV
  const mvSql = `
  CREATE MATERIALIZED VIEW feed_items AS
  WITH post_cte AS (
      SELECT
          p.id AS post_id,
          p.author_id,
          p.caption,
          p.location_name,
          p.location_lat,
          p.location_lng,
          p.likes_count,
          p.comments_count,
          p.shares_count,
          p.saves_count,
          p.views_count,
          p.is_sponsored,
          p.sponsor_user_id,
          p.audience,
          p.close_friends_only,
          p.created_at,
          u.username,
          u.full_name,
          u.avatar_url,
          u.is_verified,
          u.is_private,
          mi.url AS media_url,
          mi.thumbnail_url,
          mi.type AS media_type,
          mi.width,
          mi.height,
          mi.duration,
          mi.sort_order,
          (p.likes_count + p.comments_count * 2 + p.shares_count * 3 + p.saves_count * 4)::numeric AS engagement_score,
          EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0 AS hours_since_post
      FROM posts p
      JOIN users u ON u.id = p.author_id
      LEFT JOIN LATERAL (
          SELECT *
          FROM media_items
          WHERE mediaable_type = 'post'
            AND mediaable_id = p.id
          ORDER BY sort_order
          LIMIT 1
      ) mi ON TRUE
      WHERE p.deleted_at IS NULL
        AND p.archived_at IS NULL
        AND p.created_at > NOW() - INTERVAL '30 days'
  )
  SELECT *
  FROM post_cte
  ORDER BY created_at DESC;
  `;

  try {
    await client.query(mvSql);
    console.log('✓ Created materialized view');
  } catch (e) {
    console.log('Error creating MV:', e.message);
  }

  // Verify immediately
  try {
    const result = await client.query(`SELECT COUNT(*) FROM feed_items`);
    console.log('MV count:', result.rows[0]);
  } catch (e) {
    console.log('Error querying MV:', e.message);
  }

  // Check pg_matviews
  try {
    const mv = await client.query(`SELECT * FROM pg_matviews WHERE matviewname = 'feed_items'`);
    console.log('pg_matviews:', mv.rows.length > 0 ? 'EXISTS' : 'NOT FOUND');
  } catch (e) {
    console.log('Error checking pg_matviews:', e.message);
  }

  await client.end();
}

run().catch(console.error);