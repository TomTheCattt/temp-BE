/*
  Warnings:

  - The values [POST,STORY,REEL,LIKE] on the enum `MessageContentType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `post_id` on the `comments` table. All the data in the column will be lost.
  - You are about to drop the column `reel_id` on the `comments` table. All the data in the column will be lost.
  - You are about to drop the column `group_avatar` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `device_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `comment_id` on the `likes` table. All the data in the column will be lost.
  - You are about to drop the column `post_id` on the `likes` table. All the data in the column will be lost.
  - You are about to drop the column `reel_id` on the `likes` table. All the data in the column will be lost.
  - You are about to drop the column `post_id` on the `media_items` table. All the data in the column will be lost.
  - You are about to alter the column `duration` on the `media_items` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(8,3)`.
  - You are about to drop the column `reference_id` on the `messages` table. All the data in the column will be lost.
  - You are about to alter the column `media_duration` on the `messages` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(8,3)`.
  - You are about to drop the column `comment_text` on the `notifications` table. All the data in the column will be lost.
  - You are about to drop the column `post_id` on the `notifications` table. All the data in the column will be lost.
  - You are about to drop the column `post_thumbnail_url` on the `notifications` table. All the data in the column will be lost.
  - You are about to drop the column `reel_id` on the `notifications` table. All the data in the column will be lost.
  - You are about to alter the column `location_lat` on the `posts` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,8)`.
  - You are about to alter the column `location_lng` on the `posts` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(11,8)`.
  - You are about to drop the column `audio_cover_url` on the `reels` table. All the data in the column will be lost.
  - You are about to alter the column `duration` on the `reels` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(8,3)`.
  - You are about to alter the column `duration` on the `story_items` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(6,3)`.
  - The `sticker_data` column on the `story_items` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `firebase_uid` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `saved_posts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `saved_reels` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_settings` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[user_id,likeable_type,likeable_id]` on the table `likes` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `commentable_id` to the `comments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `commentable_type` to the `comments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `comments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `likeable_id` to the `likes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `likeable_type` to the `likes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mediaable_id` to the `media_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mediaable_type` to the `media_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `messages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `pending_uploads` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `reels` table without a default value. This is not possible if the table is not empty.
  - Added the required column `password_hash` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PostAudience" AS ENUM ('PUBLIC', 'FOLLOWERS', 'CLOSE_FRIENDS');

-- CreateEnum
CREATE TYPE "FollowStatus" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CommentableType" AS ENUM ('POST', 'REEL', 'STORY');

-- CreateEnum
CREATE TYPE "LikeableType" AS ENUM ('POST', 'REEL', 'COMMENT', 'STORY');

-- CreateEnum
CREATE TYPE "SaveableType" AS ENUM ('POST', 'REEL', 'AUDIO');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('USER', 'POST', 'REEL', 'STORY', 'COMMENT', 'MESSAGE', 'AUDIO');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'HATE_SPEECH', 'HARASSMENT', 'VIOLENCE', 'NUDITY', 'SELF_HARM', 'MISINFORMATION', 'SCAM', 'IMPERSONATION', 'COPYRIGHT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('WARN', 'CONTENT_REMOVE', 'CONTENT_HIDE', 'ACCOUNT_SUSPEND', 'ACCOUNT_BAN', 'FEATURE_RESTRICT', 'SHADOWBAN', 'RESTORE');

-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('AUDIO', 'VIDEO', 'GROUP_AUDIO', 'GROUP_VIDEO');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('INITIATED', 'RINGING', 'CONNECTING', 'ACTIVE', 'ENDED', 'MISSED', 'DECLINED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallParticipantStatus" AS ENUM ('INVITED', 'RINGING', 'JOINING', 'CONNECTED', 'RECONNECTING', 'LEFT', 'DECLINED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConnectionQuality" AS ENUM ('EXCELLENT', 'GOOD', 'POOR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SignalingDirection" AS ENUM ('SENT', 'RECEIVED');

-- CreateEnum
CREATE TYPE "LiveStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "DevicePlatform" ADD VALUE 'WEB';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaType" ADD VALUE 'CAROUSEL';
ALTER TYPE "MediaType" ADD VALUE 'AUDIO';

-- AlterEnum
BEGIN;
CREATE TYPE "MessageContentType_new" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'POST_SHARE', 'REEL_SHARE', 'STORY_SHARE', 'PROFILE_SHARE', 'LOCATION', 'CONTACT', 'VOICE', 'REPLY', 'SYSTEM');
ALTER TABLE "messages" ALTER COLUMN "content_type" TYPE "MessageContentType_new" USING ("content_type"::text::"MessageContentType_new");
ALTER TYPE "MessageContentType" RENAME TO "MessageContentType_old";
ALTER TYPE "MessageContentType_new" RENAME TO "MessageContentType";
DROP TYPE "MessageContentType_old";
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'FOLLOW_ACCEPT';
ALTER TYPE "NotificationType" ADD VALUE 'TAGGED_IN_COMMENT';
ALTER TYPE "NotificationType" ADD VALUE 'TAGGED_IN_STORY';
ALTER TYPE "NotificationType" ADD VALUE 'STORY_REPLY';
ALTER TYPE "NotificationType" ADD VALUE 'REEL_LIKE';
ALTER TYPE "NotificationType" ADD VALUE 'REEL_COMMENT';
ALTER TYPE "NotificationType" ADD VALUE 'LIVE_JOIN';
ALTER TYPE "NotificationType" ADD VALUE 'DM_MESSAGE';
ALTER TYPE "NotificationType" ADD VALUE 'DM_REACTION';
ALTER TYPE "NotificationType" ADD VALUE 'POST_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'ACHIEVEMENT';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'FEATURE_ANNOUNCEMENT';

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_post_id_fkey";

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_reel_id_fkey";

-- DropForeignKey
ALTER TABLE "likes" DROP CONSTRAINT "likes_comment_id_fkey";

-- DropForeignKey
ALTER TABLE "likes" DROP CONSTRAINT "likes_post_id_fkey";

-- DropForeignKey
ALTER TABLE "likes" DROP CONSTRAINT "likes_reel_id_fkey";

-- DropForeignKey
ALTER TABLE "media_items" DROP CONSTRAINT "media_items_post_id_fkey";

-- DropForeignKey
ALTER TABLE "saved_posts" DROP CONSTRAINT "saved_posts_post_id_fkey";

-- DropForeignKey
ALTER TABLE "saved_posts" DROP CONSTRAINT "saved_posts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "saved_reels" DROP CONSTRAINT "saved_reels_reel_id_fkey";

-- DropForeignKey
ALTER TABLE "saved_reels" DROP CONSTRAINT "saved_reels_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_settings" DROP CONSTRAINT "user_settings_user_id_fkey";

-- DropIndex
DROP INDEX "comments_parent_id_idx";

-- DropIndex
DROP INDEX "comments_post_id_created_at_idx";

-- DropIndex
DROP INDEX "comments_reel_id_created_at_idx";

-- DropIndex
DROP INDEX "likes_user_id_comment_id_key";

-- DropIndex
DROP INDEX "likes_user_id_post_id_key";

-- DropIndex
DROP INDEX "likes_user_id_reel_id_key";

-- DropIndex
DROP INDEX "media_items_post_id_idx";

-- DropIndex
DROP INDEX "messages_sender_id_idx";

-- DropIndex
DROP INDEX "posts_author_id_idx";

-- DropIndex
DROP INDEX "posts_created_at_idx";

-- DropIndex
DROP INDEX "reels_author_id_idx";

-- DropIndex
DROP INDEX "stories_author_id_idx";

-- DropIndex
DROP INDEX "story_items_story_id_idx";

-- DropIndex
DROP INDEX "users_firebase_uid_key";

-- AlterTable
ALTER TABLE "blocks" ADD COLUMN     "block_comments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "block_content" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "block_dm" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "block_mentions" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "block_profile" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "comments" DROP COLUMN "post_id",
DROP COLUMN "reel_id",
ADD COLUMN     "commentable_id" TEXT NOT NULL,
ADD COLUMN     "commentable_type" "CommentableType" NOT NULL,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "hidden_at" TIMESTAMP(3),
ADD COLUMN     "hidden_by" TEXT,
ADD COLUMN     "hidden_reason" TEXT,
ADD COLUMN     "is_hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replies_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "conversation_members" ADD COLUMN     "last_delivered_at" TIMESTAMP(3),
ADD COLUMN     "left_at" TIMESTAMP(3),
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'member';

-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "group_avatar",
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "encryption_type" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "group_avatar_url" TEXT,
ADD COLUMN     "group_owner_id" TEXT;

-- AlterTable
ALTER TABLE "device_tokens" DROP COLUMN "updated_at",
ADD COLUMN     "app_version" TEXT,
ADD COLUMN     "device_id" TEXT,
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_used_at" TIMESTAMP(3),
ADD COLUMN     "os_version" TEXT,
ADD COLUMN     "sandbox" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "topics" TEXT[],
ADD COLUMN     "voip_token" TEXT;

-- AlterTable
ALTER TABLE "follows" ADD COLUMN     "status" "FollowStatus" NOT NULL DEFAULT 'ACCEPTED';

-- AlterTable
ALTER TABLE "likes" DROP COLUMN "comment_id",
DROP COLUMN "post_id",
DROP COLUMN "reel_id",
ADD COLUMN     "likeable_id" TEXT NOT NULL,
ADD COLUMN     "likeable_type" "LikeableType" NOT NULL;

-- AlterTable
ALTER TABLE "media_items" DROP COLUMN "post_id",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "mediaable_id" TEXT NOT NULL,
ADD COLUMN     "mediaable_type" TEXT NOT NULL,
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "processing_error" TEXT,
ADD COLUMN     "processing_status" TEXT NOT NULL DEFAULT 'completed',
ALTER COLUMN "duration" SET DATA TYPE DECIMAL(8,3);

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "reference_id",
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "edited_at" TIMESTAMP(3),
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "is_edited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_ephemeral" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_unsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "media_metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "reaction_emoji" TEXT,
ADD COLUMN     "unsent_at" TIMESTAMP(3),
ADD COLUMN     "unsent_for_everyone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "media_duration" SET DATA TYPE DECIMAL(8,3);

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "comment_text",
DROP COLUMN "post_id",
DROP COLUMN "post_thumbnail_url",
DROP COLUMN "reel_id",
ADD COLUMN     "deep_link" TEXT,
ADD COLUMN     "group_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "group_key" TEXT,
ADD COLUMN     "preview_text" TEXT,
ADD COLUMN     "read_at" TIMESTAMP(3),
ADD COLUMN     "reference_id" TEXT,
ADD COLUMN     "reference_type" TEXT,
ADD COLUMN     "thumbnail_url" TEXT;

-- AlterTable
ALTER TABLE "pending_uploads" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "audience" "PostAudience" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN     "close_friends_only" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "location_id" TEXT,
ADD COLUMN     "saves_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "search_vector" TEXT,
ADD COLUMN     "shares_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sponsor_user_id" TEXT,
ADD COLUMN     "views_count" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "location_lat" SET DATA TYPE DECIMAL(10,8),
ALTER COLUMN "location_lng" SET DATA TYPE DECIMAL(11,8);

-- AlterTable
ALTER TABLE "reels" DROP COLUMN "audio_cover_url",
ADD COLUMN     "allow_download" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allow_remix" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'public',
ADD COLUMN     "audio_id" TEXT,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "plays_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "saves_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "search_vector" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "duration" SET DATA TYPE DECIMAL(8,3);

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'followers',
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "reel_id" TEXT,
ADD COLUMN     "replies_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shared_from_post_id" TEXT,
ADD COLUMN     "views_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "story_items" ADD COLUMN     "thumbnail_url" TEXT,
ALTER COLUMN "duration" SET DATA TYPE DECIMAL(6,3),
DROP COLUMN "sticker_data",
ADD COLUMN     "sticker_data" JSONB;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "firebase_uid",
ADD COLUMN     "avatar_thumb_url" TEXT,
ADD COLUMN     "business_category" TEXT,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "is_business" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "password_hash" TEXT NOT NULL,
ADD COLUMN     "reels_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "settings" JSONB,
ALTER COLUMN "full_name" DROP NOT NULL,
ALTER COLUMN "bio" SET DEFAULT '';

-- DropTable
DROP TABLE "saved_posts";

-- DropTable
DROP TABLE "saved_reels";

-- DropTable
DROP TABLE "user_settings";

-- CreateTable
CREATE TABLE "restrictions" (
    "id" TEXT NOT NULL,
    "restrictor_id" TEXT NOT NULL,
    "restricted_id" TEXT NOT NULL,
    "hide_comments" BOOLEAN NOT NULL DEFAULT true,
    "dm_to_requests" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_replies" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_tracks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artist" TEXT,
    "audio_url" TEXT NOT NULL,
    "duration" DECIMAL(8,3),
    "waveform_data" JSONB,
    "is_licensed" BOOLEAN NOT NULL DEFAULT false,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "cover_media_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "collection_id" TEXT,
    "saveable_type" "SaveableType" NOT NULL,
    "saveable_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reported_type" "ReportType" NOT NULL,
    "reported_id" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "description" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" TEXT NOT NULL,
    "moderator_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "action" "ModerationActionType" NOT NULL,
    "reason" TEXT,
    "duration" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "result_type" TEXT,
    "result_count" INTEGER,
    "clicked_result_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hashtags" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "posts_count" INTEGER NOT NULL DEFAULT 0,
    "reels_count" INTEGER NOT NULL DEFAULT 0,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "blocked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hashtags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hashtag_usages" (
    "id" TEXT NOT NULL,
    "hashtag_id" TEXT NOT NULL,
    "usage_type" TEXT NOT NULL,
    "usage_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hashtag_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DECIMAL(10,8),
    "lng" DECIMAL(11,8),
    "category" TEXT,
    "posts_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_index" (
    "id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "search_vector" TEXT,
    "embedding" vector(1536) NOT NULL,
    "author_id" TEXT,
    "created_at" TIMESTAMP(3),
    "popularity_score" DECIMAL(10,4) NOT NULL DEFAULT 0,

    CONSTRAINT "search_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_videos" (
    "id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "co_host_id" TEXT,
    "title" TEXT,
    "status" "LiveStatus" NOT NULL DEFAULT 'SCHEDULED',
    "stream_key" TEXT NOT NULL,
    "playback_url" TEXT,
    "viewer_count" INTEGER NOT NULL DEFAULT 0,
    "peak_viewers" INTEGER NOT NULL DEFAULT 0,
    "total_views" INTEGER NOT NULL DEFAULT 0,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_comments" (
    "id" TEXT NOT NULL,
    "live_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "type" "CallType" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'INITIATED',
    "initiator_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "max_participants" INTEGER NOT NULL DEFAULT 2,
    "is_recording" BOOLEAN NOT NULL DEFAULT false,
    "recording_url" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "media_server_id" TEXT,
    "room_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_participants" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "CallParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "is_muted" BOOLEAN NOT NULL DEFAULT false,
    "is_video_off" BOOLEAN NOT NULL DEFAULT false,
    "is_screen_share" BOOLEAN NOT NULL DEFAULT false,
    "connectionQuality" "ConnectionQuality",
    "device_type" TEXT,
    "app_version" TEXT,
    "joined_at" TIMESTAMP(3),
    "left_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_signaling_logs" (
    "id" BIGSERIAL NOT NULL,
    "call_id" TEXT NOT NULL,
    "participant_id" TEXT,
    "direction" "SignalingDirection" NOT NULL,
    "message_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sequence_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_signaling_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_ip" TEXT,
    "actor_user_agent" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "correlation_id" TEXT,
    "session_id" TEXT,
    "request_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restrictions_restrictor_id_restricted_id_key" ON "restrictions"("restrictor_id", "restricted_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_replies_message_id_key" ON "story_replies"("message_id");

-- CreateIndex
CREATE INDEX "story_replies_story_id_idx" ON "story_replies"("story_id");

-- CreateIndex
CREATE INDEX "audio_tracks_name_idx" ON "audio_tracks"("name");

-- CreateIndex
CREATE UNIQUE INDEX "collections_user_id_name_key" ON "collections"("user_id", "name");

-- CreateIndex
CREATE INDEX "saved_items_user_id_created_at_idx" ON "saved_items"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "saved_items_user_id_saveable_type_saveable_id_key" ON "saved_items"("user_id", "saveable_type", "saveable_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_message_id_user_id_emoji_key" ON "message_reactions"("message_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "reports_reporter_id_created_at_idx" ON "reports"("reporter_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reports_reported_type_reported_id_idx" ON "reports"("reported_type", "reported_id");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_moderator_id_created_at_idx" ON "moderation_actions"("moderator_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "moderation_actions_target_type_target_id_idx" ON "moderation_actions"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "search_history_user_id_created_at_idx" ON "search_history"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "hashtags_tag_key" ON "hashtags"("tag");

-- CreateIndex
CREATE INDEX "hashtag_usages_usage_type_usage_id_idx" ON "hashtag_usages"("usage_type", "usage_id");

-- CreateIndex
CREATE UNIQUE INDEX "hashtag_usages_hashtag_id_usage_type_usage_id_key" ON "hashtag_usages"("hashtag_id", "usage_type", "usage_id");

-- CreateIndex
CREATE INDEX "search_index_content_type_popularity_score_idx" ON "search_index"("content_type", "popularity_score" DESC);

-- CreateIndex
CREATE INDEX "search_index_search_vector_idx" ON "search_index"("search_vector");

-- CreateIndex
CREATE UNIQUE INDEX "search_index_content_type_content_id_key" ON "search_index"("content_type", "content_id");

-- CreateIndex
CREATE INDEX "live_videos_host_id_idx" ON "live_videos"("host_id");

-- CreateIndex
CREATE INDEX "live_videos_status_idx" ON "live_videos"("status");

-- CreateIndex
CREATE INDEX "live_comments_live_id_created_at_idx" ON "live_comments"("live_id", "created_at");

-- CreateIndex
CREATE INDEX "calls_initiator_id_created_at_idx" ON "calls"("initiator_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "calls_conversation_id_idx" ON "calls"("conversation_id");

-- CreateIndex
CREATE INDEX "calls_status_idx" ON "calls"("status");

-- CreateIndex
CREATE INDEX "calls_room_id_idx" ON "calls"("room_id");

-- CreateIndex
CREATE INDEX "call_participants_call_id_idx" ON "call_participants"("call_id");

-- CreateIndex
CREATE INDEX "call_participants_user_id_created_at_idx" ON "call_participants"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "call_participants_status_idx" ON "call_participants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "call_participants_call_id_user_id_key" ON "call_participants"("call_id", "user_id");

-- CreateIndex
CREATE INDEX "call_signaling_logs_call_id_created_at_idx" ON "call_signaling_logs"("call_id", "created_at");

-- CreateIndex
CREATE INDEX "call_signaling_logs_call_id_sequence_id_idx" ON "call_signaling_logs"("call_id", "sequence_id");

-- CreateIndex
CREATE INDEX "call_signaling_logs_participant_id_created_at_idx" ON "call_signaling_logs"("participant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_correlation_id_idx" ON "audit_logs"("correlation_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "rate_limit_buckets_identifier_endpoint_window_end_idx" ON "rate_limit_buckets"("identifier", "endpoint", "window_end");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_window_end_idx" ON "rate_limit_buckets"("window_end");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_buckets_identifier_endpoint_window_start_key" ON "rate_limit_buckets"("identifier", "endpoint", "window_start");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "verifications_expires_at_idx" ON "verifications"("expires_at");

-- CreateIndex
CREATE INDEX "verifications_user_id_idx" ON "verifications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "verifications_identifier_value_key" ON "verifications"("identifier", "value");

-- CreateIndex
CREATE INDEX "blocks_blocker_id_idx" ON "blocks"("blocker_id");

-- CreateIndex
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");

-- CreateIndex
CREATE INDEX "comments_commentable_type_commentable_id_parent_id_created__idx" ON "comments"("commentable_type", "commentable_id", "parent_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_author_id_created_at_idx" ON "comments"("author_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_updated_at_idx" ON "conversations"("updated_at" DESC);

-- CreateIndex
CREATE INDEX "device_tokens_user_id_is_active_idx" ON "device_tokens"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "device_tokens_expires_at_idx" ON "device_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "likes_likeable_type_likeable_id_idx" ON "likes"("likeable_type", "likeable_id");

-- CreateIndex
CREATE INDEX "likes_user_id_created_at_idx" ON "likes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "likes_user_id_likeable_type_likeable_id_key" ON "likes"("user_id", "likeable_type", "likeable_id");

-- CreateIndex
CREATE INDEX "media_items_polymorphic_idx" ON "media_items"("mediaable_type", "mediaable_id", "sort_order");

-- CreateIndex
CREATE INDEX "media_items_processing_status_idx" ON "media_items"("processing_status");

-- CreateIndex
CREATE INDEX "messages_sender_id_created_at_idx" ON "messages"("sender_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_reply_to_id_idx" ON "messages"("reply_to_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_group_key_created_at_idx" ON "notifications"("recipient_id", "group_key", "created_at" DESC);

-- CreateIndex
CREATE INDEX "posts_author_id_created_at_idx" ON "posts"("author_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "posts_search_vector_idx" ON "posts"("search_vector");

-- CreateIndex
CREATE INDEX "reels_author_id_created_at_idx" ON "reels"("author_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reels_search_vector_idx" ON "reels"("search_vector");

-- CreateIndex
CREATE INDEX "stories_author_id_expires_at_idx" ON "stories"("author_id", "expires_at" DESC);

-- CreateIndex
CREATE INDEX "story_items_story_id_sort_order_idx" ON "story_items"("story_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- AddForeignKey
ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_restrictor_id_fkey" FOREIGN KEY ("restrictor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_restricted_id_fkey" FOREIGN KEY ("restricted_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_sponsor_user_id_fkey" FOREIGN KEY ("sponsor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_post_fkey" FOREIGN KEY ("mediaable_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_reel_id_fkey" FOREIGN KEY ("reel_id") REFERENCES "reels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_shared_from_post_id_fkey" FOREIGN KEY ("shared_from_post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_replies" ADD CONSTRAINT "story_replies_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_replies" ADD CONSTRAINT "story_replies_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_replies" ADD CONSTRAINT "story_replies_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reels" ADD CONSTRAINT "reels_audio_id_fkey" FOREIGN KEY ("audio_id") REFERENCES "audio_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_commentable_post_fkey" FOREIGN KEY ("commentable_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_commentable_reel_fkey" FOREIGN KEY ("commentable_id") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_commentable_story_fkey" FOREIGN KEY ("commentable_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_likeable_post_fkey" FOREIGN KEY ("likeable_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_likeable_reel_fkey" FOREIGN KEY ("likeable_id") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_likeable_comment_fkey" FOREIGN KEY ("likeable_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_likeable_story_fkey" FOREIGN KEY ("likeable_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_saveable_post_fkey" FOREIGN KEY ("saveable_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_saveable_reel_fkey" FOREIGN KEY ("saveable_id") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_saveable_audio_fkey" FOREIGN KEY ("saveable_id") REFERENCES "audio_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderator_id_fkey" FOREIGN KEY ("moderator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hashtag_usages" ADD CONSTRAINT "hashtag_usages_hashtag_id_fkey" FOREIGN KEY ("hashtag_id") REFERENCES "hashtags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hashtag_usages" ADD CONSTRAINT "hashtag_usages_usage_post_fkey" FOREIGN KEY ("usage_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hashtag_usages" ADD CONSTRAINT "hashtag_usages_usage_reel_fkey" FOREIGN KEY ("usage_id") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_videos" ADD CONSTRAINT "live_videos_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_videos" ADD CONSTRAINT "live_videos_co_host_id_fkey" FOREIGN KEY ("co_host_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_live_id_fkey" FOREIGN KEY ("live_id") REFERENCES "live_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_signaling_logs" ADD CONSTRAINT "call_signaling_logs_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "reels_created_at_idx" RENAME TO "reels_explore_idx";
