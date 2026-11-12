import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const sql = neon(process.env.DATABASE_URL_UNPOOLED);
const sqlContent = readFileSync('sql/001_feed_materialized_view.sql', 'utf-8');

// Better splitting
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
  console.log(`Total statements: ${statements.length}`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    console.log(`\n[${i+1}/${statements.length}] Running: ${stmt.substring(0, 100)}...`);
    try {
      await sql.unsafe(stmt);
      console.log(`  SUCCESS`);
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
      // Don't continue on error for debugging
      break;
    }
  }

  console.log('\n=== Migration completed ===');
}

run().catch(console.error);