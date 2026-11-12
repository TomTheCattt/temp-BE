import './src/config/env.ts';
import { db } from './src/db/client.ts';

async function fixRemainingUUIDColumns() {
  try {
    console.log('=== Fixing remaining UUID columns ===\n');

    // 1. Fix accounts.id (uuid -> text)
    console.log('1. Fixing accounts.id...');
    await db.execute(`ALTER TABLE "accounts" ALTER COLUMN "id" TYPE text USING "id"::text;`);
    console.log('   ✓ accounts.id -> text');

    // 2. Fix refresh_tokens.user_id (uuid -> text)
    console.log('2. Fixing refresh_tokens.user_id...');
    await db.execute(`ALTER TABLE "refresh_tokens" ALTER COLUMN "user_id" TYPE text USING "user_id"::text;`);
    console.log('   ✓ refresh_tokens.user_id -> text');

    // 3. Fix verifications.id (uuid -> text)
    console.log('3. Fixing verifications.id...');
    await db.execute(`ALTER TABLE "verifications" ALTER COLUMN "id" TYPE text USING "id"::text;`);
    console.log('   ✓ verifications.id -> text');

    // 4. Fix search_index.id (uuid -> text)
    console.log('4. Fixing search_index.id...');
    await db.execute(`ALTER TABLE "search_index" ALTER COLUMN "id" TYPE text USING "id"::text;`);
    console.log('   ✓ search_index.id -> text');

    // 5. Fix search_index.content_id (uuid -> text)
    console.log('5. Fixing search_index.content_id...');
    await db.execute(`ALTER TABLE "search_index" ALTER COLUMN "content_id" TYPE text USING "content_id"::text;`);
    console.log('   ✓ search_index.content_id -> text');

    console.log('\n=== All UUID columns fixed ===');

    // Verify
    const tables = ['accounts', 'refresh_tokens', 'verifications', 'search_index'];
    for (const table of tables) {
      const result = await db.execute(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}'`);
      console.log(`\n${table}:`);
      result.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
    }

  } catch (e) {
    console.error('Error:', e);
  } finally {
    process.exit(0);
  }
}

fixRemainingUUIDColumns();
