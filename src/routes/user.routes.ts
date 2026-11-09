import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, or, desc, asc, ilike, count, notExists, inArray, not, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// Validation schemas
const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(100).optional(),
  bio: z.string().trim().max(150).nullable().optional(),
  website: z.string().url().max(250).nullable().optional(),
  isPrivate: z.boolean().optional(),
});

const profileAliasSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

const deviceSchema = z.object({
  token: z.string().min(1).max(512),
  platform: z.enum(["IOS", "ANDROID"]),
});

const tokenSchema = z.object({
  token: z.string().min(1).max(512),
});

const searchSchema = z.object({
  q: z.string().trim().min(1).max(100),
  page: z.string().optional(),
  perPage: z.string().optional(),
});

const userSettingsSchema = z.object({
  language: z.string().min(2).max(10).optional(),
  biometricEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  darkMode: z.boolean().optional(),
});

const closeFriendsSchema = z.object({
  friendIds: z.array(z.string().uuid()).max(100),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(50).default(20),
});

// Helper function for pagination
function getPagination(c: any) {
  const page = Number(c.req.query("page")) || 1;
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { page, perPage, offset: (page - 1) * perPage };
}

// Create user router
const userRouter = new Hono();

// Apply auth middleware to all routes
userRouter.use("*", authMiddleware);

// GET /v1/user/me - Canonical profile (alias for /v1/user/profile)
userRouter.get("/me", async (c) => {
  const user = getCurrentUser(c);
  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        website: user.website,
        isVerified: user.isVerified,
        isPrivate: user.isPrivate,
        postsCount: user.postsCount,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        createdAt: user.createdAt,
        isFollowing: false,
        isFollowedBy: false,
      },
    },
  });
});

// PUT /v1/user/me - Full profile update
userRouter.put("/me", zValidator("json", profileSchema), async (c) => {
  const user = getCurrentUser(c);
  const data = c.req.valid("json");

  const [updated] = await db
    .update(schema.users)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id))
    .returning();

  return c.json({
    success: true,
    data: {
      user: {
        id: updated.id,
        username: updated.username,
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        avatarUrl: updated.avatarUrl,
        bio: updated.bio,
        website: updated.website,
        isVerified: updated.isVerified,
        isPrivate: updated.isPrivate,
        postsCount: updated.postsCount,
        followersCount: updated.followersCount,
        followingCount: updated.followingCount,
        createdAt: updated.createdAt,
      },
    },
  });
});

// POST /v1/user/me/device-token - Register device token
userRouter.post("/me/device-token", zValidator("json", deviceSchema), async (c) => {
  const user = getCurrentUser(c);
  const { token, platform } = c.req.valid("json");

  // Set expiry to 90 days from now
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  await db
    .insert(schema.deviceTokens)
    .values({
      userId: user.id,
      token,
      platform,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: schema.deviceTokens.token,
      set: { platform, updatedAt: new Date(), expiresAt },
    });

  return c.status(204);
});

// DELETE /v1/user/me/device-token - Unregister device token
userRouter.delete("/me/device-token", zValidator("json", tokenSchema), async (c) => {
  const user = getCurrentUser(c);
  const { token } = c.req.valid("json");

  await db
    .delete(schema.deviceTokens)
    .where(and(eq(schema.deviceTokens.userId, user.id), eq(schema.deviceTokens.token, token)));

  return c.status(204);
});

