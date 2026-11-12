import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, gte, lt, lte, count, sql, desc, inArray, isNull, or, isNotNull } from "drizzle-orm";

/**
 * Analytics Aggregation Job
 *
 * Runs periodically to aggregate platform analytics data into
 * materialized views or summary tables for fast dashboard queries.
 */

// ============================================================================
// Types
// ============================================================================

export interface AggregatedMetric {
  date: string;
  metric: string;
  value: number;
  metadata?: Record<string, any>;
}

export interface AggregationJobResult {
  success: boolean;
  metricsAggregated: number;
  errors: string[];
  durationMs: number;
}

// ============================================================================
// Analytics Aggregation Service
// ============================================================================

export class AnalyticsAggregationJob {
  private isRunning = false;

  /**
   * Run daily analytics aggregation
   * Should be scheduled to run once per day (e.g., at 1 AM UTC)
   */
  async runDailyAggregation(targetDate?: Date): Promise<AggregationJobResult> {
    const startTime = Date.now();
    const date = targetDate || new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday by default
    const dateStr = date.toISOString().split('T')[0];
    const errors: string[] = [];
    let metricsAggregated = 0;

    if (this.isRunning) {
      return {
        success: false,
        metricsAggregated: 0,
        errors: ["Job already running"],
        durationMs: Date.now() - startTime,
      };
    }

    this.isRunning = true;

    try {
      console.log(`[AnalyticsAggregation] Starting daily aggregation for ${dateStr}`);

      // 1. Aggregate DAU/WAU/MAU
      try {
        await this.aggregateActiveUsers(date);
        metricsAggregated++;
      } catch (error) {
        errors.push(`Active users: ${error instanceof Error ? error.message : "Unknown error"}`);
      }

      // 2. Aggregate content metrics
      try {
        await this.aggregateContentMetrics(date);
        metricsAggregated++;
      } catch (error) {
        errors.push(`Content metrics: ${error instanceof Error ? error.message : "Unknown error"}`);
      }

      // 3. Aggregate engagement metrics
      try {
        await this.aggregateEngagementMetrics(date);
        metricsAggregated++;
      } catch (error) {
        errors.push(`Engagement metrics: ${error instanceof Error ? error.message : "Unknown error"}`);
      }

      // 4. Aggregate retention cohorts
      try {
        await this.aggregateRetentionCohorts(date);
        metricsAggregated++;
      } catch (error) {
        errors.push(`Retention cohorts: ${error instanceof Error ? error.message : "Unknown error"}`);
      }

      // 5. Aggregate growth metrics
      try {
        await this.aggregateGrowthMetrics(date);
        metricsAggregated++;
      } catch (error) {
        errors.push(`Growth metrics: ${error instanceof Error ? error.message : "Unknown error"}`);
      }

      // 6. Aggregate moderation metrics
      try {
        await this.aggregateModerationMetrics(date);
        metricsAggregated++;
      } catch (error) {
        errors.push(`Moderation metrics: ${error instanceof Error ? error.message : "Unknown error"}`);
      }

      // 7. Aggregate revenue metrics (if applicable)
      try {
        await this.aggregateRevenueMetrics(date);
        metricsAggregated++;
      } catch (error) {
        errors.push(`Revenue metrics: ${error instanceof Error ? error.message : "Unknown error"}`);
      }

      console.log(`[AnalyticsAggregation] Completed daily aggregation for ${dateStr} in ${Date.now() - startTime}ms`);

      return {
        success: errors.length === 0,
        metricsAggregated,
        errors,
        durationMs: Date.now() - startTime,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Aggregate daily/weekly/monthly active users
   */
  private async aggregateActiveUsers(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];
    const weekStart = new Date(date.getTime() - 6 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(date.getTime() - 29 * 24 * 60 * 60 * 1000);

    // DAU - users active on this specific date
    const dauResult = await db.execute(sql`
      INSERT INTO analytics_daily (date, metric, value, metadata)
      SELECT
        ${dateStr} as date,
        'dau' as metric,
        COUNT(DISTINCT user_id) as value,
        '{}'::jsonb as metadata
      FROM (
        SELECT author_id as user_id FROM posts WHERE DATE(created_at) = ${dateStr}
        UNION SELECT author_id FROM reels WHERE DATE(created_at) = ${dateStr}
        UNION SELECT author_id FROM stories WHERE DATE(created_at) = ${dateStr}
        UNION SELECT author_id FROM comments WHERE DATE(created_at) = ${dateStr}
        UNION SELECT sender_id FROM messages WHERE DATE(created_at) = ${dateStr}
        UNION SELECT initiator_id FROM calls WHERE DATE(created_at) = ${dateStr}
      ) as active_users
      ON CONFLICT (date, metric) DO UPDATE SET
        value = EXCLUDED.value,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `);

    // WAU - users active in the 7-day window ending on this date
    const wauResult = await db.execute(sql`
      INSERT INTO analytics_daily (date, metric, value, metadata)
      SELECT
        ${dateStr} as date,
        'wau' as metric,
        COUNT(DISTINCT user_id) as value,
        '{}'::jsonb as metadata
      FROM (
        SELECT author_id as user_id FROM posts WHERE created_at BETWEEN ${weekStart} AND ${date}
        UNION SELECT author_id FROM reels WHERE created_at BETWEEN ${weekStart} AND ${date}
        UNION SELECT author_id FROM stories WHERE created_at BETWEEN ${weekStart} AND ${date}
        UNION SELECT author_id FROM comments WHERE created_at BETWEEN ${weekStart} AND ${date}
        UNION SELECT sender_id FROM messages WHERE created_at BETWEEN ${weekStart} AND ${date}
        UNION SELECT initiator_id FROM calls WHERE created_at BETWEEN ${weekStart} AND ${date}
      ) as active_users
      ON CONFLICT (date, metric) DO UPDATE SET
        value = EXCLUDED.value,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `);

    // MAU - users active in the 30-day window ending on this date
    const mauResult = await db.execute(sql`
      INSERT INTO analytics_daily (date, metric, value, metadata)
      SELECT
        ${dateStr} as date,
        'mau' as metric,
        COUNT(DISTINCT user_id) as value,
        '{}'::jsonb as metadata
      FROM (
        SELECT author_id as user_id FROM posts WHERE created_at BETWEEN ${monthStart} AND ${date}
        UNION SELECT author_id FROM reels WHERE created_at BETWEEN ${monthStart} AND ${date}
        UNION SELECT author_id FROM stories WHERE created_at BETWEEN ${monthStart} AND ${date}
        UNION SELECT author_id FROM comments WHERE created_at BETWEEN ${monthStart} AND ${date}
        UNION SELECT sender_id FROM messages WHERE created_at BETWEEN ${monthStart} AND ${date}
        UNION SELECT initiator_id FROM calls WHERE created_at BETWEEN ${monthStart} AND ${date}
      ) as active_users
      ON CONFLICT (date, metric) DO UPDATE SET
        value = EXCLUDED.value,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `);

    // Stickiness ratio (DAU/MAU)
    const dau = await db.select({ value: sql`value` }).from(schema.analyticsDaily).where(and(eq(schema.analyticsDaily.date, date), eq(schema.analyticsDaily.metric, 'dau')));
    const mau = await db.select({ value: sql`value` }).from(schema.analyticsDaily).where(and(eq(schema.analyticsDaily.date, date), eq(schema.analyticsDaily.metric, 'mau')));

    if (dau[0] && mau[0] && Number(mau[0].value) > 0) {
      const stickiness = (Number(dau[0].value) / Number(mau[0].value)) * 100;
      await db.execute(sql`
        INSERT INTO analytics_daily (date, metric, value, metadata)
        VALUES (${dateStr}, 'stickiness', ${stickiness}, '{}'::jsonb)
        ON CONFLICT (date, metric) DO UPDATE SET
          value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `);
    }
  }

  /**
   * Aggregate content creation metrics
   */
  private async aggregateContentMetrics(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];

    const metrics = [
      { name: 'posts_created', table: schema.posts },
      { name: 'reels_created', table: schema.reels },
      { name: 'stories_created', table: schema.stories },
      { name: 'comments_created', table: schema.comments },
      { name: 'messages_sent', table: schema.messages },
      { name: 'calls_started', table: schema.calls },
    ];

    for (const metric of metrics) {
      const result = await db
        .select({ count: count() })
        .from(metric.table)
        .where(sql`DATE(${metric.table}.created_at) = ${dateStr}`);

      await db.execute(sql`
        INSERT INTO analytics_daily (date, metric, value, metadata)
        VALUES (${dateStr}, ${metric.name}, ${result[0]?.count || 0}, '{}'::jsonb)
        ON CONFLICT (date, metric) DO UPDATE SET
          value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `);
    }

    // Likes given
    const likesResult = await db
      .select({ count: count() })
      .from(schema.likes)
      .where(sql`DATE(${schema.likes}.created_at) = ${dateStr}`);

    await db.execute(sql`
      INSERT INTO analytics_daily (date, metric, value, metadata)
      VALUES (${dateStr}, 'likes_given', ${likesResult[0]?.count || 0}, '{}'::jsonb)
      ON CONFLICT (date, metric) DO UPDATE SET
        value = EXCLUDED.value,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `);

    // Shares
    const sharesResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM messages
      WHERE content_type IN ('POST_SHARE', 'REEL_SHARE', 'STORY_SHARE', 'PROFILE_SHARE')
      AND DATE(created_at) = ${dateStr}
    `);

    await db.execute(sql`
      INSERT INTO analytics_daily (date, metric, value, metadata)
      VALUES (${dateStr}, 'shares', ${(sharesResult.rows[0] as any)?.count || 0}, '{}'::jsonb)
      ON CONFLICT (date, metric) DO UPDATE SET
        value = EXCLUDED.value,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `);
  }

  /**
   * Aggregate engagement metrics
   */
  private async aggregateEngagementMetrics(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];

    // Average session duration (approximate from messages/posts)
    const sessionMetrics = await db.execute(sql`
      SELECT
        COUNT(DISTINCT user_id) as active_users,
        COUNT(*) as total_actions,
        COUNT(*)::float / NULLIF(COUNT(DISTINCT user_id), 0) as actions_per_user
      FROM (
        SELECT author_id as user_id, created_at FROM posts WHERE DATE(created_at) = ${dateStr}
        UNION ALL SELECT author_id, created_at FROM reels WHERE DATE(created_at) = ${dateStr}
        UNION ALL SELECT author_id, created_at FROM comments WHERE DATE(created_at) = ${dateStr}
        UNION ALL SELECT sender_id, created_at FROM messages WHERE DATE(created_at) = ${dateStr}
      ) as actions
    `);

    const row = sessionMetrics.rows[0] as any;
    if (row) {
      await db.execute(sql`
        INSERT INTO analytics_daily (date, metric, value, metadata)
        VALUES
          (${dateStr}, 'actions_per_user', ${row.actions_per_user || 0}, '{}'::jsonb),
          (${dateStr}, 'total_actions', ${row.total_actions || 0}, '{}'::jsonb)
        ON CONFLICT (date, metric) DO UPDATE SET
          value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `);
    }

    // Reactions per post/reel
    const reactionsResult = await db.execute(sql`
      SELECT
        'posts' as type,
        COALESCE(AVG(likes_count), 0) as avg_likes,
        COALESCE(AVG(comments_count), 0) as avg_comments
      FROM posts WHERE DATE(created_at) = ${dateStr}
      UNION ALL
      SELECT
        'reels' as type,
        COALESCE(AVG(likes_count), 0) as avg_likes,
        COALESCE(AVG(comments_count), 0) as avg_comments
      FROM reels WHERE DATE(created_at) = ${dateStr}
    `);

    for (const r of reactionsResult.rows) {
      const row = r as any;
      await db.execute(sql`
        INSERT INTO analytics_daily (date, metric, value, metadata)
        VALUES
          (${dateStr}, 'avg_likes_per_' || ${row.type}, ${row.avg_likes || 0}, '{}'::jsonb),
          (${dateStr}, 'avg_comments_per_' || ${row.type}, ${row.avg_comments || 0}, '{}'::jsonb)
        ON CONFLICT (date, metric) DO UPDATE SET
          value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `);
    }
  }

  /**
   * Aggregate retention cohorts
   */
  private async aggregateRetentionCohorts(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];

    // For each cohort from the last 60 days, calculate retention
    const cohortsResult = await db.execute(sql`
      WITH user_cohorts AS (
        SELECT
          id as user_id,
          DATE(created_at) as cohort_date
        FROM users
        WHERE created_at BETWEEN ${date} - INTERVAL '60 days' AND ${date}
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
          COUNT(DISTINCT CASE WHEN activity_date BETWEEN cohort_date + INTERVAL '13 day' AND cohort_date + INTERVAL '14 day' THEN user_id END) as day_14,
          COUNT(DISTINCT CASE WHEN activity_date BETWEEN cohort_date + INTERVAL '29 day' AND cohort_date + INTERVAL '30 day' THEN user_id END) as day_30
        FROM user_activity
        GROUP BY cohort_date
      )
      SELECT * FROM retention WHERE cohort_size > 0
    `);

    for (const row of cohortsResult.rows) {
      const r = row as any;
      const cohortDate = r.cohort_date.toISOString().split('T')[0];

      const metrics = [
        { name: `retention_day1`, value: r.cohort_size > 0 ? (r.day_1 / r.cohort_size) * 100 : 0 },
        { name: `retention_day7`, value: r.cohort_size > 0 ? (r.day_7 / r.cohort_size) * 100 : 0 },
        { name: `retention_day14`, value: r.cohort_size > 0 ? (r.day_14 / r.cohort_size) * 100 : 0 },
        { name: `retention_day30`, value: r.cohort_size > 0 ? (r.day_30 / r.cohort_size) * 100 : 0 },
      ];

      for (const m of metrics) {
        await db.execute(sql`
          INSERT INTO analytics_daily (date, metric, value, metadata)
          VALUES (${cohortDate}, ${m.name}, ${m.value}, ${JSON.stringify({ cohortSize: r.cohort_size })}::jsonb)
          ON CONFLICT (date, metric) DO UPDATE SET
            value = EXCLUDED.value,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        `);
      }
    }
  }

  /**
   * Aggregate growth metrics
   */
  private async aggregateGrowthMetrics(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];

    // New users
    const newUsersResult = await db
      .select({ count: count() })
      .from(schema.users)
      .where(sql`DATE(${schema.users}.created_at) = ${dateStr}`);

    // New verified users
    const newVerifiedResult = await db
      .select({ count: count() })
      .from(schema.users)
      .where(and(sql`DATE(${schema.users}.created_at) = ${dateStr}`, eq(schema.users.isVerified, true)));

    // User churn (users who deleted account)
    const churnedResult = await db
      .select({ count: count() })
      .from(schema.users)
      .where(sql`DATE(${schema.users}.deleted_at) = ${dateStr}`);

    // Net growth
    const netGrowth = (newUsersResult[0]?.count || 0) - (churnedResult[0]?.count || 0);

    await db.execute(sql`
      INSERT INTO analytics_daily (date, metric, value, metadata)
      VALUES
        (${dateStr}, 'new_users', ${newUsersResult[0]?.count || 0}, '{}'::jsonb),
        (${dateStr}, 'new_verified_users', ${newVerifiedResult[0]?.count || 0}, '{}'::jsonb),
        (${dateStr}, 'churned_users', ${churnedResult[0]?.count || 0}, '{}'::jsonb),
        (${dateStr}, 'net_user_growth', ${netGrowth}, '{}'::jsonb)
      ON CONFLICT (date, metric) DO UPDATE SET
        value = EXCLUDED.value,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `);
  }

  /**
   * Aggregate moderation metrics
   */
  private async aggregateModerationMetrics(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];

    const metrics = await db.execute(sql`
      SELECT
        'reports_received' as metric,
        COUNT(*) as value
      FROM reports WHERE DATE(created_at) = ${dateStr}
      UNION ALL
      SELECT
        'reports_resolved' as metric,
        COUNT(*) as value
      FROM reports WHERE status = 'RESOLVED' AND DATE(resolved_at) = ${dateStr}
      UNION ALL
      SELECT
        'reports_dismissed' as metric,
        COUNT(*) as value
      FROM reports WHERE status = 'DISMISSED' AND DATE(resolved_at) = ${dateStr}
      UNION ALL
      SELECT
        'moderation_actions' as metric,
        COUNT(*) as value
      FROM moderation_actions WHERE DATE(created_at) = ${dateStr}
      UNION ALL
      SELECT
        'accounts_banned' as metric,
        COUNT(*) as value
      FROM moderation_actions WHERE action = 'account_ban' AND DATE(created_at) = ${dateStr}
      UNION ALL
      SELECT
        'accounts_shadowbanned' as metric,
        COUNT(*) as value
      FROM moderation_actions WHERE action = 'shadowban' AND DATE(created_at) = ${dateStr}
      UNION ALL
      SELECT
        'content_removed' as metric,
        COUNT(*) as value
      FROM moderation_actions WHERE action IN ('content_remove', 'content_hide') AND DATE(created_at) = ${dateStr}
    `);

    for (const row of metrics.rows) {
      const r = row as any;
      await db.execute(sql`
        INSERT INTO analytics_daily (date, metric, value, metadata)
        VALUES (${dateStr}, ${r.metric}, ${r.value}, '{}'::jsonb)
        ON CONFLICT (date, metric) DO UPDATE SET
          value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `);
    }
  }

  /**
   * Aggregate revenue metrics (placeholder for sponsored content)
   */
  private async aggregateRevenueMetrics(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];

    try {
      const revenueResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(spent_cents), 0) as total_spent,
          COALESCE(SUM(impressions), 0) as total_impressions,
          COALESCE(SUM(clicks), 0) as total_clicks
        FROM sponsored_impressions si
        JOIN sponsored_posts sp ON si.sponsored_post_id = sp.id
        WHERE DATE(si.impression_at) = ${dateStr}
      `);

      const row = revenueResult.rows[0] as any;
      if (row) {
        const cpm = row.total_impressions > 0 ? (Number(row.total_spent) / Number(row.total_impressions)) * 1000 : 0;
        const ctr = row.total_impressions > 0 ? (Number(row.total_clicks) / Number(row.total_impressions)) * 100 : 0;

        await db.execute(sql`
          INSERT INTO analytics_daily (date, metric, value, metadata)
          VALUES
            (${dateStr}, 'ad_revenue_cents', ${row.total_spent || 0}, '{}'::jsonb),
            (${dateStr}, 'ad_impressions', ${row.total_impressions || 0}, '{}'::jsonb),
            (${dateStr}, 'ad_clicks', ${row.total_clicks || 0}, '{}'::jsonb),
            (${dateStr}, 'ad_cpm', ${cpm}, '{}'::jsonb),
            (${dateStr}, 'ad_ctr', ${ctr}, '{}'::jsonb)
          ON CONFLICT (date, metric) DO UPDATE SET
            value = EXCLUDED.value,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        `);
      }
    } catch (error) {
      // Sponsored tables might not exist yet
      console.warn("[AnalyticsAggregation] Revenue metrics skipped:", error);
    }
  }

