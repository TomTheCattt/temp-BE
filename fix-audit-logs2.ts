import './src/config/env.ts';
import { db } from './src/db/client.ts';

async function fixAuditLogsTable() {
  try {
    console.log('Fixing audit_logs table...');

    // Rename ip_address to actor_ip
    await db.execute(`ALTER TABLE "audit_logs" RENAME COLUMN "ip_address" TO "actor_ip";`);
    console.log('✓ Renamed ip_address -> actor_ip');

    // Rename user_agent to actor_user_agent
    await db.execute(`ALTER TABLE "audit_logs" RENAME COLUMN "user_agent" TO "actor_user_agent";`);
    console.log('✓ Renamed user_agent -> actor_user_agent');

    // Add session_id column
    await db.execute(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "session_id" text;`);
    console.log('✓ Added session_id');

    // Add request_id column
    await db.execute(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "request_id" text;`);
    console.log('✓ Added request_id');

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
