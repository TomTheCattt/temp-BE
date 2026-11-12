import './src/config/env.ts';
import { db } from './src/db/client.ts';

async function fixAuditLogsTable() {
  try {
    console.log('Fixing audit_logs table...');

    // Check current state
    const result = await db.execute(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'id'`);
    console.log('audit_logs.id:', result.rows);

    // Change id from uuid to text
    await db.execute(`ALTER TABLE "audit_logs" ALTER COLUMN "id" TYPE text USING "id"::text;`);
    console.log('Changed audit_logs.id to text');

    // Verify
    const result2 = await db.execute(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'id'`);
    console.log('audit_logs.id after:', result2.rows);

  } catch (e) {
    console.error('Error:', e);
  } finally {
    process.exit(0);
  }
}

fixAuditLogsTable();