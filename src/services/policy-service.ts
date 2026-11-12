import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, or, exists, sql } from "drizzle-orm";

/**
 * Policy Engine Service
 *
 * Implements authorization policy decisions based on the OPA/Rego-inspired
 * policy definition from DESIGN_DOCUMENT.md §4.3
 *
 * Provides canRead, canWrite, canDelete methods for each resource type
 * with support for ownership, relationship, attribute, role, and custom conditions.
 */

// ============================================================================
// Types
// ============================================================================

export type ResourceType =
  | "users"
  | "posts"
  | "reels"
  | "stories"
  | "comments"
  | "likes"
  | "conversations"
  | "messages"
  | "notifications"
  | "follows"
  | "blocks"
  | "restrictions"
  | "close_friends"
  | "collections"
  | "saved_items"
  | "device_tokens"
  | "calls"
  | "call_participants"
  | "live_videos"
  | "reports";

export type ActionType = "read" | "create" | "update" | "delete" | "list";

export type PolicyEffect = "allow" | "deny";

export interface PolicyCondition {
  type: "ownership" | "relationship" | "attribute" | "role" | "custom" | "membership";
  // ownership: resource.owner_id == user.id
  // relationship: EXISTS follows WHERE follower=user AND following=resource.owner
  // attribute: resource.field operator value
  // role: user.roles.includes('moderator')
  // custom: SQL expression or function call
  // membership: user is member of resource (e.g., conversation)

  field?: string;           // For attribute conditions
  operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "gte" | "lte" | "like"; // For attribute conditions
  value?: any;              // For attribute conditions
  relation?: string;        // For relationship conditions (e.g., "follows", "close_friends", "blocks")
  direction?: "follower" | "following" | "either" | "blocker" | "blocked"; // Direction of relationship
  status?: string;          // Status for relationship (e.g., "accepted", "pending")
  via?: string;             // For membership/ownership via another field (e.g., "conversation", "sender_id")
  roles?: string[];         // For role conditions
  expression?: string;      // For custom SQL expressions
}

export interface AuthorizationPolicy {
  resource: ResourceType | "*";
  action: ActionType | "*";
  effect: PolicyEffect;
  conditions: PolicyCondition[];
  priority: number; // Higher = evaluated first
  description?: string;
}

export interface UserContext {
  id: string;
  roles?: string[];
  isVerified?: boolean;
  isPrivate?: boolean;
  // Additional user attributes needed for policy evaluation
}

export interface ResourceData {
  id: string;
  authorId?: string;
  userId?: string;
  ownerId?: string;
  audience?: string;
  isPrivate?: boolean;
  [key: string]: any;
}

export interface AuthorizationResult {
  allowed: boolean;
  policy?: string;
  reason?: string;
  matchedPolicy?: AuthorizationPolicy;
}

export interface PolicyEvaluationContext {
  user: UserContext;
  resource: ResourceType;
  action: ActionType;
  resourceData?: ResourceData;
}

// ============================================================================
// Default Policies (from DESIGN_DOCUMENT.md §4.3)
// ============================================================================