// GET /v1/users/search - Search users
userRouter.get("/search", zValidator("query", searchSchema), async (c) => {
  const user = getCurrentUser(c);
  const { q } = c.req.valid("query");
  const { page, perPage, offset } = getPagination(c);

  // Subquery for blocked users
  const blockedByUser = db
    .select({ blockedId: schema.blocks.blockedId })
    .from(schema.blocks)
    .where(eq(schema.blocks.blockerId, user.id));

  const blockedUser = db
    .select({ blockerId: schema.blocks.blockerId })
    .from(schema.blocks)
    .where(eq(schema.blocks.blockedId, user.id));

  const [usersList, total] = await Promise.all([
    db
      .select()
      .from(schema.users)
      .where(
        and(
          or(
            ilike(schema.users.username, `%${q}%`),
            ilike(schema.users.fullName, `%${q}%`)
          ),
          // Exclude current user
          not(eq(schema.users.id, user.id)),
          // Exclude blocked users (both directions)
          not(inArray(schema.users.id, blockedByUser)),
          not(inArray(schema.users.id, blockedUser))
        )
      )
      .limit(perPage)
      .offset(offset)
      .orderBy(asc(schema.users.username)),
    db
      .select({ count: count() })
      .from(schema.users)
      .where(
        and(
          or(
            ilike(schema.users.username, `%${q}%`),
            ilike(schema.users.fullName, `%${q}%`)
          ),
          not(eq(schema.users.id, user.id))
        )
      ),
  ]);

  return c.json({
    success: true,
    data: {
      items: usersList.map((u) => ({
        id: u.id,
        username: u.username,
        fullName: u.fullName,
        avatarUrl: u.avatarUrl,
        isVerified: u.isVerified,
        isPrivate: u.isPrivate,
      })),
      page,
      perPage,
      total: total[0]?.count || 0,
      hasMore: page * perPage < (total[0]?.count || 0),
    },
  });
});

// GET /v1/users/suggested - Suggested users
userRouter.get("/suggested", async (c) => {
  const user = getCurrentUser(c);
  const { page, perPage, offset } = getPagination(c);

  // Get users not followed by current user and not blocked
  const followingSubquery = db
    .select({ followingId: schema.follows.followingId })
    .from(schema.follows)
    .where(eq(schema.follows.followerId, user.id));

  // Subquery for blocked users
  const blockedByUser = db
    .select({ blockedId: schema.blocks.blockedId })
    .from(schema.blocks)
    .where(eq(schema.blocks.blockerId, user.id));

  const blockedUser = db
    .select({ blockerId: schema.blocks.blockerId })
    .from(schema.blocks)
    .where(eq(schema.blocks.blockedId, user.id));

  const usersList = await db
    .select()
    .from(schema.users)
    .where(
      and(
        not(eq(schema.users.id, user.id)),
        not(inArray(schema.users.id, followingSubquery)),
        not(inArray(schema.users.id, blockedByUser)),
        not(inArray(schema.users.id, blockedUser))
      )
    )
    .limit(perPage)
    .offset(offset)
    .orderBy(desc(schema.users.createdAt));

  return c.json({
    success: true,
    data: {
      items: usersList.map((u) => ({
        id: u.id,
        username: u.username,
        fullName: u.fullName,
        avatarUrl: u.avatarUrl,
        isVerified: u.isVerified,
        isPrivate: u.isPrivate,
      })),
      page,
      perPage,
      total: usersList.length,
      hasMore: usersList.length === perPage,
    },
  });
});

// iOS aliases
// GET /v1/user/profile
userRouter.get("/profile", async (c) => {
  const user = getCurrentUser(c);
  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        website: user.website,
        isVerified: user.isVerified,
        isPrivate: user.isPrivate,
        postsCount: user.postsCount,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        createdAt: user.createdAt,
      },
    },
  });
});

// PUT /v1/user/profile (iOS sends name instead of fullName)
userRouter.put("/profile", zValidator("json", profileAliasSchema), async (c) => {
  const user = getCurrentUser(c);
  const { name } = c.req.valid("json");

  if (!name) {
    throw new HTTPException(400, {
      message: "Name is required",
      res: c.json({ success: false, error: "VALIDATION_ERROR", message: "Name is required" }),
    });
  }

  const [updated] = await db
    .update(schema.users)
    .set({ fullName: name, updatedAt: new Date() })
    .where(eq(schema.users.id, user.id))
    .returning();

  return c.json({
    success: true,
    data: {
      user: {
        id: updated.id,
        username: updated.username,
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        avatarUrl: updated.avatarUrl,
        bio: updated.bio,
        website: updated.website,
        isVerified: updated.isVerified,
        isPrivate: updated.isPrivate,
        postsCount: updated.postsCount,
        followersCount: updated.followersCount,
        followingCount: updated.followingCount,
        createdAt: updated.createdAt,
      },
    },
  });
});

