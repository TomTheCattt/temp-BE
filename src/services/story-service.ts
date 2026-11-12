import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, inArray, lt, not, isNull, or, gte } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// ============================================================================
// Types
// ============================================================================

export interface CreateStoryInput {
  authorId: string;
  audience: "followers" | "close_friends";
  items: Array<{
    mediaUrl: string;
    type: "IMAGE" | "VIDEO";
    duration?: number;
    sortOrder: number;
    stickerType?: string;
    stickerData?: Record<string, any>;
    thumbnailUrl?: string;
  }>;
}

export interface StoryWithDetails {
  id: string;
  authorId: string;
  audience: string;
  expiresAt: Date;
  viewsCount: number;
  repliesCount: number;
  reelId: string | null;
  sharedFromPostId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  author: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
    isPrivate: boolean;
  };
  items: Array<{
    id: string;
    storyId: string;
    mediaUrl: string;
    thumbnailUrl: string | null;
    type: string;
    duration: string;
    sortOrder: number;
    stickerType: string | null;
    stickerData: Record<string, any> | null;
    createdAt: Date;
  }>;
  viewed?: boolean;
}

export interface StoryFeedItem {
  userId: string;
  author: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
  };
  stories: Array<{
    id: string;
    createdAt: Date;
    expiresAt: Date;
    audience: string;
    items: Array<{
      id: string;
      mediaUrl: string;
      type: string;
      duration: string;
      sortOrder: number;
      stickerType: string | null;
      stickerData: Record<string, any> | null;
    }>;
  }>;
}

export interface StoryView {
  id: string;
  storyId: string;
  viewerId: string;
  viewedAt: Date;
  viewer: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
  };
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildStoryWithDetails(story: any, items: any[], viewed?: boolean): StoryWithDetails {
  return {
    id: story.id,
    authorId: story.authorId,
    audience: story.audience,
    expiresAt: story.expiresAt,
    viewsCount: story.viewsCount,
    repliesCount: story.repliesCount,
    reelId: story.reelId,
    sharedFromPostId: story.sharedFromPostId,
    createdAt: story.createdAt,
    deletedAt: story.deletedAt,
    author: story.author,
    items: items.map((item) => ({
      id: item.id,
      storyId: item.storyId,
      mediaUrl: item.mediaUrl,
      thumbnailUrl: item.thumbnailUrl,
      type: item.type,
      duration: item.duration,
      sortOrder: item.sortOrder,
      stickerType: item.stickerType,
      stickerData: item.stickerData,
      createdAt: item.createdAt,
    })),
    viewed,
  };
}

// ============================================================================
// Story Service Class
// ============================================================================

export class StoryService {
  /**
   * Create a new story with multiple items
   */
  async createStory(input: CreateStoryInput): Promise<StoryWithDetails> {
    const { authorId, audience = "followers", items } = input;

    // Validate media count (1-10 items per story)
    if (items.length < 1 || items.length > 10) {
      throw new HTTPException(400, { message: "Story must have 1-10 items" });
    }

    // Validate media ordering
    const sortedItems = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < sortedItems.length; i++) {
      if (sortedItems[i].sortOrder !== i) {
        throw new HTTPException(400, { message: "Item sortOrder must be sequential starting from 0" });
      }
    }

    // Calculate expiration (24 hours from now)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Insert story
    const [story] = await db.insert(schema.stories).values({
      authorId,
      audience,
      expiresAt,
    }).returning();

    // Insert story items
    if (sortedItems.length > 0) {
      await db.insert(schema.storyItems).values(
        sortedItems.map((item) => ({
          storyId: story.id,
          mediaUrl: item.mediaUrl,
          thumbnailUrl: item.thumbnailUrl,
          type: item.type,
          duration: (item.duration || 5).toString(),
          sortOrder: item.sortOrder,
          stickerType: item.stickerType,
          stickerData: item.stickerData || null,
        }))
      );
    }

    // Fetch created story with all details
    const createdStory = await db.query.stories.findFirst({
      where: eq(schema.stories.id, story.id),
      with: { author: true, storyItems: { orderBy: asc(schema.storyItems.sortOrder) } },
    });

    if (!createdStory) {
      throw new HTTPException(500, { message: "Failed to create story" });
    }

