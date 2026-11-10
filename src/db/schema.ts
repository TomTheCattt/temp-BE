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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const devicePlatformEnum = pgEnum("device_platform", ["IOS", "ANDROID"]);
export const mediaTypeEnum = pgEnum("media_type", ["IMAGE", "VIDEO"]);
export const messageContentTypeEnum = pgEnum("message_content_type", [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "POST",
  "STORY",
  "REEL",
  "LIKE",
]);
export const messageStatusEnum = pgEnum("message_status", [
  "SENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "LIKE",
  "COMMENT",
  "FOLLOW",
  "FOLLOW_REQUEST",
  "MENTION",
  "TAGGED_IN_POST",
  "STORY_MENTION",
  "LIVE_VIDEO",
]);

// Users table
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firebaseUid: varchar("firebase_uid", { length: 128 }).unique(),
    username: varchar("username", { length: 50 }).unique().notNull(),
    fullName: varchar("full_name", { length: 100 }).notNull(),
    email: varchar("email", { length: 255 }).unique().notNull(),
    phone: varchar("phone", { length: 30 }),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    bio: text("bio"),
    website: varchar("website", { length: 255 }),
    isVerified: boolean("is_verified").default(false).notNull(),
    isPrivate: boolean("is_private").default(false).notNull(),
    postsCount: integer("posts_count").default(0).notNull(),
    followersCount: integer("followers_count").default(0).notNull(),
    followingCount: integer("following_count").default(0).notNull(),
    // Better Auth required fields
    name: varchar("name", { length: 100 }),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: varchar("image", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    usernameIdx: uniqueIndex("users_username_idx").on(table.username),
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
    firebaseUidIdx: uniqueIndex("users_firebase_uid_idx").on(table.firebaseUid),
  })
);

// Device tokens
export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 500 }).unique().notNull(),
    platform: devicePlatformEnum("platform").default("IOS").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index("device_tokens_user_id_idx").on(table.userId),
    expiresAtIdx: index("device_tokens_expires_at_idx").on(table.expiresAt),
  })
);

// Follows
export const follows = pgTable(
  "follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followingId: uuid("following_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueFollow: uniqueIndex("follows_unique").on(table.followerId, table.followingId),
    followerIdx: index("follows_follower_id_idx").on(table.followerId),
    followingIdx: index("follows_following_id_idx").on(table.followingId),
  })
);

// Blocks
export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueBlock: uniqueIndex("blocks_unique").on(table.blockerId, table.blockedId),
  })
);

// Posts
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    caption: text("caption"),
    locationName: varchar("location_name", { length: 200 }),
    locationLat: decimal("location_lat", { precision: 10, scale: 8 }),
    locationLng: decimal("location_lng", { precision: 11, scale: 8 }),
    likesCount: integer("likes_count").default(0).notNull(),
    commentsCount: integer("comments_count").default(0).notNull(),
    isSponsored: boolean("is_sponsored").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    authorIdx: index("posts_author_id_idx").on(table.authorId),
    createdAtIdx: index("posts_created_at_idx").on(table.createdAt),
  })
);

// Media items
export const mediaItems = pgTable(
  "media_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    url: varchar("url", { length: 500 }).notNull(),
    thumbnailUrl: varchar("thumbnail_url", { length: 500 }),
    type: mediaTypeEnum("type").notNull(),
    width: integer("width"),
    height: integer("height"),
    duration: decimal("duration", { precision: 8, scale: 3 }),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => ({
    postIdIdx: index("media_items_post_id_idx").on(table.postId),
  })
);

// Likes
export const likes = pgTable(
  "likes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    reelId: uuid("reel_id").references(() => reels.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => comments.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniquePostLike: uniqueIndex("likes_unique_post").on(table.userId, table.postId),
    uniqueReelLike: uniqueIndex("likes_unique_reel").on(table.userId, table.reelId),
    uniqueCommentLike: uniqueIndex("likes_unique_comment").on(table.userId, table.commentId),
  })
);

// Saved posts
export const savedPosts = pgTable(
  "saved_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueSave: uniqueIndex("saved_posts_unique").on(table.userId, table.postId),
  })
);