// User Settings
// GET /v1/user/settings
userRouter.get("/settings", async (c) => {
  const user = getCurrentUser(c);

  const settings = await db.query.userSettings.findFirst({
    where: eq(schema.userSettings.userId, user.id),
  });

  if (!settings) {
    // Create default settings
    const [newSettings] = await db
      .insert(schema.userSettings)
      .values({ userId: user.id })
      .returning();
    return c.json({ success: true, data: { settings: newSettings } });
  }

  return c.json({ success: true, data: { settings } });
});

// PUT /v1/user/settings
userRouter.put("/settings", zValidator("json", userSettingsSchema), async (c) => {
  const user = getCurrentUser(c);
  const data = c.req.valid("json");

  const [updated] = await db
    .insert(schema.userSettings)
    .values({ userId: user.id, ...data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: { ...data, updatedAt: new Date() },
    })
    .returning();

  return c.json({ success: true, data: { settings: updated } });
});

// Blocked users
// GET /v1/users/me/blocked
userRouter.get("/me/blocked", async (c) => {
  const user = getCurrentUser(c);
  const { page, perPage, offset } = getPagination(c);

  const [blockedUsers, total] = await Promise.all([
    db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
        blockedAt: schema.blocks.createdAt,
      })
      .from(schema.blocks)
      .innerJoin(schema.users, eq(schema.users.id, schema.blocks.blockedId))
      .where(eq(schema.blocks.blockerId, user.id))
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(schema.blocks.createdAt)),
    db
      .select({ count: count() })
      .from(schema.blocks)
      .where(eq(schema.blocks.blockerId, user.id)),
  ]);

  return c.json({
    success: true,
    data: {
      items: blockedUsers,
      page,
      perPage,
      total: total[0]?.count || 0,
      hasMore: page * perPage < (total[0]?.count || 0),
    },
  });
});

// Close Friends
// GET /v1/users/me/close-friends
userRouter.get("/me/close-friends", async (c) => {
  const user = getCurrentUser(c);

  const closeFriends = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      fullName: schema.users.fullName,
      avatarUrl: schema.users.avatarUrl,
      isVerified: schema.users.isVerified,
    })
    .from(schema.closeFriends)
    .innerJoin(schema.users, eq(schema.users.id, schema.closeFriends.friendId))
    .where(eq(schema.closeFriends.userId, user.id))
    .orderBy(asc(schema.closeFriends.createdAt));

  return c.json({ success: true, data: { items: closeFriends } });
});

// PUT /v1/users/me/close-friends (full-set replace)
userRouter.put("/me/close-friends", zValidator("json", closeFriendsSchema), async (c) => {
  const user = getCurrentUser(c);
  const { friendIds } = c.req.valid("json");

  // Delete all existing close friends
  await db.delete(schema.closeFriends).where(eq(schema.closeFriends.userId, user.id));

  // Insert new close friends
  if (friendIds.length > 0) {
    await db.insert(schema.closeFriends).values(
      friendIds.map((friendId) => ({
        userId: user.id,
        friendId,
      }))
    );
  }

  return c.status(204);
});

// ============================================
// PARAMETERIZED ROUTES (/id/*) - MUST BE LAST
// ============================================

// GET /v1/users/:id/followers - List followers
userRouter.get("/:id/followers", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("id");
  const { page, perPage, offset } = getPagination(c);

  const [followers, total] = await Promise.all([
    db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
        followedAt: schema.follows.createdAt,
      })
      .from(schema.follows)
      .innerJoin(schema.users, eq(schema.users.id, schema.follows.followerId))
      .where(eq(schema.follows.followingId, targetId))
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(schema.follows.createdAt)),
    db
      .select({ count: count() })
      .from(schema.follows)
      .where(eq(schema.follows.followingId, targetId)),
  ]);

  return c.json({
    success: true,
    data: {
      items: followers,
      page,
      perPage,
      total: total[0]?.count || 0,
      hasMore: page * perPage < (total[0]?.count || 0),
    },
  });
});

