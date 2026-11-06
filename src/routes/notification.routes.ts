import { Hono } from "hono";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, count, sql, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

function getPagination(c: any) {
  const page = Number(c.req.query("page")) || 1;
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { page, perPage, offset: (page - 1) * perPage };
}

const notificationRouter = new Hono();
notificationRouter.use("*", authMiddleware);

// GET /v1/notifications - List notifications
notificationRouter.get("/", async (c) => {
  const user = getCurrentUser(c);
  const { page, perPage, offset } = getPagination(c);

  const [notificationsList, total] = await Promise.all([
    db.select({
      id: schema.notifications.id,
      recipientId: schema.notifications.recipientId,
      actorId: schema.notifications.actorId,
      type: schema.notifications.type,
      postId: schema.notifications.postId,
      reelId: schema.notifications.reelId,
      commentText: schema.notifications.commentText,
      postThumbnailUrl: schema.notifications.postThumbnailUrl,
      isRead: schema.notifications.isRead,
      createdAt: schema.notifications.createdAt,
      actor: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
    })
      .from(schema.notifications)
      .innerJoin(schema.users, eq(schema.users.id, schema.notifications.actorId))
      .where(eq(schema.notifications.recipientId, user.id))
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(schema.notifications.createdAt)),
    db.select({ count: count() }).from(schema.notifications).where(eq(schema.notifications.recipientId, user.id)),
  ]);

  return c.json({
    success: true,
    data: {
      items: notificationsList,
      page,
      perPage,
      total: total[0]?.count || 0,
      hasMore: page * perPage < (total[0]?.count || 0),
    },
  });
});

// GET /v1/notifications/unread-count - Get unread count
notificationRouter.get("/unread-count", async (c) => {
  const user = getCurrentUser(c);

  const result = await db
    .select({ count: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.recipientId, user.id), eq(schema.notifications.isRead, false)));

  return c.json({
    success: true,
    data: { count: result[0]?.count || 0 },
  });
});

// POST /v1/notifications/read-all - Mark all as read
notificationRouter.post("/read-all", async (c) => {
  const user = getCurrentUser(c);

  await db
    .update(schema.notifications)
    .set({ isRead: true })
    .where(and(eq(schema.notifications.recipientId, user.id), eq(schema.notifications.isRead, false)));

  return c.status(204);
});

// POST /v1/notifications/:id/read - Mark one as read
notificationRouter.post("/:id/read", async (c) => {
  const user = getCurrentUser(c);
  const notificationId = c.req.param("id");

  const notification = await db.query.notifications.findFirst({
    where: eq(schema.notifications.id, notificationId),
  });

  if (!notification) {
    throw new HTTPException(404, { message: "Notification not found" });
  }

  if (notification.recipientId !== user.id) {
    throw new HTTPException(403, { message: "Not authorized" });
  }

  await db
    .update(schema.notifications)
    .set({ isRead: true })
    .where(eq(schema.notifications.id, notificationId));

  return c.status(204);
});

export { notificationRouter };