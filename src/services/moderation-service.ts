import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, gte, lt, lte, inArray, isNull, or, ne } from "drizzle-orm";
import { getAdminService } from "./admin-service";

/**
 * Moderation Service
 *
 * Handles content moderation: reviewing reports, taking action on content,
 * automated moderation, and moderation queue management.
 */

// ============================================================================
// Types
// ============================================================================

export type ReportType = "USER" | "POST" | "REEL" | "STORY" | "COMMENT" | "MESSAGE" | "AUDIO";
export type ReportReason = "SPAM" | "HATE_SPEECH" | "HARASSMENT" | "VIOLENCE" | "NUDITY" | "SELF_HARM" | "MISINFORMATION" | "SCAM" | "IMPERSONATION" | "COPYRIGHT" | "OTHER";
export type ReportStatus = "PENDING" | "REVIEWING" | "RESOLVED" | "DISMISSED";
export type Resolution = "CONTENT_REMOVED" | "ACCOUNT_WARNED" | "ACCOUNT_SUSPENDED" | "ACCOUNT_BANNED" | "SHADOWBAN" | "FEATURE_RESTRICT" | "NO_VIOLATION" | "DISMISSED";

export type ModerationActionType = "WARN" | "CONTENT_REMOVE" | "CONTENT_HIDE" | "ACCOUNT_SUSPEND" | "ACCOUNT_BAN" | "FEATURE_RESTRICT" | "SHADOWBAN" | "RESTORE";

export interface ReportWithDetails {
  id: string;
  reporterId: string;
  reportedType: ReportType;
  reportedId: string;
  reason: ReportReason;
  description: string | null;
  status: ReportStatus;
  resolution: Resolution | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  // Reporter info
  reporter: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
  };
  // Reported content info (varies by type)
  reportedContent?: any;
}

export interface ReportQueueParams {
  page: number;
  perPage: number;
  status?: ReportStatus;
  type?: ReportType;
  reason?: ReportReason;
  sortBy?: "createdAt" | "priority";
  sortOrder?: "asc" | "desc";
}

export interface ModerationActionParams {
  reportId: string;
  moderatorId: string;
  action: ModerationActionType;
  reason: string;
  duration?: string; // For temporary actions
}

export interface ModerationActionResult {
  success: boolean;
  actionId: string;
  reportId: string;
  action: ModerationActionType;
  targetType: string;
  targetId: string;
  expiresAt?: Date | null;
}

export interface AutomatedModerationConfig {
  nsfwThreshold: number;
  spamThreshold: number;
  autoHideEnabled: boolean;
  autoShadowbanEnabled: boolean;
}

export interface ContentModerationResult {
  action: "none" | "hide" | "shadowban" | "flag";
  reason: string;
  confidence: number;
}

// ============================================================================
// Moderation Service Class
// ============================================================================

export class ModerationService {
  private adminService = getAdminService();