// GET /v1/users/:id/following - List following
userRouter.get("/:id/following", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("id");
  const { page, perPage, offset } = getPagination(c);

  const [following, total] = await Promise.all([
    db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
        followedAt: schema.follows.createdAt,
      })
      .from(schema.follows)
      .innerJoin(schema.users, eq(schema.users.id, schema.follows.followingId))
      .where(eq(schema.follows.followerId, targetId))
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(schema.follows.createdAt)),
    db
      .select({ count: count() })
      .from(schema.follows)
      .where(eq(schema.follows.followerId, targetId)),
  ]);

  return c.json({
    success: true,
    data: {
      items: following,
      page,
      perPage,
      total: total[0]?.count || 0,
      hasMore: page * perPage < (total[0]?.count || 0),
    },
  });
});

// POST /v1/users/:id/follow - Follow user
userRouter.post("/:id/follow", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("id");

  if (user.id === targetId) {
    throw new HTTPException(400, {
      message: "Cannot follow yourself",
      res: c.json({ success: false, error: "SELF_FOLLOW", message: "Cannot follow yourself" }),
    });
  }

  // Check if target user exists
  const targetUser = await db.query.users.findFirst({
    where: eq(schema.users.id, targetId),
    columns: { id: true, isPrivate: true },
  });

  if (!targetUser) {
    throw new HTTPException(404, {
      message: "User not found",
      res: c.json({ success: false, error: "NOT_FOUND", message: "User not found" }),
    });
  }

  // Check if already following
  const existing = await db.query.follows.findFirst({
    where: and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, targetId)),
  });

  if (existing) {
    throw new HTTPException(409, {
      message: "Already following this user",
      res: c.json({ success: false, error: "ALREADY_FOLLOWING", message: "Already following this user" }),
    });
  }

  // Check if blocked
  const blocked = await db.query.blocks.findFirst({
    where: or(
      and(eq(schema.blocks.blockerId, user.id), eq(schema.blocks.blockedId, targetId)),
      and(eq(schema.blocks.blockerId, targetId), eq(schema.blocks.blockedId, user.id))
    ),
  });

  if (blocked) {
    throw new HTTPException(403, {
      message: "Cannot follow this user",
      res: c.json({ success: false, error: "FORBIDDEN", message: "Cannot follow this user" }),
    });
  }

  // Create follow
  await db.insert(schema.follows).values({
    followerId: user.id,
    followingId: targetId,
  });

  // Update counts
  await db
    .update(schema.users)
    .set({
      followingCount: sql`${schema.users.followingCount} + 1`,
    })
    .where(eq(schema.users.id, user.id));

  await db
    .update(schema.users)
    .set({
      followersCount: sql`${schema.users.followersCount} + 1`,
    })
    .where(eq(schema.users.id, targetId));

  return c.status(204);
});

// DELETE /v1/users/:id/follow - Unfollow user
userRouter.delete("/:id/follow", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("id");

  const result = await db
    .delete(schema.follows)
    .where(and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, targetId)))
    .returning({ id: schema.follows.id });

  if (result.length === 0) {
    throw new HTTPException(404, {
      message: "Not following this user",
      res: c.json({ success: false, error: "NOT_FOLLOWING", message: "Not following this user" }),
    });
  }

  // Update counts
  await db
    .update(schema.users)
    .set({
      followingCount: sql`${schema.users.followingCount} - 1`,
    })
    .where(eq(schema.users.id, user.id));

  await db
    .update(schema.users)
    .set({
      followersCount: sql`${schema.users.followersCount} - 1`,
    })
    .where(eq(schema.users.id, targetId));

  return c.status(204);
});

