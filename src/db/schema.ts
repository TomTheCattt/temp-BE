import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  decimal,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
  foreignKey,
  AnyPgColumn,
  jsonb,
  inet,
  bigserial,
  bigint,
  vector,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ============================================================
// ENUMS
// ============================================================
export const devicePlatformEnum = pgEnum("device_platform", ["IOS", "ANDROID", "WEB"]);
export const mediaTypeEnum = pgEnum("media_type", ["IMAGE", "VIDEO", "CAROUSEL", "AUDIO"]);
export const postAudienceEnum = pgEnum("post_audience", ["PUBLIC", "FOLLOWERS", "CLOSE_FRIENDS"]);
export const followStatusEnum = pgEnum("follow_status", ["PENDING", "ACCEPTED", "BLOCKED"]);
export const commentableTypeEnum = pgEnum("commentable_type", ["POST", "REEL", "STORY"]);
export const likeableTypeEnum = pgEnum("likeable_type", ["POST", "REEL", "COMMENT", "STORY"]);
export const saveableTypeEnum = pgEnum("saveable_type", ["POST", "REEL", "AUDIO"]);
export const conversationContentTypeEnum = pgEnum("message_content_type", [
  "TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE",
  "POST_SHARE", "REEL_SHARE", "STORY_SHARE", "PROFILE_SHARE",
  "LOCATION", "CONTACT", "VOICE", "REPLY", "SYSTEM"
]);
export const messageStatusEnum = pgEnum("message_status", [
  "SENDING", "SENT", "DELIVERED", "READ", "FAILED"
]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "LIKE", "COMMENT", "FOLLOW", "FOLLOW_REQUEST", "FOLLOW_ACCEPT",
  "MENTION", "TAGGED_IN_POST", "TAGGED_IN_COMMENT", "TAGGED_IN_STORY",
  "STORY_MENTION", "STORY_REPLY", "REEL_LIKE", "REEL_COMMENT",
  "LIVE_VIDEO", "LIVE_JOIN", "DM_MESSAGE", "DM_REACTION",
  "POST_REMINDER", "ACHIEVEMENT", "SECURITY_ALERT", "FEATURE_ANNOUNCEMENT"
]);
export const reportTypeEnum = pgEnum("report_type", [
  "USER", "POST", "REEL", "STORY", "COMMENT", "MESSAGE", "AUDIO"
]);
export const reportReasonEnum = pgEnum("report_reason", [
  "SPAM", "HATE_SPEECH", "HARASSMENT", "VIOLENCE", "NUDITY",
  "SELF_HARM", "MISINFORMATION", "SCAM", "IMPERSONATION", "COPYRIGHT", "OTHER"
]);
export const reportStatusEnum = pgEnum("report_status", [
  "PENDING", "REVIEWING", "RESOLVED", "DISMISSED"
]);
export const moderationActionEnum = pgEnum("moderation_action", [
  "WARN", "CONTENT_REMOVE", "CONTENT_HIDE", "ACCOUNT_SUSPEND",
  "ACCOUNT_BAN", "FEATURE_RESTRICT", "SHADOWBAN", "RESTORE"
]);
export const callTypeEnum = pgEnum("call_type", [
  "AUDIO", "VIDEO", "GROUP_AUDIO", "GROUP_VIDEO"
]);
export const callStatusEnum = pgEnum("call_status", [
  "INITIATED", "RINGING", "CONNECTING", "ACTIVE", "ENDED", "MISSED", "DECLINED", "FAILED"
]);
export const callParticipantStatusEnum = pgEnum("call_participant_status", [
  "INVITED", "RINGING", "JOINING", "CONNECTED", "RECONNECTING", "LEFT", "DECLINED", "FAILED"
]);
export const connectionQualityEnum = pgEnum("connection_quality", [
  "EXCELLENT", "GOOD", "POOR", "DISCONNECTED"
]);
export const signalingDirectionEnum = pgEnum("signaling_direction", [
  "SENT", "RECEIVED"
]);
export const liveStatusEnum = pgEnum("live_status", [
  "SCHEDULED", "LIVE", "ENDED", "ARCHIVED"
]);

// ============================================================
// USERS & AUTH
// ============================================================
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: varchar("username", { length: 30 }).notNull().unique(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    phone: varchar("phone", { length: 20 }).unique(),
    passwordHash: varchar("password_hash", { length: 255 }),
    fullName: varchar("full_name", { length: 100 }),
    bio: text("bio").default(""),
    website: varchar("website", { length: 200 }),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    avatarThumbUrl: varchar("avatar_thumb_url", { length: 500 }),
    isVerified: boolean("is_verified").default(false).notNull(),
    isPrivate: boolean("is_private").default(false).notNull(),
    isBusiness: boolean("is_business").default(false).notNull(),
    businessCategory: varchar("business_category", { length: 50 }),
    postsCount: integer("posts_count").default(0).notNull(),
    followersCount: integer("followers_count").default(0).notNull(),
    followingCount: integer("following_count").default(0).notNull(),
    reelsCount: integer("reels_count").default(0).notNull(),
    settings: jsonb("settings").default({
      language: "en",
      dark_mode: false,
      push_enabled: true,
      biometric_enabled: true,
      story_controls: { allow_replies: "followers", allow_sharing: true },
      comment_controls: { allow_comments_from: "everyone", block_keywords: [] },
      privacy: { activity_status: true, read_receipts: true }
    }).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Better Auth fields
    name: varchar("name", { length: 100 }),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: varchar("image", { length: 500 }),
    firebaseUid: varchar("firebase_uid", { length: 255 }).unique(),
  },
  (table) => ({
    usernameIdx: uniqueIndex("users_username_idx").on(table.username),
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  })
);

