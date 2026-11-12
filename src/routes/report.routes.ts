import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, inArray, not, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// Schema enums (matching database):
// reportTypeEnum: "USER" | "POST" | "REEL" | "STORY" | "COMMENT" | "MESSAGE" | "AUDIO"
// reportReasonEnum: "SPAM" | "HATE_SPEECH" | "HARASSMENT" | "VIOLENCE" | "NUDITY" | "SELF_HARM" | "MISINFORMATION" | "SCAM" | "IMPERSONATION" | "COPYRIGHT" | "OTHER"
// reportStatusEnum: "PENDING" | "REVIEWING" | "RESOLVED" | "DISMISSED"

const createReportSchema = z.object({
  type: z.enum(["POST", "COMMENT", "REEL", "STORY", "USER", "MESSAGE", "AUDIO"]),
  reason: z.enum([
    "SPAM",
    "HATE_SPEECH",
    "HARASSMENT",
    "VIOLENCE",
    "NUDITY",
    "SELF_HARM",
    "MISINFORMATION",
    "SCAM",
    "IMPERSONATION",
    "COPYRIGHT",
    "OTHER",
  ]),
  description: z.string().max(1000).optional(),
  postId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional(),
  reelId: z.string().uuid().optional(),
  storyId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  audioId: z.string().uuid().optional(),
});

const reportQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(50).default(20),
  status: z.enum(["PENDING", "REVIEWING", "RESOLVED", "DISMISSED"]).optional(),
  type: z.enum(["POST", "COMMENT", "REEL", "STORY", "USER", "MESSAGE", "AUDIO"]).optional(),
});

function getPagination(c: any) {
  const page = Number(c.req.query("page")) || 1;
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { page, perPage, offset: (page - 1) * perPage };
}

const reportRouter = new Hono();
reportRouter.use("*", authMiddleware);

// POST /v1/reports - Create a report
reportRouter.post("/", zValidator("json", createReportSchema), async (c) => {
  const user = getCurrentUser(c);
  const { type, reason, description, postId, commentId, reelId, storyId, userId, messageId, audioId } = c.req.valid("json");

  // Validate that exactly one target ID is provided based on type
  const targetIds = { postId, commentId, reelId, storyId, userId, messageId, audioId };
  const providedTargets = Object.entries(targetIds).filter(([_, v]) => v !== undefined);

  if (providedTargets.length !== 1) {
    throw new HTTPException(400, { message: "Exactly one target ID must be provided for the report type" });
  }

  const [targetType, targetId] = providedTargets[0];
  const expectedTypeMap: Record<string, string> = {
    postId: "POST",
    commentId: "COMMENT",
    reelId: "REEL",
    storyId: "STORY",
    userId: "USER",
    messageId: "MESSAGE",
    audioId: "AUDIO",
  };

  if (expectedTypeMap[targetType] !== type) {
    throw new HTTPException(400, { message: `Target ID type (${targetType}) does not match report type (${type})` });
  }

  // Verify the target exists
  let targetExists = false;
  switch (type) {
    case "POST":
      targetExists = !!(await db.query.posts.findFirst({ where: eq(schema.posts.id, postId!), columns: { id: true } }));
      break;
    case "COMMENT":
      targetExists = !!(await db.query.comments.findFirst({ where: eq(schema.comments.id, commentId!), columns: { id: true } }));
      break;
    case "REEL":
      targetExists = !!(await db.query.reels.findFirst({ where: eq(schema.reels.id, reelId!), columns: { id: true } }));
      break;
    case "STORY":
      targetExists = !!(await db.query.stories.findFirst({ where: eq(schema.stories.id, storyId!), columns: { id: true } }));
      break;
    case "USER":
      targetExists = !!(await db.query.users.findFirst({ where: eq(schema.users.id, userId!), columns: { id: true } }));
      break;
    case "MESSAGE":
      targetExists = !!(await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId!), columns: { id: true } }));
      break;
    case "AUDIO":
      targetExists = !!(await db.query.audioTracks.findFirst({ where: eq(schema.audioTracks.id, audioId!), columns: { id: true } }));
      break;
  }

  if (!targetExists) {
    throw new HTTPException(404, { message: `${type} not found` });
  }

  // Prevent self-reporting for users
  if (type === "USER" && userId === user.id) {
    throw new HTTPException(400, { message: "Cannot report yourself" });
  }

  // Check for existing report from this user on this target
  const existingReport = await db.query.reports.findFirst({
    where: and(
      eq(schema.reports.reporterId, user.id),
      eq(schema.reports.reportedType, type),
      eq(schema.reports.reportedId, targetId!)
    ),
  });

  if (existingReport) {
    throw new HTTPException(409, { message: "You have already reported this content" });
  }

  const [report] = await db
    .insert(schema.reports)
    .values({
      reporterId: user.id,
      reportedType: type,
      reportedId: targetId!,
      reason,
      description,
    })
    .returning();

  // Notify moderators/admins (in a real app, you'd have a moderator role)
  // For now, we'll skip notification creation

  return c.json({ success: true, data: { report } }, 201);
});

