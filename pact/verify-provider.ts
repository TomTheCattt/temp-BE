#!/usr/bin/env tsx
/**
 * Enhanced Pact Provider Verification Script
 *
 * This script verifies provider against consumer contracts from Pact Broker
 * with full database state management for each test state.
 *
 * Run: npm run test:contract
 * Or with specific URL: STAGING_API_URL=https://staging-api.example.com npm run test:contract:staging
 */

import { Verifier, VerifierOptions } from "@pact-foundation/pact";
import * as path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { SignJWT } from "jose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACT_BROKER_URL = process.env.PACT_BROKER_URL || "http://localhost:9292";
const PACT_BROKER_USERNAME = process.env.PACT_BROKER_USERNAME;
const PACT_BROKER_PASSWORD = process.env.PACT_BROKER_PASSWORD;
const PROVIDER_BASE_URL = process.env.STAGING_API_URL || process.env.PRODUCTION_API_URL || "http://localhost:3000";
const PROVIDER_VERSION = process.env.GITHUB_SHA || "local";
const PROVIDER_BRANCH = process.env.GITHUB_REF_NAME || "local";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/instagram_test";

// Test constants
const TEST_USER_EMAIL = "pact-test@example.com";
const TEST_USER_PASSWORD = "TestPass123!";
const TEST_USERNAME = "pacttestuser";
const TEST_DISPLAY_NAME = "Pact Test User";
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || "test-secret-for-pact";

// Prisma client for state setup
const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
  log: process.env.DEBUG ? ["query", "error", "warn"] : ["error"],
});

interface TestUser {
  id: string;
  email: string;
  username: string;
  accessToken: string;
  refreshToken: string;
}

interface TestPost {
  id: string;
  userId: string;
  caption: string;
}

interface TestConversation {
  id: string;
  participants: string[];
}

interface TestMedia {
  id: string;
  userId: string;
  url: string;
  type: string;
}

let testUser: TestUser | null = null;
let testPost: TestPost | null = null;
let testMedia: TestMedia | null = null;
let testConversation: TestConversation | null = null;
let otherUserId: string | null = null;