export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 500 }).unique().notNull(),
    platform: devicePlatformEnum("platform").default("IOS").notNull(),
    deviceId: varchar("device_id", { length: 200 }),
    appVersion: varchar("app_version", { length: 20 }),
    osVersion: varchar("os_version", { length: 20 }),
    voipToken: varchar("voip_token", { length: 500 }),
    sandbox: boolean("sandbox").default(false).notNull(),
    topics: text("topics").array().default([]).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("device_tokens_user_id_idx").on(table.userId),
    userIdActiveIdx: index("device_tokens_user_id_active_idx").on(table.userId, table.isActive),
    expiresAtIdx: index("device_tokens_expires_at_idx").on(table.expiresAt),
  })
);

// ============================================================
// FOLLOWS
// ============================================================
export const follows = pgTable(
  "follows",
  {
    id: text("id").primaryKey(),
    followerId: text("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    followingId: text("following_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: followStatusEnum("status").default("ACCEPTED").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueFollow: uniqueIndex("follows_unique").on(table.followerId, table.followingId),
    followerIdx: index("follows_follower_id_idx").on(table.followerId),
    followingIdx: index("follows_following_id_idx").on(table.followingId),
    pendingIdx: index("follows_pending_idx").on(table.followingId).where(sql`${table.status} = 'PENDING'`),
  })
);

// ============================================================
// BLOCKS & RESTRICTIONS
// ============================================================
export const blocks = pgTable(
  "blocks",
  {
    id: text("id").primaryKey(),
    blockerId: text("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    blockProfile: boolean("block_profile").default(true).notNull(),
    blockContent: boolean("block_content").default(true).notNull(),
    blockDm: boolean("block_dm").default(true).notNull(),
    blockComments: boolean("block_comments").default(true).notNull(),
    blockMentions: boolean("block_mentions").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueBlock: uniqueIndex("blocks_unique").on(table.blockerId, table.blockedId),
    blockerIdx: index("blocks_blocker_id_idx").on(table.blockerId),
    blockedIdx: index("blocks_blocked_id_idx").on(table.blockedId),
  })
);

export const restrictions = pgTable(
  "restrictions",
  {
    id: text("id").primaryKey(),
    restrictorId: text("restrictor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    restrictedId: text("restricted_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    hideComments: boolean("hide_comments").default(true).notNull(),
    dmToRequests: boolean("dm_to_requests").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueRestriction: uniqueIndex("restrictions_unique").on(table.restrictorId, table.restrictedId),
  })
);

// ============================================================
// CLOSE FRIENDS
// ============================================================
export const closeFriends = pgTable(
  "close_friends",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    friendId: text("friend_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueFriend: uniqueIndex("close_friends_unique").on(table.userId, table.friendId),
    userIdx: index("close_friends_user_id_idx").on(table.userId),
    friendIdx: index("close_friends_friend_id_idx").on(table.friendId),
  })
);

// ============================================================
// POSTS
// ============================================================
export const posts = pgTable(
  "posts",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    caption: text("caption"),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    locationName: varchar("location_name", { length: 200 }),
    locationLat: decimal("location_lat", { precision: 10, scale: 8 }),
    locationLng: decimal("location_lng", { precision: 11, scale: 8 }),
    isSponsored: boolean("is_sponsored").default(false).notNull(),
    sponsorUserId: text("sponsor_user_id").references(() => users.id, { onDelete: "set null" }),
    likesCount: integer("likes_count").default(0).notNull(),
    commentsCount: integer("comments_count").default(0).notNull(),
    sharesCount: integer("shares_count").default(0).notNull(),
    savesCount: integer("saves_count").default(0).notNull(),
    viewsCount: integer("views_count").default(0).notNull(),
    audience: postAudienceEnum("audience").default("PUBLIC").notNull(),
    closeFriendsOnly: boolean("close_friends_only").default(false).notNull(),
    searchVector: text("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    authorCreatedIdx: index("posts_author_created_idx").on(table.authorId, table.createdAt.desc()),
    searchVectorIdx: index("posts_search_vector_idx").using("gin", table.searchVector),
    locationGeoIdx: index("posts_location_geo_idx").using("gist", table.locationLat, table.locationLng),
  })
);

// ============================================================
// MEDIA ITEMS (polymorphic)
// ============================================================
export const mediaItems = pgTable(
  "media_items",
  {
    id: text("id").primaryKey(),
    mediaableType: varchar("mediaable_type", { length: 20 }).notNull(),
    mediaableId: text("mediaable_id").notNull(),
    url: varchar("url", { length: 500 }).notNull(),
    thumbnailUrl: varchar("thumbnail_url", { length: 500 }),
    type: mediaTypeEnum("type").notNull(),
    width: integer("width"),
    height: integer("height"),
    duration: decimal("duration", { precision: 8, scale: 3 }),
    sortOrder: integer("sort_order").default(0).notNull(),
    processingStatus: varchar("processing_status", { length: 20 }).default("completed").notNull(),
    processingError: text("processing_error"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    polymorphicIdx: index("media_items_polymorphic_idx").on(table.mediaableType, table.mediaableId, table.sortOrder),
    processingIdx: index("media_items_processing_idx").on(table.processingStatus),
  })
);

// ============================================================
// STORIES
// ============================================================
export const stories = pgTable(
  "stories",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    audience: varchar("audience", { length: 20 }).default("followers").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    viewsCount: integer("views_count").default(0).notNull(),
    repliesCount: integer("replies_count").default(0).notNull(),
    reelId: text("reel_id").references(() => reels.id, { onDelete: "set null" }),
    sharedFromPostId: text("shared_from_post_id").references(() => posts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    authorExpiresIdx: index("stories_author_expires_idx").on(table.authorId, table.expiresAt.desc()),
    expiresIdx: index("stories_expires_idx").on(table.expiresAt),
  })
);

export const storyItems = pgTable(
  "story_items",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    mediaUrl: varchar("media_url", { length: 500 }).notNull(),
    thumbnailUrl: varchar("thumbnail_url", { length: 500 }),
    type: mediaTypeEnum("type").notNull(),
    duration: decimal("duration", { precision: 6, scale: 3 }).default("5").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    stickerType: varchar("sticker_type", { length: 30 }),
    stickerData: jsonb("sticker_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storyIdIdx: index("story_items_story_id_idx").on(table.storyId, table.sortOrder),
  })
);

