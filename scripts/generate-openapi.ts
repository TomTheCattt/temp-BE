#!/usr/bin/env tsx
/**
 * OpenAPI 3.1 Specification Generator
 *
 * Generates OpenAPI spec from Hono routes using @hono/zod-openapi
 * Run: npm run openapi:generate
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

// Import the actual app to extract routes
// Note: This requires the app to be structured for OpenAPI generation
// For now, we'll create a comprehensive spec manually based on API_ENDPOINTS.md

const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Instagram Clone API",
    version: "1.0.0",
    description: "Backend API for Instagram Clone iOS app - Neon Functions + PostgreSQL + Better Auth",
    contact: {
      name: "API Support",
      email: "api@instagram-clone.app",
    },
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
  },
  servers: [
    {
      url: "https://api.instagram-clone.app",
      description: "Production server",
    },
    {
      url: "https://staging-api.compute.us-east-2.aws.neon.tech",
      description: "Staging server",
    },
    {
      url: "http://localhost:3000",
      description: "Local development server",
    },
  ],
  tags: [
    { name: "Health", description: "Health check and monitoring endpoints" },
    { name: "Authentication", description: "User authentication and authorization" },
    { name: "Users", description: "User profiles and social graph" },
    { name: "Posts", description: "Posts, feed, and engagement" },
    { name: "Reels", description: "Short-form video content" },
    { name: "Stories", description: "Ephemeral story content" },
    { name: "Conversations", description: "Direct messaging conversations" },
    { name: "Messages", description: "Individual messages within conversations" },
    { name: "Notifications", description: "User notifications and activity" },
    { name: "Upload", description: "Media upload endpoints (TUS, multipart, presigned)" },
    { name: "Search", description: "Unified search across content types" },
    { name: "Reports", description: "Content reporting and moderation" },
    { name: "WebSocket", description: "Real-time WebSocket connections" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT access token from Better Auth",
      },
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "API key for server-to-server communication",
      },
    },
    schemas: {
      // Common schemas
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string", example: "ERROR_CODE" },
          message: { type: "string", example: "Human readable error message" },
          requestId: { type: "string", format: "uuid" },
        },
        required: ["success", "error", "message"],
      },
      Success: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: { type: "object" },
        },
        required: ["success"],
      },
      Pagination: {
        type: "object",
        properties: {
          cursor: { type: "string", description: "Base64 encoded cursor for next page" },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
      },
      PaginatedResponse: {
        allOf: [
          { $ref: "#/components/schemas/Success" },
          {
            type: "object",
            properties: {
              data: {
                type: "object",
                properties: {
                  items: { type: "array", items: { type: "object" } },
                  nextCursor: { type: "string", nullable: true },
                  hasMore: { type: "boolean" },
                },
              },
            },
          },
        ],
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          username: { type: "string", pattern: "^[a-zA-Z0-9_.]{3,30}$" },
          displayName: { type: "string", maxLength: 100 },
          bio: { type: "string", maxLength: 150, nullable: true },
          avatarUrl: { type: "string", format: "uri", nullable: true },
          bannerUrl: { type: "string", format: "uri", nullable: true },
          website: { type: "string", format: "uri", nullable: true },
          isVerified: { type: "boolean" },
          isPrivate: { type: "boolean" },
          followersCount: { type: "integer" },
          followingCount: { type: "integer" },
          postsCount: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "email", "username", "displayName", "isVerified", "isPrivate", "followersCount", "followingCount", "postsCount", "createdAt", "updatedAt"],
      },
      UserProfile: {
        allOf: [
          { $ref: "#/components/schemas/User" },
          {
            type: "object",
            properties: {
              isFollowing: { type: "boolean" },
              isFollowedBy: { type: "boolean" },
              isBlocked: { type: "boolean" },
              isRestricted: { type: "boolean" },
            },
          },
        ],
      },
      Media: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["image", "video", "carousel"] },
          url: { type: "string", format: "uri" },
          thumbnailUrl: { type: "string", format: "uri" },
          width: { type: "integer" },
          height: { type: "integer" },
          duration: { type: "number", nullable: true, description: "Duration in seconds for videos" },
        },
        required: ["id", "type", "url", "thumbnailUrl", "width", "height"],
      },
      Location: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          latitude: { type: "number", format: "double" },
          longitude: { type: "number", format: "double" },
          address: { type: "string", nullable: true },
        },
        required: ["id", "name", "latitude", "longitude"],
      },
      // Auth schemas
      RegisterRequest: {
        type: "object",
        required: ["email", "password", "username"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8, maxLength: 128 },
          username: { type: "string", pattern: "^[a-zA-Z0-9_.]{3,30}$" },
          displayName: { type: "string", maxLength: 100 },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      RefreshRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string" },
        },
      },
      LogoutRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string" },
        },
      },
      AuthResponse: {
        type: "object",
        properties: {
          user: { $ref: "#/components/schemas/User" },
          accessToken: { type: "string", description: "JWT access token" },
          refreshToken: { type: "string", description: "JWT refresh token" },
          expiresIn: { type: "integer", description: "Access token lifetime in seconds" },
          tokenType: { type: "string", enum: ["Bearer"] },
        },
        required: ["user", "accessToken", "refreshToken", "expiresIn", "tokenType"],
      },
      // Post schemas
      CreatePostRequest: {
        type: "object",
        required: ["mediaIds"],
        properties: {
          caption: { type: "string", maxLength: 2200 },
          mediaIds: { type: "array", items: { type: "string", format: "uuid" }, minItems: 1, maxItems: 10 },
          locationId: { type: "string", format: "uuid", nullable: true },
          audience: { type: "string", enum: ["public", "followers", "close_friends"], default: "followers" },
          allowComments: { type: "boolean", default: true },
          allowLikes: { type: "boolean", default: true },
        },
      },
      Post: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          caption: { type: "string", nullable: true },
          user: { $ref: "#/components/schemas/User" },
          media: { type: "array", items: { $ref: "#/components/schemas/Media" } },
          location: { $ref: "#/components/schemas/Location", nullable: true },
          likesCount: { type: "integer" },
          commentsCount: { type: "integer" },
          savesCount: { type: "integer" },
          isLiked: { type: "boolean" },
          isSaved: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "user", "media", "likesCount", "commentsCount", "savesCount", "isLiked", "isSaved", "createdAt", "updatedAt"],
      },
      // Reel schemas
      CreateReelRequest: {
        type: "object",
        required: ["videoId"],
        properties: {
          videoId: { type: "string", format: "uuid" },
          caption: { type: "string", maxLength: 2200 },
          audioId: { type: "string", format: "uuid", nullable: true },
          coverTimestamp: { type: "number", format: "double", minimum: 0 },
          audience: { type: "string", enum: ["public", "followers", "close_friends"], default: "public" },
          allowComments: { type: "boolean", default: true },
          allowRemix: { type: "boolean", default: true },
        },
      },
      Reel: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          caption: { type: "string", nullable: true },
          user: { $ref: "#/components/schemas/User" },
          video: { $ref: "#/components/schemas/Media" },
          audio: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              title: { type: "string" },
              artist: { type: "string" },
              url: { type: "string", format: "uri" },
              duration: { type: "number", format: "double" },
            },
            nullable: true,
          },
          likesCount: { type: "integer" },
          commentsCount: { type: "integer" },
          sharesCount: { type: "integer" },
          isLiked: { type: "boolean" },
          isSaved: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "user", "video", "likesCount", "commentsCount", "sharesCount", "isLiked", "isSaved", "createdAt"],
      },
      // Story schemas
      CreateStoryRequest: {
        type: "object",
        required: ["mediaId", "type"],
        properties: {
          mediaId: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["image", "video"] },
          audience: { type: "string", enum: ["followers", "close_friends"], default: "followers" },
          stickers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["mention", "hashtag", "location", "poll", "question", "music", "link"] },
                userId: { type: "string", format: "uuid", nullable: true },
                hashtag: { type: "string", nullable: true },
                locationId: { type: "string", format: "uuid", nullable: true },
                pollOptions: { type: "array", items: { type: "string" }, nullable: true },
                question: { type: "string", nullable: true },
                musicId: { type: "string", format: "uuid", nullable: true },
                linkUrl: { type: "string", format: "uri", nullable: true },
                x: { type: "number", format: "double", minimum: 0, maximum: 1 },
                y: { type: "number", format: "double", minimum: 0, maximum: 1 },
              },
            },
          },
        },
      },
      StoryItem: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["image", "video"] },
          mediaUrl: { type: "string", format: "uri" },
          duration: { type: "number", format: "double" },
          isViewed: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" },
        },
        required: ["id", "type", "mediaUrl", "duration", "isViewed", "createdAt", "expiresAt"],
      },
      StoryUser: {
        type: "object",
        properties: {
          userId: { type: "string", format: "uuid" },
          username: { type: "string" },
          displayName: { type: "string" },
          avatarUrl: { type: "string", format: "uri" },
          isVerified: { type: "boolean" },
          items: { type: "array", items: { $ref: "#/components/schemas/StoryItem" } },
          hasUnviewed: { type: "boolean" },
        },
        required: ["userId", "username", "displayName", "avatarUrl", "isVerified", "items", "hasUnviewed"],
      },
      // Conversation schemas
      CreateConversationRequest: {
        type: "object",
        required: ["participantIds"],
        properties: {
          participantIds: { type: "array", items: { type: "string", format: "uuid" }, minItems: 1, maxItems: 31 },
          type: { type: "string", enum: ["direct", "group"], default: "direct" },
          name: { type: "string", maxLength: 100, nullable: true },
        },
      },
      Conversation: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["direct", "group"] },
          name: { type: "string", nullable: true },
          avatarUrl: { type: "string", format: "uri", nullable: true },
          participants: { type: "array", items: { $ref: "#/components/schemas/User" } },
          lastMessage: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              type: { type: "string", enum: ["text", "image", "video", "audio", "file", "share", "location", "voice", "reply", "system"] },
              content: { type: "string" },
              senderId: { type: "string", format: "uuid" },
              createdAt: { type: "string", format: "date-time" },
            },
            nullable: true,
          },
          unreadCount: { type: "integer" },
          isMuted: { type: "boolean" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "type", "participants", "unreadCount", "isMuted", "updatedAt"],
      },
      // Message schemas
      SendMessageRequest: {
        type: "object",
        required: ["type", "content"],
        properties: {
          type: { type: "string", enum: ["text", "image", "video", "audio", "file", "share", "location", "voice", "reply"] },
          content: { type: "string" },
          replyToId: { type: "string", format: "uuid", nullable: true },
          mediaIds: { type: "array", items: { type: "string", format: "uuid" }, nullable: true },
          location: { $ref: "#/components/schemas/Location", nullable: true },
          share: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["post", "reel", "profile", "hashtag", "location"] },
              id: { type: "string", format: "uuid" },
            },
            nullable: true,
          },
        },
      },
      Message: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["text", "image", "video", "audio", "file", "share", "location", "voice", "reply", "system"] },
          content: { type: "string" },
          senderId: { type: "string", format: "uuid" },
          conversationId: { type: "string", format: "uuid" },
          replyToId: { type: "string", format: "uuid", nullable: true },
          isEdited: { type: "boolean" },
          isDeleted: { type: "boolean" },
          reactions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                emoji: { type: "string" },
                count: { type: "integer" },
                userIds: { type: "array", items: { type: "string", format: "uuid" } },
              },
            },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "type", "content", "senderId", "conversationId", "isEdited", "isDeleted", "reactions", "createdAt", "updatedAt"],
      },
      // Notification schemas
      Notification: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["like", "comment", "follow", "mention", "tag", "story_reply", "dm", "live", "reel_like", "reel_comment", "post_save"] },
          groupKey: { type: "string" },
          groupCount: { type: "integer" },
          actor: { $ref: "#/components/schemas/User" },
          target: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["post", "reel", "story", "comment", "user", "conversation"] },
              id: { type: "string", format: "uuid" },
              preview: { type: "string" },
            },
          },
          isRead: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "type", "groupKey", "groupCount", "actor", "target", "isRead", "createdAt"],
      },
      // Upload schemas
      PresignedUploadRequest: {
        type: "object",
        required: ["filename", "contentType"],
        properties: {
          filename: { type: "string" },
          contentType: { type: "string" },
          bucket: { type: "string", enum: ["uploads", "public"], default: "uploads" },
        },
      },
      PresignedUploadResponse: {
        type: "object",
        properties: {
          uploadUrl: { type: "string", format: "uri" },
          fields: {
            type: "object",
            properties: {
              key: { type: "string" },
              policy: { type: "string" },
              "x-amz-algorithm": { type: "string" },
              "x-amz-credential": { type: "string" },
              "x-amz-date": { type: "string" },
              "x-amz-signature": { type: "string" },
            },
          },
          fileUrl: { type: "string", format: "uri" },
          expiresIn: { type: "integer" },
        },
        required: ["uploadUrl", "fields", "fileUrl", "expiresIn"],
      },
      // Search schemas
      SearchResponse: {
        type: "object",
        properties: {
          users: { type: "array", items: { $ref: "#/components/schemas/User" } },
          posts: { type: "array", items: { $ref: "#/components/schemas/Post" } },
          reels: { type: "array", items: { $ref: "#/components/schemas/Reel" } },
          hashtags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tag: { type: "string" },
                postsCount: { type: "integer" },
              },
            },
          },
          locations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
                city: { type: "string" },
                country: { type: "string" },
              },
            },
          },
        },
      },
      // Report schemas
      CreateReportRequest: {
        type: "object",
        required: ["targetType", "targetId", "reason"],
        properties: {
          targetType: { type: "string", enum: ["post", "reel", "story", "comment", "user", "message", "conversation"] },
          targetId: { type: "string", format: "uuid" },
          reason: { type: "string", enum: ["spam", "hate_speech", "harassment", "violence", "nudity", "illegal", "self_harm", "misinformation", "impersonation", "other"] },
          description: { type: "string", maxLength: 500, nullable: true },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        description: "Returns the health status of the API",
        operationId: "getHealth",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        status: { type: "string", enum: ["ok"] },
                        timestamp: { type: "string", format: "date-time" },
                        service: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/metrics": {
      get: {
        tags: ["Health"],
        summary: "Prometheus metrics",
        description: "Returns Prometheus-formatted metrics for monitoring",
        operationId: "getMetrics",
        responses: {
          "200": {
            description: "Metrics in Prometheus format",
            content: {
              "text/plain": {
                schema: { type: "string" },
              },
            },
          },
        },
      },
    },
    "/v1/auth/register": {
      post: {
        tags: ["Authentication"],
        summary: "Register new user",
        description: "Creates a new user account with email/password",
        operationId: "registerUser",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RegisterRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "User registered successfully",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/AuthResponse" } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "409": { $ref: "#/components/responses/Conflict" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/v1/auth/login": {
      post: {
        tags: ["Authentication"],
        summary: "Login user",
        description: "Authenticates user and returns access/refresh tokens",
        operationId: "loginUser",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Login successful",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/AuthResponse" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/v1/auth/refresh": {
      post: {
        tags: ["Authentication"],
        summary: "Refresh access token",
        description: "Rotates access token using refresh token with reuse detection",
        operationId: "refreshToken",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefreshRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Token refreshed successfully",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/AuthResponse" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/auth/logout": {
      post: {
        tags: ["Authentication"],
        summary: "Logout user",
        description: "Revokes refresh token and ends session",
        operationId: "logoutUser",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LogoutRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Logged out successfully",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { message: { type: "string" } } } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/user/me": {
      get: {
        tags: ["Users"],
        summary: "Get current user profile",
        description: "Returns the authenticated user's full profile",
        operationId: "getCurrentUser",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "User profile",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { user: { $ref: "#/components/schemas/UserProfile" } } } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      patch: {
        tags: ["Users"],
        summary: "Update current user profile",
        description: "Updates the authenticated user's profile information",
        operationId: "updateCurrentUser",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  displayName: { type: "string", maxLength: 100 },
                  bio: { type: "string", maxLength: 150 },
                  website: { type: "string", format: "uri" },
                  avatarId: { type: "string", format: "uuid" },
                  bannerId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Profile updated",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { user: { $ref: "#/components/schemas/User" } } } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/users/{username}": {
      get: {
        tags: ["Users"],
        summary: "Get user by username",
        description: "Returns public profile of a user by username",
        operationId: "getUserByUsername",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "username", in: "path", required: true, schema: { type: "string", pattern: "^[a-zA-Z0-9_.]{3,30}$" } },
        ],
        responses: {
          "200": {
            description: "User profile",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { user: { $ref: "#/components/schemas/UserProfile" } } } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/posts": {
      post: {
        tags: ["Posts"],
        summary: "Create post",
        description: "Creates a new post with media",
        operationId: "createPost",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreatePostRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Post created",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { post: { $ref: "#/components/schemas/Post" } } } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "413": { $ref: "#/components/responses/PayloadTooLarge" },
        },
      },
    },
    "/v1/posts/{id}": {
      get: {
        tags: ["Posts"],
        summary: "Get post by ID",
        description: "Returns a single post with media and comments preview",
        operationId: "getPost",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Post found",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { post: { $ref: "#/components/schemas/Post" } } } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Posts"],
        summary: "Update post",
        description: "Updates post caption, location, or audience",
        operationId: "updatePost",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  caption: { type: "string", maxLength: 2200 },
                  locationId: { type: "string", format: "uuid", nullable: true },
                  audience: { type: "string", enum: ["public", "followers", "close_friends"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Post updated",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { post: { $ref: "#/components/schemas/Post" } } } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Posts"],
        summary: "Delete post",
        description: "Soft deletes a post",
        operationId: "deletePost",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Post deleted",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { message: { type: "string" } } } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/posts/feed": {
      get: {
        tags: ["Posts"],
        summary: "Get home feed",
        description: "Returns paginated feed of posts from followed users",
        operationId: "getFeed",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          "200": {
            description: "Feed posts",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/PaginatedResponse" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/posts/{id}/like": {
      post: {
        tags: ["Posts"],
        summary: "Like post",
        description: "Likes a post",
        operationId: "likePost",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Post liked",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { isLiked: { type: "boolean" }, likesCount: { type: "integer" } } } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Posts"],
        summary: "Unlike post",
        description: "Removes like from a post",
        operationId: "unlikePost",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Post unliked",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { isLiked: { type: "boolean" }, likesCount: { type: "integer" } } } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/reels": {
      post: {
        tags: ["Reels"],
        summary: "Create reel",
        description: "Creates a new reel with video",
        operationId: "createReel",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateReelRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Reel created",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { reel: { $ref: "#/components/schemas/Reel" } } } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/reels/feed": {
      get: {
        tags: ["Reels"],
        summary: "Get reels feed",
        description: "Returns paginated personalized reels feed",
        operationId: "getReelsFeed",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 20, default: 10 } },
        ],
        responses: {
          "200": {
            description: "Reels feed",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/PaginatedResponse" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/stories": {
      post: {
        tags: ["Stories"],
        summary: "Create story",
        description: "Creates a new story",
        operationId: "createStory",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateStoryRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Story created",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { story: { type: "object", properties: { id: { type: "string", format: "uuid" }, userId: { type: "string", format: "uuid" }, items: { type: "array", items: { $ref: "#/components/schemas/StoryItem" } }, audience: { type: "string" }, createdAt: { type: "string", format: "date-time" } } } } } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/stories/feed": {
      get: {
        tags: ["Stories"],
        summary: "Get stories tray",
        description: "Returns stories from followed users and self",
        operationId: "getStoriesFeed",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Stories tray",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { stories: { type: "array", items: { $ref: "#/components/schemas/StoryUser" } } } } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/conversations": {
      get: {
        tags: ["Conversations"],
        summary: "Get conversations",
        description: "Returns paginated list of user's conversations",
        operationId: "getConversations",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          "200": {
            description: "Conversations list",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/PaginatedResponse" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Conversations"],
        summary: "Create conversation",
        description: "Creates a new 1:1 or group conversation",
        operationId: "createConversation",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateConversationRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Conversation created",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { conversation: { $ref: "#/components/schemas/Conversation" } } } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/conversations/{id}/messages": {
      get: {
        tags: ["Messages"],
        summary: "Get messages",
        description: "Returns paginated messages for a conversation",
        operationId: "getMessages",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
        ],
        responses: {
          "200": {
            description: "Messages list",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/PaginatedResponse" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      post: {
        tags: ["Messages"],
        summary: "Send message",
        description: "Sends a new message to a conversation",
        operationId: "sendMessage",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SendMessageRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Message sent",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { message: { $ref: "#/components/schemas/Message" } } } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/notifications": {
      get: {
        tags: ["Notifications"],
        summary: "Get notifications",
        description: "Returns grouped paginated notifications",
        operationId: "getNotifications",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          "200": {
            description: "Notifications",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/PaginatedResponse" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/notifications/{id}/read": {
      patch: {
        tags: ["Notifications"],
        summary: "Mark notification as read",
        description: "Marks a notification as read",
        operationId: "markNotificationRead",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Notification marked as read",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { notification: { type: "object", properties: { id: { type: "string", format: "uuid" }, isRead: { type: "boolean" } } } } } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/upload/presigned": {
      post: {
        tags: ["Upload"],
        summary: "Get presigned upload URL",
        description: "Returns a presigned URL for direct S3 upload",
        operationId: "getPresignedUrl",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PresignedUploadRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Presigned URL generated",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/PresignedUploadResponse" } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/search": {
      get: {
        tags: ["Search"],
        summary: "Unified search",
        description: "Searches across users, posts, reels, hashtags, and locations",
        operationId: "search",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string", minLength: 1, maxLength: 100 } },
          { name: "type", in: "query", schema: { type: "string", enum: ["all", "users", "posts", "reels", "hashtags", "locations", "audio"], default: "all" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          "200": {
            description: "Search results",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/SearchResponse" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/reports": {
      post: {
        tags: ["Reports"],
        summary: "Create report",
        description: "Reports content for moderation review",
        operationId: "createReport",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateReportRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Report created",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Success" },
                    { type: "object", properties: { data: { type: "object", properties: { reportId: { type: "string", format: "uuid" } } } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
  },
  responses: {
    BadRequest: {
      description: "Bad request - validation error",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
          example: {
            success: false,
            error: "VALIDATION_ERROR",
            message: "Invalid request payload",
            requestId: "abc123",
          },
        },
      },
    },
    Unauthorized: {
      description: "Unauthorized - invalid or missing authentication",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
          example: {
            success: false,
            error: "UNAUTHORIZED",
            message: "Invalid or expired token",
            requestId: "abc123",
          },
        },
      },
    },
    Forbidden: {
      description: "Forbidden - insufficient permissions",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
          example: {
            success: false,
            error: "FORBIDDEN",
            message: "You don't have permission to perform this action",
            requestId: "abc123",
          },
        },
      },
    },
    NotFound: {
      description: "Not found - resource doesn't exist",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
          example: {
            success: false,
            error: "NOT_FOUND",
            message: "Resource not found",
            requestId: "abc123",
          },
        },
      },
    },
    Conflict: {
      description: "Conflict - resource already exists",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
          example: {
            success: false,
            error: "CONFLICT",
            message: "Username already taken",
            requestId: "abc123",
          },
        },
      },
    },
    RateLimited: {
      description: "Too many requests",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
          example: {
            success: false,
            error: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests, please slow down",
            requestId: "abc123",
          },
        },
      },
    },
    PayloadTooLarge: {
      description: "Payload too large",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
          example: {
            success: false,
            error: "PAYLOAD_TOO_LARGE",
            message: "Request body exceeds maximum size",
            requestId: "abc123",
          },
        },
      },
    },
    InternalError: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
          example: {
            success: false,
            error: "INTERNAL_ERROR",
            message: "An unexpected error occurred",
            requestId: "abc123",
          },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
};

// Write the OpenAPI spec
const outputPath = resolve(__dirname, "../openapi.json");
writeFileSync(outputPath, JSON.stringify(openApiSpec, null, 2));
console.log(`✅ OpenAPI spec generated at ${outputPath}`);

// Also generate YAML version
import { writeFileSync as writeFileSyncYaml } from "fs";
import * as yaml from "js-yaml";
try {
  const yamlOutput = yaml.dump(openApiSpec);
  writeFileSyncYaml(resolve(__dirname, "../openapi.yaml"), yamlOutput);
  console.log("✅ OpenAPI spec (YAML) generated at openapi.yaml");
} catch (e) {
  console.log("Note: js-yaml not installed, skipping YAML output");
}