    return buildStoryWithDetails(createdStory, createdStory.storyItems || []);
  }

  /**
   * Get active stories feed (from self + following)
   */
  async getFeed(userId: string): Promise<StoryFeedItem[]> {
    // Get users that current user follows (accepted)
    const following = await db.select({ followingId: schema.follows.followingId })
      .from(schema.follows)
      .where(and(
        eq(schema.follows.followerId, userId),
        eq(schema.follows.status, "ACCEPTED")
      ));

    const followingIds = following.map((f) => f.followingId);
    followingIds.push(userId); // Include own stories

    // Get blocked users (both directions)
    const blocked = await db.select({ blockedId: schema.blocks.blockedId })
      .from(schema.blocks)
      .where(eq(schema.blocks.blockerId, userId));
    const blockedBy = await db.select({ blockerId: schema.blocks.blockerId })
      .from(schema.blocks)
      .where(eq(schema.blocks.blockedId, userId));

    const blockedIds = [...blocked.map((b) => b.blockedId), ...blockedBy.map((b) => b.blockerId)];

    // Get close friends of current user
    const closeFriendsList = await db.select({ friendId: schema.closeFriends.friendId })
      .from(schema.closeFriends)
      .where(eq(schema.closeFriends.userId, userId));
    const closeFriendIds = closeFriendsList.map((cf) => cf.friendId);

    const now = new Date();

    // Build where conditions for active stories
    const whereConditions = [
      inArray(schema.stories.authorId, followingIds),
      sql`${schema.stories.expiresAt} > ${now}`,
      isNull(schema.stories.deletedAt),
    ];

    // Exclude blocked users
    if (blockedIds.length > 0) {
      whereConditions.push(not(inArray(schema.stories.authorId, blockedIds)));
    }

    // Get active stories from following + self
    const activeStories = await db
      .select({
        id: schema.stories.id,
        authorId: schema.stories.authorId,
        audience: schema.stories.audience,
        createdAt: schema.stories.createdAt,
        expiresAt: schema.stories.expiresAt,
        author: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
        },
        items: sql<Array<{
        id: string;
        mediaUrl: string;
        type: string;
        duration: string;
        sortOrder: number;
        stickerType: string | null;
        stickerData: Record<string, any> | null;
      }>>`(
          SELECT json_agg(json_build_object(
            'id', si.id,
            'mediaUrl', si.media_url,
            'type', si.type,
            'duration', si.duration,
            'sortOrder', si.sort_order,
            'stickerType', si.sticker_type,
            'stickerData', si.sticker_data
          ) ORDER BY si.sort_order)
          FROM story_items si
          WHERE si.story_id = stories.id
        )`,
      })
      .from(schema.stories)
      .innerJoin(schema.users, eq(schema.users.id, schema.stories.authorId))
      .where(and(...whereConditions))
      .orderBy(desc(schema.stories.createdAt));

    // Filter stories based on audience (close friends)
    const filteredStories = activeStories.filter((story) => {
      // If story is for close friends only, check if viewer is in author's close friends
      if (story.audience === "close_friends") {
        return closeFriendIds.includes(story.authorId);
      }
      // For followers audience, check if viewer follows author (or is author)
      if (story.audience === "followers") {
        return story.authorId === userId || followingIds.includes(story.authorId);
      }
      return true; // public or other
    });

    // Group by author
    const storiesByAuthor = new Map<string, StoryFeedItem>();
    for (const story of filteredStories) {
      const authorId = story.authorId;
      if (!storiesByAuthor.has(authorId)) {
        storiesByAuthor.set(authorId, {
          userId: authorId,
          author: story.author,
          stories: [],
        });
      }
      storiesByAuthor.get(authorId)!.stories.push({
        id: story.id,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
        audience: story.audience,
        items: story.items || [],
      });
    }

    return Array.from(storiesByAuthor.values());
  }

  /**
   * Get user's active story items with view status
   */
  async getUserStories(targetUserId: string, currentUserId: string): Promise<StoryWithDetails[]> {
    const targetUser = await db.query.users.findFirst({
      where: eq(schema.users.id, targetUserId),
      columns: { id: true, isPrivate: true },
    });

    if (!targetUser) {
      throw new HTTPException(404, { message: "User not found" });
    }

    // Check private account permissions
    if (targetUser.isPrivate && targetUserId !== currentUserId) {
      const following = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, currentUserId),
          eq(schema.follows.followingId, targetUserId),
          eq(schema.follows.status, "ACCEPTED")
        ),
      });
      if (!following) {
        throw new HTTPException(403, { message: "This account is private" });
      }
    }

    // Check blocks
    const block = await db.query.blocks.findFirst({
      where: or(
        and(
          eq(schema.blocks.blockerId, currentUserId),
          eq(schema.blocks.blockedId, targetUserId)
        ),
        and(
          eq(schema.blocks.blockerId, targetUserId),
          eq(schema.blocks.blockedId, currentUserId)
        )
      ),
    });
    if (block) {
      throw new HTTPException(403, { message: "You cannot view these stories" });
    }

    // Get close friends of target user
    const closeFriendsList = await db.select({ friendId: schema.closeFriends.friendId })
      .from(schema.closeFriends)
      .where(eq(schema.closeFriends.userId, targetUserId));
    const closeFriendIds = closeFriendsList.map((cf) => cf.friendId);

    // Check if current user is in target user's close friends
    const isCloseFriend = closeFriendIds.includes(currentUserId) || targetUserId === currentUserId;

    const now = new Date();

    // Build where conditions
    const whereConditions = [
      eq(schema.stories.authorId, targetUserId),
      sql`${schema.stories.expiresAt} > ${now}`,
      isNull(schema.stories.deletedAt),
    ];

    // Filter by audience
    if (!isCloseFriend) {
      // If not close friend, only show followers audience stories
      whereConditions.push(eq(schema.stories.audience, "followers"));
    }
    // If is close friend or own profile, show all audiences

    const stories = await db
      .select({
        id: schema.stories.id,
        authorId: schema.stories.authorId,
        audience: schema.stories.audience,
        createdAt: schema.stories.createdAt,
        expiresAt: schema.stories.expiresAt,
        viewsCount: schema.stories.viewsCount,
        repliesCount: schema.stories.repliesCount,
        reelId: schema.stories.reelId,
        sharedFromPostId: schema.stories.sharedFromPostId,
        deletedAt: schema.stories.deletedAt,
        author: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
          isPrivate: schema.users.isPrivate,
        },
        items: sql<Array<{
        id: string;
        mediaUrl: string;
        type: string;
        duration: string;
        sortOrder: number;
        stickerType: string | null;
        stickerData: Record<string, any> | null;
      }>>`(
          SELECT json_agg(json_build_object(
            'id', si.id,
            'mediaUrl', si.media_url,
            'type', si.type,
            'duration', si.duration,
            'sortOrder', si.sort_order,
            'stickerType', si.sticker_type,
            'stickerData', si.sticker_data
          ) ORDER BY si.sort_order)
          FROM story_items si
          WHERE si.story_id = stories.id
        )`,
      })
      .from(schema.stories)
      .innerJoin(schema.users, eq(schema.users.id, schema.stories.authorId))
      .where(and(...whereConditions))
      .orderBy(desc(schema.stories.createdAt));

    // Get view status for current user
    const storyIds = stories.map((s) => s.id);
    let viewedSet = new Set<string>();
    if (storyIds.length > 0) {
      const views = await db
        .select({ storyId: schema.storyViews.storyId })
        .from(schema.storyViews)
        .where(and(eq(schema.storyViews.viewerId, currentUserId), inArray(schema.storyViews.storyId, storyIds)));
      viewedSet = new Set(views.map((v) => v.storyId));
    }

    return stories.map((story) =>
      buildStoryWithDetails(story, story.items || [], viewedSet.has(story.id))
    );
  }

  /**
   * Mark story as viewed
   */
  async markAsViewed(storyId: string, viewerId: string): Promise<void> {
    const story = await db.query.stories.findFirst({ where: eq(schema.stories.id, storyId) });
    if (!story) {
      throw new HTTPException(404, { message: "Story not found" });
    }

    if (story.expiresAt < new Date()) {
      throw new HTTPException(410, { message: "Story has expired" });
    }

    if (story.deletedAt) {
      throw new HTTPException(410, { message: "Story has been deleted" });
    }

    // Check if user can view this story
    await this.checkStoryAccess(story, viewerId);

    // Insert view (on conflict do nothing - idempotent)
    await db.insert(schema.storyViews).values({ storyId, viewerId }).onConflictDoNothing();

    // Increment views count
    await db.update(schema.stories)
      .set({ viewsCount: sql`${schema.stories.viewsCount} + 1` })
      .where(eq(schema.stories.id, storyId));
  }

  /**
   * Get story viewers (author only)
   */
  async getStoryViewers(storyId: string, currentUserId: string, cursor?: string, perPage = 50): Promise<PaginatedResult<StoryView>> {
    const story = await db.query.stories.findFirst({ where: eq(schema.stories.id, storyId) });
    if (!story) {
      throw new HTTPException(404, { message: "Story not found" });
    }

    if (story.authorId !== currentUserId) {
      throw new HTTPException(403, { message: "Not authorized to view story viewers" });
    }

    const whereConditions = [
      eq(schema.storyViews.storyId, storyId),
    ];

    if (cursor) {
      whereConditions.push(lt(schema.storyViews.viewedAt, new Date(cursor)));
    }

    const viewsList = await db
      .select({
        id: schema.storyViews.id,
        storyId: schema.storyViews.storyId,
        viewerId: schema.storyViews.viewerId,
        viewedAt: schema.storyViews.viewedAt,
        viewer: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
        },
      })
      .from(schema.storyViews)
      .innerJoin(schema.users, eq(schema.users.id, schema.storyViews.viewerId))
      .where(and(...whereConditions))
      .limit(perPage + 1)
      .orderBy(desc(schema.storyViews.viewedAt));

    const hasMore = viewsList.length > perPage;
    const items = hasMore ? viewsList.slice(0, perPage) : viewsList;
    const nextCursor = hasMore ? items[items.length - 1].viewedAt.toISOString() : null;

    return {
      items: items.map((v) => ({
        id: v.id,
        storyId: v.storyId,
        viewerId: v.viewerId,
        viewedAt: v.viewedAt,
        viewer: v.viewer,
      })),
      nextCursor,
      hasMore,
    };
  }

  /**
   * Delete a story (author only)
   */
  async deleteStory(storyId: string, userId: string): Promise<void> {
    const story = await db.query.stories.findFirst({ where: eq(schema.stories.id, storyId) });
    if (!story) {
      throw new HTTPException(404, { message: "Story not found" });
    }
    if (story.authorId !== userId) {
      throw new HTTPException(403, { message: "Not authorized to delete this story" });
    }

    await db.delete(schema.stories).where(eq(schema.stories.id, storyId));
  }

  /**
   * Reply to a story (creates a DM)
   */
  async replyToStory(storyId: string, senderId: string, text: string, mediaUrl?: string): Promise<{ conversationId: string; messageId: string }> {
    const story = await db.query.stories.findFirst({
      where: eq(schema.stories.id, storyId),
      with: { author: true }
    });
    if (!story) {
      throw new HTTPException(404, { message: "Story not found" });
    }

    if (story.expiresAt < new Date()) {
      throw new HTTPException(410, { message: "Story has expired" });
    }

    // Check if user can view/reply to this story
    await this.checkStoryAccess(story, senderId);

    // Find or create conversation between sender and story author
    // Get conversations where both users are members
    const senderConversations = await db
      .select({ conversationId: schema.conversationMembers.conversationId })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.userId, senderId));

    const senderConversationIds = senderConversations.map((c) => c.conversationId);

    let conversation: any = null;

    if (senderConversationIds.length > 0) {
      // Find conversation that also has story author as member and is not a group
      const sharedConversations = await db
        .select({ conversationId: schema.conversationMembers.conversationId })
        .from(schema.conversationMembers)
        .where(and(
          eq(schema.conversationMembers.userId, story.authorId),
          inArray(schema.conversationMembers.conversationId, senderConversationIds)
        ));

      if (sharedConversations.length > 0) {
        // Get the conversation details
        conversation = await db.query.conversations.findFirst({
          where: and(
            eq(schema.conversations.id, sharedConversations[0].conversationId),
            eq(schema.conversations.isGroup, false)
          ),
          with: { members: true },
        });
      }
    }

    if (!conversation) {
      // Create new conversation
      const [newConversation] = await db.insert(schema.conversations).values({
        isGroup: false,
      }).returning();

      await db.insert(schema.conversationMembers).values([
        { conversationId: newConversation.id, userId: senderId, role: "member" },
        { conversationId: newConversation.id, userId: story.authorId, role: "member" },
      ]);

      conversation = newConversation;
    }

    // Create message
    const [message] = await db.insert(schema.messages).values({
      conversationId: conversation.id,
      senderId,
      contentType: mediaUrl ? "STORY_SHARE" : "TEXT",
      textContent: text,
      mediaUrl,
      mediaMetadata: mediaUrl ? { storyId } : {},
    }).returning();

    // Create story reply link
    await db.insert(schema.storyReplies).values({
      storyId,
      senderId,
      messageId: message.id,
    });

    // Increment replies count
    await db.update(schema.stories)
      .set({ repliesCount: sql`${schema.stories.repliesCount} + 1` })
      .where(eq(schema.stories.id, storyId));

    // Notify story author (if not self)
    if (story.authorId !== senderId) {
      await db.insert(schema.notifications).values({
        recipientId: story.authorId,
        actorId: senderId,
        type: "STORY_REPLY",
        referenceType: "story",
        referenceId: storyId,
        previewText: text.substring(0, 100),
        deepLink: `/stories/${storyId}`,
      });
    }

    return { conversationId: conversation.id, messageId: message.id };
  }

  /**
   * Check if user has access to a story
   */
  private async checkStoryAccess(story: any, userId: string): Promise<void> {
    // Author always has access
    if (story.authorId === userId) {
      return;
    }

    // Get story author
    const author = await db.query.users.findFirst({
      where: eq(schema.users.id, story.authorId),
      columns: { id: true, isPrivate: true },
    });

    if (!author) {
      throw new HTTPException(404, { message: "Story author not found" });
    }

    // Check private account
    if (author.isPrivate) {
      const following = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, userId),
          eq(schema.follows.followingId, story.authorId),
          eq(schema.follows.status, "ACCEPTED")
        ),
      });
      if (!following) {
        throw new HTTPException(403, { message: "This account is private" });
      }
    }

    // Check blocks
    const block = await db.query.blocks.findFirst({
      where: or(
        and(
          eq(schema.blocks.blockerId, userId),
          eq(schema.blocks.blockedId, story.authorId)
        ),
        and(
          eq(schema.blocks.blockerId, story.authorId),
          eq(schema.blocks.blockedId, userId)
        )
      ),
    });
    if (block) {
      throw new HTTPException(403, { message: "You cannot view this story" });
    }

    // Check close friends audience
    if (story.audience === "close_friends") {
      const isCloseFriend = await db.query.closeFriends.findFirst({
        where: and(
          eq(schema.closeFriends.userId, story.authorId),
          eq(schema.closeFriends.friendId, userId)
        ),
      });
      if (!isCloseFriend) {
        throw new HTTPException(403, { message: "This story is for close friends only" });
      }
    }
  }

  /**
   * Get expiring stories (for cleanup job)
   */
  async getExpiredStories(limit = 1000): Promise<Array<{ id: string; authorId: string; mediaUrls: string[] }>> {
    const now = new Date();

    const expiredStories = await db
      .select({
        id: schema.stories.id,
        authorId: schema.stories.authorId,
        mediaUrls: sql<string[]>`array_agg(story_items.media_url)`,
      })
      .from(schema.stories)
      .innerJoin(schema.storyItems, eq(schema.storyItems.storyId, schema.stories.id))
      .where(and(
        lt(schema.stories.expiresAt, now),
        isNull(schema.stories.deletedAt)
      ))
      .groupBy(schema.stories.id, schema.stories.authorId)
      .limit(limit);

    return expiredStories;
  }

  /**
   * Delete expired stories (for cleanup job)
   */
  async deleteExpiredStories(): Promise<number> {
    const now = new Date();

    const result = await db
      .delete(schema.stories)
      .where(and(
        lt(schema.stories.expiresAt, now),
        isNull(schema.stories.deletedAt)
      ));

    return result.rowCount || 0;
  }

  /**
   * Report a story
   */
  async reportStory(storyId: string, reporterId: string, reason: string, description?: string): Promise<void> {
    const story = await db.query.stories.findFirst({ where: eq(schema.stories.id, storyId) });
    if (!story) {
      throw new HTTPException(404, { message: "Story not found" });
    }

    await db.insert(schema.reports).values({
      reporterId,
      reportedType: "STORY",
      reportedId: storyId,
      reason: reason as any,
      description,
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let storyServiceInstance: StoryService | null = null;

export function getStoryService(): StoryService {
  if (!storyServiceInstance) {
    storyServiceInstance = new StoryService();
  }
  return storyServiceInstance;
}

export function setStoryService(service: StoryService): void {
  storyServiceInstance = service;
}