export const DEFAULT_POLICIES: AuthorizationPolicy[] = [
  // =============================================
  // POSTS
  // =============================================
  {
    resource: "posts",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Public posts are readable by everyone",
    conditions: [
      { type: "attribute", field: "audience", operator: "eq", value: "PUBLIC" },
    ],
  },
  {
    resource: "posts",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Users can read their own posts",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "posts",
    action: "read",
    effect: "allow",
    priority: 80,
    description: "Followers can read followers-only posts",
    conditions: [
      { type: "attribute", field: "audience", operator: "eq", value: "FOLLOWERS" },
      { type: "relationship", relation: "follows", direction: "following", status: "ACCEPTED" },
    ],
  },
  {
    resource: "posts",
    action: "read",
    effect: "allow",
    priority: 70,
    description: "Close friends can read close-friends-only posts",
    conditions: [
      { type: "attribute", field: "closeFriendsOnly", operator: "eq", value: true },
      { type: "relationship", relation: "close_friends" },
    ],
  },
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
  {
    resource: "posts",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Owners can update their posts",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "posts",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Owners can delete their posts",
    conditions: [
      { type: "ownership" },
    ],
  },

  // =============================================
  // REELS
  // =============================================
  {
    resource: "reels",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Public reels are readable by everyone",
    conditions: [
      { type: "attribute", field: "audience", operator: "eq", value: "PUBLIC" },
    ],
  },
  {
    resource: "reels",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Users can read their own reels",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "reels",
    action: "read",
    effect: "allow",
    priority: 80,
    description: "Followers can read followers-only reels",
    conditions: [
      { type: "attribute", field: "audience", operator: "eq", value: "FOLLOWERS" },
      { type: "relationship", relation: "follows", direction: "following", status: "ACCEPTED" },
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
    description: "Owners can update their reels",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "reels",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Owners can delete their reels",
    conditions: [
      { type: "ownership" },
    ],
  },

  // =============================================
  // STORIES
  // =============================================
  {
    resource: "stories",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Users can read their own stories",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "stories",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Followers can read stories",
    conditions: [
      { type: "attribute", field: "audience", operator: "eq", value: "followers" },
      { type: "relationship", relation: "follows", direction: "following", status: "ACCEPTED" },
    ],
  },
  {
    resource: "stories",
    action: "read",
    effect: "allow",
    priority: 80,
    description: "Close friends can read close-friends stories",
    conditions: [
      { type: "attribute", field: "audience", operator: "eq", value: "close_friends" },
      { type: "relationship", relation: "close_friends" },
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
  {
    resource: "stories",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Owners can delete their stories",
    conditions: [
      { type: "ownership" },
    ],
  },

  // =============================================
  // COMMENTS
  // =============================================
  {
    resource: "comments",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Non-hidden comments are readable",
    conditions: [
      { type: "attribute", field: "isHidden", operator: "eq", value: false },
    ],
  },
  {
    resource: "comments",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Authors can read their own hidden comments",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "comments",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can create comments",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "comments",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Authors can update their comments",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "comments",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Authors can delete their comments",
    conditions: [
      { type: "ownership" },
    ],
  },

  // ============================================================================
  // LIKES
  // ============================================================================
  {
    resource: "likes",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Likes are publicly readable",
    conditions: [],
  },
  {
    resource: "likes",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can like content",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "likes",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Users can unlike their own likes",
    conditions: [
      { type: "ownership" },
    ],
  },

  // =============================================
  // CONVERSATIONS (DMs)
  // =============================================
  {
    resource: "conversations",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Members can read conversations",
    conditions: [
      { type: "membership" },
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
  {
    resource: "conversations",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Group owners/admins can update conversation",
    conditions: [
      { type: "custom", expression: "EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = conversations.id AND user_id = $1 AND role IN ('owner', 'admin'))" },
    ],
  },

  // =============================================
  // MESSAGES
  // =============================================
  {
    resource: "messages",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Conversation members can read messages",
    conditions: [
      { type: "membership", via: "conversation" },
    ],
  },
  {
    resource: "messages",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Conversation members can send messages",
    conditions: [
      { type: "membership", via: "conversation" },
    ],
  },
  {
    resource: "messages",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Authors can edit messages within 10 minutes",
    conditions: [
      { type: "ownership", via: "sender_id" },
      { type: "custom", expression: "NOW() - messages.created_at < INTERVAL '10 minutes'" },
    ],
  },
  {
    resource: "messages",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Authors can unsend their messages",
    conditions: [
      { type: "ownership", via: "sender_id" },
    ],
  },

  // =============================================
  // NOTIFICATIONS
  // =============================================
  {
    resource: "notifications",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Recipients can read their notifications",
    conditions: [
      { type: "ownership", via: "recipient_id" },
    ],
  },
  {
    resource: "notifications",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Recipients can mark notifications as read",
    conditions: [
      { type: "ownership", via: "recipient_id" },
    ],
  },

  // =============================================
  // USERS
  // =============================================
  {
    resource: "users",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Public profiles are readable by everyone",
    conditions: [
      { type: "attribute", field: "isPrivate", operator: "eq", value: false },
    ],
  },
  {
    resource: "users",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Users can read their own profile",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "users",
    action: "read",
    effect: "allow",
    priority: 80,
    description: "Followers can read private profiles",
    conditions: [
      { type: "attribute", field: "isPrivate", operator: "eq", value: true },
      { type: "relationship", relation: "follows", direction: "following", status: "ACCEPTED" },
    ],
  },
  {
    resource: "users",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Users can update their own profile",
    conditions: [
      { type: "ownership" },
    ],
  },

  // =============================================
  // FOLLOWS
  // =============================================
  {
    resource: "follows",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Users can read their own follows",
    conditions: [
      { type: "ownership", via: "follower_id" },
    ],
  },
  {
    resource: "follows",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Users can read their followers",
    conditions: [
      { type: "ownership", via: "following_id" },
    ],
  },
  {
    resource: "follows",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can follow others",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "follows",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Followed user can accept/decline follow requests",
    conditions: [
      { type: "ownership", via: "following_id" },
    ],
  },
  {
    resource: "follows",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Users can unfollow",
    conditions: [
      { type: "ownership", via: "follower_id" },
    ],
  },

  // =============================================
  // BLOCKS
  // =============================================
  {
    resource: "blocks",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Blockers can read their blocks",
    conditions: [
      { type: "ownership", via: "blocker_id" },
    ],
  },
  {
    resource: "blocks",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can block others",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "blocks",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Blockers can unblock",
    conditions: [
      { type: "ownership", via: "blocker_id" },
    ],
  },

  // =============================================
  // RESTRICTIONS
  // =============================================
  {
    resource: "restrictions",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Restrictors can read their restrictions",
    conditions: [
      { type: "ownership", via: "restrictor_id" },
    ],
  },
  {
    resource: "restrictions",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can restrict others",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "restrictions",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Restrictors can unrestrict",
    conditions: [
      { type: "ownership", via: "restrictor_id" },
    ],
  },

  // =============================================
  // CLOSE FRIENDS
  // =============================================
  {
    resource: "close_friends",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Users can read their close friends list",
    conditions: [
      { type: "ownership", via: "user_id" },
    ],
  },
  {
    resource: "close_friends",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Users can add close friends",
    conditions: [
      { type: "ownership", via: "user_id" },
    ],
  },
  {
    resource: "close_friends",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Users can remove close friends",
    conditions: [
      { type: "ownership", via: "user_id" },
    ],
  },

  // =============================================
  // COLLECTIONS & SAVES
  // =============================================
  {
    resource: "collections",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Owners can read their collections",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "collections",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can create collections",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "collections",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Owners can update collections",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "collections",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Owners can delete collections",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "saved_items",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Owners can read their saved items",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "saved_items",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can save items",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "saved_items",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Owners can unsave items",
    conditions: [
      { type: "ownership" },
    ],
  },

  // =============================================
  // DEVICE TOKENS
  // =============================================
  {
    resource: "device_tokens",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Users can read their device tokens",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "device_tokens",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Users can register device tokens",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "device_tokens",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Users can update their device tokens",
    conditions: [
      { type: "ownership" },
    ],
  },
  {
    resource: "device_tokens",
    action: "delete",
    effect: "allow",
    priority: 100,
    description: "Users can delete their device tokens",
    conditions: [
      { type: "ownership" },
    ],
  },

  // =============================================
  // CALLS
  // =============================================
  {
    resource: "calls",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Participants can read calls",
    conditions: [
      { type: "membership" },
    ],
  },
  {
    resource: "calls",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can initiate calls",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "calls",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Initiators can update calls",
    conditions: [
      { type: "ownership", via: "initiator_id" },
    ],
  },

  // =============================================
  // CALL PARTICIPANTS
  // =============================================
  {
    resource: "call_participants",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Call participants can read participant list",
    conditions: [
      { type: "membership", via: "call" },
    ],
  },
  {
    resource: "call_participants",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Participants can update their own status",
    conditions: [
      { type: "ownership" },
    ],
  },

  // =============================================
  // LIVE VIDEOS
  // =============================================
  {
    resource: "live_videos",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Public live videos are readable",
    conditions: [
      { type: "attribute", field: "status", operator: "eq", value: "LIVE" },
    ],
  },
  {
    resource: "live_videos",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Hosts can read their live videos",
    conditions: [
      { type: "ownership", via: "host_id" },
    ],
  },
  {
    resource: "live_videos",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Verified users can create live videos",
    conditions: [
      { type: "role", roles: ["user"] },
      { type: "attribute", field: "isVerified", operator: "eq", value: true },
    ],
  },

  // =============================================
  // REPORTS
  // =============================================
  {
    resource: "reports",
    action: "read",
    effect: "allow",
    priority: 100,
    description: "Reporters can read their reports",
    conditions: [
      { type: "ownership", via: "reporter_id" },
    ],
  },
  {
    resource: "reports",
    action: "read",
    effect: "allow",
    priority: 90,
    description: "Moderators can read all reports",
    conditions: [
      { type: "role", roles: ["moderator", "admin"] },
    ],
  },
  {
    resource: "reports",
    action: "create",
    effect: "allow",
    priority: 100,
    description: "Authenticated users can report content",
    conditions: [
      { type: "role", roles: ["user"] },
    ],
  },
  {
    resource: "reports",
    action: "update",
    effect: "allow",
    priority: 100,
    description: "Moderators can update reports",
    conditions: [
      { type: "role", roles: ["moderator", "admin"] },
    ],
  },

  // =============================================
  // DENY POLICIES (BLOCKS TAKE PRECEDENCE)
  // =============================================
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
    resource: "messages",
    action: "*",
    effect: "deny",
    priority: 1000,
    description: "Blocked users cannot message each other",
    conditions: [
      { type: "relationship", relation: "blocks", direction: "either" },
    ],
  },
  {
    resource: "follows",
    action: "create",
    effect: "deny",
    priority: 1000,
    description: "Blocked users cannot follow blocker",
    conditions: [
      { type: "relationship", relation: "blocks", direction: "blocked" },
    ],
  },
];

// ============================================================================
// Policy Service Class
// ============================================================================

export class PolicyService {
  private policies: AuthorizationPolicy[] = DEFAULT_POLICIES;

  constructor(customPolicies?: AuthorizationPolicy[]) {
    if (customPolicies) {
      this.policies = [...customPolicies, ...DEFAULT_POLICIES];
      // Sort by priority descending
      this.policies.sort((a, b) => b.priority - a.priority);
    }
  }

  /**
   * Main authorization function
   * Evaluates all applicable policies and returns the decision
   */
  async authorize(context: PolicyEvaluationContext): Promise<AuthorizationResult> {
    const { user, resource, action, resourceData } = context;

    // Get applicable policies sorted by priority (highest first)
    const applicable = this.policies
      .filter((p) => p.resource === resource || p.resource === "*")
      .filter((p) => p.action === action || p.action === "*")
      .sort((a, b) => b.priority - a.priority);

    // Evaluate deny policies first (highest priority)
    for (const policy of applicable) {
      if (policy.effect === "deny") {
        const result = await this.evaluateConditions(policy.conditions, user, resourceData);
        if (result) {
          return {
            allowed: false,
            policy: policy.resource,
            reason: policy.description || "Denied by policy",
            matchedPolicy: policy,
          };
        }
      }
    }

    // Then evaluate allow policies
    for (const policy of applicable) {
      if (policy.effect === "allow") {
        const result = await this.evaluateConditions(policy.conditions, user, resourceData);
        if (result) {
          return {
            allowed: true,
            policy: policy.resource,
            matchedPolicy: policy,
          };
        }
      }
    }

    return {
      allowed: false,
      reason: "No matching policy found",
    };
  }

  /**
   * Convenience methods for common actions
   */
  async canRead(user: UserContext, resource: ResourceType, resourceData?: ResourceData): Promise<AuthorizationResult> {
    return this.authorize({ user, resource, action: "read", resourceData });
  }

  async canWrite(user: UserContext, resource: ResourceType, resourceData?: ResourceData): Promise<AuthorizationResult> {
    // Write includes create and update
    const createResult = await this.authorize({ user, resource, action: "create", resourceData });
    if (createResult.allowed) return createResult;

    const updateResult = await this.authorize({ user, resource, action: "update", resourceData });
    return updateResult;
  }

  async canCreate(user: UserContext, resource: ResourceType, resourceData?: ResourceData): Promise<AuthorizationResult> {
    return this.authorize({ user, resource, action: "create", resourceData });
  }

  async canUpdate(user: UserContext, resource: ResourceType, resourceData?: ResourceData): Promise<AuthorizationResult> {
    return this.authorize({ user, resource, action: "update", resourceData });
  }

  async canDelete(user: UserContext, resource: ResourceType, resourceData?: ResourceData): Promise<AuthorizationResult> {
    return this.authorize({ user, resource, action: "delete", resourceData });
  }

  async canList(user: UserContext, resource: ResourceType, resourceData?: ResourceData): Promise<AuthorizationResult> {
    return this.authorize({ user, resource, action: "list", resourceData });
  }

  /**
   * Evaluate a list of conditions
   * All conditions must pass (AND logic)
   */
  private async evaluateConditions(
    conditions: PolicyCondition[],
    user: UserContext,
    resourceData?: ResourceData
  ): Promise<boolean> {
    for (const condition of conditions) {
      const result = await this.evaluateCondition(condition, user, resourceData);
      if (!result) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluate a single condition
   */
  private async evaluateCondition(
    condition: PolicyCondition,
    user: UserContext,
    resourceData?: ResourceData
  ): Promise<boolean> {
    switch (condition.type) {
      case "ownership":
        return this.checkOwnership(condition, user, resourceData);

      case "relationship":
        return this.checkRelationship(condition, user, resourceData);

      case "attribute":
        return this.checkAttribute(condition, user, resourceData);

      case "role":
        return this.checkRole(condition, user);

      case "membership":
        return this.checkMembership(condition, user, resourceData);

      case "custom":
        return this.checkCustom(condition, user, resourceData);

      default:
        return false;
    }
  }

  /**
   * Check ownership condition
   * resource.owner_id == user.id (or via field)
   */
  private checkOwnership(
    condition: PolicyCondition,
    user: UserContext,
    resourceData?: ResourceData
  ): boolean {
    if (!resourceData) return false;

    const ownerField = condition.via || "authorId" || "userId" || "ownerId";
    const ownerId = resourceData[ownerField] || resourceData.authorId || resourceData.userId || resourceData.ownerId;

    return ownerId === user.id;
  }

  /**
   * Check relationship condition
   * e.g., EXISTS follows WHERE follower=user AND following=resource.owner
   */
  private async checkRelationship(
    condition: PolicyCondition,
    user: UserContext,
    resourceData?: ResourceData
  ): Promise<boolean> {
    if (!resourceData) return false;

    const relation = condition.relation;
    const direction = condition.direction || "following";
    const status = condition.status || "ACCEPTED";

    // Determine the target user ID from resource data
    const targetUserId = resourceData.authorId || resourceData.userId || resourceData.ownerId;
    if (!targetUserId) return false;

    switch (relation) {
      case "follows":
        return this.checkFollowsRelationship(user.id, targetUserId, direction, status);

      case "close_friends":
        return this.checkCloseFriendsRelationship(user.id, targetUserId);

      case "blocks":
        return this.checkBlocksRelationship(user.id, targetUserId, direction);

      default:
        return false;
    }
  }

  /**
   * Check follows relationship
   */
  private async checkFollowsRelationship(
    userId: string,
    targetUserId: string,
    direction: string,
    status: string
  ): Promise<boolean> {
    if (direction === "following") {
      // User follows target
      const follow = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, userId),
          eq(schema.follows.followingId, targetUserId),
          eq(schema.follows.status, status as any)
        ),
      });
      return !!follow;
    } else if (direction === "follower") {
      // Target follows user
      const follow = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, targetUserId),
          eq(schema.follows.followingId, userId),
          eq(schema.follows.status, status as any)
        ),
      });
      return !!follow;
    } else if (direction === "either") {
      // Either direction
      const follow = await db.query.follows.findFirst({
        where: and(
          or(
            and(
              eq(schema.follows.followerId, userId),
              eq(schema.follows.followingId, targetUserId)
            ),
            and(
              eq(schema.follows.followerId, targetUserId),
              eq(schema.follows.followingId, userId)
            )
          ),
          eq(schema.follows.status, status as any)
        ),
      });
      return !!follow;
    }
    return false;
  }

  /**
   * Check close friends relationship
   */
  private async checkCloseFriendsRelationship(
    userId: string,
    targetUserId: string
  ): Promise<boolean> {
    // Check if targetUserId has userId in their close friends list
    const closeFriend = await db.query.closeFriends.findFirst({
      where: and(
        eq(schema.closeFriends.userId, targetUserId),
        eq(schema.closeFriends.friendId, userId)
      ),
    });
    return !!closeFriend;
  }

  /**
   * Check blocks relationship
   */
  private async checkBlocksRelationship(
    userId: string,
    targetUserId: string,
    direction: string
  ): Promise<boolean> {
    if (direction === "blocker") {
      // User blocked target
      const block = await db.query.blocks.findFirst({
        where: and(
          eq(schema.blocks.blockerId, userId),
          eq(schema.blocks.blockedId, targetUserId)
        ),
      });
      return !!block;
    } else if (direction === "blocked") {
      // Target blocked user
      const block = await db.query.blocks.findFirst({
        where: and(
          eq(schema.blocks.blockerId, targetUserId),
          eq(schema.blocks.blockedId, userId)
        ),
      });
      return !!block;
    } else if (direction === "either") {
      // Either direction
      const block = await db.query.blocks.findFirst({
        where: or(
          and(
            eq(schema.blocks.blockerId, userId),
            eq(schema.blocks.blockedId, targetUserId)
          ),
          and(
            eq(schema.blocks.blockerId, targetUserId),
            eq(schema.blocks.blockedId, userId)
          )
        ),
      });
      return !!block;
    }
    return false;
  }

  /**
   * Check attribute condition
   * resource.field operator value
   */
  private checkAttribute(
    condition: PolicyCondition,
    user: UserContext,
    resourceData?: ResourceData
  ): boolean {
    if (!resourceData || !condition.field || !condition.operator) return false;

    const value = resourceData[condition.field];
    const expectedValue = condition.value;

    switch (condition.operator) {
      case "eq":
        return value === expectedValue;
      case "neq":
        return value !== expectedValue;
      case "in":
        return Array.isArray(expectedValue) && expectedValue.includes(value);
      case "nin":
        return Array.isArray(expectedValue) && !expectedValue.includes(value);
      case "gt":
        return value > expectedValue;
      case "lt":
        return value < expectedValue;
      case "gte":
        return value >= expectedValue;
      case "lte":
        return value <= expectedValue;
      case "like":
        return typeof value === "string" && typeof expectedValue === "string" && value.includes(expectedValue);
      default:
        return false;
    }
  }

  /**
   * Check role condition
   * user.roles.includes(role)
   */
  private checkRole(
    condition: PolicyCondition,
    user: UserContext
  ): boolean {
    if (!user.roles || !condition.roles) return false;
    return condition.roles.some((role) => user.roles!.includes(role));
  }

  /**
   * Check membership condition
   * User is member of resource (e.g., conversation)
   */
  private async checkMembership(
    condition: PolicyCondition,
    user: UserContext,
    resourceData?: ResourceData
  ): Promise<boolean> {
    if (!resourceData) return false;

    const via = condition.via;

    if (via === "conversation") {
      // Check if user is member of conversation
      const conversationId = resourceData.conversationId || resourceData.id;
      if (!conversationId) return false;

      const membership = await db.query.conversationMembers.findFirst({
        where: and(
          eq(schema.conversationMembers.conversationId, conversationId),
          eq(schema.conversationMembers.userId, user.id),
          or(
            isNull(schema.conversationMembers.leftAt),
            // leftAt is null or future
            // This is a simplification - actual check would be more complex
          )
        ),
      });
      return !!membership;
    }

    if (via === "call") {
      // Check if user is participant in call
      const callId = resourceData.callId || resourceData.id;
      if (!callId) return false;

      const participant = await db.query.callParticipants.findFirst({
        where: and(
          eq(schema.callParticipants.callId, callId),
          eq(schema.callParticipants.userId, user.id),
          or(
            eq(schema.callParticipants.status, "CONNECTED"),
            eq(schema.callParticipants.status, "JOINING"),
            eq(schema.callParticipants.status, "INVITED")
          )
        ),
      });
      return !!participant;
    }

    return false;
  }

  /**
   * Check custom SQL expression
   * This is a placeholder - in production, you'd use a safe query builder
   */
  private async checkCustom(
    condition: PolicyCondition,
    user: UserContext,
    resourceData?: ResourceData
  ): Promise<boolean> {
    if (!condition.expression) return false;

    // SECURITY WARNING: Custom expressions should be carefully validated
    // In production, use a safe, predefined set of expressions or a query builder
    // For now, we support a few predefined expressions

    const expressions: Record<string, () => Promise<boolean>> = {
      // Message edit window (10 minutes)
      "NOW() - messages.created_at < INTERVAL '10 minutes'": async () => {
        if (!resourceData?.createdAt) return false;
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        return new Date(resourceData.createdAt) > tenMinutesAgo;
      },
      // Conversation membership check
      "EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = conversations.id AND user_id = $1 AND role IN ('owner', 'admin'))": async () => {
        if (!resourceData?.id) return false;
        const membership = await db.query.conversationMembers.findFirst({
          where: and(
            eq(schema.conversationMembers.conversationId, resourceData.id),
            eq(schema.conversationMembers.userId, user.id),
            or(
              eq(schema.conversationMembers.role, "owner"),
              eq(schema.conversationMembers.role, "admin")
            )
          ),
        });
        return !!membership;
      },
    };

    const exprFn = expressions[condition.expression];
    if (exprFn) {
      return await exprFn();
    }

    // Unknown expression - deny by default for security
    console.warn(`[PolicyService] Unknown custom expression: ${condition.expression}`);
    return false;
  }

  /**
   * Add a custom policy
   */
  addPolicy(policy: AuthorizationPolicy): void {
    this.policies.push(policy);
    this.policies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get all policies (for debugging/admin)
   */
  getPolicies(): AuthorizationPolicy[] {
    return [...this.policies];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let policyServiceInstance: PolicyService | null = null;

export function getPolicyService(): PolicyService {
  if (!policyServiceInstance) {
    policyServiceInstance = new PolicyService();
  }
  return policyServiceInstance;
}

export function setPolicyService(service: PolicyService): void {
  policyServiceInstance = service;
}

// ============================================================================
// Helper Functions for Middleware Integration
// ============================================================================

/**
 * Create a user context from the authenticated user
 */
export function createUserContext(user: typeof schema.users.$inferSelect): UserContext {
  return {
    id: user.id,
    roles: user.isVerified ? ["user", "verified"] : ["user"],
    isVerified: user.isVerified,
    isPrivate: user.isPrivate,
  };
}

/**
 * Create resource data from a database record
 */
export function createResourceData(record: any, resourceType: ResourceType): ResourceData {
  return {
    id: record.id,
    authorId: record.authorId || record.userId || record.ownerId,
    userId: record.userId,
    ownerId: record.ownerId,
    audience: record.audience,
    isPrivate: record.isPrivate,
    closeFriendsOnly: record.closeFriendsOnly,
    createdAt: record.createdAt,
    conversationId: record.conversationId,
    callId: record.callId,
    senderId: record.senderId,
    ...record,
  };
}

// Need to import isNull for the membership check
import { isNull } from "drizzle-orm";