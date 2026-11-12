import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';

const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

const sqlContent = readFileSync('sql/001_feed_materialized_view.sql', 'utf-8');

// Better splitting - split on semicolon followed by newline and optional whitespace
// but not inside function bodies (dollar-quoted strings)
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';

  const lines = sql.split('\n');

  for (const line of lines) {
    const dollarQuoteMatch = line.match(/\$([a-zA-Z0-9_]*)\$/);
    if (dollarQuoteMatch) {
      const tag = dollarQuoteMatch[1];
      if (!inDollarQuote) {
        inDollarQuote = true;
        dollarTag = tag;
      } else if (dollarTag === tag) {
        inDollarQuote = false;
        dollarTag = '';
      }
    }

    current += line + '\n';

    const trimmed = line.trim();
    if (!inDollarQuote && trimmed.endsWith(';') && !trimmed.startsWith('--')) {
      statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements.filter(s => s.length > 0);
}

const statements = splitStatements(sqlContent);

async function run() {
  await client.connect();
  console.log(`Connected. Total statements: ${statements.length}`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    console.log(`\n[${i+1}/${statements.length}] Running: ${stmt.substring(0, 100)}...`);
    try {
      await client.query(stmt);
      console.log(`  SUCCESS`);
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
    }
  }

  // Verify
  console.log('\n=== Verification ===');
  try {
    const mv = await client.query(`SELECT * FROM pg_matviews WHERE matviewname = 'feed_items'`);
    console.log('Materialized view:', mv.rows.length > 0 ? 'EXISTS' : 'NOT FOUND');
    if (mv.rows.length > 0) {
      const count = await client.query(`SELECT COUNT(*) FROM feed_items`);
      console.log('  Row count:', count.rows[0].count);
    }
  } catch (e) {
    console.log('MV verification error:', e.message);
  }

  try {
    const ext = await client.query(`SELECT * FROM pg_extension WHERE extname = 'pg_cron'`);
    console.log('pg_cron extension:', ext.rows.length > 0 ? 'ENABLED' : 'NOT ENABLED');
  } catch (e) {
    console.log('pg_cron check error:', e.message);
  }

  try {
    const cron = await client.query(`SELECT * FROM cron.job WHERE jobname LIKE '%feed%'`);
    console.log('pg_cron jobs:', cron.rows);
  } catch (e) {
    console.log('pg_cron jobs error:', e.message);
  }

  try {
    const triggers = await client.query(`SELECT * FROM information_schema.triggers WHERE trigger_name LIKE 'trigger_feed_invalidate%'`);
    console.log('Triggers:', triggers.rows.map(t => t.trigger_name));
  } catch (e) {
    console.log('Triggers error:', e.message);
  }

  try {
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'sponsored_%'`);
    console.log('Sponsored tables:', tables.rows.map(t => t.table_name));
  } catch (e) {
    console.log('Sponsored tables error:', e.message);
  }

  await client.end();
  console.log('\n=== Migration completed ===');
}

run().catch(console.error);