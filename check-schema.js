import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

async function test() {
  await client.connect();

  // Check posts table columns
  const cols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'posts'
    ORDER BY ordinal_position
  `);
  console.log('Posts columns:', cols.rows);

  // Check users table
  const users = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'users'
    ORDER BY ordinal_position
  `);
  console.log('Users columns:', users.rows);

  // Check media_items table
  const media = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'media_items'
    ORDER BY ordinal_position
  `);
  console.log('Media items columns:', media.rows);

  // Check follows table
  const follows = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'follows'
    ORDER BY ordinal_position
  `);
  console.log('Follows columns:', follows.rows);

  // Check blocks table
  const blocks = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'blocks'
    ORDER BY ordinal_position
  `);
  console.log('Blocks columns:', blocks.rows);

  // Check close_friends table
  const cf = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'close_friends'
    ORDER BY ordinal_position
  `);
  console.log('Close friends columns:', cf.rows);

  await client.end();
}

test().catch(console.error);