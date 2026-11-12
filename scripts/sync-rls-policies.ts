#!/usr/bin/env node

/**
 * RLS Policy Sync Script
 *
 * Generates PostgreSQL RLS policies from the policy engine definitions
 * to ensure database-level enforcement matches application-level policies.
 *
 * Usage: npx ts-node scripts/sync-rls-policies.ts
 * Or: node scripts/sync-rls-policies.js (after compilation)
 */

import { DEFAULT_POLICIES, AuthorizationPolicy } from "../src/services/policy-service";

// ============================================================================
// Type Definitions
// ============================================================================

interface RLSPolicy {
  table: string;
  name: string;
  command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
  using?: string;      // FOR SELECT, UPDATE, DELETE
  withCheck?: string;  // FOR INSERT, UPDATE
}

interface TableMapping {
  resource: string;
  table: string;
  ownerField: string;
  // Additional fields for relationship checks
  relationshipTables?: Record<string, { table: string; joinCondition: string }>;
}

// ============================================================================
// Table Mappings
// ============================================================================

const TABLE_MAPPINGS: Record<string, TableMapping> = {
  posts: {
    resource: "posts",
    table: "posts",
    ownerField: "author_id",
    relationshipTables: {
      follows: { table: "follows", joinCondition: "follows.following_id = posts.author_id AND follows.follower_id = current_user_id() AND follows.status = 'ACCEPTED'" },
      close_friends: { table: "close_friends", joinCondition: "close_friends.user_id = posts.author_id AND close_friends.friend_id = current_user_id()" },
    },
  },
  reels: {
    resource: "reels",
    table: "reels",
    ownerField: "author_id",
    relationshipTables: {
      follows: { table: "follows", joinCondition: "follows.following_id = reels.author_id AND follows.follower_id = current_user_id() AND follows.status = 'ACCEPTED'" },
    },
  },
  stories: {
    resource: "stories",
    table: "stories",
    ownerField: "author_id",
    relationshipTables: {
      follows: { table: "follows", joinCondition: "follows.following_id = stories.author_id AND follows.follower_id = current_user_id() AND follows.status = 'ACCEPTED'" },
      close_friends: { table: "close_friends", joinCondition: "close_friends.user_id = stories.author_id AND close_friends.friend_id = current_user_id()" },
    },
  },
  comments: {
    resource: "comments",
    table: "comments",
    ownerField: "author_id",
  },
  likes: {
    resource: "likes",
    table: "likes",
    ownerField: "user_id",
  },
  conversations: {
    resource: "conversations",
    table: "conversations",
    ownerField: "id", // Special: membership-based
  },
  messages: {
    resource: "messages",
    table: "messages",
    ownerField: "sender_id",
  },
  notifications: {
    resource: "notifications",
    table: "notifications",
    ownerField: "recipient_id",
  },
  users: {
    resource: "users",
    table: "users",
    ownerField: "id",
    relationshipTables: {
      follows: { table: "follows", joinCondition: "follows.following_id = users.id AND follows.follower_id = current_user_id() AND follows.status = 'ACCEPTED'" },
    },
  },
  follows: {
    resource: "follows",
    table: "follows",
    ownerField: "follower_id", // Can be follower or following
  },
  blocks: {
    resource: "blocks",
    table: "blocks",
    ownerField: "blocker_id",
  },
  restrictions: {
    resource: "restrictions",
    table: "restrictions",
    ownerField: "restrictor_id",
  },
  close_friends: {
    resource: "close_friends",
    table: "close_friends",
    ownerField: "user_id",
  },
  collections: {
    resource: "collections",
    table: "collections",
    ownerField: "user_id",
  },
  saved_items: {
    resource: "saved_items",
    table: "saved_items",
    ownerField: "user_id",
  },
  device_tokens: {
    resource: "device_tokens",
    table: "device_tokens",
    ownerField: "user_id",
  },
  calls: {
    resource: "calls",
    table: "calls",
    ownerField: "initiator_id",
  },
  call_participants: {
    resource: "call_participants",
    table: "call_participants",
    ownerField: "user_id",
  },
  live_videos: {
    resource: "live_videos",
    table: "live_videos",
    ownerField: "host_id",
  },
  reports: {
    resource: "reports",
    table: "reports",
    ownerField: "reporter_id",
  },
};

