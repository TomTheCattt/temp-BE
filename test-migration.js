import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_UNPOOLED);

async function test() {
  // Try a simple CREATE TABLE
  try {
    console.log('Testing CREATE TABLE...');
    await sql`CREATE TABLE test_migration_check (id INT PRIMARY KEY)`;
    console.log('CREATE TABLE succeeded');

    const result = await sql`SELECT * FROM test_migration_check`;
    console.log('Query result:', result);

    await sql`DROP TABLE test_migration_check`;
    console.log('DROP TABLE succeeded');
  } catch (e) {
    console.log('Error:', e.message);
  }
}

test().catch(console.error);