// Comments
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    reelId: uuid("reel_id").references(() => reels.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => stories.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    likesCount: integer("likes_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    postIdx: index("comments_post_id_created_at_idx").on(table.postId, table.createdAt),
    reelIdx: index("comments_reel_id_created_at_idx").on(table.reelId, table.createdAt),
    storyIdx: index("comments_story_id_created_at_idx").on(table.storyId, table.createdAt),
    parentIdx: index("comments_parent_id_idx").on(table.parentId),
  })
);

// Stories
export const stories = pgTable(
  "stories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    authorIdx: index("stories_author_id_idx").on(table.authorId),
    expiresAtIdx: index("stories_expires_at_idx").on(table.expiresAt),
  })
);

// Story items
export const storyItems = pgTable(
  "story_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    mediaUrl: varchar("media_url", { length: 500 }).notNull(),
    type: mediaTypeEnum("type").notNull(),
    duration: decimal("duration", { precision: 8, scale: 3 }).default("5").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    stickerType: varchar("sticker_type", { length: 50 }),
    stickerData: text("sticker_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storyIdIdx: index("story_items_story_id_idx").on(table.storyId),
  })
);

// Story views
export const storyViews = pgTable(
  "story_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    viewerId: uuid("viewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueView: uniqueIndex("story_views_unique").on(table.storyId, table.viewerId),
  })
);

// Reels
export const reels = pgTable(
  "reels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    videoUrl: varchar("video_url", { length: 500 }).notNull(),
    thumbnailUrl: varchar("thumbnail_url", { length: 500 }),
    caption: text("caption"),
    audioName: varchar("audio_name", { length: 200 }),
    audioArtist: varchar("audio_artist", { length: 200 }),
    audioCoverUrl: varchar("audio_cover_url", { length: 500 }),
    isOriginalAudio: boolean("is_original_audio").default(true).notNull(),
    duration: decimal("duration", { precision: 8, scale: 3 }).notNull(),
    likesCount: integer("likes_count").default(0).notNull(),
    commentsCount: integer("comments_count").default(0).notNull(),
    sharesCount: integer("shares_count").default(0).notNull(),
    viewsCount: integer("views_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    authorIdx: index("reels_author_id_idx").on(table.authorId),
    createdAtIdx: index("reels_created_at_idx").on(table.createdAt),
  })
);

// Saved reels
export const savedReels = pgTable(
  "saved_reels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reelId: uuid("reel_id")
      .notNull()
      .references(() => reels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueSave: uniqueIndex("saved_reels_unique").on(table.userId, table.reelId),
  })
);

// Conversations
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    isGroup: boolean("is_group").default(false).notNull(),
    groupName: varchar("group_name", { length: 100 }),
    groupAvatar: varchar("group_avatar", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    updatedAtIdx: index("conversations_updated_at_idx").on(table.updatedAt),
  })
);

// Conversation members
export const conversationMembers = pgTable(
  "conversation_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isMuted: boolean("is_muted").default(false).notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueMember: uniqueIndex("conversation_members_unique").on(table.conversationId, table.userId),
    userIdIdx: index("conversation_members_user_id_idx").on(table.userId),
  })
);

// Messages
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentType: messageContentTypeEnum("content_type").notNull(),
    textContent: text("text_content"),
    mediaUrl: varchar("media_url", { length: 500 }),
    mediaThumbnail: varchar("media_thumbnail", { length: 500 }),
    mediaDuration: decimal("media_duration", { precision: 8, scale: 3 }),
    referenceId: uuid("reference_id"),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => messages.id, { onDelete: "set null" }),
    status: messageStatusEnum("status").default("SENT").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    convCreatedIdx: index("messages_conversation_id_created_at_idx").on(table.conversationId, table.createdAt),
    senderIdx: index("messages_sender_id_idx").on(table.senderId),
  })
);

// Notifications
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    reelId: uuid("reel_id").references(() => reels.id, { onDelete: "cascade" }),
    commentText: text("comment_text"),
    postThumbnailUrl: varchar("post_thumbnail_url", { length: 500 }),
    isRead: boolean("is_read").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    recipientIdx: index("notifications_recipient_id_created_at_idx").on(table.recipientId, table.createdAt),
    recipientReadIdx: index("notifications_recipient_id_is_read_idx").on(table.recipientId, table.isRead),
  })
);