// ============================================================================
// SQL Generation Functions
// ============================================================================

/**
 * Convert policy conditions to SQL WHERE clause
 */
function conditionsToSQL(
  conditions: AuthorizationPolicy["conditions"],
  mapping: TableMapping,
  tableAlias: string = ""
): string {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  const sqlParts: string[] = [];

  for (const condition of conditions) {
    switch (condition.type) {
      case "ownership": {
        const ownerField = mapping.ownerField;
        sqlParts.push(`${prefix}${ownerField} = current_user_id()`);
        break;
      }

      case "attribute": {
        if (!condition.field || !condition.operator) break;
        const field = `${prefix}${condition.field.toLowerCase()}`;
        const value = typeof condition.value === "string" ? `'${condition.value}'` : condition.value;

        switch (condition.operator) {
          case "eq":
            sqlParts.push(`${field} = ${value}`);
            break;
          case "neq":
            sqlParts.push(`${field} != ${value}`);
            break;
          case "in":
            sqlParts.push(`${field} IN (${Array.isArray(condition.value) ? condition.value.map(v => typeof v === "string" ? `'${v}'` : v).join(",") : value})`);
            break;
          case "nin":
            sqlParts.push(`${field} NOT IN (${Array.isArray(condition.value) ? condition.value.map(v => typeof v === "string" ? `'${v}'` : v).join(",") : value})`);
            break;
          case "gt":
            sqlParts.push(`${field} > ${value}`);
            break;
          case "lt":
            sqlParts.push(`${field} < ${value}`);
            break;
          case "gte":
            sqlParts.push(`${field} >= ${value}`);
            break;
          case "lte":
            sqlParts.push(`${field} <= ${value}`);
            break;
          case "like":
            sqlParts.push(`${field} LIKE '%${condition.value}%'`);
            break;
        }
        break;
      }

      case "relationship": {
        if (!condition.relation || !mapping.relationshipTables?.[condition.relation]) break;

        const relTable = mapping.relationshipTables[condition.relation];
        const direction = condition.direction || "following";
        const status = condition.status || "ACCEPTED";

        if (condition.relation === "follows") {
          if (direction === "following") {
            // User follows the resource owner
            sqlParts.push(`EXISTS (
              SELECT 1 FROM ${relTable.table}
              WHERE ${relTable.joinCondition.replace("current_user_id()", "current_user_id()")}
              AND ${relTable.table}.status = '${status}'
            )`);
          } else if (direction === "follower") {
            // Resource owner follows user
            sqlParts.push(`EXISTS (
              SELECT 1 FROM ${relTable.table}
              WHERE ${relTable.table}.follower_id = ${prefix}${mapping.ownerField}
              AND ${relTable.table}.following_id = current_user_id()
              AND ${relTable.table}.status = '${status}'
            )`);
          } else if (direction === "either") {
            sqlParts.push(`EXISTS (
              SELECT 1 FROM ${relTable.table}
              WHERE (${relTable.table}.follower_id = current_user_id() AND ${relTable.table}.following_id = ${prefix}${mapping.ownerField})
              OR (${relTable.table}.follower_id = ${prefix}${mapping.ownerField} AND ${relTable.table}.following_id = current_user_id())
              AND ${relTable.table}.status = '${status}'
            )`);
          }
        } else if (condition.relation === "close_friends") {
          // Resource owner has user in close friends
          sqlParts.push(`EXISTS (
            SELECT 1 FROM ${relTable.table}
            WHERE ${relTable.joinCondition.replace("current_user_id()", "current_user_id()")}
          )`);
        } else if (condition.relation === "blocks") {
          // Block checks - these are DENY policies
          if (direction === "blocker") {
            sqlParts.push(`EXISTS (
              SELECT 1 FROM blocks
              WHERE blocks.blocker_id = current_user_id()
              AND blocks.blocked_id = ${prefix}${mapping.ownerField}
            )`);
          } else if (direction === "blocked") {
            sqlParts.push(`EXISTS (
              SELECT 1 FROM blocks
              WHERE blocks.blocker_id = ${prefix}${mapping.ownerField}
              AND blocks.blocked_id = current_user_id()
            )`);
          } else if (direction === "either") {
            sqlParts.push(`EXISTS (
              SELECT 1 FROM blocks
              WHERE (blocks.blocker_id = current_user_id() AND blocks.blocked_id = ${prefix}${mapping.ownerField})
              OR (blocks.blocker_id = ${prefix}${mapping.ownerField} AND blocks.blocked_id = current_user_id())
            )`);
          }
        }
        break;
      }

      case "role": {
        // Role checks - in RLS we use a function or check a user roles table
        // For now, we'll use a placeholder function
        if (condition.roles) {
          const roleChecks = condition.roles.map(r => `has_role('${r}')`).join(" OR ");
          sqlParts.push(`(${roleChecks})`);
        }
        break;
      }

      case "membership": {
        if (condition.via === "conversation") {
          sqlParts.push(`EXISTS (
            SELECT 1 FROM conversation_members
            WHERE conversation_members.conversation_id = ${prefix}id
            AND conversation_members.user_id = current_user_id()
            AND conversation_members.left_at IS NULL
          )`);
        } else if (condition.via === "call") {
          sqlParts.push(`EXISTS (
            SELECT 1 FROM call_participants
            WHERE call_participants.call_id = ${prefix}id
            AND call_participants.user_id = current_user_id()
            AND call_participants.status IN ('INVITED', 'JOINING', 'CONNECTED', 'RECONNECTING')
          )`);
        }
        break;
      }

      case "custom": {
        // Custom expressions - we support a few predefined ones
        if (condition.expression) {
          if (condition.expression.includes("10 minutes")) {
            sqlParts.push(`${prefix}created_at > NOW() - INTERVAL '10 minutes'`);
          } else if (condition.expression.includes("conversation_members")) {
            sqlParts.push(`EXISTS (
              SELECT 1 FROM conversation_members
              WHERE conversation_members.conversation_id = ${prefix}id
              AND conversation_members.user_id = current_user_id()
              AND conversation_members.role IN ('owner', 'admin')
            )`);
          } else {
            // Unknown custom expression - comment it out
            sqlParts.push(`-- CUSTOM: ${condition.expression.replace(/'/g, "''")} --`);
          }
        }
        break;
      }
    }
  }

  return sqlParts.length > 0 ? sqlParts.join(" AND ") : "TRUE";
}

