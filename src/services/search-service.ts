import { db } from "../db/client";
import * as schema from "../db/schema";
import {
  eq,
  and,
  desc,
  asc,
  sql,
  inArray,
  lt,
  gt,
  isNull,
  or,
  not,
  ilike,
  count,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// ============================================================================
// Types
// ============================================================================

export type SearchContentType = "users" | "posts" | "reels" | "hashtags" | "locations" | "audio";

export interface SearchOptions {
  types?: SearchContentType[];
  limit?: number;
  cursor?: string;
  userId?: string;
  includePrivate?: boolean;
}

export interface SearchResultItem {
  id: string;
  type: SearchContentType;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  metadata?: Record<string, any>;
  searchScore: number;
  relevanceScore?: number;
}

export interface SearchResults {
  items: SearchResultItem[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount?: number;
  tookMs: number;
}

// Embedding API response types
interface EmbeddingResponseData {
  index: number;
  embedding: number[];
}

interface EmbeddingApiResponse {
  data: EmbeddingResponseData[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface SearchSuggestion {
  query: string;
  type: "recent" | "trending" | "suggested";
  count?: number;
}

export interface TrendingHashtag {
  tag: string;
  postsCount: number;
  reelsCount: number;
  growthRate: number; // percentage change in last 24h
}

export interface SearchAnalytics {
  popularQueries: Array<{ query: string; count: number }>;
  zeroResultQueries: Array<{ query: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
  avgResultsPerQuery: number;
}

export interface EmbeddingInput {
  text: string;
  model?: string;
  dimensions?: number;
}

// ============================================================================
// Constants
// ============================================================================

const RRF_K = 60;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VECTOR_SEARCH_LIMIT = 40;
const BM25_SEARCH_LIMIT = 40;
const GRAPH_SEARCH_LIMIT = 40;
const EMBEDDING_MODEL = "qwen3-embedding-0-6b";
const EMBEDDING_DIMENSIONS = 1024;
const QUERY_PROMPT = "Instruct: Given a question about Neon, retrieve documentation passages that answer the question\nQuery: ";

// ============================================================================
// AI Gateway Embedding Client
// ============================================================================

class EmbeddingClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.NEON_AI_GATEWAY_BASE_URL!;
    this.apiKey = process.env.NEON_AI_GATEWAY_TOKEN!;

    if (!this.baseUrl || !this.apiKey) {
      throw new Error("NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN must be set");
    }
  }

  async generateEmbedding(input: EmbeddingInput): Promise<number[]> {
    const { text, model = EMBEDDING_MODEL, dimensions = EMBEDDING_DIMENSIONS } = input;

    // Apply query prompt for search queries
    const promptText = text.startsWith("Instruct:") ? text : `${QUERY_PROMPT}${text}`;

    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: promptText,
        dimensions,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding generation failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as EmbeddingApiResponse;
    return data.data[0].embedding;
  }

  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    const promptTexts = texts.map(t => t.startsWith("Instruct:") ? t : `${QUERY_PROMPT}${t}`);

    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: promptTexts,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Batch embedding generation failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as EmbeddingApiResponse;
    // Sort by index to maintain order
    const embeddings = new Array(texts.length);
    for (const item of data.data) {
      embeddings[item.index] = item.embedding;
    }
    return embeddings;
  }
}

// ============================================================================
// Search Service Class
// ============================================================================

export class SearchService {
  private embeddingClient: EmbeddingClient;

  constructor() {
    this.embeddingClient = new EmbeddingClient();
  }

  // ---------------------------------------------------------------------------
  // Main Search Entry Point
  // ---------------------------------------------------------------------------

  async search(query: string, options: SearchOptions = {}): Promise<SearchResults> {
    const startTime = Date.now();
    const {
      types = ["users", "posts", "reels", "hashtags", "locations", "audio"],
      limit = DEFAULT_LIMIT,
      cursor,
      userId,
      includePrivate = false,
    } = options;

    const validatedLimit = Math.min(limit, MAX_LIMIT);

    // 1. Generate query embedding for semantic search
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await this.embeddingClient.generateEmbedding({ text: query });
    } catch (error) {
      console.error("Failed to generate query embedding:", error);
      // Continue without semantic search if embedding fails
    }

    // 2. Execute searches in parallel for each type
    const searchPromises = types.map(type =>
      this.searchType(type, query, queryEmbedding, {
        limit: validatedLimit,
        cursor,
        userId,
        includePrivate,
      })
    );

    const results = await Promise.all(searchPromises);

    // 3. Merge results using RRF
    const mergedResults = this.mergeResultsRRF(results, validatedLimit);

    // 4. Log search analytics
    if (userId) {
      this.logSearchAnalytics(userId, query, types, mergedResults.length).catch(console.error);
    }

    return {
      items: mergedResults,
      nextCursor: mergedResults.length === validatedLimit
        ? mergedResults[mergedResults.length - 1].id
        : null,
      hasMore: mergedResults.length === validatedLimit,
      tookMs: Date.now() - startTime,
    };
  }

  // ---------------------------------------------------------------------------
  // Type-specific Search Methods
  // ---------------------------------------------------------------------------

  private async searchType(
    type: SearchContentType,
    query: string,
    queryEmbedding: number[] | null,
    options: { limit: number; cursor?: string; userId?: string; includePrivate?: boolean }
  ): Promise<SearchResultItem[]> {
    const { limit, cursor, userId, includePrivate } = options;

    switch (type) {
      case "users":
        return this.searchUsers(query, queryEmbedding, { limit, cursor, userId, includePrivate });
      case "posts":
        return this.searchPosts(query, queryEmbedding, { limit, cursor, userId, includePrivate });
      case "reels":
        return this.searchReels(query, queryEmbedding, { limit, cursor, userId, includePrivate });
      case "hashtags":
        return this.searchHashtags(query, { limit, cursor });
      case "locations":
        return this.searchLocations(query, { limit, cursor });
      case "audio":
        return this.searchAudio(query, queryEmbedding, { limit, cursor });
      default:
        return [];
    }
  }

  // ---------- Users Search ----------
  private async searchUsers(
    query: string,
    queryEmbedding: number[] | null,
    options: { limit: number; cursor?: string; userId?: string; includePrivate?: boolean }
  ): Promise<SearchResultItem[]> {
    const { limit, cursor, userId, includePrivate } = options;

    const results: SearchResultItem[] = [];

    // 1. BM25 search on search_index
    if (queryEmbedding) {
      const vectorResults = await this.vectorSearch("users", queryEmbedding, VECTOR_SEARCH_LIMIT);
      for (const [rank, item] of vectorResults.entries()) {
        results.push({
          ...item,
          type: "users",
          searchScore: 1 / (RRF_K + rank + 1),
        });
      }
    }

    // 2. BM25 full-text search
    const bm25Results = await this.bm25Search("users", query, BM25_SEARCH_LIMIT);
    for (const [rank, item] of bm25Results.entries()) {
      const existing = results.find(r => r.id === item.id);
      if (existing) {
        existing.searchScore += 1 / (RRF_K + rank + 1);
      } else {
        results.push({
          ...item,
          type: "users",
          searchScore: 1 / (RRF_K + rank + 1),
        });
      }
    }

    // 3. Graph-based search (if userId provided)
    if (userId) {
      const graphResults = await this.graphSearchUsers(userId, query, GRAPH_SEARCH_LIMIT);
      for (const [rank, item] of graphResults.entries()) {
        const existing = results.find(r => r.id === item.id);
        if (existing) {
          existing.searchScore += 1 / (RRF_K + rank + 1);
        } else {
          results.push({
            ...item,
            type: "users",
            searchScore: 1 / (RRF_K + rank + 1),
          });
        }
      }
    }

    // Sort by combined score and limit
    results.sort((a, b) => b.searchScore - a.searchScore);
    return results.slice(0, limit);
  }

  // ---------- Posts Search ----------
  private async searchPosts(
    query: string,
    queryEmbedding: number[] | null,
    options: { limit: number; cursor?: string; userId?: string; includePrivate?: boolean }
  ): Promise<SearchResultItem[]> {
    const { limit, cursor, userId, includePrivate } = options;

    const results: SearchResultItem[] = [];

    // 1. Vector search
    if (queryEmbedding) {
      const vectorResults = await this.vectorSearch("posts", queryEmbedding, VECTOR_SEARCH_LIMIT);
      for (const [rank, item] of vectorResults.entries()) {
        results.push({
          ...item,
          type: "posts",
          searchScore: 1 / (RRF_K + rank + 1),
        });
      }
    }

    // 2. BM25 search
    const bm25Results = await this.bm25Search("posts", query, BM25_SEARCH_LIMIT);
    for (const [rank, item] of bm25Results.entries()) {
      const existing = results.find(r => r.id === item.id);
      if (existing) {
        existing.searchScore += 1 / (RRF_K + rank + 1);
      } else {
        results.push({
          ...item,
          type: "posts",
          searchScore: 1 / (RRF_K + rank + 1),
        });
      }
    }

    // 3. Graph search
    if (userId) {
      const graphResults = await this.graphSearchPosts(userId, query, GRAPH_SEARCH_LIMIT);
      for (const [rank, item] of graphResults.entries()) {
        const existing = results.find(r => r.id === item.id);
        if (existing) {
          existing.searchScore += 1 / (RRF_K + rank + 1);
        } else {
          results.push({
            ...item,
            type: "posts",
            searchScore: 1 / (RRF_K + rank + 1),
          });
        }
      }
    }

    results.sort((a, b) => b.searchScore - a.searchScore);
    return results.slice(0, limit);
  }

  // ---------- Reels Search ----------
  private async searchReels(
    query: string,
    queryEmbedding: number[] | null,
    options: { limit: number; cursor?: string; userId?: string; includePrivate?: boolean }
  ): Promise<SearchResultItem[]> {
    const { limit, cursor, userId, includePrivate } = options;

    const results: SearchResultItem[] = [];

    if (queryEmbedding) {
      const vectorResults = await this.vectorSearch("reels", queryEmbedding, VECTOR_SEARCH_LIMIT);
      for (const [rank, item] of vectorResults.entries()) {
        results.push({
          ...item,
          type: "reels",
          searchScore: 1 / (RRF_K + rank + 1),
        });
      }
    }

    const bm25Results = await this.bm25Search("reels", query, BM25_SEARCH_LIMIT);
    for (const [rank, item] of bm25Results.entries()) {
      const existing = results.find(r => r.id === item.id);
      if (existing) {
        existing.searchScore += 1 / (RRF_K + rank + 1);
      } else {
        results.push({
          ...item,
          type: "reels",
          searchScore: 1 / (RRF_K + rank + 1),
        });
      }
    }

    if (userId) {
      const graphResults = await this.graphSearchReels(userId, query, GRAPH_SEARCH_LIMIT);
      for (const [rank, item] of graphResults.entries()) {
        const existing = results.find(r => r.id === item.id);
        if (existing) {
          existing.searchScore += 1 / (RRF_K + rank + 1);
        } else {
          results.push({
            ...item,
            type: "reels",
            searchScore: 1 / (RRF_K + rank + 1),
          });
        }
      }
    }

    results.sort((a, b) => b.searchScore - a.searchScore);
    return results.slice(0, limit);
  }

  // ---------- Hashtags Search ----------
  private async searchHashtags(
    query: string,
    options: { limit: number; cursor?: string }
  ): Promise<SearchResultItem[]> {
    const { limit, cursor } = options;

    const cleanQuery = query.replace(/^#/, "").toLowerCase();

    const whereConditions = [
      ilike(schema.hashtags.tag, `%${cleanQuery}%`),
      eq(schema.hashtags.isBlocked, false),
    ];

    if (cursor) {
      whereConditions.push(lt(schema.hashtags.tag, cursor));
    }

    const results = await db
      .select({
        id: schema.hashtags.id,
        tag: schema.hashtags.tag,
        postsCount: schema.hashtags.postsCount,
        reelsCount: schema.hashtags.reelsCount,
      })
      .from(schema.hashtags)
      .where(and(...whereConditions))
      .limit(limit)
      .orderBy(desc(sql`${schema.hashtags.postsCount} + ${schema.hashtags.reelsCount}`));

    return results.map((h, rank) => ({
      id: h.id,
      type: "hashtags" as SearchContentType,
      title: `#${h.tag}`,
      subtitle: `${h.postsCount} posts · ${h.reelsCount} reels`,
      searchScore: 1 / (RRF_K + rank + 1),
      metadata: { postsCount: h.postsCount, reelsCount: h.reelsCount },
    }));
  }

  // ---------- Locations Search ----------
  private async searchLocations(
    query: string,
    options: { limit: number; cursor?: string }
  ): Promise<SearchResultItem[]> {
    const { limit, cursor } = options;

    const whereConditions = [
      or(
        ilike(schema.locations.name, `%${query}%`),
        ilike(schema.locations.address, `%${query}%`)
      ),
    ];

    if (cursor) {
      whereConditions.push(lt(schema.locations.name, cursor));
    }

    const results = await db
      .select({
        id: schema.locations.id,
        name: schema.locations.name,
        address: schema.locations.address,
        category: schema.locations.category,
        postsCount: schema.locations.postsCount,
      })
      .from(schema.locations)
      .where(and(...whereConditions))
      .limit(limit)
      .orderBy(desc(schema.locations.postsCount));

    return results.map((l, rank) => ({
      id: l.id,
      type: "locations" as SearchContentType,
      title: l.name,
      subtitle: l.address ?? l.category ?? undefined,
      searchScore: 1 / (RRF_K + rank + 1),
      metadata: { postsCount: l.postsCount, category: l.category },
    }));
  }

  // ---------- Audio Search ----------
  private async searchAudio(
    query: string,
    queryEmbedding: number[] | null,
    options: { limit: number; cursor?: string }
  ): Promise<SearchResultItem[]> {
    const { limit, cursor } = options;

    const results: SearchResultItem[] = [];

    if (queryEmbedding) {
      const vectorResults = await this.vectorSearch("audio", queryEmbedding, VECTOR_SEARCH_LIMIT);
      for (const [rank, item] of vectorResults.entries()) {
        results.push({
          ...item,
          type: "audio",
          searchScore: 1 / (RRF_K + rank + 1),
        });
      }
    }

    const bm25Results = await this.bm25Search("audio", query, BM25_SEARCH_LIMIT);
    for (const [rank, item] of bm25Results.entries()) {
      const existing = results.find(r => r.id === item.id);
      if (existing) {
        existing.searchScore += 1 / (RRF_K + rank + 1);
      } else {
        results.push({
          ...item,
          type: "audio",
          searchScore: 1 / (RRF_K + rank + 1),
        });
      }
    }

    results.sort((a, b) => b.searchScore - a.searchScore);
    return results.slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Vector Search (Semantic)
  // ---------------------------------------------------------------------------

  private async vectorSearch(
    contentType: string,
    queryEmbedding: number[],
    limit: number
  ): Promise<Omit<SearchResultItem, "type" | "searchScore">[]> {
    const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

    const results = await db.execute(sql`
      SELECT
        si.id,
        si.content_id as "contentId",
        si.title,
        si.description,
        si.author_id as "authorId",
        si.created_at as "createdAt",
        si.popularity_score as "popularityScore",
        si.embedding <=> ${embeddingLiteral}::vector as distance
      FROM ${schema.searchIndex} si
      WHERE si.content_type = ${contentType}
        AND si.embedding IS NOT NULL
      ORDER BY distance
      LIMIT ${limit}
    `);

    return results.rows.map((row: any) => ({
      id: row.contentId,
      title: row.title || "",
      subtitle: row.description || "",
      metadata: {
        authorId: row.authorId,
        createdAt: row.createdAt,
        popularityScore: row.popularityScore,
        distance: row.distance,
      },
    }));
  }

  // ---------------------------------------------------------------------------
  // BM25 Full-Text Search
  // ---------------------------------------------------------------------------

  private async bm25Search(
    contentType: string,
    query: string,
    limit: number
  ): Promise<Omit<SearchResultItem, "type" | "searchScore">[]> {
    // Use the lakebase_bm25 index on search_index table
    const results = await db.execute(sql`
      SELECT
        si.id,
        si.content_id as "contentId",
        si.title,
        si.description,
        si.author_id as "authorId",
        si.created_at as "createdAt",
        si.popularity_score as "popularityScore",
        si.search_vector <@> to_bm25query(
          to_tsvector('english', ${query}),
          'search_index_search_vector_idx'::regclass
        ) AS score
      FROM ${schema.searchIndex} si
      WHERE si.content_type = ${contentType}
        AND si.search_vector IS NOT NULL
        AND si.search_vector @@ to_tsquery('english', ${query})
      ORDER BY score
      LIMIT ${limit}
    `);

    return results.rows
      .filter((row: any) => row.score < 0) // Only matches
      .map((row: any) => ({
        id: row.contentId,
        title: row.title || "",
        subtitle: row.description || "",
        metadata: {
          authorId: row.authorId,
          createdAt: row.createdAt,
          popularityScore: row.popularityScore,
          bm25Score: row.score,
        },
      }));
  }

  // ---------------------------------------------------------------------------
  // Graph Search (Social Signals)
  // ---------------------------------------------------------------------------

  private async graphSearchUsers(
    userId: string,
    query: string,
    limit: number
  ): Promise<Omit<SearchResultItem, "type" | "searchScore">[]> {
    // Find users that the current user's follows have interacted with
    const results = await db.execute(sql`
      WITH followed_users AS (
        SELECT following_id FROM ${schema.follows}
        WHERE follower_id = ${userId} AND status = 'accepted'
      ),
      candidate_users AS (
        SELECT DISTINCT u.id, u.username, u.full_name, u.avatar_url, u.is_verified,
               COUNT(DISTINCT l.id) as interaction_count
        FROM ${schema.users} u
        LEFT JOIN ${schema.likes} l ON l.user_id IN (SELECT * FROM followed_users)
          AND l.likeable_type = 'USER'
          AND l.likeable_id = u.id
        LEFT JOIN ${schema.follows} f ON f.follower_id IN (SELECT * FROM followed_users)
          AND f.following_id = u.id
          AND f.status = 'accepted'
        WHERE u.id != ${userId}
          AND u.deleted_at IS NULL
          AND (u.username ILIKE ${`%${query}%`} OR u.full_name ILIKE ${`%${query}%`})
        GROUP BY u.id, u.username, u.full_name, u.avatar_url, u.is_verified
        HAVING COUNT(DISTINCT l.id) + COUNT(DISTINCT f.id) > 0
        ORDER BY interaction_count DESC
        LIMIT ${limit}
      )
      SELECT * FROM candidate_users
    `);

    return results.rows.map((row: any) => ({
      id: row.id,
      title: row.username,
      subtitle: row.full_name,
      imageUrl: row.avatar_url,
      metadata: {
        isVerified: row.is_verified,
        interactionCount: row.interaction_count,
      },
    }));
  }

  private async graphSearchPosts(
    userId: string,
    query: string,
    limit: number
  ): Promise<Omit<SearchResultItem, "type" | "searchScore">[]> {
    const results = await db.execute(sql`
      WITH followed_users AS (
        SELECT following_id FROM ${schema.follows}
        WHERE follower_id = ${userId} AND status = 'accepted'
      ),
      engaged_posts AS (
        SELECT DISTINCT p.id, p.author_id, p.caption, p.created_at,
               p.likes_count, p.comments_count, p.shares_count,
               (p.likes_count + p.comments_count * 2 + p.shares_count * 3) as engagement_score
        FROM ${schema.posts} p
        WHERE p.deleted_at IS NULL
          AND p.audience = 'PUBLIC'
          AND (p.caption ILIKE ${`%${query}%`})
          AND (
            p.author_id IN (SELECT * FROM followed_users)
            OR p.id IN (
              SELECT likeable_id FROM ${schema.likes}
              WHERE user_id IN (SELECT * FROM followed_users)
                AND likeable_type = 'POST'
            )
            OR p.id IN (
              SELECT commentable_id FROM ${schema.comments}
              WHERE author_id IN (SELECT * FROM followed_users)
                AND commentable_type = 'POST'
            )
          )
        ORDER BY engagement_score DESC, p.created_at DESC
        LIMIT ${limit}
      )
      SELECT ep.*, u.username, u.full_name, u.avatar_url, u.is_verified
      FROM engaged_posts ep
      JOIN ${schema.users} u ON u.id = ep.author_id
      WHERE u.deleted_at IS NULL
    `);

    return results.rows.map((row: any) => ({
      id: row.id,
      title: row.caption?.substring(0, 100) || "Post",
      subtitle: `@${row.username}`,
      metadata: {
        authorId: row.author_id,
        authorUsername: row.username,
        authorName: row.full_name,
        authorAvatar: row.avatar_url,
        authorVerified: row.is_verified,
        likesCount: row.likes_count,
        commentsCount: row.comments_count,
        sharesCount: row.shares_count,
        createdAt: row.created_at,
        engagementScore: row.engagement_score,
      },
    }));
  }

  private async graphSearchReels(
    userId: string,
    query: string,
    limit: number
  ): Promise<Omit<SearchResultItem, "type" | "searchScore">[]> {
    const results = await db.execute(sql`
      WITH followed_users AS (
        SELECT following_id FROM ${schema.follows}
        WHERE follower_id = ${userId} AND status = 'accepted'
      ),
      engaged_reels AS (
        SELECT DISTINCT r.id, r.author_id, r.caption, r.created_at,
               r.likes_count, r.comments_count, r.shares_count, r.plays_count,
               (r.likes_count + r.comments_count * 2 + r.shares_count * 3 + r.plays_count * 0.1) as engagement_score
        FROM ${schema.reels} r
        WHERE r.deleted_at IS NULL
          AND r.audience = 'public'
          AND (r.caption ILIKE ${`%${query}%`})
          AND (
            r.author_id IN (SELECT * FROM followed_users)
            OR r.id IN (
              SELECT likeable_id FROM ${schema.likes}
              WHERE user_id IN (SELECT * FROM followed_users)
                AND likeable_type = 'REEL'
            )
          )
        ORDER BY engagement_score DESC, r.created_at DESC
        LIMIT ${limit}
      )
      SELECT er.*, u.username, u.full_name, u.avatar_url, u.is_verified
      FROM engaged_reels er
      JOIN ${schema.users} u ON u.id = er.author_id
      WHERE u.deleted_at IS NULL
    `);

    return results.rows.map((row: any) => ({
      id: row.id,
      title: row.caption?.substring(0, 100) || "Reel",
      subtitle: `@${row.username}`,
      metadata: {
        authorId: row.author_id,
        authorUsername: row.username,
        authorName: row.full_name,
        authorAvatar: row.avatar_url,
        authorVerified: row.is_verified,
        likesCount: row.likes_count,
        commentsCount: row.comments_count,
        sharesCount: row.shares_count,
        playsCount: row.plays_count,
        createdAt: row.created_at,
        engagementScore: row.engagement_score,
      },
    }));
  }

  // ---------------------------------------------------------------------------
  // RRF Merge
  // ---------------------------------------------------------------------------

  private mergeResultsRRF(
    resultsByType: SearchResultItem[][],
    limit: number
  ): SearchResultItem[] {
    const scores = new Map<string, SearchResultItem>();

    for (const results of resultsByType) {
      for (const [rank, item] of results.entries()) {
        const key = `${item.type}:${item.id}`;
        const rrfScore = 1 / (RRF_K + rank + 1);

        if (scores.has(key)) {
          const existing = scores.get(key)!;
          existing.searchScore += rrfScore;
        } else {
          scores.set(key, { ...item, searchScore: rrfScore });
        }
      }
    }

    return Array.from(scores.values())
      .sort((a, b) => b.searchScore - a.searchScore)
      .slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Typeahead / Suggestions
  // ---------------------------------------------------------------------------

  async getSuggestions(query: string, userId?: string, limit = 10): Promise<SearchSuggestion[]> {
    const suggestions: SearchSuggestion[] = [];
    const cleanQuery = query.toLowerCase().trim();

    if (cleanQuery.length < 2) return suggestions;

    // 1. Recent searches for this user
    if (userId) {
      const recent = await db
        .selectDistinct({ query: schema.searchHistory.query })
        .from(schema.searchHistory)
        .where(and(
          eq(schema.searchHistory.userId, userId),
          ilike(schema.searchHistory.query, `%${cleanQuery}%`)
        ))
        .orderBy(desc(schema.searchHistory.createdAt))
        .limit(5);

      for (const r of recent) {
        suggestions.push({ query: r.query, type: "recent" });
      }
    }

    // 2. Trending hashtags matching query
    const trendingTags = await db
      .select({ tag: schema.hashtags.tag, count: sql<number>`${schema.hashtags.postsCount} + ${schema.hashtags.reelsCount}` })
      .from(schema.hashtags)
      .where(and(
        ilike(schema.hashtags.tag, `%${cleanQuery}%`),
        eq(schema.hashtags.isBlocked, false)
      ))
      .orderBy(desc(sql`${schema.hashtags.postsCount} + ${schema.hashtags.reelsCount}`))
      .limit(5);

    for (const t of trendingTags) {
      suggestions.push({ query: `#${t.tag}`, type: "trending", count: t.count });
    }

    // 3. Suggested users matching query
    const suggestedUsers = await db
      .select({ username: schema.users.username, fullName: schema.users.fullName })
      .from(schema.users)
      .where(and(
        or(
          ilike(schema.users.username, `%${cleanQuery}%`),
          ilike(schema.users.fullName, `%${cleanQuery}%`)
        ),
        isNull(schema.users.deletedAt),
        eq(schema.users.isPrivate, false)
      ))
      .limit(5);

    for (const u of suggestedUsers) {
      suggestions.push({
        query: u.username,
        type: "suggested",
        count: undefined,
      });
    }

    // Deduplicate and limit
    const seen = new Set<string>();
    return suggestions
      .filter(s => {
        const key = s.query.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Trending Hashtags
  // ---------------------------------------------------------------------------

  async getTrendingHashtags(limit = 20, timeWindowHours = 24): Promise<TrendingHashtag[]> {
    // Get hashtags with recent growth
    const results = await db.execute(sql`
      WITH recent_usage AS (
        SELECT h.id, h.tag, h.posts_count, h.reels_count,
               COUNT(hu.id) FILTER (WHERE hu.created_at > NOW() - INTERVAL '${timeWindowHours} hours') as recent_usage,
               COUNT(hu.id) FILTER (WHERE hu.created_at > NOW() - INTERVAL '${timeWindowHours * 2} hours'
                 AND hu.created_at <= NOW() - INTERVAL '${timeWindowHours} hours') as previous_usage
        FROM ${schema.hashtags} h
        LEFT JOIN ${schema.hashtagUsages} hu ON hu.hashtag_id = h.id
        WHERE h.is_blocked = FALSE
        GROUP BY h.id, h.tag, h.posts_count, h.reels_count
        HAVING COUNT(hu.id) > 0
      )
      SELECT
        tag,
        posts_count as "postsCount",
        reels_count as "reelsCount",
        CASE
          WHEN previous_usage > 0 THEN
            ((recent_usage - previous_usage)::float / previous_usage) * 100
          ELSE 0
        END as "growthRate"
      FROM recent_usage
      ORDER BY (posts_count + reels_count) DESC, "growthRate" DESC
      LIMIT ${limit}
    `);

    return results.rows.map((row: any) => ({
      tag: row.tag,
      postsCount: row.postsCount,
      reelsCount: row.reelsCount,
      growthRate: Math.round(row.growthRate * 100) / 100,
    }));
  }

  // ---------------------------------------------------------------------------
  // Search History & Analytics
  // ---------------------------------------------------------------------------

  async getRecentSearches(userId: string, limit = 10): Promise<SearchSuggestion[]> {
    const results = await db
      .selectDistinct({ query: schema.searchHistory.query, createdAt: schema.searchHistory.createdAt })
      .from(schema.searchHistory)
      .where(eq(schema.searchHistory.userId, userId))
      .orderBy(desc(schema.searchHistory.createdAt))
      .limit(limit);

    return results.map(r => ({ query: r.query, type: "recent" as const }));
  }

  async clearSearchHistory(userId: string): Promise<void> {
    await db.delete(schema.searchHistory)
      .where(eq(schema.searchHistory.userId, userId));
  }

  async logSearch(
    userId: string,
    query: string,
    resultType: string,
    resultCount: number,
    clickedResultId?: string
  ): Promise<void> {
    await db.insert(schema.searchHistory).values({
      userId,
      query,
      resultType,
      resultCount,
      clickedResultId,
    });
  }

  private async logSearchAnalytics(
    userId: string,
    query: string,
    types: SearchContentType[],
    resultCount: number
  ): Promise<void> {
    await this.logSearch(userId, query, types.join(","), resultCount);
  }

  async getSearchAnalytics(days = 7): Promise<SearchAnalytics> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Popular queries
    const popularQueries = await db.execute(sql`
      SELECT query, COUNT(*) as count
      FROM ${schema.searchHistory}
      WHERE created_at > ${since}
      GROUP BY query
      ORDER BY count DESC
      LIMIT 20
    `);

    // Zero-result queries
    const zeroResultQueries = await db.execute(sql`
      SELECT query, COUNT(*) as count
      FROM ${schema.searchHistory}
      WHERE created_at > ${since}
        AND result_count = 0
      GROUP BY query
      ORDER BY count DESC
      LIMIT 20
    `);

    // Top result types
    const topCategories = await db.execute(sql`
      SELECT result_type as category, COUNT(*) as count
      FROM ${schema.searchHistory}
      WHERE created_at > ${since}
      GROUP BY result_type
      ORDER BY count DESC
    `);

    // Average results per query
    const avgResult = await db.execute(sql`
      SELECT AVG(result_count) as avg_count
      FROM ${schema.searchHistory}
      WHERE created_at > ${since}
    `);

    return {
      popularQueries: popularQueries.rows.map((r: any) => ({ query: r.query, count: Number(r.count) })),
      zeroResultQueries: zeroResultQueries.rows.map((r: any) => ({ query: r.query, count: Number(r.count) })),
      topCategories: topCategories.rows.map((r: any) => ({ category: r.category, count: Number(r.count) })),
      avgResultsPerQuery: Number(avgResult.rows[0]?.avg_count || 0),
    };
  }

  // ---------------------------------------------------------------------------
  // Embedding Generation (for indexer)
  // ---------------------------------------------------------------------------

  async generateEmbedding(text: string): Promise<number[]> {
    return this.embeddingClient.generateEmbedding({ text });
  }

  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    return this.embeddingClient.generateEmbeddingsBatch(texts);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let searchServiceInstance: SearchService | null = null;

export function getSearchService(): SearchService {
  if (!searchServiceInstance) {
    searchServiceInstance = new SearchService();
  }
  return searchServiceInstance;
}

export function setSearchService(service: SearchService): void {
  searchServiceInstance = service;
}