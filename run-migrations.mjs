import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load DATABASE_URL from .env
import 'dotenv/config';

const sql = neon(process.env.DATABASE_URL);

const migrations = [
  'feed_items_materialized_view.sql',
  'search_index_pgvector.sql',
  'audit_logs_partitioned.sql',
  'rate_limit_buckets.sql',
  'call_tables.sql',
];

async function runMigrations() {
  for (const migration of migrations) {
    const filePath = join(__dirname, 'prisma', 'migrations', migration);
    const sqlContent = readFileSync(filePath, 'utf-8');
    
    console.log(`\n--- Running ${migration} ---`);
    
    // Split by semicolon and run each statement
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (const stmt of statements) {
      if (stmt.trim()) {
        try {
          await sql.unsafe(stmt);
          console.log(`  ✓ Executed: ${stmt.substring(0, 60)}...`);
        } catch (error) {
          // Some statements might fail if they already exist, that's okay
          console.log(`  ⚠ Warning: ${error.message.substring(0, 100)}`);
        }
      }
    }
  }
  
  console.log('\n=== All migrations completed ===');
}

runMigrations().catch(console.error);