/**
 * Generate RLS policies from authorization policies
 */
function generateRLSPolicies(policies: AuthorizationPolicy[]): RLSPolicy[] {
  const rlsPolicies: RLSPolicy[] = [];

  // Group policies by resource and action
  const policyGroups = new Map<string, AuthorizationPolicy[]>();

  for (const policy of policies) {
    const mapping = TABLE_MAPPINGS[policy.resource];
    if (!mapping) continue; // Skip wildcard policies for now

    const key = `${mapping.table}:${policy.action}:${policy.effect}`;
    if (!policyGroups.has(key)) {
      policyGroups.set(key, []);
    }
    policyGroups.get(key)!.push(policy);
  }

  // Generate RLS policy for each group
  for (const [key, groupPolicies] of policyGroups) {
    const [table, action, effect] = key.split(":");
    const mapping = TABLE_MAPPINGS[groupPolicies[0].resource];

    if (!mapping) continue;

    // Combine conditions with OR (any matching policy allows)
    const conditionSQLs = groupPolicies.map(p =>
      conditionsToSQL(p.conditions, mapping)
    );

    const combinedCondition = conditionSQLs.length > 1
      ? `(${conditionSQLs.join(") OR (")})`
      : conditionSQLs[0];

    // Map action to RLS command
    let command: RLSPolicy["command"];
    switch (action) {
      case "read":
      case "list":
        command = "SELECT";
        break;
      case "create":
        command = "INSERT";
        break;
      case "update":
        command = "UPDATE";
        break;
      case "delete":
        command = "DELETE";
        break;
      default:
        command = "ALL";
    }

    // Generate policy name
    const policyName = `${table}_${action}_${effect}_policy`;

    if (command === "SELECT") {
      rlsPolicies.push({
        table: mapping.table,
        name: policyName,
        command: "SELECT",
        using: combinedCondition,
      });
    } else if (command === "INSERT") {
      rlsPolicies.push({
        table: mapping.table,
        name: policyName,
        command: "INSERT",
        withCheck: combinedCondition,
      });
    } else if (command === "UPDATE") {
      rlsPolicies.push({
        table: mapping.table,
        name: policyName,
        command: "UPDATE",
        using: combinedCondition,
        withCheck: combinedCondition,
      });
    } else if (command === "DELETE") {
      rlsPolicies.push({
        table: mapping.table,
        name: policyName,
        command: "DELETE",
        using: combinedCondition,
      });
    }
  }

  return rlsPolicies;
}