export const storyViews = pgTable(
  "story_views",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    viewerId: text("viewer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueView: uniqueIndex("story_views_unique").on(table.storyId, table.viewerId),
  })
);

export const storyReplies = pgTable(
  "story_replies",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    senderId: text("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storyIdIdx: index("story_replies_story_id_idx").on(table.storyId),
  })
);

// ============================================================
// REELS
// ============================================================
export const reels = pgTable(
  "reels",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    videoUrl: varchar("video_url", { length: 500 }).notNull(),
    thumbnailUrl: varchar("thumbnail_url", { length: 500 }),
    caption: text("caption"),
    audioId: text("audio_id").references(() => audioTracks.id, { onDelete: "set null" }),
    audioName: varchar("audio_name", { length: 200 }),
    audioArtist: varchar("audio_artist", { length: 200 }),
    isOriginalAudio: boolean("is_original_audio").default(true).notNull(),
    duration: decimal("duration", { precision: 8, scale: 3 }).notNull(),
    likesCount: integer("likes_count").default(0).notNull(),
    commentsCount: integer("comments_count").default(0).notNull(),
    sharesCount: integer("shares_count").default(0).notNull(),
    savesCount: integer("saves_count").default(0).notNull(),
    viewsCount: integer("views_count").default(0).notNull(),
    playsCount: integer("plays_count").default(0).notNull(),
    audience: varchar("audience", { length: 20 }).default("public").notNull(),
    allowRemix: boolean("allow_remix").default(true).notNull(),
    allowDownload: boolean("allow_download").default(false).notNull(),
    searchVector: text("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    authorCreatedIdx: index("reels_author_created_idx").on(table.authorId, table.createdAt.desc()),
    exploreIdx: index("reels_explore_idx").on(table.createdAt.desc()),
    searchVectorIdx: index("reels_search_vector_idx").using("gin", table.searchVector),
  })
);

export const audioTracks = pgTable(
  "audio_tracks",
  {
    id: text("id").primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    artist: varchar("artist", { length: 200 }),
    audioUrl: varchar("audio_url", { length: 500 }).notNull(),
    duration: decimal("duration", { precision: 8, scale: 3 }),
    waveformData: jsonb("waveform_data"),
    isLicensed: boolean("is_licensed").default(false).notNull(),
    usageCount: integer("usage_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: index("audio_tracks_name_idx").on(table.name),
  })
);

// ============================================================
// COMMENTS (polymorphic)
// ============================================================
export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    commentableType: commentableTypeEnum("commentable_type").notNull(),
    commentableId: text("commentable_id").notNull(),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    likesCount: integer("likes_count").default(0).notNull(),
    repliesCount: integer("replies_count").default(0).notNull(),
    isHidden: boolean("is_hidden").default(false).notNull(),
    hiddenReason: varchar("hidden_reason", { length: 50 }),
    hiddenBy: text("hidden_by").references(() => users.id, { onDelete: "set null" }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    threadIdx: index("comments_thread_idx").on(table.commentableType, table.commentableId, table.parentId, table.createdAt),
    authorIdx: index("comments_author_idx").on(table.authorId, table.createdAt.desc()),
  })
);

// ============================================================
// LIKES (polymorphic)
// ============================================================
export const likes = pgTable(
  "likes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    likeableType: likeableTypeEnum("likeable_type").notNull(),
    likeableId: text("likeable_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueLike: uniqueIndex("likes_unique").on(table.userId, table.likeableType, table.likeableId),
    likeableIdx: index("likes_likeable_idx").on(table.likeableType, table.likeableId),
    userIdx: index("likes_user_idx").on(table.userId, table.createdAt.desc()),
  })
);

// ============================================================
// COLLECTIONS & SAVES
// ============================================================
export const collections = pgTable(
  "collections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    coverMediaId: text("cover_media_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueCollection: uniqueIndex("collections_unique").on(table.userId, table.name),
  })
);

export const savedItems = pgTable(
  "saved_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    collectionId: text("collection_id").references(() => collections.id, { onDelete: "set null" }),
    saveableType: saveableTypeEnum("saveable_type").notNull(),
    saveableId: text("saveable_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueSave: uniqueIndex("saved_items_unique").on(table.userId, table.saveableType, table.saveableId),
    userIdx: index("saved_items_user_idx").on(table.userId, table.createdAt.desc()),
  })
);

// ============================================================
// DIRECT MESSAGES
// ============================================================
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    isGroup: boolean("is_group").default(false).notNull(),
    groupName: varchar("group_name", { length: 100 }),
    groupAvatarUrl: varchar("group_avatar_url", { length: 500 }),
    groupOwnerId: text("group_owner_id").references(() => users.id, { onDelete: "set null" }),
    encryptionType: varchar("encryption_type", { length: 20 }).default("none").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    updatedAtIdx: index("conversations_updated_at_idx").on(table.updatedAt.desc()),
  })
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).default("member").notNull(),
    isMuted: boolean("is_muted").default(false).notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => ({
    uniqueMember: uniqueIndex("conversation_members_unique").on(table.conversationId, table.userId),
    userIdIdx: index("conversation_members_user_id_idx").on(table.userId),
  })
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    contentType: conversationContentTypeEnum("content_type").notNull(),
    textContent: text("text_content"),
    mediaUrl: varchar("media_url", { length: 500 }),
    mediaThumbnail: varchar("media_thumbnail", { length: 500 }),
    mediaDuration: decimal("media_duration", { precision: 8, scale: 3 }),
    mediaMetadata: jsonb("media_metadata").default({}).notNull(),
    reactionEmoji: varchar("reaction_emoji", { length: 10 }),
    replyToId: text("reply_to_id").references((): AnyPgColumn => messages.id, { onDelete: "set null" }),
    status: messageStatusEnum("status").default("SENT").notNull(),
    isEphemeral: boolean("is_ephemeral").default(false).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isEdited: boolean("is_edited").default(false).notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    isUnsent: boolean("is_unsent").default(false).notNull(),
    unsentAt: timestamp("unsent_at", { withTimezone: true }),
    unsentForEveryone: boolean("unsent_for_everyone").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    convCreatedIdx: index("messages_conv_created_idx").on(table.conversationId, table.createdAt.desc()),
    senderIdx: index("messages_sender_idx").on(table.senderId, table.createdAt.desc()),
    replyIdx: index("messages_reply_idx").on(table.replyToId),
  })
);