async function generateTokens(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
  const secret = new TextEncoder().encode(BETTER_AUTH_SECRET);
  const accessToken = await new SignJWT({
    sub: userId,
    email: TEST_USER_EMAIL,
    username: TEST_USERNAME,
    device_id: "pact-test-device",
    scope: "read write dm upload",
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .setIssuer("https://auth.instagram-clone.com")
    .setAudience("instagram-clone-api")
    .sign(secret);

  const refreshToken = await new SignJWT({
    sub: userId,
    type: "refresh",
    device_id: "pact-test-device",
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .setIssuer("https://auth.instagram-clone.com")
    .setAudience("instagram-clone-api")
    .sign(secret);

  return { accessToken, refreshToken };
}

async function cleanupDatabase() {
  console.log("🧹 Cleaning up test database...");
  // Clean up in reverse dependency order
  await prisma.messageReaction.deleteMany({ where: { message: { conversation: { participants: { some: { user: { email: TEST_USER_EMAIL } } } } } } });
  await prisma.message.deleteMany({ where: { conversation: { participants: { some: { user: { email: TEST_USER_EMAIL } } } } } });
  await prisma.conversationParticipant.deleteMany({ where: { user: { email: TEST_USER_EMAIL } } });
  await prisma.conversation.deleteMany({ where: { participants: { some: { user: { email: TEST_USER_EMAIL } } } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: [testUser?.id, otherUserId].filter(Boolean) as string[] } } });
  await prisma.storyItem.deleteMany({ where: { story: { userId: testUser?.id } } });
  await prisma.story.deleteMany({ where: { userId: testUser?.id } });
  await prisma.reel.deleteMany({ where: { userId: testUser?.id } });
  await prisma.postMedia.deleteMany({ where: { post: { userId: testUser?.id } } });
  await prisma.post.deleteMany({ where: { userId: testUser?.id } });
  await prisma.media.deleteMany({ where: { userId: testUser?.id } });
  await prisma.follow.deleteMany({ where: { OR: [{ followerId: testUser?.id }, { followingId: testUser?.id }] } });
  await prisma.session.deleteMany({ where: { userId: testUser?.id } });
  await prisma.account.deleteMany({ where: { userId: testUser?.id } });
  await prisma.user.deleteMany({ where: { email: TEST_USER_EMAIL } });
  await prisma.user.deleteMany({ where: { email: "other@example.com" } });
  console.log("✅ Database cleaned");
}

async function setupTestUser(): Promise<TestUser> {
  console.log("👤 Setting up test user...");

  // Create other user for interactions
  const otherUser = await prisma.user.create({
    data: {
      email: "other@example.com",
      username: "otheruser",
      displayName: "Other User",
      passwordHash: await bcrypt.hash("OtherPass123!", 12),
      isVerified: true,
      isPrivate: false,
    },
  });
  otherUserId = otherUser.id;

  // Create main test user
  const user = await prisma.user.create({
    data: {
      email: TEST_USER_EMAIL,
      username: TEST_USERNAME,
      displayName: TEST_DISPLAY_NAME,
      passwordHash: await bcrypt.hash(TEST_USER_PASSWORD, 12),
      isVerified: true,
      isPrivate: false,
      bio: "Test bio",
      website: "https://example.com",
    },
  });

  const tokens = await generateTokens(user.id);

  // Create session
  await prisma.session.create({
    data: {
      userId: user.id,
      token: tokens.accessToken,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      deviceId: "pact-test-device",
      ipAddress: "127.0.0.1",
      userAgent: "Pact Test Agent",
    },
  });

  testUser = {
    id: user.id,
    email: user.email,
    username: user.username,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };

  console.log(`✅ Test user created: ${user.id}`);
  return testUser;
}

async function setupTestMedia(): Promise<TestMedia> {
  if (!testUser) throw new Error("Test user not set up");

  console.log("📸 Setting up test media...");

  const media = await prisma.media.create({
    data: {
      userId: testUser.id,
      type: "image",
      url: "https://storage.example.com/media/test-image.jpg",
      thumbnailUrl: "https://storage.example.com/media/thumb_test-image.jpg",
      width: 1080,
      height: 1080,
      duration: null,
      mimeType: "image/jpeg",
      fileSize: 102400,
      status: "ready",
      processingStatus: "completed",
    },
  });

  testMedia = {
    id: media.id,
    userId: media.userId,
    url: media.url,
    type: media.type,
  };

  console.log(`✅ Test media created: ${media.id}`);
  return testMedia;
}

async function setupTestPost(): Promise<TestPost> {
  if (!testUser || !testMedia) throw new Error("Dependencies not set up");

  console.log("📝 Setting up test post...");

  const post = await prisma.post.create({
    data: {
      userId: testUser.id,
      caption: "Test post caption #hashtag",
      audience: "followers",
      allowComments: true,
      allowLikes: true,
      media: {
        create: {
          mediaId: testMedia.id,
          order: 0,
        },
      },
      location: {
        create: {
          name: "San Francisco, CA",
          latitude: 37.7749,
          longitude: -122.4194,
        },
      },
    },
  });

  testPost = {
    id: post.id,
    userId: post.userId,
    caption: post.caption,
  };

  console.log(`✅ Test post created: ${post.id}`);
  return testPost;
}

async function setupTestConversation(): Promise<TestConversation> {
  if (!testUser || !otherUserId) throw new Error("Dependencies not set up");

  console.log("💬 Setting up test conversation...");

  const conversation = await prisma.conversation.create({
    data: {
      type: "direct",
      participants: {
        create: [
          { userId: testUser.id },
          { userId: otherUserId },
        ],
      },
      messages: {
        create: {
          senderId: otherUserId,
          type: "text",
          content: "Hey! How are you?",
        },
      },
    },
  });

  testConversation = {
    id: conversation.id,
    participants: [testUser.id, otherUserId],
  };

  console.log(`✅ Test conversation created: ${conversation.id}`);
  return testConversation;
}

async function setupTestReel() {
  if (!testUser || !testMedia) return;

  console.log("🎬 Setting up test reel...");

  await prisma.reel.create({
    data: {
      userId: testUser.id,
      caption: "Amazing reel! 🎬",
      audience: "public",
      allowComments: true,
      allowRemix: true,
      videoId: testMedia.id,
      coverTimestamp: 5.0,
    },
  });
  console.log("✅ Test reel created");
}

async function setupTestStory() {
  if (!testUser || !testMedia) return;

  console.log("📖 Setting up test story...");

  await prisma.story.create({
    data: {
      userId: testUser.id,
      audience: "followers",
      items: {
        create: {
          mediaId: testMedia.id,
          type: "image",
          duration: 5,
        },
      },
    },
  });
  console.log("✅ Test story created");
}

async function setupTestNotification() {
  if (!testUser || !otherUserId || !testPost) return;

  console.log("🔔 Setting up test notification...");

  await prisma.notification.create({
    data: {
      recipientId: testUser.id,
      actorId: otherUserId,
      type: "like",
      groupKey: `like:post:${testPost.id}`,
      groupCount: 5,
      targetType: "post",
      targetId: testPost.id,
      targetPreview: "Test post caption...",
      isRead: false,
    },
  });
  console.log("✅ Test notification created");
}

async function setupFollowRelationship() {
  if (!testUser || !otherUserId) return;

  console.log("👥 Setting up follow relationship...");

  await prisma.follow.create({
    data: {
      followerId: testUser.id,
      followingId: otherUserId,
      status: "accepted",
    },
  });
  console.log("✅ Follow relationship created");
}

async function initializeTestData() {
  console.log("🚀 Initializing test data for Pact verification...");

  await cleanupDatabase();
  await setupTestUser();
  await setupTestMedia();
  await setupTestPost();
  await setupTestConversation();
  await setupTestReel();
  await setupTestStory();
  await setupTestNotification();
  await setupFollowRelationship();

  console.log("✅ All test data initialized");
  return {
    user: testUser,
    post: testPost,
    media: testMedia,
    conversation: testConversation,
    otherUserId,
  };
}

async function verifyProvider() {
  console.log("🔍 Verifying provider against Pact contracts...");
  console.log(`Provider URL: ${PROVIDER_BASE_URL}`);
  console.log(`Broker: ${PACT_BROKER_URL}`);
  console.log(`Provider: instagram-backend`);
  console.log(`Version: ${PROVIDER_VERSION}`);
  console.log(`Branch: ${PROVIDER_BRANCH}`);

  // Initialize test data before verification
  await initializeTestData();

  const stateHandlers: VerifierOptions["stateHandlers"] = {
    "API is healthy": async () => {
      // No setup needed
    },
    "metrics are available": async () => {
      // No setup needed
    },
    "a registered user exists": async () => {
      if (!testUser) await initializeTestData();
    },
    "a valid registration request": async () => {
      // No setup needed - request is valid
      // Ensure user doesn't exist
      await prisma.user.deleteMany({ where: { email: "newuser@example.com" } });
    },
    "a valid refresh token exists": async () => {
      if (!testUser) await initializeTestData();
      // Refresh token is in testUser.refreshToken
    },
    "an authenticated user session exists": async () => {
      if (!testUser) await initializeTestData();
      // Session already created in setupTestUser
    },
    "an authenticated user exists": async () => {
      if (!testUser) await initializeTestData();
    },
    "a public user profile exists": async () => {
      if (!testUser) await initializeTestData();
    },
    "an authenticated user with media exists": async () => {
      if (!testUser || !testMedia) await initializeTestData();
    },
    "a post exists": async () => {
      if (!testPost) await initializeTestData();
    },
    "feed items exist for user": async () => {
      if (!testUser || !testPost) await initializeTestData();
      // Create additional posts for feed
      await setupFollowRelationship();
    },
    "a post exists and user is authenticated": async () => {
      if (!testPost || !testUser) await initializeTestData();
    },
    "a liked post exists": async () => {
      if (!testPost || !testUser) await initializeTestData();
      await prisma.postLike.upsert({
        where: { postId_userId: { postId: testPost.id, userId: testUser.id } },
        create: { postId: testPost.id, userId: testUser.id },
        update: {},
      });
    },
    "reels exist for feed": async () => {
      if (!testUser) await initializeTestData();
      await setupTestReel();
    },
    "an authenticated user with video exists": async () => {
      if (!testUser || !testMedia) await initializeTestData();
    },
    "stories exist for user": async () => {
      if (!testUser) await initializeTestData();
      await setupTestStory();
    },
    "user has conversations": async () => {
      if (!testConversation) await initializeTestData();
    },
    "authenticated user wants to start conversation": async () => {
      if (!testUser || !otherUserId) await initializeTestData();
    },
    "conversation with messages exists": async () => {
      if (!testConversation) await initializeTestData();
    },
    "authenticated user in conversation": async () => {
      if (!testConversation || !testUser) await initializeTestData();
    },
    "user has notifications": async () => {
      if (!testUser) await initializeTestData();
      await setupTestNotification();
    },
    "unread notification exists": async () => {
      if (!testUser) await initializeTestData();
      await setupTestNotification();
    },
    "authenticated user requesting upload": async () => {
      if (!testUser) await initializeTestData();
    },
    "TUS upload initiated": async () => {
      if (!testUser) await initializeTestData();
    },
    "search index has data": async () => {
      if (!testUser || !testPost) await initializeTestData();
    },
    "valid auth token provided": async () => {
      if (!testUser) await initializeTestData();
    },
  };

  const verifier = new Verifier({
    provider: "instagram-backend",
    providerBaseUrl: PROVIDER_BASE_URL,
    pactBrokerUrl: PACT_BROKER_URL,
    pactBrokerUsername: PACT_BROKER_USERNAME,
    pactBrokerPassword: PACT_BROKER_PASSWORD,
    publishVerificationResults: true,
    providerVersion: PROVIDER_VERSION,
    providerVersionTags: [PROVIDER_BRANCH, "latest"],
    enablePending: true,
    includeWipPactsSince: "2024-01-01",
    stateHandlers,
    // Custom request filter to add auth headers
    requestFilter: (req, res, next) => {
      // Add test headers for debugging
      req.headers["x-pact-verification"] = "true";
      next();
    },
  });

  try {
    console.log("\n📋 Starting provider verification...");
    const result = await verifier.verifyProvider();
    console.log("\n✅ Provider verification passed!");
    console.log(result);
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Provider verification failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Received SIGINT, cleaning up...");
  await prisma.$disconnect();
  process.exit(1);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, cleaning up...");
  await prisma.$disconnect();
  process.exit(1);
});

verifyProvider();