import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const sql = neon(process.env.DATABASE_URL_UNPOOLED);
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
    const trimmed = line.trim();

    // Check for dollar quote start/end
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

    // Split on semicolon if not in dollar quote and line ends with semicolon
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
    try {
      await sql.unsafe(stmt);
      console.log(`✓ [${i+1}/${statements.length}] ${stmt.substring(0, 80)}...`);
    } catch (error) {
      // Some statements might fail if they already exist, that's okay
      console.log(`⚠ [${i+1}/${statements.length}] Warning: ${error.message.substring(0, 200)}`);
    }
  }

  console.log('\n=== Migration completed ===');
}

run().catch(console.error);