export const messageReactions = pgTable(
  "message_reactions",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    emoji: varchar("emoji", { length: 10 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueReaction: uniqueIndex("message_reactions_unique").on(table.messageId, table.userId, table.emoji),
  })
);

// ============================================================
// NOTIFICATIONS
// ============================================================
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    referenceType: varchar("reference_type", { length: 20 }),
    referenceId: text("reference_id"),
    previewText: text("preview_text"),
    thumbnailUrl: varchar("thumbnail_url", { length: 500 }),
    deepLink: varchar("deep_link", { length: 500 }),
    groupKey: varchar("group_key", { length: 100 }),
    groupCount: integer("group_count").default(1).notNull(),
    isRead: boolean("is_read").default(false).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    recipientIdx: index("notifications_recipient_idx").on(table.recipientId, table.createdAt.desc()),
    recipientReadIdx: index("notifications_recipient_read_idx").on(table.recipientId, table.isRead),
    groupIdx: index("notifications_group_idx").on(table.recipientId, table.groupKey, table.createdAt.desc()),
  })
);

// ============================================================
// REPORTS & MODERATION
// ============================================================
export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reportedType: reportTypeEnum("reported_type").notNull(),
    reportedId: text("reported_id").notNull(),
    reason: reportReasonEnum("reason").notNull(),
    description: text("description"),
    status: reportStatusEnum("status").default("PENDING").notNull(),
    resolution: varchar("resolution", { length: 50 }),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    reporterIdx: index("reports_reporter_idx").on(table.reporterId, table.createdAt.desc()),
    reportedIdx: index("reports_reported_idx").on(table.reportedType, table.reportedId),
    statusIdx: index("reports_status_idx").on(table.status, table.createdAt),
  })
);

export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: text("id").primaryKey(),
    moderatorId: text("moderator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 20 }).notNull(),
    targetId: text("target_id").notNull(),
    action: moderationActionEnum("action").notNull(),
    reason: text("reason"),
    duration: varchar("duration", { length: 50 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    moderatorIdx: index("moderation_actions_moderator_idx").on(table.moderatorId, table.createdAt.desc()),
    targetIdx: index("moderation_actions_target_idx").on(table.targetType, table.targetId),
  })
);

// ============================================================
// SEARCH & DISCOVERY
// ============================================================
export const searchHistory = pgTable(
  "search_history",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    resultType: varchar("result_type", { length: 20 }),
    resultCount: integer("result_count"),
    clickedResultId: text("clicked_result_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("search_history_user_idx").on(table.userId, table.createdAt.desc()),
  })
);

export const hashtags = pgTable(
  "hashtags",
  {
    id: text("id").primaryKey(),
    tag: varchar("tag", { length: 50 }).notNull().unique(),
    postsCount: integer("posts_count").default(0).notNull(),
    reelsCount: integer("reels_count").default(0).notNull(),
    isBlocked: boolean("is_blocked").default(false).notNull(),
    blockedReason: varchar("blocked_reason", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tagIdx: uniqueIndex("hashtags_tag_idx").on(table.tag),
  })
);

export const hashtagUsages = pgTable(
  "hashtag_usages",
  {
    id: text("id").primaryKey(),
    hashtagId: text("hashtag_id").notNull().references(() => hashtags.id, { onDelete: "cascade" }),
    usageType: varchar("usage_type", { length: 10 }).notNull(),
    usageId: text("usage_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueUsage: uniqueIndex("hashtag_usages_unique").on(table.hashtagId, table.usageType, table.usageId),
    usageIdx: index("hashtag_usages_usage_idx").on(table.usageType, table.usageId),
  })
);

export const locations = pgTable(
  "locations",
  {
    id: text("id").primaryKey(),
    externalId: varchar("external_id", { length: 100 }),
    name: varchar("name", { length: 200 }).notNull(),
    address: text("address"),
    lat: decimal("lat", { precision: 10, scale: 8 }),
    lng: decimal("lng", { precision: 11, scale: 8 }),
    category: varchar("category", { length: 100 }),
    postsCount: integer("posts_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    geoIdx: index("locations_geo_idx").using("gist", table.lat, table.lng),
  })
);

// ============================================================
// SEARCH INDEX (with pgvector)
// ============================================================
export const searchIndex = pgTable(
  "search_index",
  {
    id: text("id").primaryKey(),
    contentType: varchar("content_type", { length: 20 }).notNull(),
    contentId: text("content_id").notNull(),
    title: text("title"),
    description: text("description"),
    searchVector: text("search_vector"),
    embedding: vector("embedding", { dimensions: 1536 }),
    authorId: text("author_id"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    popularityScore: decimal("popularity_score", { precision: 10, scale: 4 }).default("0").notNull(),
  },
  (table) => ({
    uniqueContent: uniqueIndex("search_index_unique").on(table.contentType, table.contentId),
    vectorIdx: index("search_index_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    typePopularityIdx: index("search_index_type_popularity_idx").on(table.contentType, table.popularityScore.desc()),
  })
);

// ============================================================
// LIVE VIDEO
// ============================================================
export const liveVideos = pgTable(
  "live_videos",
  {
    id: text("id").primaryKey(),
    hostId: text("host_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    coHostId: text("co_host_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 200 }),
    status: liveStatusEnum("status").default("SCHEDULED").notNull(),
    streamKey: text("stream_key").notNull(),
    playbackUrl: varchar("playback_url", { length: 500 }),
    viewerCount: integer("viewer_count").default(0).notNull(),
    peakViewers: integer("peak_viewers").default(0).notNull(),
    totalViews: integer("total_views").default(0).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    hostIdx: index("live_videos_host_idx").on(table.hostId),
    statusIdx: index("live_videos_status_idx").on(table.status),
  })
);