// POST /v1/users/:id/block - Block user
userRouter.post("/:id/block", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("id");

  if (user.id === targetId) {
    throw new HTTPException(400, {
      message: "Cannot block yourself",
      res: c.json({ success: false, error: "SELF_BLOCK", message: "Cannot block yourself" }),
    });
  }

  const targetUser = await db.query.users.findFirst({
    where: eq(schema.users.id, targetId),
    columns: { id: true },
  });

  if (!targetUser) {
    throw new HTTPException(404, {
      message: "User not found",
      res: c.json({ success: false, error: "NOT_FOUND", message: "User not found" }),
    });
  }

  // Check if already blocked
  const existing = await db.query.blocks.findFirst({
    where: and(eq(schema.blocks.blockerId, user.id), eq(schema.blocks.blockedId, targetId)),
  });

  if (existing) {
    throw new HTTPException(409, {
      message: "Already blocked this user",
      res: c.json({ success: false, error: "ALREADY_BLOCKED", message: "Already blocked this user" }),
    });
  }

  // Create block
  await db.insert(schema.blocks).values({
    blockerId: user.id,
    blockedId: targetId,
  });

  // Remove follow relationships if they exist
  await db
    .delete(schema.follows)
    .where(
      or(
        and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, targetId)),
        and(eq(schema.follows.followerId, targetId), eq(schema.follows.followingId, user.id))
      )
    );

  return c.status(204);
});

// DELETE /v1/users/:id/block - Unblock user
userRouter.delete("/:id/block", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("id");

  const result = await db
    .delete(schema.blocks)
    .where(and(eq(schema.blocks.blockerId, user.id), eq(schema.blocks.blockedId, targetId)))
    .returning({ id: schema.blocks.id });

  if (result.length === 0) {
    throw new HTTPException(404, {
      message: "Not blocking this user",
      res: c.json({ success: false, error: "NOT_BLOCKED", message: "Not blocking this user" }),
    });
  }

  return c.status(204);
});

// GET /v1/users/:id - Public profile (catch-all, must be last)
userRouter.get("/:id", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("id");

  const targetUser = await db.query.users.findFirst({
    where: eq(schema.users.id, targetId),
  });

  if (!targetUser) {
    throw new HTTPException(404, {
      message: "User not found",
      res: c.json({ success: false, error: "NOT_FOUND", message: "User not found" }),
    });
  }

  // Check if blocked
  const blocked = await db.query.blocks.findFirst({
    where: or(
      and(eq(schema.blocks.blockerId, user.id), eq(schema.blocks.blockedId, targetId)),
      and(eq(schema.blocks.blockerId, targetId), eq(schema.blocks.blockedId, user.id))
    ),
  });

  if (blocked) {
    throw new HTTPException(403, {
      message: "User not found",
      res: c.json({ success: false, error: "NOT_FOUND", message: "User not found" }),
    });
  }

  // Check follow status
  const isFollowing = !!(await db.query.follows.findFirst({
    where: and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, targetId)),
  }));

  const isFollowedBy = !!(await db.query.follows.findFirst({
    where: and(eq(schema.follows.followerId, targetId), eq(schema.follows.followingId, user.id)),
  }));

  // If private and not following, return limited info
  if (targetUser.isPrivate && !isFollowing && user.id !== targetId) {
    return c.json({
      success: true,
      data: {
        user: {
          id: targetUser.id,
          username: targetUser.username,
          fullName: targetUser.fullName,
          avatarUrl: targetUser.avatarUrl,
          bio: targetUser.bio,
          isVerified: targetUser.isVerified,
          isPrivate: targetUser.isPrivate,
          postsCount: targetUser.postsCount,
          followersCount: targetUser.followersCount,
          followingCount: targetUser.followingCount,
          isFollowing,
          isFollowedBy,
        },
      },
    });
  }

  return c.json({
    success: true,
    data: {
      user: {
        id: targetUser.id,
        username: targetUser.username,
        fullName: targetUser.fullName,
        email: user.id === targetId ? targetUser.email : undefined,
        phone: user.id === targetId ? targetUser.phone : undefined,
        avatarUrl: targetUser.avatarUrl,
        bio: targetUser.bio,
        website: targetUser.website,
        isVerified: targetUser.isVerified,
        isPrivate: targetUser.isPrivate,
        postsCount: targetUser.postsCount,
        followersCount: targetUser.followersCount,
        followingCount: targetUser.followingCount,
        createdAt: targetUser.createdAt,
        isFollowing,
        isFollowedBy,
      },
    },
  });
});

export { userRouter };