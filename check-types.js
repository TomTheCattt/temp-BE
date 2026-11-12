import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

async function run() {
  await client.connect();

  // Check users.id type
  const usersCols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'id'
  `);
  console.log('users.id:', usersCols.rows);

  // Check posts.author_id type
  const postsCols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name IN ('author_id', 'sponsor_user_id', 'location_id')
  `);
  console.log('posts FK columns:', postsCols.rows);

  // Check media_items.mediaable_id type
  const mediaCols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'media_items' AND column_name = 'mediaable_id'
  `);
  console.log('media_items.mediaable_id:', mediaCols.rows);

  // Check comments.author_id type
  const commentsCols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'comments' AND column_name = 'author_id'
  `);
  console.log('comments.author_id:', commentsCols.rows);

  // Check likes.user_id type
  const likesCols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'likes' AND column_name = 'user_id'
  `);
  console.log('likes.user_id:', likesCols.rows);

  await client.end();
}

run().catch(console.error);