export const liveComments = pgTable(
  "live_comments",
  {
    id: text("id").primaryKey(),
    liveId: text("live_id").notNull().references(() => liveVideos.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    isPinned: boolean("is_pinned").default(false).notNull(),
    isHidden: boolean("is_hidden").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    liveIdx: index("live_comments_live_idx").on(table.liveId, table.createdAt),
  })
);

// ============================================================
// CALLS
// ============================================================
export const calls = pgTable(
  "calls",
  {
    id: text("id").primaryKey(),
    type: callTypeEnum("type").notNull(),
    status: callStatusEnum("status").default("INITIATED").notNull(),
    initiatorId: text("initiator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    maxParticipants: integer("max_participants").default(2).notNull(),
    isRecording: boolean("is_recording").default(false).notNull(),
    recordingUrl: varchar("recording_url", { length: 500 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds").default(0).notNull(),
    mediaServerId: text("media_server_id"),
    roomId: varchar("room_id", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    initiatorIdx: index("calls_initiator_idx").on(table.initiatorId, table.createdAt.desc()),
    conversationIdx: index("calls_conversation_idx").on(table.conversationId),
    statusIdx: index("calls_status_idx").on(table.status),
    roomIdx: index("calls_room_idx").on(table.roomId),
  })
);

export const callParticipants = pgTable(
  "call_participants",
  {
    id: text("id").primaryKey(),
    callId: text("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: callParticipantStatusEnum("status").default("INVITED").notNull(),
    isMuted: boolean("is_muted").default(false).notNull(),
    isVideoOff: boolean("is_video_off").default(false).notNull(),
    isScreenShare: boolean("is_screen_share").default(false).notNull(),
    connectionQuality: connectionQualityEnum("connection_quality"),
    deviceType: varchar("device_type", { length: 20 }),
    appVersion: varchar("app_version", { length: 20 }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    leftAt: timestamp("left_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueParticipant: uniqueIndex("call_participants_unique").on(table.callId, table.userId),
    callIdx: index("call_participants_call_idx").on(table.callId),
    userIdx: index("call_participants_user_idx").on(table.userId, table.createdAt.desc()),
    statusIdx: index("call_participants_status_idx").on(table.status),
  })
);

export const callSignalingLogs = pgTable(
  "call_signaling_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    callId: text("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
    participantId: text("participant_id").references(() => callParticipants.id, { onDelete: "set null" }),
    direction: signalingDirectionEnum("direction").notNull(),
    messageType: varchar("message_type", { length: 50 }).notNull(),
    payload: jsonb("payload").notNull(),
    sequenceId: bigint("sequence_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    callIdx: index("call_signaling_logs_call_idx").on(table.callId, table.createdAt),
    sequenceIdx: index("call_signaling_logs_sequence_idx").on(table.callId, table.sequenceId),
    participantIdx: index("call_signaling_logs_participant_idx").on(table.participantId, table.createdAt),
  })
);

// ============================================================
// AUDIT LOGS (partitioned)
// ============================================================
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(), // event_id
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorIp: inet("actor_ip"),
    actorUserAgent: text("actor_user_agent"),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 50 }),
    resourceId: text("resource_id"),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    correlationId: text("correlation_id"),
    sessionId: text("session_id"),
    requestId: text("request_id"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    actorIdx: index("audit_logs_actor_idx").on(table.actorId, table.createdAt.desc()),
    resourceIdx: index("audit_logs_resource_idx").on(table.resourceType, table.resourceId, table.createdAt.desc()),
    correlationIdx: index("audit_logs_correlation_idx").on(table.correlationId),
    actionIdx: index("audit_logs_action_idx").on(table.action, table.createdAt.desc()),
  })
);

// ============================================================
// RATE LIMITING
// ============================================================
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    id: text("id").primaryKey(),
    identifier: varchar("identifier", { length: 200 }).notNull(),
    endpoint: varchar("endpoint", { length: 100 }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    limit: integer("limit").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueBucket: uniqueIndex("rate_limit_buckets_unique").on(table.identifier, table.endpoint, table.windowStart),
    lookupIdx: index("rate_limit_buckets_lookup_idx").on(table.identifier, table.endpoint, table.windowEnd),
    cleanupIdx: index("rate_limit_buckets_cleanup_idx").on(table.windowEnd),
  })
);

// ============================================================
// ANALYTICS (Daily & Hourly Aggregations)
// ============================================================
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    id: text("id").primaryKey(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    metric: varchar("metric", { length: 100 }).notNull(),
    value: decimal("value", { precision: 20, scale: 4 }).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueDaily: uniqueIndex("analytics_daily_unique").on(table.date, table.metric),
    dateIdx: index("analytics_daily_date_idx").on(table.date.desc()),
    metricIdx: index("analytics_daily_metric_idx").on(table.metric),
  })
);

export const analyticsHourly = pgTable(
  "analytics_hourly",
  {
    id: text("id").primaryKey(),
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    metric: varchar("metric", { length: 100 }).notNull(),
    value: decimal("value", { precision: 20, scale: 4 }).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueHourly: uniqueIndex("analytics_hourly_unique").on(table.hour, table.metric),
    hourIdx: index("analytics_hourly_hour_idx").on(table.hour.desc()),
    metricIdx: index("analytics_hourly_metric_idx").on(table.metric),
  })
);

// ============================================================
// PENDING UPLOADS
// ============================================================
export const pendingUploads = pgTable(
  "pending_uploads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    storagePath: varchar("storage_path", { length: 500 }).notNull(),
    url: varchar("url", { length: 500 }).notNull(),
    confirmed: boolean("confirmed").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    confirmedIdx: index("pending_uploads_confirmed_idx").on(table.confirmed, table.createdAt),
  })
);

// ============================================================
// TUS UPLOADS (Resumable Upload Protocol)
// ============================================================
export const tusUploadStatusEnum = pgEnum("tus_upload_status", [
  "created", "uploading", "completed", "failed", "expired"
]);