  /**
   * Get reports queue for moderation
   */
  async getReportsQueue(params: ReportQueueParams): Promise<{ items: ReportWithDetails[]; total: number; page: number; perPage: number; hasMore: boolean }> {
    const { page, perPage, status, type, reason, sortBy = "createdAt", sortOrder = "desc" } = params;
    const offset = (page - 1) * perPage;

    const conditions = [];

    if (status) conditions.push(eq(schema.reports.status, status));
    if (type) conditions.push(eq(schema.reports.reportedType, type as any));
    if (reason) conditions.push(eq(schema.reports.reason, reason as any));

    const orderColumn = (sortBy === "priority" ? schema.reports.createdAt : schema.reports[sortBy as keyof typeof schema.reports]) as any || schema.reports.createdAt;
    const orderFn = sortOrder === "asc" ? asc : desc;

    // Priority: older reports first, but PENDING before REVIEWING
    // We'll handle priority in application logic if needed

    const [reportsList, totalResult] = await Promise.all([
      db
        .select({
          id: schema.reports.id,
          reporterId: schema.reports.reporterId,
          reportedType: schema.reports.reportedType,
          reportedId: schema.reports.reportedId,
          reason: schema.reports.reason,
          description: schema.reports.description,
          status: schema.reports.status,
          resolution: schema.reports.resolution,
          resolvedBy: schema.reports.resolvedBy,
          resolvedAt: schema.reports.resolvedAt,
          createdAt: schema.reports.createdAt,
          reporter: {
            id: schema.users.id,
            username: schema.users.username,
            fullName: schema.users.fullName,
            avatarUrl: schema.users.avatarUrl,
            isVerified: schema.users.isVerified,
          },
        })
        .from(schema.reports)
        .innerJoin(schema.users, eq(schema.users.id, schema.reports.reporterId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(orderFn(orderColumn))
        .limit(perPage)
        .offset(offset),
      db.select({ count: count() }).from(schema.reports).where(conditions.length > 0 ? and(...conditions) : undefined),
    ]);

    // Fetch reported content details for each report
    const items: ReportWithDetails[] = [];
    for (const report of reportsList) {
      const content = await this.getReportedContent(report.reportedType, report.reportedId);
      items.push({
        ...report,
        resolution: report.resolution as Resolution | null,
        reportedContent: content,
      });
    }

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
   * Get reported content details based on type
   */
  private async getReportedContent(type: ReportType, id: string): Promise<any> {
    switch (type) {
      case "POST": {
        const post = await db.query.posts.findFirst({
          where: eq(schema.posts.id, id),
          with: {
            author: {
              columns: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true }
            },
            // mediaItems is a polymorphic relation, query separately if needed
          }
        });
        return post;
      }
      case "REEL": {
        const reel = await db.query.reels.findFirst({
          where: eq(schema.reels.id, id),
          with: {
            author: {
              columns: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true }
            },
            audio: true,
          }
        });
        return reel;
      }
      case "STORY": {
        const story = await db.query.stories.findFirst({
          where: eq(schema.stories.id, id),
          with: {
            author: {
              columns: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true }
            },
            storyItems: true,
          }
        });
        return story;
      }
      case "COMMENT": {
        const comment = await db.query.comments.findFirst({
          where: eq(schema.comments.id, id),
          with: {
            author: {
              columns: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true }
            },
          }
        });
        return comment;
      }
      case "USER": {
        const user = await db.query.users.findFirst({
          where: eq(schema.users.id, id),
          columns: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
            isVerified: true,
            isPrivate: true,
            postsCount: true,
            followersCount: true,
            createdAt: true,
          }
        });
        return user;
      }
      case "MESSAGE": {
        const message = await db.query.messages.findFirst({
          where: eq(schema.messages.id, id),
          with: {
            sender: {
              columns: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true }
            },
            conversation: {
              columns: { id: true, isGroup: true, groupName: true }
            }
          }
        });
        return message;
      }
      default:
        return null;
    }
  }

  /**
   * Get single report with full details
   */
  async getReportById(reportId: string): Promise<ReportWithDetails | null> {
    const report = await db
      .select({
        id: schema.reports.id,
        reporterId: schema.reports.reporterId,
        reportedType: schema.reports.reportedType,
        reportedId: schema.reports.reportedId,
        reason: schema.reports.reason,
        description: schema.reports.description,
        status: schema.reports.status,
        resolution: schema.reports.resolution,
        resolvedBy: schema.reports.resolvedBy,
        resolvedAt: schema.reports.resolvedAt,
        createdAt: schema.reports.createdAt,
        reporter: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
        },
      })
      .from(schema.reports)
      .innerJoin(schema.users, eq(schema.users.id, schema.reports.reporterId))
      .where(eq(schema.reports.id, reportId))
      .limit(1);

    if (!report[0]) return null;

    const r = report[0];
    const content = await this.getReportedContent(r.reportedType, r.reportedId);

    // Cast resolution to Resolution type (string from DB matches enum)
    const resolution = r.resolution as Resolution | null;

    return {
      id: r.id,
      reporterId: r.reporterId,
      reportedType: r.reportedType,
      reportedId: r.reportedId,
      reason: r.reason,
      description: r.description,
      status: r.status,
      resolution,
      resolvedBy: r.resolvedBy,
      resolvedAt: r.resolvedAt,
      createdAt: r.createdAt,
      reporter: r.reporter,
      reportedContent: content,
    };
  }

  /**
   * Take moderation action on a report
   */
  async takeAction(params: ModerationActionParams): Promise<ModerationActionResult> {
    const { reportId, moderatorId, action, reason, duration } = params;

    // Get the report
    const report = await db.query.reports.findFirst({
      where: eq(schema.reports.id, reportId),
    });

    if (!report) {
      throw new Error("Report not found");
    }

    if (report.status === "RESOLVED" || report.status === "DISMISSED") {
      throw new Error("Report already resolved");
    }

    // Calculate expiration for temporary actions
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

    // Map action to resolution
    const resolutionMap: Record<ModerationActionType, Resolution> = {
      "WARN": "ACCOUNT_WARNED",
      "CONTENT_REMOVE": "CONTENT_REMOVED",
      "CONTENT_HIDE": "CONTENT_REMOVED",
      "ACCOUNT_SUSPEND": "ACCOUNT_SUSPENDED",
      "ACCOUNT_BAN": "ACCOUNT_BANNED",
      "FEATURE_RESTRICT": "FEATURE_RESTRICT",
      "SHADOWBAN": "SHADOWBAN",
      "RESTORE": "NO_VIOLATION",
    };

    const resolution = resolutionMap[action];

    // Update report status
    const [updatedReport] = await db
      .update(schema.reports)
      .set({
        status: "RESOLVED",
        resolution,
        resolvedBy: moderatorId,
        resolvedAt: new Date(),
      })
      .where(eq(schema.reports.id, reportId))
      .returning();

    // Create moderation action record
    const [moderationAction] = await db
      .insert(schema.moderationActions)
      .values({
        moderatorId,
        targetType: report.reportedType,
        targetId: report.reportedId,
        action: action as any,
        reason,
        expiresAt,
      })
      .returning();

    // Execute the action on the target content/user
    await this.executeAction(report.reportedType, report.reportedId, action, expiresAt, moderatorId, reason);

    // Log audit
    await this.adminService.logAudit({
      actorId: moderatorId,
      action: `moderation.report_action.${action.toLowerCase()}`,
      resourceType: "report",
      resourceId: reportId,
      newValues: { action, reason, resolution, duration, expiresAt },
      metadata: { reportedType: report.reportedType, reportedId: report.reportedId },
    });

    return {
      success: true,
      actionId: moderationAction.id,
      reportId,
      action,
      targetType: report.reportedType.toLowerCase(),
      targetId: report.reportedId,
      expiresAt,
    };
  }

  /**
   * Execute moderation action on target content/user
   */
  private async executeAction(
    reportedType: ReportType,
    reportedId: string,
    action: ModerationActionType,
    expiresAt: Date | null,
    moderatorId: string,
    reason: string
  ): Promise<void> {
    const now = new Date();

    switch (reportedType) {
      case "POST": {
        if (action === "CONTENT_REMOVE" || action === "CONTENT_HIDE") {
          await db
            .update(schema.posts)
            .set({ deletedAt: now, archivedAt: action === "CONTENT_HIDE" ? null : now })
            .where(eq(schema.posts.id, reportedId));
        } else if (action === "RESTORE") {
          await db
            .update(schema.posts)
            .set({ deletedAt: null, archivedAt: null })
            .where(eq(schema.posts.id, reportedId));
        }
        break;
      }
      case "REEL": {
        if (action === "CONTENT_REMOVE" || action === "CONTENT_HIDE") {
          await db
            .update(schema.reels)
            .set({ deletedAt: now })
            .where(eq(schema.reels.id, reportedId));
        } else if (action === "RESTORE") {
          await db
            .update(schema.reels)
            .set({ deletedAt: null })
            .where(eq(schema.reels.id, reportedId));
        }
        break;
      }
      case "STORY": {
        if (action === "CONTENT_REMOVE" || action === "CONTENT_HIDE") {
          await db
            .update(schema.stories)
            .set({ deletedAt: now })
            .where(eq(schema.stories.id, reportedId));
        } else if (action === "RESTORE") {
          await db
            .update(schema.stories)
            .set({ deletedAt: null })
            .where(eq(schema.stories.id, reportedId));
        }
        break;
      }
      case "COMMENT": {
        if (action === "CONTENT_REMOVE" || action === "CONTENT_HIDE") {
          await db
            .update(schema.comments)
            .set({
              isHidden: true,
              hiddenReason: reason,
              hiddenBy: moderatorId,
              hiddenAt: now,
              deletedAt: action === "CONTENT_REMOVE" ? now : null,
            })
            .where(eq(schema.comments.id, reportedId));
        } else if (action === "RESTORE") {
          await db
            .update(schema.comments)
            .set({
              isHidden: false,
              hiddenReason: null,
              hiddenBy: null,
              hiddenAt: null,
              deletedAt: null,
            })
            .where(eq(schema.comments.id, reportedId));
        }
        break;
      }
      case "USER": {
        if (action === "ACCOUNT_BAN" || action === "ACCOUNT_SUSPEND") {
          await db
            .update(schema.users)
            .set({ deletedAt: now })
            .where(eq(schema.users.id, reportedId));
        } else if (action === "SHADOWBAN") {
          // Shadowban is tracked via moderation_actions table
          // The feed/explore services should check for active shadowban
        } else if (action === "FEATURE_RESTRICT") {
          // Feature restrictions tracked via moderation_actions
        } else if (action === "WARN") {
          // Warning is just a moderation action record
        } else if (action === "RESTORE") {
          await db
            .update(schema.users)
            .set({ deletedAt: null })
            .where(eq(schema.users.id, reportedId));
        }
        break;
      }
      case "MESSAGE": {
        if (action === "CONTENT_REMOVE" || action === "CONTENT_HIDE") {
          await db
            .update(schema.messages)
            .set({ deletedAt: now, isUnsent: true, unsentForEveryone: true })
            .where(eq(schema.messages.id, reportedId));
        } else if (action === "RESTORE") {
          await db
            .update(schema.messages)
            .set({ deletedAt: null, isUnsent: false, unsentForEveryone: false })
            .where(eq(schema.messages.id, reportedId));
        }
        break;
      }
    }
  }

  /**
   * Dismiss a report without taking action
   */
  async dismissReport(reportId: string, moderatorId: string, reason: string): Promise<void> {
    const report = await db.query.reports.findFirst({
      where: eq(schema.reports.id, reportId),
    });

    if (!report) {
      throw new Error("Report not found");
    }

    await db
      .update(schema.reports)
      .set({
        status: "DISMISSED",
        resolution: "DISMISSED",
        resolvedBy: moderatorId,
        resolvedAt: new Date(),
      })
      .where(eq(schema.reports.id, reportId));

    // Log audit
    await this.adminService.logAudit({
      actorId: moderatorId,
      action: "moderation.report_dismiss",
      resourceType: "report",
      resourceId: reportId,
      newValues: { reason },
      metadata: { reportedType: report.reportedType, reportedId: report.reportedId },
    });
  }

  /**
   * Start reviewing a report (mark as REVIEWING)
   */
  async startReview(reportId: string, moderatorId: string): Promise<void> {
    await db
      .update(schema.reports)
      .set({
        status: "REVIEWING",
      })
      .where(eq(schema.reports.id, reportId));
  }

  /**
   * Get moderation actions for a target
   */
  async getModerationHistory(targetType: string, targetId: string): Promise<any[]> {
    return db
      .select()
      .from(schema.moderationActions)
      .where(
        and(
          eq(schema.moderationActions.targetType, targetType),
          eq(schema.moderationActions.targetId, targetId)
        )
      )
      .orderBy(desc(schema.moderationActions.createdAt));
  }

  /**
   * Check if user is shadowbanned
   */
  async isShadowbanned(userId: string): Promise<boolean> {
    const action = await db.query.moderationActions.findFirst({
      where: and(
        eq(schema.moderationActions.targetType, "user"),
        eq(schema.moderationActions.targetId, userId),
        eq(schema.moderationActions.action, "SHADOWBAN"),
        or(
          isNull(schema.moderationActions.expiresAt),
          gte(schema.moderationActions.expiresAt, new Date())
        )
      ),
    });
    return !!action;
  }

  /**
   * Check if user has active feature restrictions
   */
  async getFeatureRestrictions(userId: string): Promise<string[]> {
    const actions = await db
      .select()
      .from(schema.moderationActions)
      .where(
        and(
          eq(schema.moderationActions.targetType, "user"),
          eq(schema.moderationActions.targetId, userId),
          eq(schema.moderationActions.action, "FEATURE_RESTRICT"),
          or(
            isNull(schema.moderationActions.expiresAt),
            gte(schema.moderationActions.expiresAt, new Date())
          )
        )
      );
    return actions.map(a => a.reason || "restricted");
  }

  /**
   * Automated content moderation (NSFW, spam detection)
   * This would integrate with ML models in production
   */
  async moderateContent(
    contentType: "post" | "reel" | "story" | "comment" | "message",
    contentId: string,
    contentData: { text?: string; mediaUrls?: string[] }
  ): Promise<ContentModerationResult> {
    // In production, this would call ML models for:
    // - NSFW detection on images/videos
    // - Spam detection on text
    // - Hate speech detection
    // - etc.

    // For now, return no action needed
    // This is a placeholder for integration with moderation ML services

    // Example logic for text-based spam detection
    if (contentData.text) {
      const spamKeywords = ["buy now", "click here", "free money", "bitcoin", "crypto", "investment opportunity"];
      const textLower = contentData.text.toLowerCase();
      const spamScore = spamKeywords.filter(k => textLower.includes(k)).length / spamKeywords.length;

      if (spamScore > 0.3) {
        return {
          action: "flag",
          reason: "Potential spam detected",
          confidence: spamScore,
        };
      }
    }

    // Example: check for excessive links
    if (contentData.text) {
      const linkCount = (contentData.text.match(/https?:\/\//g) || []).length;
      if (linkCount > 3) {
        return {
          action: "flag",
          reason: "Excessive links in content",
          confidence: Math.min(linkCount / 10, 1),
        };
      }
    }

    return {
      action: "none",
      reason: "No issues detected",
      confidence: 1.0,
    };
  }

  /**
   * Process automated moderation for new content
   * Called after content creation
   */
  async processNewContent(
    contentType: "post" | "reel" | "story" | "comment" | "message",
    contentId: string,
    authorId: string,
    contentData: { text?: string; mediaUrls?: string[] }
  ): Promise<void> {
    const result = await this.moderateContent(contentType, contentId, contentData);

    if (result.action !== "none") {
      // Create a system report for review
      await db.insert(schema.reports).values({
        reporterId: authorId, // System reports use author as reporter for tracking
        reportedType: contentType.toUpperCase() as any,
        reportedId: contentId,
        reason: "OTHER",
        description: `Automated moderation flag: ${result.reason} (confidence: ${Math.round(result.confidence * 100)}%)`,
        status: "PENDING",
      });

      // If high confidence, auto-hide
      if (result.confidence > 0.8 && result.action === "hide") {
        await this.executeAction(
          contentType.toUpperCase() as ReportType,
          contentId,
          "CONTENT_HIDE",
          null,
          authorId, // System user
          `Auto-moderation: ${result.reason}`
        );
      }

      // If spam with high confidence, consider shadowban for repeat offenders
      if (result.confidence > 0.9 && result.reason.includes("spam")) {
        // Check user's spam history
        const spamReports = await db
          .select({ count: count() })
          .from(schema.reports)
          .where(
            and(
              eq(schema.reports.reporterId, authorId),
              eq(schema.reports.reason, "SPAM"),
              eq(schema.reports.status, "RESOLVED")
            )
          );

        if (spamReports[0]?.count && spamReports[0].count >= 3) {
          await this.takeAction({
            reportId: "", // This would need a real report ID
            moderatorId: "system",
            action: "SHADOWBAN",
            reason: "Automated shadowban for repeat spam violations",
            duration: "7d",
          });
        }
      }
    }
  }

  /**
   * Get moderation statistics
   */
  async getModerationStats(): Promise<{
    pendingReports: number;
    reviewingReports: number;
    resolvedToday: number;
    dismissedToday: number;
    actionsToday: number;
    topReasons: { reason: string; count: number }[];
    reportsByType: { type: string; count: number }[];
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      pendingReports,
      reviewingReports,
      resolvedToday,
      dismissedToday,
      actionsToday,
      topReasons,
      reportsByType,
    ] = await Promise.all([
      db.select({ count: count() }).from(schema.reports).where(eq(schema.reports.status, "PENDING")),
      db.select({ count: count() }).from(schema.reports).where(eq(schema.reports.status, "REVIEWING")),
      db.select({ count: count() }).from(schema.reports).where(
        and(eq(schema.reports.status, "RESOLVED"), gte(schema.reports.resolvedAt, todayStart))
      ),
      db.select({ count: count() }).from(schema.reports).where(
        and(eq(schema.reports.status, "DISMISSED"), gte(schema.reports.resolvedAt, todayStart))
      ),
      db.select({ count: count() }).from(schema.moderationActions).where(gte(schema.moderationActions.createdAt, todayStart)),
      db.execute(sql`
        SELECT reason, COUNT(*) as count
        FROM reports
        WHERE status IN ('PENDING', 'REVIEWING', 'RESOLVED')
        GROUP BY reason
        ORDER BY count DESC
        LIMIT 10
      `),
      db.execute(sql`
        SELECT reported_type as type, COUNT(*) as count
        FROM reports
        WHERE status IN ('PENDING', 'REVIEWING', 'RESOLVED')
        GROUP BY reported_type
        ORDER BY count DESC
      `),
    ]);

    return {
      pendingReports: pendingReports[0]?.count || 0,
      reviewingReports: reviewingReports[0]?.count || 0,
      resolvedToday: resolvedToday[0]?.count || 0,
      dismissedToday: dismissedToday[0]?.count || 0,
      actionsToday: actionsToday[0]?.count || 0,
      topReasons: topReasons.rows.map((r: any) => ({ reason: r.reason, count: parseInt(r.count, 10) })),
      reportsByType: reportsByType.rows.map((r: any) => ({ type: r.type, count: parseInt(r.count, 10) })),
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let moderationServiceInstance: ModerationService | null = null;

export function getModerationService(): ModerationService {
  if (!moderationServiceInstance) {
    moderationServiceInstance = new ModerationService();
  }
  return moderationServiceInstance;
}