/**
 * Call Routes - REST API for call management
 *
 * Endpoints:
 * - POST /v1/calls - Create a new call
 * - GET /v1/calls/:id - Get call details
 * - POST /v1/calls/:id/join - Join a call
 * - POST /v1/calls/:id/leave - Leave a call
 * - POST /v1/calls/:id/end - End a call
 * - POST /v1/calls/:id/invite - Invite participants
 * - POST /v1/calls/:id/kick - Kick participant
 * - POST /v1/calls/:id/participants/:userId - Update participant media state
 * - POST /v1/calls/:id/host/transfer - Transfer host
 * - GET /v1/calls/history - Get call history
 * - GET /v1/calls/:id/recording - Get call recording
 * - POST /v1/calls/:id/quality - Record quality metrics
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { HTTPException } from "hono/http-exception";
import { callService } from "../services/call-service";
import { CallState } from "../services/call-state-machine";

// Validation schemas
const createCallSchema = z.object({
  type: z.enum(["AUDIO", "VIDEO", "GROUP_AUDIO", "GROUP_VIDEO"]),
  participantIds: z.array(z.string().uuid()).min(1).max(50),
  conversationId: z.string().uuid().optional(),
  maxParticipants: z.number().min(2).max(50).optional(),
  isRecording: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

const joinCallSchema = z.object({
  deviceType: z.string().max(50).optional(),
  appVersion: z.string().max(20).optional(),
});

const leaveCallSchema = z.object({
  reason: z.string().max(200).optional(),
});

const endCallSchema = z.object({
  reason: z.string().max(200).optional(),
});

const inviteParticipantsSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(50),
});

const kickParticipantSchema = z.object({
  targetUserId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

const updateParticipantSchema = z.object({
  isMuted: z.boolean().optional(),
  isVideoOff: z.boolean().optional(),
  isScreenShare: z.boolean().optional(),
});

const transferHostSchema = z.object({
  newHostId: z.string().uuid(),
});

const qualityMetricsSchema = z.object({
  participantId: z.string().uuid(),
  bitrate: z.number(),
  packetLoss: z.number(),
  latency: z.number(),
  jitter: z.number(),
  fps: z.number().optional(),
  resolution: z.object({
    width: z.number(),
    height: z.number(),
  }).optional(),
});

function getPagination(c: any) {
  const page = Number(c.req.query("page")) || 1;
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { page, perPage, offset: (page - 1) * perPage };
}

const callRouter = new Hono();
callRouter.use("*", authMiddleware);

// ============================================================
// CALL MANAGEMENT
// ============================================================

// POST /v1/calls - Create a new call
callRouter.post("/", zValidator("json", createCallSchema), async (c) => {
  const user = getCurrentUser(c);
  const input = c.req.valid("json");

  try {
    const call = await callService.createCall(input, user.id);

    return c.json(
      {
        success: true,
        data: { call },
      },
      201
    );
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error("[CallRoutes] Create call error:", error);
    throw new HTTPException(500, { message: "Failed to create call" });
  }
});

// GET /v1/calls/:id - Get call details
callRouter.get("/:id", async (c) => {
  const user = getCurrentUser(c);
  const callId = c.req.param("id");

  try {
    const call = await callService.getCallById(callId);

    // Verify user is a participant
    const participant = call.participants.find((p) => p.userId === user.id);
    if (!participant) {
      throw new HTTPException(403, { message: "Not a participant in this call" });
    }

    return c.json({
      success: true,
      data: { call },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error("[CallRoutes] Get call error:", error);
    throw new HTTPException(500, { message: "Failed to get call" });
  }
});

// POST /v1/calls/:id/join - Join a call
callRouter.post("/:id/join", zValidator("json", joinCallSchema), async (c) => {
  const user = getCurrentUser(c);
  const callId = c.req.param("id");
  const { deviceType, appVersion } = c.req.valid("json");

  try {
    const call = await callService.joinCall({
      callId,
      userId: user.id,
      deviceType,
      appVersion,
    });

    return c.json({
      success: true,
      data: { call },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error("[CallRoutes] Join call error:", error);
    throw new HTTPException(500, { message: "Failed to join call" });
  }
});

// POST /v1/calls/:id/leave - Leave a call
callRouter.post("/:id/leave", zValidator("json", leaveCallSchema), async (c) => {
  const user = getCurrentUser(c);
  const callId = c.req.param("id");
  const { reason } = c.req.valid("json");

  try {
    await callService.leaveCall({ callId, userId: user.id, reason });

    return c.status(204);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error("[CallRoutes] Leave call error:", error);
    throw new HTTPException(500, { message: "Failed to leave call" });
  }
});

// POST /v1/calls/:id/end - End a call
callRouter.post("/:id/end", zValidator("json", endCallSchema), async (c) => {
  const user = getCurrentUser(c);
  const callId = c.req.param("id");
  const { reason } = c.req.valid("json");

  try {
    await callService.endCall({ callId, userId: user.id, reason });

    return c.status(204);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error("[CallRoutes] End call error:", error);
    throw new HTTPException(500, { message: "Failed to end call" });
  }
});

// POST /v1/calls/:id/invite - Invite participants to a call
callRouter.post("/:id/invite", zValidator("json", inviteParticipantsSchema), async (c) => {
  const user = getCurrentUser(c);
  const callId = c.req.param("id");
  const { participantIds } = c.req.valid("json");

  try {
    await callService.inviteParticipants({ callId, userId: user.id, participantIds });

    return c.status(204);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error("[CallRoutes] Invite participants error:", error);
    throw new HTTPException(500, { message: "Failed to invite participants" });
  }
});

// POST /v1/calls/:id/kick - Kick participant from a call
callRouter.post("/:id/kick", zValidator("json", kickParticipantSchema), async (c) => {
  const user = getCurrentUser(c);
  const callId = c.req.param("id");
  const { targetUserId, reason } = c.req.valid("json");

  try {
    await callService.kickParticipant({ callId, userId: user.id, targetUserId, reason });

    return c.status(204);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error("[CallRoutes] Kick participant error:", error);
    throw new HTTPException(500, { message: "Failed to kick participant" });
  }
});

// POST /v1/calls/:id/participants/:userId - Update participant media state
callRouter.post(
  "/:id/participants/:userId",
  zValidator("json", updateParticipantSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const callId = c.req.param("id");
    const targetUserId = c.req.param("userId");
    const { isMuted, isVideoOff, isScreenShare } = c.req.valid("json");

    try {
      await callService.updateParticipant({
        callId,
        userId: user.id,
        targetUserId,
        isMuted,
        isVideoOff,
        isScreenShare,
      });

      return c.status(204);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("[CallRoutes] Update participant error:", error);
      throw new HTTPException(500, { message: "Failed to update participant" });
    }
  }
);

// POST /v1/calls/:id/host/transfer - Transfer host
callRouter.post("/:id/host/transfer", zValidator("json", transferHostSchema), async (c) => {
  const user = getCurrentUser(c);
  const callId = c.req.param("id");
  const { newHostId } = c.req.valid("json");

  try {
    await callService.transferHost({ callId, userId: user.id, newHostId });

    return c.status(204);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error("[CallRoutes] Transfer host error:", error);
    throw new HTTPException(500, { message: "Failed to transfer host" });
  }
});

// ============================================================
// CALL HISTORY & RECORDINGS
// ============================================================

// GET /v1/calls/history - Get call history for current user
callRouter.get("/history", async (c) => {
  const user = getCurrentUser(c);
  const { page, perPage } = getPagination(c);
  const type = c.req.query("type");
  const status = c.req.query("status");

  try {
    const result = await callService.getCallHistory({
      userId: user.id,
      page,
      perPage,
      type: type as any,
      status: status as any,
    });

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[CallRoutes] Get call history error:", error);
    throw new HTTPException(500, { message: "Failed to get call history" });
  }
});

// GET /v1/calls/:id/recording - Get call recording
callRouter.get("/:id/recording", async (c) => {
  const user = getCurrentUser(c);
  const callId = c.req.param("id");

  try {
    const recording = await callService.getCallRecording(callId, user.id);

    return c.json({
      success: true,
      data: recording,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error("[CallRoutes] Get recording error:", error);
    throw new HTTPException(500, { message: "Failed to get recording" });
  }
});

// ============================================================
// CALL QUALITY METRICS
// ============================================================

// POST /v1/calls/:id/quality - Record call quality metrics
callRouter.post("/:id/quality", zValidator("json", qualityMetricsSchema), async (c) => {
  const user = getCurrentUser(c);
  const callId = c.req.param("id");
  const input = c.req.valid("json");

  try {
    await callService.recordQualityMetrics({
      callId,
      ...input,
    });

    return c.status(204);
  } catch (error) {
    console.error("[CallRoutes] Record quality metrics error:", error);
    throw new HTTPException(500, { message: "Failed to record quality metrics" });
  }
});

// GET /v1/calls/:id/quality - Get call quality metrics
callRouter.get("/:id/quality", async (c) => {
  const user = getCurrentUser(c);
  const callId = c.req.param("id");

  try {
    // Verify user is a participant
    const call = await callService.getCallById(callId);
    const participant = call.participants.find((p) => p.userId === user.id);
    if (!participant) {
      throw new HTTPException(403, { message: "Not a participant in this call" });
    }

    const metrics = await callService.getCallQualityMetrics(callId);

    return c.json({
      success: true,
      data: { metrics },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error("[CallRoutes] Get quality metrics error:", error);
    throw new HTTPException(500, { message: "Failed to get quality metrics" });
  }
});

export { callRouter };