export const tusUploads = pgTable(
  "tus_uploads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    storagePath: varchar("storage_path", { length: 500 }).notNull(),
    fileSize: bigint("file_size", { mode: "number" }).notNull(),
    uploadedSize: bigint("uploaded_size", { mode: "number" }).default(0).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    status: tusUploadStatusEnum("status").default("created").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("tus_uploads_user_id_idx").on(table.userId),
    statusIdx: index("tus_uploads_status_idx").on(table.status),
    expiresAtIdx: index("tus_uploads_expires_at_idx").on(table.expiresAt),
    userStatusIdx: index("tus_uploads_user_status_idx").on(table.userId, table.status),
  })
);

// ============================================================
// PROCESSING JOBS
// ============================================================
export const processingJobTypeEnum = pgEnum("processing_job_type", [
  "media", "video", "audio", "image", "thumbnail", "transcode", "nsfw", "metadata"
]);

export const processingJobStatusEnum = pgEnum("processing_job_status", [
  "pending", "processing", "completed", "failed", "cancelled"
]);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: text("id").primaryKey(),
    uploadId: text("upload_id").notNull().references(() => tusUploads.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: processingJobTypeEnum("type").notNull(),
    status: processingJobStatusEnum("status").default("pending").notNull(),
    payload: jsonb("payload").default({}).notNull(),
    result: jsonb("result"),
    error: text("processing_error"),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uploadIdIdx: index("processing_jobs_upload_id_idx").on(table.uploadId),
    userIdIdx: index("processing_jobs_user_id_idx").on(table.userId),
    statusIdx: index("processing_jobs_status_idx").on(table.status),
    typeStatusIdx: index("processing_jobs_type_status_idx").on(table.type, table.status),
  })
);

// ============================================================
// SPONSORED CONTENT
// ============================================================
export const sponsoredCampaignStatusEnum = pgEnum("sponsored_campaign_status", [
  "draft", "active", "paused", "ended", "archived"
]);

export const sponsoredPostStatusEnum = pgEnum("sponsored_post_status", [
  "pending", "active", "paused", "rejected", "archived"
]);

export const sponsoredCampaigns = pgTable(
  "sponsored_campaigns",
  {
    id: text("id").primaryKey(),
    sponsorUserId: text("sponsor_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    targetAudience: jsonb("target_audience").default({}).notNull(),
    budgetCents: bigint("budget_cents", { mode: "number" }).default(0).notNull(),
    spentCents: bigint("spent_cents", { mode: "number" }).default(0).notNull(),
    bidCents: bigint("bid_cents", { mode: "number" }).default(100).notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    status: sponsoredCampaignStatusEnum("status").default("draft").notNull(),
    maxImpressionsPerUserPerDay: integer("max_impressions_per_user_per_day").default(3).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    activeIdx: index("idx_sponsored_campaigns_active").on(table.status, table.startAt, table.endAt).where(sql`${table.status} = 'active'`),
    sponsorIdx: index("idx_sponsored_campaigns_sponsor").on(table.sponsorUserId),
  })
);

export const sponsoredPosts = pgTable(
  "sponsored_posts",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id").notNull().references(() => sponsoredCampaigns.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    targetAudience: jsonb("target_audience"),
    bidCents: bigint("bid_cents", { mode: "number" }),
    status: sponsoredPostStatusEnum("status").default("pending").notNull(),
    impressions: bigint("impressions", { mode: "number" }).default(0).notNull(),
    clicks: bigint("clicks", { mode: "number" }).default(0).notNull(),
    spentCents: bigint("spent_cents", { mode: "number" }).default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueCampaignPost: uniqueIndex("sponsored_posts_unique").on(table.campaignId, table.postId),
    campaignIdx: index("idx_sponsored_posts_campaign").on(table.campaignId, table.status),
    postIdx: index("idx_sponsored_posts_post").on(table.postId),
  })
);

export const sponsoredImpressions = pgTable(
  "sponsored_impressions",
  {
    id: text("id").primaryKey(),
    sponsoredPostId: text("sponsored_post_id").notNull().references(() => sponsoredPosts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    impressionAt: timestamp("impression_at", { withTimezone: true }).defaultNow().notNull(),
    impressionDate: timestamp("impression_date", { withTimezone: true }).default(sql`CURRENT_DATE`).notNull(),
  },
  (table) => ({
    postUserDateIdx: index("idx_sponsored_impressions_post_user_date").on(table.sponsoredPostId, table.userId, table.impressionDate),
    userDateIdx: index("idx_sponsored_impressions_user_date").on(table.userId, table.impressionDate),
  })
);

export const sponsoredClicks = pgTable(
  "sponsored_clicks",
  {
    id: text("id").primaryKey(),
    sponsoredPostId: text("sponsored_post_id").notNull().references(() => sponsoredPosts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    postUserIdx: index("idx_sponsored_clicks_post_user").on(table.sponsoredPostId, table.userId),
    userIdx: index("idx_sponsored_clicks_user").on(table.userId, table.clickedAt.desc()),
  })
);

// ============================================================
// BETTER AUTH TABLES
// ============================================================
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: varchar("account_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 255 }).notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: varchar("scope", { length: 255 }),
    password: varchar("password", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("accounts_user_id_idx").on(table.userId),
    providerAccountIdx: uniqueIndex("accounts_provider_account_idx").on(table.providerId, table.accountId),
  })
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 255 }).unique().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("sessions_user_id_idx").on(table.userId),
    tokenIdx: uniqueIndex("sessions_token_idx").on(table.token),
    expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt),
  })
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).unique().notNull(),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index("refresh_tokens_user_id_idx").on(table.userId),
    tokenHashIdx: uniqueIndex("refresh_tokens_token_hash_idx").on(table.tokenHash),
    sessionIdIdx: index("refresh_tokens_session_id_idx").on(table.sessionId),
    expiresAtIdx: index("refresh_tokens_expires_at_idx").on(table.expiresAt),
  })
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    value: varchar("value", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    identifierValueIdx: uniqueIndex("verifications_identifier_value_idx").on(table.identifier, table.value),
    expiresAtIdx: index("verifications_expires_at_idx").on(table.expiresAt),
    userIdIdx: index("verifications_user_id_idx").on(table.userId),
  })
);

