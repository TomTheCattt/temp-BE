import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { getCurrentUser } from "./auth";

/**
 * Admin Middleware
 *
 * Provides role-based access control for admin/moderator endpoints.
 * Uses the user's roles from the policy engine (verified users get "verified" role).
 * In a production system, you would store roles in the database.
 */

export type AdminRole = "admin" | "moderator" | "superadmin";

/**
 * Check if user has admin/moderator role
 * In production, this would check a roles table or user metadata
 * For now, we check if user is verified (as a placeholder for admin status)
 * You should add a proper role field to the users table
 */
export function hasAdminRole(user: { isVerified?: boolean; roles?: string[]; id: string }, requiredRoles: AdminRole[]): boolean {
  // Check explicit roles if available
  if (user.roles && user.roles.length > 0) {
    return requiredRoles.some(role => user.roles!.includes(role));
  }

  // Fallback: treat verified users as potential moderators
  // In production, you should add a proper `role` column to users table
  if (user.isVerified && requiredRoles.includes("moderator")) {
    return true;
  }

  // For development, allow specific admin user IDs
  const adminUserIds = process.env.ADMIN_USER_IDS?.split(",") || [];
  if (adminUserIds.includes(user.id)) {
    return requiredRoles.some(r => ["admin", "superadmin"].includes(r));
  }

  return false;
}

/**
 * Middleware to require admin role
 */
export function requireAdminRole(...roles: AdminRole[]) {
  return createMiddleware(async (c, next) => {
    const user = getCurrentUser(c);

    if (!hasAdminRole(user, roles)) {
      throw new HTTPException(403, {
        message: "Admin access required",
        res: c.json({
          success: false,
          error: "FORBIDDEN",
          message: `This endpoint requires one of the following roles: ${roles.join(", ")}`,
        }, 403),
      });
    }

    // Set admin context for downstream handlers
    c.set("adminUser", user);
    c.set("adminRoles", roles);

    await next();
  });
}

/**
 * Specific role middlewares
 */
export const requireAdmin = requireAdminRole("admin", "superadmin");
export const requireModerator = requireAdminRole("moderator", "admin", "superadmin");
export const requireSuperAdmin = requireAdminRole("superadmin");

/**
 * Optional admin middleware - adds admin context if user has admin role
 */
export const optionalAdmin = createMiddleware(async (c, next) => {
  const user = getCurrentUser(c);

  const isAdmin = hasAdminRole(user, ["admin", "superadmin"]);
  const isModerator = hasAdminRole(user, ["moderator", "admin", "superadmin"]);

  c.set("isAdmin", isAdmin);
  c.set("isModerator", isModerator);

  await next();
});

/**
 * Get admin user from context
 */
export function getAdminUser(c: any) {
  return c.get("adminUser");
}

/**
 * Check if current user is admin (for use in handlers)
 */
export function isAdmin(c: any): boolean {
  return c.get("isAdmin") === true;
}

/**
 * Check if current user is moderator (for use in handlers)
 */
export function isModerator(c: any): boolean {
  return c.get("isModerator") === true;
}