// GET /v1/reports/my - Get current user's reports
reportRouter.get("/my", async (c) => {
  const user = getCurrentUser(c);
  const { page, perPage, offset } = getPagination(c);
  const status = c.req.query("status") as "PENDING" | "REVIEWING" | "RESOLVED" | "DISMISSED" | undefined;
  const type = c.req.query("type") as "POST" | "COMMENT" | "REEL" | "STORY" | "USER" | "MESSAGE" | "AUDIO" | undefined;

  const conditions = [eq(schema.reports.reporterId, user.id)];
  if (status) conditions.push(eq(schema.reports.status, status));
  if (type) conditions.push(eq(schema.reports.reportedType, type));

  const [reportsList, total] = await Promise.all([
    db
      .select({
        id: schema.reports.id,
        reportedType: schema.reports.reportedType,
        reportedId: schema.reports.reportedId,
        reason: schema.reports.reason,
        description: schema.reports.description,
        status: schema.reports.status,
        resolvedBy: schema.reports.resolvedBy,
        resolvedAt: schema.reports.resolvedAt,
        resolution: schema.reports.resolution,
        createdAt: schema.reports.createdAt,
      })
      .from(schema.reports)
      .where(and(...conditions))
      .orderBy(desc(schema.reports.createdAt))
      .limit(perPage)
      .offset(offset),
    db.select({ count: count() }).from(schema.reports).where(and(...conditions)),
  ]);

  return c.json({
    success: true,
    data: {
      items: reportsList,
      page,
      perPage,
      total: total[0]?.count || 0,
      hasMore: page * perPage < (total[0]?.count || 0),
    },
  });
});

// GET /v1/reports/:id - Get report details
reportRouter.get("/:id", async (c) => {
  const user = getCurrentUser(c);
  const reportId = c.req.param("id");

  const report = await db.query.reports.findFirst({
    where: eq(schema.reports.id, reportId),
  });

  if (!report) {
    throw new HTTPException(404, { message: "Report not found" });
  }

  // Users can only see their own reports (admins would see all)
  if (report.reporterId !== user.id) {
    throw new HTTPException(403, { message: "Not authorized to view this report" });
  }

  return c.json({ success: true, data: { report } });
});

// Admin routes (would be protected by admin middleware in production)
// For now, any authenticated user can access these (not ideal but works for dev)

// GET /v1/reports - Get all reports (admin)
reportRouter.get("/", async (c) => {
  const user = getCurrentUser(c);
  const { page, perPage, offset } = getPagination(c);
  const status = c.req.query("status") as "PENDING" | "REVIEWING" | "RESOLVED" | "DISMISSED" | undefined;
  const type = c.req.query("type") as "POST" | "COMMENT" | "REEL" | "STORY" | "USER" | "MESSAGE" | "AUDIO" | undefined;

  const conditions = [];
  if (status) conditions.push(eq(schema.reports.status, status));
  if (type) conditions.push(eq(schema.reports.reportedType, type));

  const [reportsList, total] = await Promise.all([
    db
      .select({
        id: schema.reports.id,
        reporterId: schema.reports.reporterId,
        reportedType: schema.reports.reportedType,
        reportedId: schema.reports.reportedId,
        reason: schema.reports.reason,
        description: schema.reports.description,
        status: schema.reports.status,
        resolvedBy: schema.reports.resolvedBy,
        resolvedAt: schema.reports.resolvedAt,
        resolution: schema.reports.resolution,
        createdAt: schema.reports.createdAt,
        reporter: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
        },
      })
      .from(schema.reports)
      .innerJoin(schema.users, eq(schema.users.id, schema.reports.reporterId))
      .where(and(...conditions))
      .orderBy(desc(schema.reports.createdAt))
      .limit(perPage)
      .offset(offset),
    db.select({ count: count() }).from(schema.reports).where(and(...conditions)),
  ]);

  return c.json({
    success: true,
    data: {
      items: reportsList,
      page,
      perPage,
      total: total[0]?.count || 0,
      hasMore: page * perPage < (total[0]?.count || 0),
    },
  });
});

// PUT /v1/reports/:id - Update report status (admin/moderator)
reportRouter.put(
  "/:id",
  zValidator("json", z.object({
    status: z.enum(["PENDING", "REVIEWING", "RESOLVED", "DISMISSED"]),
    resolution: z.string().max(2000).optional(),
  })),
  async (c) => {
    const user = getCurrentUser(c);
    const reportId = c.req.param("id");
    const { status, resolution } = c.req.valid("json");

    const report = await db.query.reports.findFirst({ where: eq(schema.reports.id, reportId) });
    if (!report) throw new HTTPException(404, { message: "Report not found" });

    // In production, check for admin/moderator role here
    // For now, allow any user to update (not ideal)

    const [updated] = await db
      .update(schema.reports)
      .set({
        status,
        resolvedBy: user.id,
        resolvedAt: new Date(),
        resolution,
      })
      .where(eq(schema.reports.id, reportId))
      .returning();

    return c.json({ success: true, data: { report: updated } });
  }
);

export { reportRouter };