/**
 * Generate SQL statements for RLS policies
 */
function generateSQL(rlsPolicies: RLSPolicy[]): string {
  const statements: string[] = [];

  // Group by table
  const byTable = new Map<string, RLSPolicy[]>();
  for (const policy of rlsPolicies) {
    if (!byTable.has(policy.table)) {
      byTable.set(policy.table, []);
    }
    byTable.get(policy.table)!.push(policy);
  }

  statements.push("-- ============================================================");
  statements.push("-- RLS POLICIES GENERATED FROM POLICY ENGINE");
  statements.push("-- ============================================================");
  statements.push("");
  statements.push("-- This file is auto-generated. Do not edit manually.");
  statements.push("-- Run: npx ts-node scripts/sync-rls-policies.ts");
  statements.push("");

  for (const [table, policies] of byTable) {
    // Enable RLS on table
    statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    statements.push("");

    // Drop existing policies for this table (optional - comment out if you want to keep manual ones)
    statements.push(`-- Drop existing policies for ${table}`);
    for (const policy of policies) {
      statements.push(`DROP POLICY IF EXISTS ${policy.name} ON ${table};`);
    }
    statements.push("");

    // Create new policies
    for (const policy of policies) {
      let sql = `CREATE POLICY ${policy.name} ON ${table}`;

      sql += ` FOR ${policy.command}`;

      if (policy.using) {
        sql += ` USING (${policy.using})`;
      }

      if (policy.withCheck) {
        sql += ` WITH CHECK (${policy.withCheck})`;
      }

      sql += ";";
      statements.push(sql);
    }
    statements.push("");
  }

  // Add helper function for current_user_id if not exists
  statements.push("-- ============================================================");
  statements.push("-- HELPER FUNCTIONS");
  statements.push("-- ============================================================");
  statements.push("");
  statements.push(`CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
BEGIN
  -- Try to get from session variable (set by middleware)
  IF current_setting('app.current_user_id', true) != '' THEN
    RETURN current_setting('app.current_user_id')::UUID;
  END IF;

  -- Fallback: try to get from auth.uid() if using Supabase-style auth
  -- This would need to be adapted based on your auth system
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`);

  statements.push("");
  statements.push(`CREATE OR REPLACE FUNCTION has_role(role_name TEXT) RETURNS BOOLEAN AS $$
BEGIN
  -- Check if current user has the specified role
  -- This would need to be implemented based on your role system
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`);

  return statements.join("\n");
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log("[RLS Sync] Generating RLS policies from policy engine...");

  const rlsPolicies = generateRLSPolicies(DEFAULT_POLICIES);
  const sql = generateSQL(rlsPolicies);

  // Output to console
  console.log(sql);

  // Optionally write to file
  const fs = require("fs");
  const path = require("path");
  const outputPath = path.join(__dirname, "..", "drizzle", "rls-policies-generated.sql");

  fs.writeFileSync(outputPath, sql);
  console.log(`\n[RLS Sync] Written to ${outputPath}`);

  console.log(`\n[RLS Sync] Generated ${rlsPolicies.length} RLS policies for ${new Set(rlsPolicies.map(p => p.table)).size} tables`);
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { generateRLSPolicies, generateSQL, conditionsToSQL };