  /**
   * Run hourly aggregation for real-time metrics
   */
  async runHourlyAggregation(): Promise<AggregationJobResult> {
    const startTime = Date.now();
    const now = new Date();
    const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    const errors: string[] = [];
    let metricsAggregated = 0;

    if (this.isRunning) {
      return {
        success: false,
        metricsAggregated: 0,
        errors: ["Job already running"],
        durationMs: Date.now() - startTime,
      };
    }

    this.isRunning = true;

    try {
      console.log(`[AnalyticsAggregation] Starting hourly aggregation for ${hourStart.toISOString()}`);

      // Current active users (last 5 minutes)
      const activeNowResult = await db.execute(sql`
        SELECT COUNT(DISTINCT user_id) as count FROM (
          SELECT author_id as user_id FROM posts WHERE created_at >= ${new Date(now.getTime() - 5 * 60 * 1000)}
          UNION SELECT author_id FROM reels WHERE created_at >= ${new Date(now.getTime() - 5 * 60 * 1000)}
          UNION SELECT author_id FROM stories WHERE created_at >= ${new Date(now.getTime() - 5 * 60 * 1000)}
          UNION SELECT author_id FROM comments WHERE created_at >= ${new Date(now.getTime() - 5 * 60 * 1000)}
          UNION SELECT sender_id FROM messages WHERE created_at >= ${new Date(now.getTime() - 5 * 60 * 1000)}
          UNION SELECT initiator_id FROM calls WHERE created_at >= ${new Date(now.getTime() - 5 * 60 * 1000)}
        ) as active_users
      `);

      const activeNow = (activeNowResult.rows[0] as any)?.count || 0;
      const hourStr = hourStart.toISOString();

      await db.execute(sql`
        INSERT INTO analytics_hourly (hour, metric, value, metadata)
        VALUES (${hourStr}, 'active_now', ${activeNow}, '{}'::jsonb)
        ON CONFLICT (hour, metric) DO UPDATE SET
          value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `);

      metricsAggregated++;

      // Queue sizes
      const queueSizes = await db.execute(sql`
        SELECT
          'pending_reports' as metric,
          COUNT(*) as value
        FROM reports WHERE status = 'PENDING'
        UNION ALL
        SELECT
          'processing_uploads' as metric,
          COUNT(*) as value
        FROM tus_uploads WHERE status IN ('created', 'uploading', 'processing')
      `);

      for (const row of queueSizes.rows) {
        const r = row as any;
        await db.execute(sql`
          INSERT INTO analytics_hourly (hour, metric, value, metadata)
          VALUES (${hourStr}, ${r.metric}, ${r.value}, '{}'::jsonb)
          ON CONFLICT (hour, metric) DO UPDATE SET
            value = EXCLUDED.value,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        `);
        metricsAggregated++;
      }

      console.log(`[AnalyticsAggregation] Completed hourly aggregation in ${Date.now() - startTime}ms`);

      return {
        success: errors.length === 0,
        metricsAggregated,
        errors,
        durationMs: Date.now() - startTime,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Backfill historical data
   */
  async backfill(startDate: Date, endDate: Date): Promise<AggregationJobResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let metricsAggregated = 0;

    console.log(`[AnalyticsAggregation] Starting backfill from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      try {
        const result = await this.runDailyAggregation(currentDate);
        metricsAggregated += result.metricsAggregated;
        errors.push(...result.errors);
      } catch (error) {
        errors.push(`Date ${currentDate.toISOString()}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`[AnalyticsAggregation] Completed backfill in ${Date.now() - startTime}ms`);

    return {
      success: errors.length === 0,
      metricsAggregated,
      errors,
      durationMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Job Scheduler
// ============================================================================

let dailyJobInterval: NodeJS.Timeout | null = null;
let hourlyJobInterval: NodeJS.Timeout | null = null;

const analyticsJob = new AnalyticsAggregationJob();

export async function startAnalyticsAggregationJob(): Promise<void> {
  // Run daily at 1 AM UTC
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setUTCHours(1, 0, 0, 0);
  if (nextRun <= now) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }

  const msUntilNextRun = nextRun.getTime() - now.getTime();

  console.log(`[AnalyticsAggregation] Next daily run scheduled for ${nextRun.toISOString()} (in ${Math.round(msUntilNextRun / 1000 / 60)} minutes)`);

  // Initial run after startup (with delay to avoid blocking startup)
  setTimeout(async () => {
    try {
      await analyticsJob.runDailyAggregation();
    } catch (error) {
      console.error("[AnalyticsAggregation] Initial daily run failed:", error);
    }
  }, 30000); // 30 seconds after startup

  // Schedule daily runs
  dailyJobInterval = setInterval(async () => {
    try {
      await analyticsJob.runDailyAggregation();
    } catch (error) {
      console.error("[AnalyticsAggregation] Daily run failed:", error);
    }
  }, 24 * 60 * 60 * 1000); // Every 24 hours

  // Run hourly aggregation every hour at minute 5
  setTimeout(async () => {
    try {
      await analyticsJob.runHourlyAggregation();
    } catch (error) {
      console.error("[AnalyticsAggregation] Initial hourly run failed:", error);
    }
  }, 60000); // 1 minute after startup

  hourlyJobInterval = setInterval(async () => {
    try {
      await analyticsJob.runHourlyAggregation();
    } catch (error) {
      console.error("[AnalyticsAggregation] Hourly run failed:", error);
    }
  }, 60 * 60 * 1000); // Every hour
}

export function stopAnalyticsAggregationJob(): void {
  if (dailyJobInterval) {
    clearInterval(dailyJobInterval);
    dailyJobInterval = null;
  }
  if (hourlyJobInterval) {
    clearInterval(hourlyJobInterval);
    hourlyJobInterval = null;
  }
  console.log("[AnalyticsAggregation] Jobs stopped");
}

export function getAnalyticsJob(): AnalyticsAggregationJob {
  return analyticsJob;
}