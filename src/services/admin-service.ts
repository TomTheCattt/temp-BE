import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, gte, lt, lte, inArray, isNull, or } from "drizzle-orm";

/**
 * Admin Service
 *
 * Handles admin dashboard statistics, user management, and platform analytics.
 */

// ============================================================================
// Types
// ============================================================================

export interface PlatformStats {
  users: {
    total: number;
    activeToday: number;
    activeThisWeek: number;
    activeThisMonth: number;
    newToday: number;
    newThisWeek: number;
    newThisMonth: number;
    verified: number;
    banned: number;
    shadowbanned: number;
  };
  content: {
    posts: number;
    reels: number;
    stories: number;
    comments: number;
    likes: number;
  };
  engagement: {
    dau: number;
    wau: number;
    mau: number;
    messagesSent: number;
    callsStarted: number;
  };
  moderation: {
    pendingReports: number;
    resolvedReportsToday: number;
    actionsTakenToday: number;
  };
}

export interface UserManagementParams {
  page: number;
  perPage: number;
  search?: string;
  status?: "active" | "banned" | "shadowbanned" | "verified" | "unverified";
  sortBy?: "createdAt" | "username" | "followersCount" | "postsCount" | "lastLoginAt";
  sortOrder?: "asc" | "desc";
}

export interface UserListItem {
  id: string;
  username: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  isPrivate: boolean;
  isBusiness: boolean;
  postsCount: number;
  followersCount: number;
  followingCount: number;
  reelsCount: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  // Moderation status
  isBanned: boolean;
  isShadowbanned: boolean;
  banReason?: string;
  banExpiresAt?: Date | null;
  featureRestrictions?: string[];
}

export interface ModerationActionParams {
  targetUserId: string;
  action: "warn" | "suspend" | "ban" | "shadowban" | "feature_restrict" | "restore";
  reason: string;
  duration?: string; // e.g., "7d", "30d", "permanent"
  moderatorId: string;
}

export interface ModerationActionResult {
  success: boolean;
  actionId: string;
  expiresAt?: Date | null;
}

export interface AnalyticsParams {
  metric: "dau" | "wau" | "mau" | "retention" | "engagement" | "content" | "growth";
  startDate: Date;
  endDate: Date;
  granularity?: "hour" | "day" | "week" | "month";
}

export interface AnalyticsDataPoint {
  date: string;
  value: number;
  metadata?: Record<string, any>;
}

export interface AuditLogParams {
  page: number;
  perPage: number;
  actorId?: string;
  action?: string;
  resourceType?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorIp: string | null;
  actorUserAgent: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  oldValues: Record<string, any> | null;
  newValues: Record<string, any> | null;
  correlationId: string | null;
  sessionId: string | null;
  requestId: string | null;
  metadata: Record<string, any>;
  createdAt: Date;
}

// ============================================================================
// Admin Service Class
// ============================================================================

