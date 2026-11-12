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
  WITH followed_users AS (
      SELECT following_id AS user_id
      FROM follows
      WHERE follower_id = current_user_id()
        AND status = 'accepted'
  ),
  blocked_users AS (
      SELECT blocked_id AS user_id
      FROM blocks
      WHERE blocker_id = current_user_id()
        AND block_content = TRUE
  ),
  close_friends AS (
      SELECT friend_id AS user_id
      FROM close_friends
      WHERE user_id = current_user_id()
  ),
  post_cte AS (
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
  WHERE
      (audience = 'PUBLIC' AND author_id IN (SELECT user_id FROM followed_users))
      OR
      (close_friends_only = TRUE AND author_id IN (SELECT user_id FROM close_friends))
      OR
      (author_id = current_user_id())
      AND author_id NOT IN (SELECT user_id FROM blocked_users)
      AND NOT (is_private = TRUE
               AND author_id != current_user_id()
               AND author_id NOT IN (SELECT user_id FROM followed_users)
               AND author_id NOT IN (SELECT user_id FROM close_friends))
  ORDER BY created_at DESC;
  `;

  try {
    console.log('Creating materialized view...');
    await sql.unsafe(mvSql);
    console.log('CREATE MATERIALIZED VIEW succeeded');
  } catch (e) {
    console.log('CREATE MATERIALIZED VIEW error:', e.message);
  }
}

test().catch(console.error);