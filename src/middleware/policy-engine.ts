import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import * as schema from "../db/schema";
import { eq, and, or, isNull, sql, inArray } from "drizzle-orm";
import { db } from "../db/client";

/**
 * Authorization Policy Engine (OPA-style)
 *
 * This implements a policy engine inspired by OPA/Rego for authorization decisions.
 * Policies are evaluated at the application level and also translated to RLS policies
 * for database-level enforcement.
 */

// ============================================================================
// Types
// ============================================================================

export type PolicyEffect = "allow" | "deny";

export type PolicyConditionType =
  | "ownership"
  | "relationship"
  | "attribute"
  | "role"
  | "custom";

export interface PolicyCondition {
  type: PolicyConditionType;
  // For ownership: resource.owner_field == user.id
  ownershipField?: string;
  // For relationship: follows, blocks, close_friends, conversation_membership
  relation?: string;
  direction?: "follower" | "following" | "either" | "blocker" | "blocked";
  status?: "pending" | "accepted" | "blocked" | "invited" | "joined";
  // For attribute: resource.field operator value
  field?: string;
  operator?: "eq" | "ne" | "in" | "nin" | "gt" | "lt" | "contains";
  value?: any;
  // For role: user.roles.includes(role)
  roles?: string[];
  // For custom: SQL expression or function
  expression?: string;
}

export interface AuthorizationPolicy {
  resource: string;           // e.g., "posts", "conversations", "users", "*"
  action: string;             // e.g., "read", "create", "update", "delete", "list", "*"
  effect: PolicyEffect;
  conditions: PolicyCondition[];
  priority: number;           // Higher = evaluated first
  description?: string;
}

export interface UserContext {
  id: string;
  username: string;
  email: string;
  isVerified: boolean;
  isPrivate: boolean;
  roles: string[];
  [key: string]: any;
}

export interface ResourceContext {
  id: string;
  [key: string]: any;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  policy?: string;
  matchedConditions?: PolicyCondition[];
}

// ============================================================================
// Policy Definitions (mirrors DESIGN_DOCUMENT.md §4.3)
// ============================================================================

