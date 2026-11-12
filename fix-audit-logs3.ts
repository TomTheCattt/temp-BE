import './src/config/env.ts';
import { db } from './src/db/client.ts';

async function fixAuditLogsTable() {
  try {
    console.log('Adding missing audit_logs columns...');

    // Add old_values column
    await db.execute(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "old_values" jsonb;`);
    console.log('✓ Added old_values');

    // Add new_values column
    await db.execute(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "new_values" jsonb;`);
    console.log('✓ Added new_values');

    // Verify
    const result = await db.execute(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'audit_logs'`);
    console.log('\nColumns after fix:');
    result.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

  } catch (e) {
    console.error('Error:', e);
  } finally {
    process.exit(0);
  }
}

fixAuditLogsTable();
