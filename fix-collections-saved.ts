import './src/config/env.ts';
import { db } from './src/db/client.ts';

async function fixCollectionsAndSaved() {
  try {
    console.log('Creating collections table...');

    await db.execute(`
      CREATE TABLE IF NOT EXISTS "collections" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "name" varchar(100) NOT NULL,
        "is_default" boolean DEFAULT FALSE NOT NULL,
        "cover_media_id" text,
        "created_at" timestamptz DEFAULT NOW() NOT NULL,
        UNIQUE("user_id", "name")
      );
    `);
    console.log('✓ Created collections table');

    await db.execute(`
      CREATE INDEX IF NOT EXISTS "collections_user_idx" ON "collections"("user_id");
    `);
    console.log('✓ Created collections_user_idx');

    console.log('\nCreating saved_items table...');

    await db.execute(`
      CREATE TABLE IF NOT EXISTS "saved_items" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "collection_id" text REFERENCES "collections"("id") ON DELETE SET NULL,
        "saveable_type" varchar(50) NOT NULL,
        "saveable_id" text NOT NULL,
        "created_at" timestamptz DEFAULT NOW() NOT NULL,
        UNIQUE("user_id", "saveable_type", "saveable_id")
      );
    `);
    console.log('✓ Created saved_items table');

    await db.execute(`
      CREATE INDEX IF NOT EXISTS "saved_items_user_idx" ON "saved_items"("user_id", "created_at" DESC);
    `);
    console.log('✓ Created saved_items_user_idx');

    await db.execute(`
      CREATE INDEX IF NOT EXISTS "saved_items_saveable_idx" ON "saved_items"("saveable_type", "saveable_id");
    `);
    console.log('✓ Created saved_items_saveable_idx');

    // Verify
    const result1 = await db.execute(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'collections'`);
    console.log('\nCollections columns:');
    result1.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

    const result2 = await db.execute(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'saved_items'`);
    console.log('\nSaved_items columns:');
    result2.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

  } catch (e) {
    console.error('Error:', e);
  } finally {
    process.exit(0);
  }
}

fixCollectionsAndSaved();