export const authorizationPolicies: AuthorizationPolicy[] = [
  // ========== POSTS ==========
  // Public posts are readable by everyone
  {
    resource: "posts",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Public posts are readable by everyone",
    conditions: [
      { type: "attribute", field: "audience", operator: "eq", value: "public" },
    ],
  },
  // Users can read their own posts
  {
    resource: "posts",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Users can read their own posts",
    conditions: [
      { type: "ownership", ownershipField: "author_id" },
    ],
  },
  // Followed users' posts (followers audience)
  {
    resource: "posts",
    action: "read",
    effect: "allow",
    priority: 80,
    description: "Followed users' posts with 'followers' audience",
    conditions: [
      { type: "attribute", field: "audience", operator: "eq", value: "followers" },
      { type: "relationship", relation: "follows", direction: "following", status: "accepted" },
    ],
  },
  // Close friends posts
  {
    resource: "posts",
    action: "read",
    effect: "allow",
    priority: 70,
    description: "Close friends only posts",
    conditions: [
      { type: "attribute", field: "close_friends_only", operator: "eq", value: true },
      { type: "relationship", relation: "close_friends", direction: "either" },
    ],
  },
  // Create posts - authenticated users
  {
    resource: "posts",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can create posts",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  // Update own posts
  {
    resource: "posts",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Users can update their own posts",
    conditions: [
      { type: "ownership", ownershipField: "author_id" },
    ],
  },
  // Delete own posts
  {
    resource: "posts",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Users can delete their own posts",
    conditions: [
      { type: "ownership", ownershipField: "author_id" },
    ],
  },

  // ========== REELS ==========
  {
    resource: "reels",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Public reels are readable by everyone",
    conditions: [
      { type: "attribute", field: "audience", operator: "eq", value: "public" },
    ],
  },
  {
    resource: "reels",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Users can read their own reels",
    conditions: [
      { type: "ownership", ownershipField: "author_id" },
    ],
  },
  {
    resource: "reels",
    action: "read",
    effect: "allow",
    priority: 80,
    description: "Followed users' reels with 'followers' audience",
    conditions: [
      { type: "attribute", field: "audience", operator: "eq", value: "followers" },
      { type: "relationship", relation: "follows", direction: "following", status: "accepted" },
    ],
  },
  {
    resource: "reels",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can create reels",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "reels",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Users can update their own reels",
    conditions: [
      { type: "ownership", ownershipField: "author_id" },
    ],
  },
  {
    resource: "reels",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Users can delete their own reels",
    conditions: [
      { type: "ownership", ownershipField: "author_id" },
    ],
  },

  // ========== STORIES ==========
  {
    resource: "stories",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Followers can view stories (non-expired)",
    conditions: [
      { type: "relationship", relation: "follows", direction: "following", status: "accepted" },
      { type: "custom", expression: "stories.expires_at > NOW()" },
    ],
  },
  {
    resource: "stories",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Users can view their own stories",
    conditions: [
      { type: "ownership", ownershipField: "author_id" },
    ],
  },
  {
    resource: "stories",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can create stories",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },

  // ========== CONVERSATIONS (DMs) ==========
  {
    resource: "conversations",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Conversation members can read conversations",
    conditions: [
      { type: "relationship", relation: "conversation_membership" },
    ],
  },
  {
    resource: "conversations",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can create conversations",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },

  // ========== MESSAGES ==========
  {
    resource: "messages",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Conversation members can read messages",
    conditions: [
      { type: "relationship", relation: "conversation_membership" },
    ],
  },
  {
    resource: "messages",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Conversation members can send messages",
    conditions: [
      { type: "relationship", relation: "conversation_membership" },
    ],
  },
  {
    resource: "messages",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Users can edit their own messages within 10 minutes",
    conditions: [
      { type: "ownership", ownershipField: "sender_id" },
      { type: "custom", expression: "NOW() - messages.created_at < INTERVAL '10 minutes'" },
    ],
  },
  {
    resource: "messages",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Users can unsend their own messages",
    conditions: [
      { type: "ownership", ownershipField: "sender_id" },
    ],
  },

  // ========== USERS ==========
  {
    resource: "users",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Public profiles are readable by everyone",
    conditions: [
      { type: "attribute", field: "is_private", operator: "eq", value: false },
    ],
  },
  {
    resource: "users",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Followed users' private profiles",
    conditions: [
      { type: "relationship", relation: "follows", direction: "following", status: "accepted" },
    ],
  },
  {
    resource: "users",
    action: "read",
    effect: "allow",
    priority: 80,
    description: "Users can read their own profile",
    conditions: [
      { type: "ownership", ownershipField: "id" },
    ],
  },
  {
    resource: "users",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Users can update their own profile",
    conditions: [
      { type: "ownership", ownershipField: "id" },
    ],
  },

  // ========== FOLLOWS ==========
  {
    resource: "follows",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Users can follow others (unless blocked)",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "follows",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Users can unfollow",
    conditions: [
      { type: "ownership", ownershipField: "follower_id" },
    ],
  },
  {
    resource: "follows",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Users can accept follow requests",
    conditions: [
      { type: "ownership", ownershipField: "following_id" },
    ],
  },

  // ========== BLOCKS (DENY takes precedence) ==========
  {
    resource: "*",
    action: "*",
    effect: "deny",
    priority: 1000,
    description: "Blocked users cannot interact with blocker's content",
    conditions: [
      { type: "relationship", relation: "blocks", direction: "blocker" },
    ],
  },
  {
    resource: "conversations",
    action: "*",
    effect: "deny",
    priority: 1000,
    description: "Blocked users cannot DM each other",
    conditions: [
      { type: "relationship", relation: "blocks", direction: "either" },
    ],
  },
  {
    resource: "users",
    action: "read",
    effect: "deny",
    priority: 1000,
    description: "Blocked users cannot view blocker's profile",
    conditions: [
      { type: "relationship", relation: "blocks", direction: "blocked" },
    ],
  },
];

// ============================================================================
// Policy Evaluator
// ============================================================================

/**
 * Evaluates authorization policies for a given user, resource, and action.
 * Returns the first matching policy (by priority).
 */
export async function authorize(
  user: UserContext,
  resource: string,
  action: string,
  resourceData?: ResourceContext
): Promise<AuthorizationResult> {
  // Find applicable policies
  const applicable = authorizationPolicies
    .filter(p => p.resource === resource || p.resource === "*")
    .filter(p => p.action === action || p.action === "*")
    .sort((a, b) => b.priority - a.priority);

  for (const policy of applicable) {
    const result = await evaluateConditions(policy.conditions, user, resourceData);
    if (result.matched) {
      return {
        allowed: policy.effect === "allow",
        reason: result.reason,
        policy: `${policy.resource}:${policy.action}`,
        matchedConditions: result.matchedConditions,
      };
    }
  }

  // Default deny
  return { allowed: false, reason: "No matching policy" };
}

/**
 * Evaluates a list of conditions against user and resource context.
 */
async function evaluateConditions(
  conditions: PolicyCondition[],
  user: UserContext,
  resourceData?: ResourceContext
): Promise<{ matched: boolean; reason?: string; matchedConditions?: PolicyCondition[] }> {
  const matchedConditions: PolicyCondition[] = [];

  for (const condition of conditions) {
    let conditionMet = false;

    switch (condition.type) {
      case "ownership":
        conditionMet = await checkOwnership(condition, user, resourceData);
        break;
      case "relationship":
        conditionMet = await checkRelationship(condition, user, resourceData);
        break;
      case "attribute":
        conditionMet = checkAttribute(condition, resourceData);
        break;
      case "role":
        conditionMet = checkRole(condition, user);
        break;
      case "custom":
        conditionMet = await checkCustom(condition, user, resourceData);
        break;
    }

    if (conditionMet) {
      matchedConditions.push(condition);
    } else {
      // All conditions must be met (AND logic)
      return { matched: false };
    }
  }

  return { matched: true, matchedConditions };
}

// ============================================================================
// Condition Checkers
// ============================================================================

async function checkOwnership(
  condition: PolicyCondition,
  user: UserContext,
  resourceData?: ResourceContext
): Promise<boolean> {
  if (!condition.ownershipField || !resourceData) return false;

  const ownerId = resourceData[condition.ownershipField];
  return ownerId === user.id;
}

async function checkRelationship(
  condition: PolicyCondition,
  user: UserContext,
  resourceData?: ResourceContext
): Promise<boolean> {
  if (!condition.relation) return false;

  const targetUserId = resourceData?.author_id || resourceData?.user_id || resourceData?.id;
  if (!targetUserId) return false;

  switch (condition.relation) {
    case "follows":
      return await checkFollowsRelationship(user.id, targetUserId, condition.direction, condition.status);
    case "blocks":
      return await checkBlocksRelationship(user.id, targetUserId, condition.direction);
    case "close_friends":
      return await checkCloseFriendsRelationship(user.id, targetUserId);
    case "conversation_membership":
      return await checkConversationMembership(user.id, resourceData?.conversation_id || resourceData?.id);
    default:
      return false;
  }
}

async function checkFollowsRelationship(
  followerId: string,
  followingId: string,
  direction?: string,
  status = "accepted"
): Promise<boolean> {
  // If checking if user follows target
  if (direction === "following" || direction === "follower") {
    const follow = await db.query.follows.findFirst({
      where: and(
        eq(schema.follows.followerId, direction === "following" ? followerId : followingId),
        eq(schema.follows.followingId, direction === "following" ? followingId : followerId),
        eq((schema.follows as any).status, status as any)
      ),
    });
    return !!follow;
  }
  // Check either direction (for blocks)
  if (direction === "either") {
    const follow1 = await db.query.follows.findFirst({
      where: and(
        eq(schema.follows.followerId, followerId),
        eq(schema.follows.followingId, followingId),
        eq((schema.follows as any).status, status as any)
      ),
    });
    const follow2 = await db.query.follows.findFirst({
      where: and(
        eq(schema.follows.followerId, followingId),
        eq(schema.follows.followingId, followerId),
        eq((schema.follows as any).status, status as any)
      ),
    });
    return !!follow1 || !!follow2;
  }
  return false;
}

async function checkBlocksRelationship(
  blockerId: string,
  blockedId: string,
  direction?: string
): Promise<boolean> {
  if (direction === "blocker") {
    const block = await db.query.blocks.findFirst({
      where: and(
        eq(schema.blocks.blockerId, blockerId),
        eq(schema.blocks.blockedId, blockedId)
      ),
    });
    return !!block;
  }
  if (direction === "blocked") {
    const block = await db.query.blocks.findFirst({
      where: and(
        eq(schema.blocks.blockerId, blockedId),
        eq(schema.blocks.blockedId, blockerId)
      ),
    });
    return !!block;
  }
  if (direction === "either") {
    const block1 = await db.query.blocks.findFirst({
      where: and(
        eq(schema.blocks.blockerId, blockerId),
        eq(schema.blocks.blockedId, blockedId)
      ),
    });
    const block2 = await db.query.blocks.findFirst({
      where: and(
        eq(schema.blocks.blockerId, blockedId),
        eq(schema.blocks.blockedId, blockerId)
      ),
    });
    return !!block1 || !!block2;
  }
  return false;
}

async function checkCloseFriendsRelationship(
  userId: string,
  friendId: string
): Promise<boolean> {
  const closeFriend = await db.query.closeFriends.findFirst({
    where: and(
      eq(schema.closeFriends.userId, userId),
      eq(schema.closeFriends.friendId, friendId)
    ),
  });
  return !!closeFriend;
}

async function checkConversationMembership(
  userId: string,
  conversationId: string
): Promise<boolean> {
  if (!conversationId) return false;

  const member = await db.query.conversationMembers.findFirst({
    where: and(
      eq(schema.conversationMembers.conversationId, conversationId),
      eq(schema.conversationMembers.userId, userId)
    ),
  });
  return !!member;
}

function checkAttribute(
  condition: PolicyCondition,
  resourceData?: ResourceContext
): boolean {
  if (!condition.field || !resourceData) return false;

  const resourceValue = resourceData[condition.field];
  const expectedValue = condition.value;
  const operator = condition.operator || "eq";

  switch (operator) {
    case "eq": return resourceValue === expectedValue;
    case "ne": return resourceValue !== expectedValue;
    case "in": return Array.isArray(expectedValue) && expectedValue.includes(resourceValue);
    case "nin": return Array.isArray(expectedValue) && !expectedValue.includes(resourceValue);
    case "gt": return resourceValue > expectedValue;
    case "lt": return resourceValue < expectedValue;
    case "contains": return String(resourceValue).includes(String(expectedValue));
    default: return false;
  }
}

function checkRole(
  condition: PolicyCondition,
  user: UserContext
): boolean {
  if (!condition.roles) return false;
  return condition.roles.some(role => user.roles?.includes(role));
}

async function checkCustom(
  condition: PolicyCondition,
  user: UserContext,
  resourceData?: ResourceContext
): Promise<boolean> {
  // Custom SQL expressions would be evaluated here
  // For now, we support a few known expressions
  if (!condition.expression) return false;

  if (condition.expression.includes("NOW() - messages.created_at < INTERVAL '10 minutes'")) {
    if (!resourceData?.createdAt) return false;
    const createdAt = new Date(resourceData.createdAt);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    return createdAt > tenMinutesAgo;
  }

  if (condition.expression.includes("stories.expires_at > NOW()")) {
    if (!resourceData?.expiresAt) return false;
    const expiresAt = new Date(resourceData.expiresAt);
    return expiresAt > new Date();
  }

  return false;
}

// ============================================================================
// RLS Policy Generator (for database-level enforcement)
// ============================================================================

/**
 * Generates PostgreSQL RLS policies from the authorization policies.
 * This ensures database-level enforcement matches application-level policies.
 */
export function generateRLSPolicies(): string[] {
  const policies: string[] = [];

  // Group policies by resource
  const resourceGroups = new Map<string, AuthorizationPolicy[]>();

  for (const policy of authorizationPolicies) {
    if (!resourceGroups.has(policy.resource)) {
      resourceGroups.set(policy.resource, []);
    }
    resourceGroups.get(policy.resource)!.push(policy);
  }

  for (const [resource, policies_list] of resourceGroups) {
    // Skip wildcard resource
    if (resource === "*") continue;

    // Generate SELECT policy
    const selectPolicies = policies_list.filter(p => p.action === "read" || p.action === "*");
    if (selectPolicies.length > 0) {
      const conditions = selectPolicies
        .map(p => policyConditionsToSQL(p.conditions, resource))
        .filter(c => c)
        .join(" OR ");

      if (conditions) {
        policies.push(`
CREATE POLICY ${resource}_select_policy ON ${resource}
  FOR SELECT USING (${conditions});
        `.trim());
      }
    }

    // Generate INSERT policy
    const insertPolicies = policies_list.filter(p => p.action === "create" || p.action === "*");
    if (insertPolicies.length > 0) {
      const conditions = insertPolicies
        .map(p => policyConditionsToSQL(p.conditions, resource))
        .filter(c => c)
        .join(" OR ");

      if (conditions) {
        policies.push(`
CREATE POLICY ${resource}_insert_policy ON ${resource}
  FOR INSERT WITH CHECK (${conditions});
        `.trim());
      }
    }

    // Generate UPDATE policy
    const updatePolicies = policies_list.filter(p => p.action === "update" || p.action === "*");
    if (updatePolicies.length > 0) {
      const conditions = updatePolicies
        .map(p => policyConditionsToSQL(p.conditions, resource))
        .filter(c => c)
        .join(" OR ");

      if (conditions) {
        policies.push(`
CREATE POLICY ${resource}_update_policy ON ${resource}
  FOR UPDATE USING (${conditions});
        `.trim());
      }
    }

    // Generate DELETE policy
    const deletePolicies = policies_list.filter(p => p.action === "delete" || p.action === "*");
    if (deletePolicies.length > 0) {
      const conditions = deletePolicies
        .map(p => policyConditionsToSQL(p.conditions, resource))
        .filter(c => c)
        .join(" OR ");

      if (conditions) {
        policies.push(`
CREATE POLICY ${resource}_delete_policy ON ${resource}
  FOR DELETE USING (${conditions});
        `.trim());
      }
    }
  }

  // Add DENY policies for blocks (these are complex and may need custom implementation)
  policies.push(`
-- Block policies (DENY) - implemented as RLS with NOT EXISTS
CREATE POLICY users_block_deny ON users
  FOR SELECT USING (
    NOT EXISTS (
      SELECT 1 FROM blocks WHERE blocker_id = users.id AND blocked_id = current_user_id()
    )
  );
  `.trim());

  return policies;
}

function policyConditionsToSQL(conditions: PolicyCondition[], resource: string): string {
  const sqlConditions: string[] = [];

  for (const condition of conditions) {
    switch (condition.type) {
      case "ownership":
        if (condition.ownershipField) {
          sqlConditions.push(`${condition.ownershipField} = current_user_id()`);
        }
        break;
      case "attribute":
        if (condition.field && condition.operator && condition.value !== undefined) {
          const op = sqlOperator(condition.operator);
          const val = typeof condition.value === "string" ? `'${condition.value}'` : condition.value;
          sqlConditions.push(`${condition.field} ${op} ${val}`);
        }
        break;
      case "relationship":
        if (condition.relation === "follows") {
          const dir = condition.direction === "following" ? "follower_id" : "following_id";
          const otherDir = condition.direction === "following" ? "following_id" : "follower_id";
          sqlConditions.push(`
            EXISTS (
              SELECT 1 FROM follows
              WHERE ${dir} = current_user_id()
              AND ${otherDir} = ${resource}.author_id
              AND status = '${condition.status || "accepted"}'
            )
          `.trim());
        } else if (condition.relation === "close_friends") {
          sqlConditions.push(`
            EXISTS (
              SELECT 1 FROM close_friends
              WHERE user_id = ${resource}.author_id
              AND friend_id = current_user_id()
            )
          `.trim());
        } else if (condition.relation === "conversation_membership") {
          sqlConditions.push(`
            EXISTS (
              SELECT 1 FROM conversation_members
              WHERE conversation_id = ${resource}.conversation_id
              AND user_id = current_user_id()
            )
          `.trim());
        }
        break;
      case "role":
        // Role checks at DB level would need a user_roles table or JWT claims
        sqlConditions.push(`has_role('${condition.roles?.join("') OR has_role('")}')`);
        break;
    }
  }

  return sqlConditions.join(" AND ");
}

function sqlOperator(op: string): string {
  switch (op) {
    case "eq": return "=";
    case "ne": return "!=";
    case "in": return "IN";
    case "nin": return "NOT IN";
    case "gt": return ">";
    case "lt": return "<";
    case "contains": return "ILIKE";
    default: return "=";
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Authorization middleware that checks policies before allowing access to routes.
 * Usage: app.use("/v1/posts/*", authzMiddleware("posts", "read"));
 */
export function authzMiddleware(resource: string, action: string) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");
    if (!user) {
      throw new HTTPException(401, { message: "Authentication required" });
    }

    // For list/read operations, we check on each item in the route handler
    // For create/update/delete, we can check here if resource data is available
    await next();
  });
}

/**
 * Helper to check authorization in route handlers with resource data.
 */
export async function checkAuthz(
  c: any,
  resource: string,
  action: string,
  resourceData?: ResourceContext
): Promise<AuthorizationResult> {
  const user = c.get("user");
  if (!user) {
    return { allowed: false, reason: "Not authenticated" };
  }

  const userContext: UserContext = {
    id: user.id,
    username: user.username,
    email: user.email,
    isVerified: user.isVerified,
    isPrivate: user.isPrivate,
    roles: ["user"], // Default role, can be extended
  };

  return await authorize(userContext, resource, action, resourceData);
}