// ============================================================
// RELATIONS
// ============================================================
export const usersRelations = relations(users, ({ many, one }) => ({
  deviceTokens: many(deviceTokens),
  following: many(follows, { relationName: "follower" }),
  followers: many(follows, { relationName: "following" }),
  blocks: many(blocks, { relationName: "blocker" }),
  blockedBy: many(blocks, { relationName: "blocked" }),
  restrictions: many(restrictions, { relationName: "restrictor" }),
  restrictedBy: many(restrictions, { relationName: "restricted" }),
  closeFriends: many(closeFriends, { relationName: "user" }),
  closeFriendOf: many(closeFriends, { relationName: "friend" }),
  posts: many(posts),
  sponsoredPosts: many(posts, { relationName: "SponsoredPosts" }),
  reels: many(reels),
  stories: many(stories),
  storyViews: many(storyViews, { relationName: "StoryViews" }),
  storyReplies: many(storyReplies, { relationName: "StoryAuthor" }),
  comments: many(comments),
  likes: many(likes),
  savedItems: many(savedItems),
  collections: many(collections),
  conversationMembers: many(conversationMembers),
  sentMessages: many(messages, { relationName: "sender" }),
  messageReactions: many(messageReactions),
  actorNotifications: many(notifications, { relationName: "actor" }),
  notifications: many(notifications, { relationName: "recipient" }),
  reports: many(reports, { relationName: "reporter" }),
  moderationActions: many(moderationActions, { relationName: "moderator" }),
  pendingUploads: many(pendingUploads),
  tusUploads: many(tusUploads),
  processingJobs: many(processingJobs),
  sessions: many(sessions),
  refreshTokens: many(refreshTokens),
  accounts: many(accounts),
  callsInitiated: many(calls, { relationName: "initiator" }),
  callParticipants: many(callParticipants),
  liveVideosHosted: many(liveVideos, { relationName: "host" }),
  liveVideosCoHosted: many(liveVideos, { relationName: "coHost" }),
  liveComments: many(liveComments),
  searchHistory: many(searchHistory),
  verifications: many(verifications, { relationName: "UserVerifications" }),
}));

export const postsRelations = relations(posts, ({ many, one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  location: one(locations, { fields: [posts.locationId], references: [locations.id] }),
  sponsor: one(users, { fields: [posts.sponsorUserId], references: [users.id], relationName: "SponsoredPosts" }),
  sharedStories: many(stories, { relationName: "SharedStories" }),
}));

export const storiesRelations = relations(stories, ({ many, one }) => ({
  author: one(users, { fields: [stories.authorId], references: [users.id] }),
  reel: one(reels, { fields: [stories.reelId], references: [reels.id], relationName: "StoryReel" }),
  sharedFromPost: one(posts, { fields: [stories.sharedFromPostId], references: [posts.id], relationName: "SharedStories" }),
  storyItems: many(storyItems, { relationName: "StoryItems" }),
  storyViews: many(storyViews, { relationName: "StoryViews" }),
  storyReplies: many(storyReplies, { relationName: "StoryReplies" }),
}));

export const storyItemsRelations = relations(storyItems, ({ one }) => ({
  story: one(stories, { fields: [storyItems.storyId], references: [stories.id], relationName: "StoryItems" }),
}));

export const storyViewsRelations = relations(storyViews, ({ one }) => ({
  story: one(stories, { fields: [storyViews.storyId], references: [stories.id], relationName: "StoryViews" }),
  viewer: one(users, { fields: [storyViews.viewerId], references: [users.id], relationName: "StoryViews" }),
}));

export const storyRepliesRelations = relations(storyReplies, ({ one }) => ({
  story: one(stories, { fields: [storyReplies.storyId], references: [stories.id], relationName: "StoryReplies" }),
  sender: one(users, { fields: [storyReplies.senderId], references: [users.id], relationName: "StoryAuthor" }),
}));

export const collectionsRelations = relations(collections, ({ many, one }) => ({
  user: one(users, { fields: [collections.userId], references: [users.id] }),
  savedItems: many(savedItems),
}));

export const savedItemsRelations = relations(savedItems, ({ one }) => ({
  user: one(users, { fields: [savedItems.userId], references: [users.id] }),
  collection: one(collections, { fields: [savedItems.collectionId], references: [collections.id] }),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  members: many(conversationMembers),
  messages: many(messages),
}));

export const conversationMembersRelations = relations(conversationMembers, ({ one }) => ({
  conversation: one(conversations, { fields: [conversationMembers.conversationId], references: [conversations.id] }),
  user: one(users, { fields: [conversationMembers.userId], references: [users.id] }),
}));

export const messagesRelations = relations(messages, ({ many, one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id], relationName: "messages" }),
  sender: one(users, { fields: [messages.senderId], references: [users.id], relationName: "sender" }),
  replyTo: one(messages, { fields: [messages.replyToId], references: [messages.id], relationName: "replies" }),
  replies: many(messages, { relationName: "replies" }),
  reactions: many(messageReactions),
}));

export const messageReactionsRelations = relations(messageReactions, ({ one }) => ({
  message: one(messages, { fields: [messageReactions.messageId], references: [messages.id] }),
  user: one(users, { fields: [messageReactions.userId], references: [users.id] }),
}));

export const hashtagsRelations = relations(hashtags, ({ many }) => ({
  usages: many(hashtagUsages),
}));

export const hashtagUsagesRelations = relations(hashtagUsages, ({ one }) => ({
  hashtag: one(hashtags, { fields: [hashtagUsages.hashtagId], references: [hashtags.id] }),
}));

export const locationsRelations = relations(locations, ({ many }) => ({
  posts: many(posts),
}));

