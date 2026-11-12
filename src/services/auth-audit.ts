import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, gte, lte, inArray, count } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * Auth Audit Service
 *
 * Provides comprehensive audit logging for all authentication events:
 * - Login, logout, registration
 * - Password changes, resets
 * - Email/phone verification
 * - OAuth flows
 * - Session management (refresh, revocation)
 * - 2FA/MFA events
 * - Brute force attempts
 * - Device token registration
 * - Account linking/unlinking
 *
 * Logs are stored in the audit_logs table (partitioned by month)
 * with full context for security analysis and compliance.
 */

// ============================================================================
// Types
// ============================================================================

export type AuthEventType =
  // Registration & Login
  | "USER_REGISTER"
  | "USER_LOGIN"
  | "USER_LOGOUT"
  | "USER_LOGOUT_ALL"
  // Password Management
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET_REQUEST"
  | "PASSWORD_RESET_COMPLETE"
  // Email/Phone Verification
  | "EMAIL_VERIFICATION_SENT"
  | "EMAIL_VERIFICATION_COMPLETE"
  | "EMAIL_VERIFICATION_FAILED"
  | "PHONE_VERIFICATION_SENT"
  | "PHONE_VERIFICATION_COMPLETE"
  // OAuth
  | "OAUTH_INITIATE"
  | "OAUTH_CALLBACK_SUCCESS"
  | "OAUTH_CALLBACK_FAILED"
  | "OAUTH_LINK_ACCOUNT"
  | "OAUTH_UNLINK_ACCOUNT"
  // Session Management
  | "SESSION_REFRESH"
  | "SESSION_REFRESH_FAILED"
  | "SESSION_REVOKED"
  // 2FA/MFA
  | "MFA_ENABLE"
  | "MFA_DISABLE"
  | "MFA_VERIFY"
  | "MFA_VERIFY_FAILED"
  | "MFA_BACKUP_CODES_GENERATED"
  // Device Tokens
  | "DEVICE_TOKEN_REGISTER"
  | "DEVICE_TOKEN_UPDATE"
  | "DEVICE_TOKEN_REVOKE"
  // Security Events
  | "BRUTE_FORCE_ATTEMPT"
  | "BRUTE_FORCE_LOCKOUT"
  | "SUSPICIOUS_ACTIVITY"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_UNLOCKED"
  // Profile Changes
  | "PROFILE_UPDATE"
  | "EMAIL_CHANGE_REQUEST"
  | "EMAIL_CHANGE_COMPLETE"
  // Admin Actions
  | "ADMIN_USER_SUSPEND"
  | "ADMIN_USER_BAN"
  | "ADMIN_USER_RESTORE"
  | "ADMIN_PASSWORD_RESET";

export interface AuthAuditContext {
  // Actor information
  userId?: string;
  ip?: string;
  userAgent?: string;
  // Request context
  requestId?: string;
  correlationId?: string;
  sessionId?: string;
  // Additional metadata
  metadata?: Record<string, any>;
}

export interface AuthAuditEntry {
  event: AuthEventType;
  success: boolean;
  context: AuthAuditContext;
  // Resource affected (optional)
  resourceType?: string;
  resourceId?: string;
  // Before/after values for changes
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  // Error details if failed
  error?: string;
  errorCode?: string;
  // Additional metadata
  metadata?: Record<string, any>;
}

// ============================================================================
// Auth Audit Service Class
// ============================================================================