export class AdminService {
  /**
   * Get platform overview statistics
   */
  async getPlatformStats(): Promise<PlatformStats> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000);

    // User stats
    const [
      totalUsers,
      activeToday,
      activeThisWeek,
      activeThisMonth,
      newToday,
      newThisWeek,
      newThisMonth,
      verifiedUsers,
      bannedUsers,
      shadowbannedUsers,
    ] = await Promise.all([
      db.select({ count: count() }).from(schema.users).where(isNull(schema.users.deletedAt)),
      db.select({ count: count() }).from(schema.users).where(
        and(isNull(schema.users.deletedAt), gte(schema.users.lastLoginAt, todayStart))
      ),
      db.select({ count: count() }).from(schema.users).where(
        and(isNull(schema.users.deletedAt), gte(schema.users.lastLoginAt, weekStart))
      ),
      db.select({ count: count() }).from(schema.users).where(
        and(isNull(schema.users.deletedAt), gte(schema.users.lastLoginAt, monthStart))
      ),
      db.select({ count: count() }).from(schema.users).where(
        and(isNull(schema.users.deletedAt), gte(schema.users.createdAt, todayStart))
      ),
      db.select({ count: count() }).from(schema.users).where(
        and(isNull(schema.users.deletedAt), gte(schema.users.createdAt, weekStart))
      ),
      db.select({ count: count() }).from(schema.users).where(
        and(isNull(schema.users.deletedAt), gte(schema.users.createdAt, monthStart))
      ),
      db.select({ count: count() }).from(schema.users).where(
        and(isNull(schema.users.deletedAt), eq(schema.users.isVerified, true))
      ),
      // Banned users - check for moderation actions with ACCOUNT_BAN
      db.select({ count: count() }).from(schema.moderationActions).where(
        and(
          eq(schema.moderationActions.action, "ACCOUNT_BAN"),
          or(isNull(schema.moderationActions.expiresAt), gte(schema.moderationActions.expiresAt, now))
        )
      ),
      // Shadowbanned users
      db.select({ count: count() }).from(schema.moderationActions).where(
        and(
          eq(schema.moderationActions.action, "SHADOWBAN"),
          or(isNull(schema.moderationActions.expiresAt), gte(schema.moderationActions.expiresAt, now))
        )
      ),
    ]);

    // Content stats
    const [
      totalPosts,
      totalReels,
      totalStories,
      totalComments,
      totalLikes,
    ] = await Promise.all([
      db.select({ count: count() }).from(schema.posts).where(isNull(schema.posts.deletedAt)),
      db.select({ count: count() }).from(schema.reels).where(isNull(schema.reels.deletedAt)),
      db.select({ count: count() }).from(schema.stories).where(
        and(isNull(schema.stories.deletedAt), gte(schema.stories.expiresAt, now))
      ),
      db.select({ count: count() }).from(schema.comments).where(isNull(schema.comments.deletedAt)),
      db.select({ count: count() }).from(schema.likes),
    ]);

    // Engagement stats (DAU/WAU/MAU)
    const [dau, wau, mau, messagesSent, callsStarted] = await Promise.all([
      // DAU: unique users with activity today
      db.execute(sql`
        SELECT COUNT(DISTINCT user_id) as count FROM (
          SELECT author_id as user_id FROM posts WHERE created_at >= ${todayStart}
          UNION SELECT author_id FROM reels WHERE created_at >= ${todayStart}
          UNION SELECT author_id FROM stories WHERE created_at >= ${todayStart}
          UNION SELECT author_id FROM comments WHERE created_at >= ${todayStart}
          UNION SELECT sender_id FROM messages WHERE created_at >= ${todayStart}
          UNION SELECT initiator_id FROM calls WHERE created_at >= ${todayStart}
        ) as active_users
      `),
      // WAU
      db.execute(sql`
        SELECT COUNT(DISTINCT user_id) as count FROM (
          SELECT author_id as user_id FROM posts WHERE created_at >= ${weekStart}
          UNION SELECT author_id FROM reels WHERE created_at >= ${weekStart}
          UNION SELECT author_id FROM stories WHERE created_at >= ${weekStart}
          UNION SELECT author_id FROM comments WHERE created_at >= ${weekStart}
          UNION SELECT sender_id FROM messages WHERE created_at >= ${weekStart}
          UNION SELECT initiator_id FROM calls WHERE created_at >= ${weekStart}
        ) as active_users
      `),
      // MAU
      db.execute(sql`
        SELECT COUNT(DISTINCT user_id) as count FROM (
          SELECT author_id as user_id FROM posts WHERE created_at >= ${monthStart}
          UNION SELECT author_id FROM reels WHERE created_at >= ${monthStart}
          UNION SELECT author_id FROM stories WHERE created_at >= ${monthStart}
          UNION SELECT author_id FROM comments WHERE created_at >= ${monthStart}
          UNION SELECT sender_id FROM messages WHERE created_at >= ${monthStart}
          UNION SELECT initiator_id FROM calls WHERE created_at >= ${monthStart}
        ) as active_users
      `),
      db.select({ count: count() }).from(schema.messages).where(gte(schema.messages.createdAt, todayStart)),
      db.select({ count: count() }).from(schema.calls).where(gte(schema.calls.createdAt, todayStart)),
    ]);

    // Moderation stats
    const [pendingReports, resolvedReportsToday, actionsTakenToday] = await Promise.all([
      db.select({ count: count() }).from(schema.reports).where(eq(schema.reports.status, "PENDING")),
      db.select({ count: count() }).from(schema.reports).where(
        and(eq(schema.reports.status, "RESOLVED"), gte(schema.reports.resolvedAt, todayStart))
      ),
      db.select({ count: count() }).from(schema.moderationActions).where(gte(schema.moderationActions.createdAt, todayStart)),
    ]);

    return {
      users: {
        total: totalUsers[0]?.count || 0,
        activeToday: activeToday[0]?.count || 0,
        activeThisWeek: activeThisWeek[0]?.count || 0,
        activeThisMonth: activeThisMonth[0]?.count || 0,
        newToday: newToday[0]?.count || 0,
        newThisWeek: newThisWeek[0]?.count || 0,
        newThisMonth: newThisMonth[0]?.count || 0,
        verified: verifiedUsers[0]?.count || 0,
        banned: bannedUsers[0]?.count || 0,
        shadowbanned: shadowbannedUsers[0]?.count || 0,
      },
      content: {
        posts: totalPosts[0]?.count || 0,
        reels: totalReels[0]?.count || 0,
        stories: totalStories[0]?.count || 0,
        comments: totalComments[0]?.count || 0,
        likes: totalLikes[0]?.count || 0,
      },
      engagement: {
        dau: (dau.rows[0] as any)?.count || 0,
        wau: (wau.rows[0] as any)?.count || 0,
        mau: (mau.rows[0] as any)?.count || 0,
        messagesSent: messagesSent[0]?.count || 0,
        callsStarted: callsStarted[0]?.count || 0,
      },
      moderation: {
        pendingReports: pendingReports[0]?.count || 0,
        resolvedReportsToday: resolvedReportsToday[0]?.count || 0,
        actionsTakenToday: actionsTakenToday[0]?.count || 0,
      },
    };
  }

  /**
   * Get paginated list of users with filters
   */
  async getUsers(params: UserManagementParams): Promise<{ items: UserListItem[]; total: number; page: number; perPage: number; hasMore: boolean }> {
    const { page, perPage, search, status, sortBy = "createdAt", sortOrder = "desc" } = params;
    const offset = (page - 1) * perPage;

    // Build conditions
    const conditions = [isNull(schema.users.deletedAt)];

    if (search) {
      conditions.push(
        or(
          sql`${schema.users.username} ILIKE ${`%${search}%`}`,
          sql`${schema.users.email} ILIKE ${`%${search}%`}`,
          sql`${schema.users.fullName} ILIKE ${`%${search}%`}`
        )!
      );
    }

    if (status) {
      switch (status) {
        case "banned":
          conditions.push(
            sql`EXISTS (SELECT 1 FROM ${schema.moderationActions} WHERE target_type = 'user' AND target_id = ${schema.users.id} AND action = 'ACCOUNT_BAN' AND (expires_at IS NULL OR expires_at > NOW()))`
          );
          break;
        case "shadowbanned":
          conditions.push(
            sql`EXISTS (SELECT 1 FROM ${schema.moderationActions} WHERE target_type = 'user' AND target_id = ${schema.users.id} AND action = 'SHADOWBAN' AND (expires_at IS NULL OR expires_at > NOW()))`
          );
          break;
        case "verified":
          conditions.push(eq(schema.users.isVerified, true));
          break;
        case "unverified":
          conditions.push(eq(schema.users.isVerified, false));
          break;
        case "active":
          conditions.push(isNull(schema.users.deletedAt));
          break;
      }
    }

    // Build sort
    const sortColumn = schema.users[sortBy as keyof typeof schema.users] as any || schema.users.createdAt;
    const orderFn = sortOrder === "asc" ? asc : desc;

    // Execute queries
    const [usersList, totalResult] = await Promise.all([
      db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          email: schema.users.email,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
          isPrivate: schema.users.isPrivate,
          isBusiness: schema.users.isBusiness,
          postsCount: schema.users.postsCount,
          followersCount: schema.users.followersCount,
          followingCount: schema.users.followingCount,
          reelsCount: schema.users.reelsCount,
          lastLoginAt: schema.users.lastLoginAt,
          createdAt: schema.users.createdAt,
          deletedAt: schema.users.deletedAt,
        })
        .from(schema.users)
        .where(and(...conditions))
        .orderBy(orderFn(sortColumn))
        .limit(perPage)
        .offset(offset),
      db.select({ count: count() }).from(schema.users).where(and(...conditions)),
    ]);

    // Fetch moderation status for each user
    const userIds = usersList.map(u => u.id);
    let moderationStatuses: Map<string, { isBanned: boolean; isShadowbanned: boolean; banReason?: string; banExpiresAt?: Date | null; featureRestrictions?: string[] }> = new Map();

    if (userIds.length > 0) {
      const moderationActions = await db
        .select()
        .from(schema.moderationActions)
        .where(
          and(
            inArray(schema.moderationActions.targetId, userIds),
            eq(schema.moderationActions.targetType, "user"),
            or(
              isNull(schema.moderationActions.expiresAt),
              gte(schema.moderationActions.expiresAt, new Date())
            )
          )
        );

      for (const action of moderationActions) {
        const existing = moderationStatuses.get(action.targetId) || { isBanned: false, isShadowbanned: false, featureRestrictions: [] };
        if (action.action === "ACCOUNT_BAN") {
          existing.isBanned = true;
          existing.banReason = action.reason || undefined;
          existing.banExpiresAt = action.expiresAt || null;
        } else if (action.action === "SHADOWBAN") {
          existing.isShadowbanned = true;
        } else if (action.action === "FEATURE_RESTRICT") {
          existing.featureRestrictions?.push(action.reason || "restricted");
        }
        moderationStatuses.set(action.targetId, existing);
      }
    }

    // Map users with moderation status
    const items: UserListItem[] = usersList.map(user => {
      const modStatus = moderationStatuses.get(user.id) || { isBanned: false, isShadowbanned: false, featureRestrictions: [] };
      return {
        ...user,
        ...modStatus,
      };
    });

    const total = totalResult[0]?.count || 0;

    return {
      items,
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
    };
  }

  /**
   * Get user details by ID
   */
  async getUserById(userId: string): Promise<UserListItem | null> {
    const user = await db.query.users.findFirst({
      where: and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)),
    });

    if (!user) return null;

    // Get moderation status
    const moderationActions = await db
      .select()
      .from(schema.moderationActions)
      .where(
        and(
          eq(schema.moderationActions.targetId, userId),
          eq(schema.moderationActions.targetType, "user"),
          or(
            isNull(schema.moderationActions.expiresAt),
            gte(schema.moderationActions.expiresAt, new Date())
          )
        )
      );

    let isBanned = false;
    let isShadowbanned = false;
    let banReason: string | undefined;
    let banExpiresAt: Date | null = null;
    const featureRestrictions: string[] = [];

    for (const action of moderationActions) {
      if (action.action === "ACCOUNT_BAN") {
        isBanned = true;
        banReason = action.reason || undefined;
        banExpiresAt = action.expiresAt || null;
      } else if (action.action === "SHADOWBAN") {
        isShadowbanned = true;
      } else if (action.action === "FEATURE_RESTRICT") {
        featureRestrictions.push(action.reason || "restricted");
      }
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      isVerified: user.isVerified,
      isPrivate: user.isPrivate,
      isBusiness: user.isBusiness,
      postsCount: user.postsCount,
      followersCount: user.followersCount,
      followingCount: user.followingCount,
      reelsCount: user.reelsCount,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      deletedAt: user.deletedAt,
      isBanned,
      isShadowbanned,
      banReason,
      banExpiresAt,
      featureRestrictions,
    };
  }

  /**
   * Apply moderation action on a user
   */
  async applyModerationAction(params: ModerationActionParams): Promise<ModerationActionResult> {
    const { targetUserId, action, reason, duration, moderatorId } = params;

    // Map frontend action to database enum
    const actionMap: Record<string, string> = {
      "warn": "WARN",
      "suspend": "ACCOUNT_SUSPEND",
      "ban": "ACCOUNT_BAN",
      "shadowban": "SHADOWBAN",
      "feature_restrict": "FEATURE_RESTRICT",
      "restore": "RESTORE",
    };
    const dbAction = actionMap[action] || action;

    // Verify target user exists
    const targetUser = await db.query.users.findFirst({
      where: eq(schema.users.id, targetUserId),
    });

    if (!targetUser) {
      throw new Error("Target user not found");
    }

    // Calculate expiration
    let expiresAt: Date | null = null;
    if (duration && duration !== "permanent") {
      const match = duration.match(/^(\d+)([dwhm])$/);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        const ms = unit === "d" ? value * 24 * 60 * 60 * 1000 :
                   unit === "w" ? value * 7 * 24 * 60 * 60 * 1000 :
                   unit === "h" ? value * 60 * 60 * 1000 :
                   value * 60 * 1000;
        expiresAt = new Date(Date.now() + ms);
      }
    }

    // Insert moderation action
    const [moderationAction] = await db
      .insert(schema.moderationActions)
      .values({
        moderatorId,
        targetType: "user",
        targetId: targetUserId,
        action: dbAction as any,
        reason,
        expiresAt,
      })
      .returning();

    // If banning, also soft delete user (or mark as banned)
    if (dbAction === "ACCOUNT_BAN" || dbAction === "ACCOUNT_SUSPEND") {
      await db
        .update(schema.users)
        .set({ deletedAt: new Date() })
        .where(eq(schema.users.id, targetUserId));
    }

    // Log audit
    await this.logAudit({
      actorId: moderatorId,
      action: `moderation.${action}`,
      resourceType: "user",
      resourceId: targetUserId,
      newValues: { action, reason, duration, expiresAt },
      metadata: { targetUsername: targetUser.username },
    });

    return {
      success: true,
      actionId: moderationAction.id,
      expiresAt,
    };
  }

  /**
   * Get analytics data
   */
  async getAnalytics(params: AnalyticsParams): Promise<AnalyticsDataPoint[]> {
    const { metric, startDate, endDate, granularity = "day" } = params;

    // Determine date truncation
    const truncate = granularity === "hour" ? "hour" :
                     granularity === "day" ? "day" :
                     granularity === "week" ? "week" : "month";

    switch (metric) {
      case "dau":
        return this.getDAU(startDate, endDate, truncate);
      case "wau":
        return this.getWAU(startDate, endDate, truncate);
      case "mau":
        return this.getMAU(startDate, endDate, truncate);
      case "retention":
        return this.getRetention(startDate, endDate);
      case "engagement":
        return this.getEngagement(startDate, endDate, truncate);
      case "content":
        return this.getContentMetrics(startDate, endDate, truncate);
      case "growth":
        return this.getGrowthMetrics(startDate, endDate, truncate);
      default:
        throw new Error(`Unknown metric: ${metric}`);
    }
  }

  /**
   * Get Daily Active Users
   */
  private async getDAU(startDate: Date, endDate: Date, truncate: string): Promise<AnalyticsDataPoint[]> {
    const result = await db.execute(sql`
      SELECT
        DATE_TRUNC(${truncate}, activity_date) as date,
        COUNT(DISTINCT user_id) as value
      FROM (
        SELECT author_id as user_id, DATE(created_at) as activity_date FROM posts WHERE created_at BETWEEN ${startDate} AND ${endDate}
        UNION ALL SELECT author_id, DATE(created_at) FROM reels WHERE created_at BETWEEN ${startDate} AND ${endDate}
        UNION ALL SELECT author_id, DATE(created_at) FROM stories WHERE created_at BETWEEN ${startDate} AND ${endDate}
        UNION ALL SELECT author_id, DATE(created_at) FROM comments WHERE created_at BETWEEN ${startDate} AND ${endDate}
        UNION ALL SELECT sender_id, DATE(created_at) FROM messages WHERE created_at BETWEEN ${startDate} AND ${endDate}
        UNION ALL SELECT initiator_id, DATE(created_at) FROM calls WHERE created_at BETWEEN ${startDate} AND ${endDate}
      ) as activities
      GROUP BY DATE_TRUNC(${truncate}, activity_date)
      ORDER BY date
    `);

    return result.rows.map((row: any) => ({
      date: row.date.toISOString().split('T')[0],
      value: parseInt(row.value, 10),
    }));
  }

  /**
   * Get Weekly Active Users
   */
  private async getWAU(startDate: Date, endDate: Date, truncate: string): Promise<AnalyticsDataPoint[]> {
    // WAU is typically calculated as rolling 7-day window
    const result = await db.execute(sql`
      WITH weekly_activity AS (
        SELECT
          user_id,
          DATE_TRUNC('week', activity_date) as week,
          COUNT(DISTINCT DATE(activity_date)) as active_days
        FROM (
          SELECT author_id as user_id, DATE(created_at) as activity_date FROM posts WHERE created_at BETWEEN ${startDate} AND ${endDate}
          UNION ALL SELECT author_id, DATE(created_at) FROM reels WHERE created_at BETWEEN ${startDate} AND ${endDate}
          UNION ALL SELECT author_id, DATE(created_at) FROM stories WHERE created_at BETWEEN ${startDate} AND ${endDate}
          UNION ALL SELECT author_id, DATE(created_at) FROM comments WHERE created_at BETWEEN ${startDate} AND ${endDate}
          UNION ALL SELECT sender_id, DATE(created_at) FROM messages WHERE created_at BETWEEN ${startDate} AND ${endDate}
          UNION ALL SELECT initiator_id, DATE(created_at) FROM calls WHERE created_at BETWEEN ${startDate} AND ${endDate}
        ) as activities
        GROUP BY user_id, DATE_TRUNC('week', activity_date)
      )
      SELECT week as date, COUNT(*) as value
      FROM weekly_activity
      WHERE active_days >= 1
      GROUP BY week
      ORDER BY week
    `);

    return result.rows.map((row: any) => ({
      date: row.date.toISOString().split('T')[0],
      value: parseInt(row.value, 10),
    }));
  }

  /**
   * Get Monthly Active Users
   */
  private async getMAU(startDate: Date, endDate: Date, truncate: string): Promise<AnalyticsDataPoint[]> {
    const result = await db.execute(sql`
      WITH monthly_activity AS (
        SELECT
          user_id,
          DATE_TRUNC('month', activity_date) as month,
          COUNT(DISTINCT DATE(activity_date)) as active_days
        FROM (
          SELECT author_id as user_id, DATE(created_at) as activity_date FROM posts WHERE created_at BETWEEN ${startDate} AND ${endDate}
          UNION ALL SELECT author_id, DATE(created_at) FROM reels WHERE created_at BETWEEN ${startDate} AND ${endDate}
          UNION ALL SELECT author_id, DATE(created_at) FROM stories WHERE created_at BETWEEN ${startDate} AND ${endDate}
          UNION ALL SELECT author_id, DATE(created_at) FROM comments WHERE created_at BETWEEN ${startDate} AND ${endDate}
          UNION ALL SELECT sender_id, DATE(created_at) FROM messages WHERE created_at BETWEEN ${startDate} AND ${endDate}
          UNION ALL SELECT initiator_id, DATE(created_at) FROM calls WHERE created_at BETWEEN ${startDate} AND ${endDate}
        ) as activities
        GROUP BY user_id, DATE_TRUNC('month', activity_date)
      )
      SELECT month as date, COUNT(*) as value
      FROM monthly_activity
      WHERE active_days >= 1
      GROUP BY month
      ORDER BY month
    `);

    return result.rows.map((row: any) => ({
      date: row.date.toISOString().split('T')[0],
      value: parseInt(row.value, 10),
    }));
  }

  /**
   * Get Retention Metrics (Day 1, Day 7, Day 30)
   */
  private async getRetention(startDate: Date, endDate: Date): Promise<AnalyticsDataPoint[]> {
    const result = await db.execute(sql`
      WITH user_cohorts AS (
        SELECT
          id as user_id,
          DATE(created_at) as cohort_date
        FROM users
        WHERE created_at BETWEEN ${startDate} AND ${endDate}
      ),
      user_activity AS (
        SELECT
          u.user_id,
          u.cohort_date,
          DATE(a.activity_date) as activity_date
        FROM user_cohorts u
        JOIN (
          SELECT author_id as user_id, DATE(created_at) as activity_date FROM posts
          UNION SELECT author_id, DATE(created_at) FROM reels
          UNION SELECT author_id, DATE(created_at) FROM stories
          UNION SELECT author_id, DATE(created_at) FROM comments
          UNION SELECT sender_id, DATE(created_at) FROM messages
          UNION SELECT initiator_id, DATE(created_at) FROM calls
        ) a ON u.user_id = a.user_id
      ),
      retention AS (
        SELECT
          cohort_date,
          COUNT(DISTINCT user_id) as cohort_size,
          COUNT(DISTINCT CASE WHEN activity_date = cohort_date + INTERVAL '1 day' THEN user_id END) as day_1,
          COUNT(DISTINCT CASE WHEN activity_date BETWEEN cohort_date + INTERVAL '6 day' AND cohort_date + INTERVAL '7 day' THEN user_id END) as day_7,
          COUNT(DISTINCT CASE WHEN activity_date BETWEEN cohort_date + INTERVAL '29 day' AND cohort_date + INTERVAL '30 day' THEN user_id END) as day_30
        FROM user_activity
        GROUP BY cohort_date
      )
      SELECT
        cohort_date as date,
        cohort_size,
        ROUND(day_1::numeric / NULLIF(cohort_size, 0) * 100, 2) as day_1_retention,
        ROUND(day_7::numeric / NULLIF(cohort_size, 0) * 100, 2) as day_7_retention,
        ROUND(day_30::numeric / NULLIF(cohort_size, 0) * 100, 2) as day_30_retention
      FROM retention
      ORDER BY cohort_date
    `);

    return result.rows.map((row: any) => ({
      date: row.date.toISOString().split('T')[0],
      value: row.cohort_size,
      metadata: {
        day1Retention: row.day_1_retention,
        day7Retention: row.day_7_retention,
        day30Retention: row.day_30_retention,
      },
    }));
  }

  /**
   * Get Engagement Metrics
   */
  private async getEngagement(startDate: Date, endDate: Date, truncate: string): Promise<AnalyticsDataPoint[]> {
    const result = await db.execute(sql`
      SELECT
        DATE_TRUNC(${truncate}, created_at) as date,
        COUNT(*) as posts,
        0 as reels,
        0 as stories,
        0 as comments,
        0 as likes,
        0 as messages,
        0 as calls
      FROM posts
      WHERE created_at BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE_TRUNC(${truncate}, created_at)
      ORDER BY date
    `);

    return result.rows.map((row: any) => ({
      date: row.date.toISOString().split('T')[0],
      value: parseInt(row.posts, 10),
      metadata: {
        posts: row.posts,
        reels: row.reels,
        stories: row.stories,
        comments: row.comments,
        likes: row.likes,
        messages: row.messages,
        calls: row.calls,
      },
    }));
  }

  /**
   * Get Content Metrics
   */
  private async getContentMetrics(startDate: Date, endDate: Date, truncate: string): Promise<AnalyticsDataPoint[]> {
    const result = await db.execute(sql`
      SELECT
        DATE_TRUNC(${truncate}, created_at) as date,
        'posts' as type,
        COUNT(*) as value
      FROM posts
      WHERE created_at BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE_TRUNC(${truncate}, created_at)
      UNION ALL
      SELECT
        DATE_TRUNC(${truncate}, created_at) as date,
        'reels' as type,
        COUNT(*) as value
      FROM reels
      WHERE created_at BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE_TRUNC(${truncate}, created_at)
      UNION ALL
      SELECT
        DATE_TRUNC(${truncate}, created_at) as date,
        'stories' as type,
        COUNT(*) as value
      FROM stories
      WHERE created_at BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE_TRUNC(${truncate}, created_at)
      ORDER BY date, type
    `);

    return result.rows.map((row: any) => ({
      date: row.date.toISOString().split('T')[0],
      value: parseInt(row.value, 10),
      metadata: { type: row.type },
    }));
  }

  /**
   * Get Growth Metrics (New users, new content)
   */
  private async getGrowthMetrics(startDate: Date, endDate: Date, truncate: string): Promise<AnalyticsDataPoint[]> {
    const result = await db.execute(sql`
      SELECT
        DATE_TRUNC(${truncate}, created_at) as date,
        'new_users' as type,
        COUNT(*) as value
      FROM users
      WHERE created_at BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE_TRUNC(${truncate}, created_at)
      UNION ALL
      SELECT
        DATE_TRUNC(${truncate}, created_at) as date,
        'new_posts' as type,
        COUNT(*) as value
      FROM posts
      WHERE created_at BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE_TRUNC(${truncate}, created_at)
      UNION ALL
      SELECT
        DATE_TRUNC(${truncate}, created_at) as date,
        'new_reels' as type,
        COUNT(*) as value
      FROM reels
      WHERE created_at BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE_TRUNC(${truncate}, created_at)
      ORDER BY date, type
    `);

    return result.rows.map((row: any) => ({
      date: row.date.toISOString().split('T')[0],
      value: parseInt(row.value, 10),
      metadata: { type: row.type },
    }));
  }

  /**
   * Get audit logs
   */
  async getAuditLogs(params: AuditLogParams): Promise<{ items: AuditLogEntry[]; total: number; page: number; perPage: number; hasMore: boolean }> {
    const { page, perPage, actorId, action, resourceType, startDate, endDate } = params;
    const offset = (page - 1) * perPage;

    const conditions = [];

    if (actorId) conditions.push(eq(schema.auditLogs.actorId, actorId));
    if (action) conditions.push(eq(schema.auditLogs.action, action));
    if (resourceType) conditions.push(eq(schema.auditLogs.resourceType, resourceType));
    if (startDate) conditions.push(gte(schema.auditLogs.createdAt, startDate));
    if (endDate) conditions.push(lte(schema.auditLogs.createdAt, endDate));

    const [logs, totalResult] = await Promise.all([
      db
        .select({
          id: schema.auditLogs.id,
          actorId: schema.auditLogs.actorId,
          actorIp: schema.auditLogs.actorIp,
          actorUserAgent: schema.auditLogs.actorUserAgent,
          action: schema.auditLogs.action,
          resourceType: schema.auditLogs.resourceType,
          resourceId: schema.auditLogs.resourceId,
          oldValues: schema.auditLogs.oldValues,
          newValues: schema.auditLogs.newValues,
          correlationId: schema.auditLogs.correlationId,
          sessionId: schema.auditLogs.sessionId,
          requestId: schema.auditLogs.requestId,
          metadata: schema.auditLogs.metadata,
          createdAt: schema.auditLogs.createdAt,
        })
        .from(schema.auditLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(perPage)
        .offset(offset),
      db.select({ count: count() }).from(schema.auditLogs).where(conditions.length > 0 ? and(...conditions) : undefined),
    ]);

    const total = totalResult[0]?.count || 0;

    // Cast logs to match AuditLogEntry type (oldValues/newValues are unknown from DB but should be Record<string, any> | null)
    const typedLogs = logs.map(log => ({
      ...log,
      oldValues: log.oldValues as Record<string, any> | null,
      newValues: log.newValues as Record<string, any> | null,
    })) as AuditLogEntry[];

    return {
      items: typedLogs,
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
    };
  }

  /**
   * Log audit event
   */
  async logAudit(params: {
    actorId: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    oldValues?: Record<string, any>;
    newValues?: Record<string, any>;
    correlationId?: string;
    sessionId?: string;
    requestId?: string;
    metadata?: Record<string, any>;
    actorIp?: string;
    actorUserAgent?: string;
  }): Promise<void> {
    await db.insert(schema.auditLogs).values({
      actorId: params.actorId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      oldValues: params.oldValues,
      newValues: params.newValues,
      correlationId: params.correlationId,
      sessionId: params.sessionId,
      requestId: params.requestId,
      metadata: params.metadata || {},
      actorIp: params.actorIp,
      actorUserAgent: params.actorUserAgent,
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let adminServiceInstance: AdminService | null = null;

export function getAdminService(): AdminService {
  if (!adminServiceInstance) {
    adminServiceInstance = new AdminService();
  }
  return adminServiceInstance;
}