export const liveVideosRelations = relations(liveVideos, ({ many, one }) => ({
  host: one(users, { fields: [liveVideos.hostId], references: [users.id], relationName: "host" }),
  coHost: one(users, { fields: [liveVideos.coHostId], references: [users.id], relationName: "coHost" }),
  comments: many(liveComments),
}));

export const liveCommentsRelations = relations(liveComments, ({ one }) => ({
  live: one(liveVideos, { fields: [liveComments.liveId], references: [liveVideos.id] }),
  user: one(users, { fields: [liveComments.userId], references: [users.id] }),
}));

export const callsRelations = relations(calls, ({ many, one }) => ({
  initiator: one(users, { fields: [calls.initiatorId], references: [users.id], relationName: "initiator" }),
  participants: many(callParticipants),
  signalingLogs: many(callSignalingLogs),
}));

export const callParticipantsRelations = relations(callParticipants, ({ one }) => ({
  call: one(calls, { fields: [callParticipants.callId], references: [calls.id] }),
  user: one(users, { fields: [callParticipants.userId], references: [users.id] }),
}));

export const callSignalingLogsRelations = relations(callSignalingLogs, ({ one }) => ({
  call: one(calls, { fields: [callSignalingLogs.callId], references: [calls.id] }),
}));

export const sessionsRelations = relations(sessions, ({ many, one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  refreshTokens: many(refreshTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
  session: one(sessions, { fields: [refreshTokens.sessionId], references: [sessions.id] }),
}));

export const verificationsRelations = relations(verifications, ({ one }) => ({
  user: one(users, { fields: [verifications.userId], references: [users.id], relationName: "UserVerifications" }),
}));

export const reelsRelations = relations(reels, ({ many, one }) => ({
  author: one(users, { fields: [reels.authorId], references: [users.id] }),
  audio: one(audioTracks, { fields: [reels.audioId], references: [audioTracks.id] }),
  stories: many(stories, { relationName: "StoryReel" }),
}));

export const audioTracksRelations = relations(audioTracks, ({ many }) => ({
  reels: many(reels),
}));

export const sponsoredCampaignsRelations = relations(sponsoredCampaigns, ({ one, many }) => ({
  sponsor: one(users, { fields: [sponsoredCampaigns.sponsorUserId], references: [users.id] }),
  sponsoredPosts: many(sponsoredPosts),
}));

export const sponsoredImpressionsRelations = relations(sponsoredImpressions, ({ one }) => ({
  sponsoredPost: one(sponsoredPosts, { fields: [sponsoredImpressions.sponsoredPostId], references: [sponsoredPosts.id] }),
  user: one(users, { fields: [sponsoredImpressions.userId], references: [users.id] }),
}));

export const sponsoredClicksRelations = relations(sponsoredClicks, ({ one }) => ({
  sponsoredPost: one(sponsoredPosts, { fields: [sponsoredClicks.sponsoredPostId], references: [sponsoredPosts.id] }),
  user: one(users, { fields: [sponsoredClicks.userId], references: [users.id] }),
}));

export const sponsoredPostsRelations = relations(sponsoredPosts, ({ one, many }) => ({
  campaign: one(sponsoredCampaigns, { fields: [sponsoredPosts.campaignId], references: [sponsoredCampaigns.id] }),
  post: one(posts, { fields: [sponsoredPosts.postId], references: [posts.id] }),
  impressions: many(sponsoredImpressions),
  clicks: many(sponsoredClicks),
}));

export const tusUploadsRelations = relations(tusUploads, ({ one, many }) => ({
  user: one(users, { fields: [tusUploads.userId], references: [users.id] }),
  processingJobs: many(processingJobs),
}));

export const processingJobsRelations = relations(processingJobs, ({ one }) => ({
  upload: one(tusUploads, { fields: [processingJobs.uploadId], references: [tusUploads.id] }),
  user: one(users, { fields: [processingJobs.userId], references: [users.id] }),
}));

// Export all tables
export const schema = {
  users,
  deviceTokens,
  follows,
  blocks,
  restrictions,
  closeFriends,
  posts,
  mediaItems,
  stories,
  storyItems,
  storyViews,
  storyReplies,
  reels,
  audioTracks,
  comments,
  likes,
  collections,
  savedItems,
  conversations,
  conversationMembers,
  messages,
  messageReactions,
  notifications,
  reports,
  moderationActions,
  searchHistory,
  hashtags,
  hashtagUsages,
  locations,
  searchIndex,
  liveVideos,
  liveComments,
  calls,
  callParticipants,
  callSignalingLogs,
  auditLogs,
  rateLimitBuckets,
  analyticsDaily,
  analyticsHourly,
  pendingUploads,
  tusUploads,
  processingJobs,
  sponsoredCampaigns,
  sponsoredPosts,
  sponsoredImpressions,
  sponsoredClicks,
  accounts,
  sessions,
  refreshTokens,
  verifications,
};

// Type helpers
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Reel = typeof reels.$inferSelect;
export type NewReel = typeof reels.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type StoryItem = typeof storyItems.$inferSelect;
export type StoryView = typeof storyViews.$inferSelect;
export type SavedItem = typeof savedItems.$inferSelect;
export type ConversationMember = typeof conversationMembers.$inferSelect;
export type Like = typeof likes.$inferSelect;
export type DeviceToken = typeof deviceTokens.$inferSelect;
export type Follow = typeof follows.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type CloseFriend = typeof closeFriends.$inferSelect;
export type PendingUpload = typeof pendingUploads.$inferSelect;
export type TusUpload = typeof tusUploads.$inferSelect;
export type NewTusUpload = typeof tusUploads.$inferInsert;
export type ProcessingJob = typeof processingJobs.$inferSelect;
export type NewProcessingJob = typeof processingJobs.$inferInsert;
export type Call = typeof calls.$inferSelect;
export type CallParticipant = typeof callParticipants.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type AnalyticsDaily = typeof analyticsDaily.$inferSelect;
export type AnalyticsHourly = typeof analyticsHourly.$inferSelect;