export class AuthAuditService {
  private batchBuffer: AuthAuditEntry[] = [];
  private batchSize = 10;
  private flushInterval = 5000; // 5 seconds
  private flushTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic flush
    this.startPeriodicFlush();
  }

  /**
   * Log an authentication event
   */
  async log(entry: AuthAuditEntry): Promise<void> {
    const auditEntry = {
      eventId: randomUUID(),
      actorId: entry.context.userId || null,
      actorIp: entry.context.ip ? entry.context.ip : null,
      actorUserAgent: entry.context.userAgent || null,
      action: entry.event,
      resourceType: entry.resourceType || null,
      resourceId: entry.resourceId || null,
      oldValues: entry.oldValues ? JSON.stringify(entry.oldValues) : null,
      newValues: entry.newValues ? JSON.stringify(entry.newValues) : null,
      correlationId: entry.context.correlationId || null,
      sessionId: entry.context.sessionId || null,
      requestId: entry.context.requestId || null,
      metadata: {
        success: entry.success,
        error: entry.error,
        errorCode: entry.errorCode,
        ...entry.context.metadata,
      },
      createdAt: new Date(),
    };

    // Add to batch buffer
    this.batchBuffer.push(entry);

    // Flush if buffer is full
    if (this.batchBuffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * Flush buffer to database
   */
  async flush(): Promise<void> {
    if (this.batchBuffer.length === 0) return;

    const entries = [...this.batchBuffer];
    this.batchBuffer = [];

    try {
      // Insert in batches
      const batchSize = 100;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        await db.insert(schema.auditLogs).values(
          batch.map((entry) => ({
            eventId: randomUUID(),
            actorId: entry.context.userId || null,
            actorIp: entry.context.ip || null,
            actorUserAgent: entry.context.userAgent || null,
            action: entry.event,
            resourceType: entry.resourceType || null,
            resourceId: entry.resourceId || null,
            oldValues: entry.oldValues ? JSON.stringify(entry.oldValues) : null,
            newValues: entry.newValues ? JSON.stringify(entry.newValues) : null,
            correlationId: entry.context.correlationId || null,
            sessionId: entry.context.sessionId || null,
            requestId: entry.context.requestId || null,
            metadata: {
              success: entry.success,
              error: entry.error,
              errorCode: entry.errorCode,
              ...entry.context.metadata,
            },
          }))
        );
      }
    } catch (error) {
      console.error("[AuthAudit] Failed to flush audit logs:", error);
      // Re-add to buffer for retry
      this.batchBuffer.unshift(...entries);
    }
  }

  /**
   * Start periodic flush timer
   */
  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushInterval);

    // Don't prevent process exit
    this.flushTimer.unref();
  }

  /**
   * Stop periodic flush (for testing/shutdown)
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Flush remaining
    this.flush().catch(console.error);
  }

  // ========================================================================
  // Convenience Methods for Common Auth Events
  // ========================================================================

  /**
   * Log user registration
   */
  async logRegister(
    context: AuthAuditContext,
    userId: string,
    email: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "USER_REGISTER",
      success,
      context: { ...context, userId },
      resourceType: "user",
      resourceId: userId,
      newValues: { email },
      error,
    });
  }

  /**
   * Log user login
   */
  async logLogin(
    context: AuthAuditContext,
    userId: string,
    email: string,
    success: boolean,
    error?: string,
    errorCode?: string
  ): Promise<void> {
    await this.log({
      event: "USER_LOGIN",
      success,
      context: { ...context, userId },
      resourceType: "user",
      resourceId: userId,
      metadata: { email, method: "password" },
      error,
      errorCode,
    });
  }

  /**
   * Log OAuth login
   */
  async logOAuthLogin(
    context: AuthAuditContext,
    userId: string,
    provider: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "USER_LOGIN",
      success,
      context: { ...context, userId },
      resourceType: "user",
      resourceId: userId,
      metadata: { method: "oauth", provider },
      error,
    });
  }

  /**
   * Log user logout
   */
  async logLogout(
    context: AuthAuditContext,
    userId: string,
    allDevices: boolean = false
  ): Promise<void> {
    await this.log({
      event: allDevices ? "USER_LOGOUT_ALL" : "USER_LOGOUT",
      success: true,
      context: { ...context, userId },
      resourceType: "user",
      resourceId: userId,
    });
  }

  /**
   * Log password change
   */
  async logPasswordChange(
    context: AuthAuditContext,
    userId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "PASSWORD_CHANGE",
      success,
      context: { ...context, userId },
      resourceType: "user",
      resourceId: userId,
      error,
    });
  }

  /**
   * Log password reset request
   */
  async logPasswordResetRequest(
    context: AuthAuditContext,
    email: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "PASSWORD_RESET_REQUEST",
      success,
      context,
      resourceType: "user",
      metadata: { email },
      error,
    });
  }

  /**
   * Log password reset completion
   */
  async logPasswordResetComplete(
    context: AuthAuditContext,
    userId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "PASSWORD_RESET_COMPLETE",
      success,
      context: { ...context, userId },
      resourceType: "user",
      resourceId: userId,
      error,
    });
  }

  /**
   * Log email verification sent
   */
  async logEmailVerificationSent(
    context: AuthAuditContext,
    email: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "EMAIL_VERIFICATION_SENT",
      success,
      context,
      resourceType: "user",
      metadata: { email },
      error,
    });
  }

  /**
   * Log email verification completion
   */
  async logEmailVerificationComplete(
    context: AuthAuditContext,
    userId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "EMAIL_VERIFICATION_COMPLETE",
      success,
      context: { ...context, userId },
      resourceType: "user",
      resourceId: userId,
      error,
    });
  }

  /**
   * Log OAuth initiation
   */
  async logOAuthInitiate(
    context: AuthAuditContext,
    provider: string,
    redirectUrl: string
  ): Promise<void> {
    await this.log({
      event: "OAUTH_INITIATE",
      success: true,
      context,
      resourceType: "oauth",
      metadata: { provider, redirectUrl },
    });
  }

  /**
   * Log OAuth callback
   */
  async logOAuthCallback(
    context: AuthAuditContext,
    provider: string,
    success: boolean,
    userId?: string,
    error?: string
  ): Promise<void> {
    await this.log({
      event: success ? "OAUTH_CALLBACK_SUCCESS" : "OAUTH_CALLBACK_FAILED",
      success,
      context: { ...context, userId },
      resourceType: "oauth",
      resourceId: userId,
      metadata: { provider },
      error,
    });
  }

  /**
   * Log account linking
   */
  async logAccountLink(
    context: AuthAuditContext,
    userId: string,
    provider: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "OAUTH_LINK_ACCOUNT",
      success,
      context: { ...context, userId },
      resourceType: "account",
      resourceId: userId,
      metadata: { provider },
      error,
    });
  }

  /**
   * Log account unlinking
   */
  async logAccountUnlink(
    context: AuthAuditContext,
    userId: string,
    provider: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "OAUTH_UNLINK_ACCOUNT",
      success,
      context: { ...context, userId },
      resourceType: "account",
      resourceId: userId,
      metadata: { provider },
      error,
    });
  }

  /**
   * Log session refresh
   */
  async logSessionRefresh(
    context: AuthAuditContext,
    userId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: success ? "SESSION_REFRESH" : "SESSION_REFRESH_FAILED",
      success,
      context: { ...context, userId },
      resourceType: "session",
      error,
    });
  }

  /**
   * Log session revocation
   */
  async logSessionRevoked(
    context: AuthAuditContext,
    userId: string,
    sessionId: string,
    allDevices: boolean = false
  ): Promise<void> {
    await this.log({
      event: "SESSION_REVOKED",
      success: true,
      context: { ...context, userId },
      resourceType: "session",
      resourceId: sessionId,
      metadata: { allDevices },
    });
  }

  /**
   * Log MFA enable
   */
  async logMfaEnable(
    context: AuthAuditContext,
    userId: string,
    method: "totp" | "sms" | "email",
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "MFA_ENABLE",
      success,
      context: { ...context, userId },
      resourceType: "mfa",
      resourceId: userId,
      metadata: { method },
      error,
    });
  }

  /**
   * Log MFA disable
   */
  async logMfaDisable(
    context: AuthAuditContext,
    userId: string,
    method: "totp" | "sms" | "email",
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "MFA_DISABLE",
      success,
      context: { ...context, userId },
      resourceType: "mfa",
      resourceId: userId,
      metadata: { method },
      error,
    });
  }

  /**
   * Log MFA verification
   */
  async logMfaVerify(
    context: AuthAuditContext,
    userId: string,
    method: "totp" | "sms" | "email" | "backup_code",
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: success ? "MFA_VERIFY" : "MFA_VERIFY_FAILED",
      success,
      context: { ...context, userId },
      resourceType: "mfa",
      resourceId: userId,
      metadata: { method },
      error,
    });
  }

  /**
   * Log device token registration
   */
  async logDeviceTokenRegister(
    context: AuthAuditContext,
    userId: string,
    deviceId: string,
    platform: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "DEVICE_TOKEN_REGISTER",
      success,
      context: { ...context, userId },
      resourceType: "device_token",
      resourceId: deviceId,
      metadata: { platform },
      error,
    });
  }

  /**
   * Log device token revocation
   */
  async logDeviceTokenRevoke(
    context: AuthAuditContext,
    userId: string,
    deviceId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "DEVICE_TOKEN_REVOKE",
      success,
      context: { ...context, userId },
      resourceType: "device_token",
      resourceId: deviceId,
      error,
    });
  }

  /**
   * Log brute force attempt
   */
  async logBruteForceAttempt(
    context: AuthAuditContext,
    identifier: string, // email or IP
    attemptCount: number,
    locked: boolean = false
  ): Promise<void> {
    await this.log({
      event: locked ? "BRUTE_FORCE_LOCKOUT" : "BRUTE_FORCE_ATTEMPT",
      success: false, // Always false for security events
      context,
      resourceType: "security",
      metadata: { identifier, attemptCount, locked },
    });
  }

  /**
   * Log suspicious activity
   */
  async logSuspiciousActivity(
    context: AuthAuditContext,
    userId: string | undefined,
    activity: string,
    details: Record<string, any>
  ): Promise<void> {
    await this.log({
      event: "SUSPICIOUS_ACTIVITY",
      success: false,
      context: { ...context, userId },
      resourceType: "security",
      resourceId: userId,
      metadata: { activity, ...details },
    });
  }

  /**
   * Log account lock/unlock
   */
  async logAccountLock(
    context: AuthAuditContext,
    userId: string,
    locked: boolean,
    reason: string
  ): Promise<void> {
    await this.log({
      event: locked ? "ACCOUNT_LOCKED" : "ACCOUNT_UNLOCKED",
      success: true,
      context: { ...context, userId },
      resourceType: "user",
      resourceId: userId,
      metadata: { reason },
    });
  }

  /**
   * Log profile update
   */
  async logProfileUpdate(
    context: AuthAuditContext,
    userId: string,
    oldValues: Record<string, any>,
    newValues: Record<string, any>,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "PROFILE_UPDATE",
      success,
      context: { ...context, userId },
      resourceType: "user",
      resourceId: userId,
      oldValues,
      newValues,
      error,
    });
  }

  /**
   * Log email change request
   */
  async logEmailChangeRequest(
    context: AuthAuditContext,
    userId: string,
    oldEmail: string,
    newEmail: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.log({
      event: "EMAIL_CHANGE_REQUEST",
      success,
      context: { ...context, userId },
      resourceType: "user",
      resourceId: userId,
      oldValues: { email: oldEmail },
      newValues: { email: newEmail },
      error,
    });
  }

  /**
   * Log admin action
   */
  async logAdminAction(
    context: AuthAuditContext,
    targetUserId: string,
    action: "suspend" | "ban" | "restore" | "password_reset",
    success: boolean,
    reason?: string,
    error?: string
  ): Promise<void> {
    const eventMap: Record<string, AuthEventType> = {
      suspend: "ADMIN_USER_SUSPEND",
      ban: "ADMIN_USER_BAN",
      restore: "ADMIN_USER_RESTORE",
      password_reset: "ADMIN_PASSWORD_RESET",
    };

    await this.log({
      event: eventMap[action],
      success,
      context: { ...context, userId: targetUserId },
      resourceType: "user",
      resourceId: targetUserId,
      metadata: { reason, adminId: context.userId },
      error,
    });
  }

  // ========================================================================
  // Query Methods
  // ========================================================================

  /**
   * Get audit logs for a user
   */
  async getUserAuditLogs(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
      eventTypes?: AuthEventType[];
    } = {}
  ): Promise<{ entries: AuthAuditEntry[]; total: number }> {
    const { limit = 50, offset = 0, startDate, endDate, eventTypes } = options;

    const conditions = [eq(schema.auditLogs.actorId, userId)];

    if (startDate) {
      conditions.push(gte(schema.auditLogs.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(schema.auditLogs.createdAt, endDate));
    }

    if (eventTypes && eventTypes.length > 0) {
      conditions.push(inArray(schema.auditLogs.action, eventTypes));
    }

    const [entries, total] = await Promise.all([
      db
        .select()
        .from(schema.auditLogs)
        .where(and(...conditions))
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(schema.auditLogs).where(and(...conditions)),
    ]);

    return {
      entries: entries as unknown as AuthAuditEntry[],
      total: total[0]?.count || 0,
    };
  }

  /**
   * Get security events (failed logins, brute force, etc.)
   */
  async getSecurityEvents(
    options: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
      userId?: string;
    } = {}
  ): Promise<{ entries: AuthAuditEntry[]; total: number }> {
    const { limit = 50, offset = 0, startDate, endDate, userId } = options;

    const conditions = [
      // Security events: failed logins, brute force, suspicious activity
      inArray(schema.auditLogs.action, [
        'LOGIN_FAILED',
        'BRUTE_FORCE_DETECTED',
        'SUSPICIOUS_ACTIVITY',
        'ACCOUNT_LOCKED',
        'PASSWORD_RESET_REQUESTED',
        'MFA_FAILED',
      ]),
    ];

    if (userId) {
      conditions.push(eq(schema.auditLogs.actorId, userId));
    }
    if (startDate) {
      conditions.push(gte(schema.auditLogs.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(schema.auditLogs.createdAt, endDate));
    }

    const [entries, total] = await Promise.all([
      db
        .select()
        .from(schema.auditLogs)
        .where(and(...conditions))
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(schema.auditLogs).where(and(...conditions)),
    ]);

    return {
      entries: entries as unknown as AuthAuditEntry[],
      total: total[0]?.count || 0,
    };
  }

  /**
   * Get login history for a user
   */
  async getLoginHistory(userId: string, limit = 20): Promise<AuthAuditEntry[]> {
    const entries = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.actorId, userId),
          inArray(schema.auditLogs.action, ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'SESSION_REFRESHED'])
        )
      )
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(limit);

    return entries as unknown as AuthAuditEntry[];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let authAuditInstance: AuthAuditService | null = null;

export function getAuthAuditService(): AuthAuditService {
  if (!authAuditInstance) {
    authAuditInstance = new AuthAuditService();
  }
  return authAuditInstance;
}

export function setAuthAuditService(service: AuthAuditService): void {
  if (authAuditInstance) {
    authAuditInstance.stop();
  }
  authAuditInstance = service;
}

// ============================================================================
// Helper Functions for Middleware/Route Integration
// ============================================================================

/**
 * Create audit context from Hono request
 */
export function createAuditContext(c: any): AuthAuditContext {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
        c.req.header("x-real-ip");
  return {
    ip: ip || null,
    userAgent: c.req.header("user-agent") || "unknown",
    requestId: c.req.header("x-request-id") || randomUUID(),
    correlationId: c.get("correlationId"),
    sessionId: c.get("session")?.sessionId,
  };
}

/**
 * Middleware to add audit context to request
 */
export function auditContextMiddleware() {
  return async (c: any, next: any) => {
    c.set("auditContext", createAuditContext(c));
    await next();
  };
}