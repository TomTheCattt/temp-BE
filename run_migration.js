const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function runMigration(filePath) {
  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log(`Running migration: ${filePath}`);
    const sql = fs.readFileSync(filePath, 'utf8');
    await client.query(sql);
    console.log(`Migration ${filePath} completed successfully`);
  } catch (error) {
    console.error(`Error running ${filePath}:`, error.message);
  } finally {
    await client.end();
  }
}

const migrations = [
  'prisma/migrations/feed_items_materialized_view.sql',
  'prisma/migrations/search_index_pgvector.sql',
  'prisma/migrations/audit_logs_partitioned.sql',
  'prisma/migrations/rate_limit_buckets.sql',
  'prisma/migrations/call_tables.sql'
];

async function runAll() {
  for (const m of migrations) {
    await runMigration(m);
  }
}

runAll();