// User settings
export const userSettings = pgTable(
  "user_settings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .primaryKey(),
    language: varchar("language", { length: 10 }).default("en").notNull(),
    biometricEnabled: boolean("biometric_enabled").default(true).notNull(),
    pushEnabled: boolean("push_enabled").default(true).notNull(),
    darkMode: boolean("dark_mode").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// Close friends
export const closeFriends = pgTable(
  "close_friends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendId: uuid("friend_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueFriend: uniqueIndex("close_friends_unique").on(table.userId, table.friendId),
    userIdx: index("close_friends_user_id_idx").on(table.userId),
    friendIdx: index("close_friends_friend_id_idx").on(table.friendId),
  })
);

// Pending uploads
export const pendingUploads = pgTable(
  "pending_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storagePath: varchar("storage_path", { length: 500 }).notNull(),
    url: varchar("url", { length: 500 }).notNull(),
    confirmed: boolean("confirmed").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    confirmedIdx: index("pending_uploads_confirmed_created_at_idx").on(table.confirmed, table.createdAt),
  })
);

// Better Auth tables
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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

// Refresh tokens (for rotation)
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).unique().notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
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

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    value: varchar("value", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    identifierValueIdx: uniqueIndex("verifications_identifier_value_idx").on(table.identifier, table.value),
    expiresAtIdx: index("verifications_expires_at_idx").on(table.expiresAt),
  })
);

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  deviceTokens: many(deviceTokens),
  following: many(follows, { relationName: "follower" }),
  followers: many(follows, { relationName: "following" }),
  blocks: many(blocks, { relationName: "blocker" }),
  blockedBy: many(blocks, { relationName: "blocked" }),
  posts: many(posts),
  reels: many(reels),
  stories: many(stories),
  comments: many(comments),
  likes: many(likes),
  savedPosts: many(savedPosts),
  savedReels: many(savedReels),
  conversationMembers: many(conversationMembers),
  sentMessages: many(messages),
  actorNotifications: many(notifications, { relationName: "actor" }),
  notifications: many(notifications, { relationName: "recipient" }),
  settings: one(userSettings, { fields: [users.id], references: [userSettings.userId] }),
  closeFriends: many(closeFriends, { relationName: "user" }),
  closeFriendOf: many(closeFriends, { relationName: "friend" }),
  pendingUploads: many(pendingUploads),
  sessions: many(sessions),
  accounts: many(accounts),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  refreshTokens: many(refreshTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
  session: one(sessions, { fields: [refreshTokens.sessionId], references: [sessions.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const verificationsRelations = relations(verifications, ({ one }) => ({
  // No relations needed for verifications
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  mediaItems: many(mediaItems),
  comments: many(comments),
  likes: many(likes),
  savedBy: many(savedPosts),
}));

export const reelsRelations = relations(reels, ({ one, many }) => ({
  author: one(users, { fields: [reels.authorId], references: [users.id] }),
  comments: many(comments),
  likes: many(likes),
  savedBy: many(savedReels),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  members: many(conversationMembers),
  messages: many(messages),
}));

export const conversationMembersRelations = relations(conversationMembers, ({ one }) => ({
  conversation: one(conversations, { fields: [conversationMembers.conversationId], references: [conversations.id] }),
  user: one(users, { fields: [conversationMembers.userId], references: [users.id] }),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
  replyTo: one(messages, { fields: [messages.replyToId], references: [messages.id], relationName: "replies" }),
  replies: many(messages, { relationName: "replies" }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, { fields: [notifications.recipientId], references: [users.id], relationName: "recipient" }),
  actor: one(users, { fields: [notifications.actorId], references: [users.id], relationName: "actor" }),
  post: one(posts, { fields: [notifications.postId], references: [posts.id] }),
  reel: one(reels, { fields: [notifications.reelId], references: [reels.id] }),
}));

// Export all tables for easy importing
export const schema = {
  users,
  deviceTokens,
  follows,
  blocks,
  posts,
  mediaItems,
  likes,
  savedPosts,
  comments,
  stories,
  storyItems,
  storyViews,
  reels,
  savedReels,
  conversations,
  conversationMembers,
  messages,
  notifications,
  userSettings,
  closeFriends,
  pendingUploads,
  sessions,
  refreshTokens,
  accounts,
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
export type UserSettings = typeof userSettings.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;