import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import { Matchers } from "@pact-foundation/pact";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { like, eachLike, term, iso8601DateTime, uuid } = MatchersV3;

const PACT_DIR = path.resolve(__dirname, "../../pacts");
const PROVIDER_BASE_URL = "http://localhost:3000";

// Consumer (iOS app) contract tests - these define what the consumer expects
describe("Instagram iOS App - Consumer Contract Tests", () => {
  const provider = new PactV3({
    consumer: "instagram-ios-app",
    provider: "instagram-backend",
    dir: PACT_DIR,
    logLevel: "info",
  });

  beforeAll(() => provider.setup());
  afterAll(() => provider.finalize());

  describe("Health & Metrics", () => {
    it("GET /health", async () => {
      await provider.addInteraction({
        state: "API is healthy",
        uponReceiving: "a request for health check",
        withRequest: {
          method: "GET",
          path: "/health",
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              status: "ok",
              timestamp: iso8601DateTime(),
              service: "instagram-clone-api",
            }),
          }),
        },
      });
    });

    it("GET /metrics", async () => {
      await provider.addInteraction({
        state: "metrics are available",
        uponReceiving: "a request for Prometheus metrics",
        withRequest: {
          method: "GET",
          path: "/metrics",
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          },
          body: term({
            generate: "# HELP http_requests_total Total number of HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total{method=\"GET\",endpoint=\"/metrics\"} 1\n",
            matcher: "^# HELP http_requests_total",
          }),
        },
      });
    });
  });

  describe("Authentication", () => {
    it("POST /v1/auth/register - successful registration", async () => {
      await provider.addInteraction({
        state: "a valid registration request",
        uponReceiving: "a request to register a new user",
        withRequest: {
          method: "POST",
          path: "/v1/auth/register",
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            email: "test@example.com",
            password: "SecurePass123!",
            username: "testuser",
            displayName: "Test User",
          }),
        },
        willRespondWith: {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              user: like({
                id: uuid(),
                email: "test@example.com",
                username: "testuser",
                displayName: "Test User",
                avatarUrl: term({ generate: "https://storage.example.com/avatars/default.png", matcher: "^https://" }),
                isVerified: false,
                isPrivate: false,
                createdAt: iso8601DateTime(),
              }),
              accessToken: term({ generate: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", matcher: "^eyJ" }),
              refreshToken: term({ generate: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", matcher: "^eyJ" }),
              expiresIn: 3600,
              tokenType: "Bearer",
            }),
          }),
        },
      });
    });

    it("POST /v1/auth/login - successful login", async () => {
      await provider.addInteraction({
        state: "a registered user exists",
        uponReceiving: "a request to login with valid credentials",
        withRequest: {
          method: "POST",
          path: "/v1/auth/login",
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            email: "test@example.com",
            password: "SecurePass123!",
          }),
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              user: like({
                id: uuid(),
                email: "test@example.com",
                username: "testuser",
                displayName: "Test User",
                avatarUrl: term({ generate: "https://storage.example.com/avatars/default.png", matcher: "^https://" }),
                isVerified: true,
                isPrivate: false,
                createdAt: iso8601DateTime(),
              }),
              accessToken: term({ generate: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", matcher: "^eyJ" }),
              refreshToken: term({ generate: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", matcher: "^eyJ" }),
              expiresIn: 3600,
              tokenType: "Bearer",
            }),
          }),
        },
      });
    });

    it("POST /v1/auth/login - invalid credentials", async () => {
      await provider.addInteraction({
        state: "a registered user exists",
        uponReceiving: "a request to login with invalid credentials",
        withRequest: {
          method: "POST",
          path: "/v1/auth/login",
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            email: "test@example.com",
            password: "WrongPassword123!",
          }),
        },
        willRespondWith: {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: false,
            error: "INVALID_CREDENTIALS",
            message: "Invalid email or password",
          }),
        },
      });
    });

    it("POST /v1/auth/refresh - token rotation", async () => {
      await provider.addInteraction({
        state: "a valid refresh token exists",
        uponReceiving: "a request to refresh access token",
        withRequest: {
          method: "POST",
          path: "/v1/auth/refresh",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer old_refresh_token",
          },
          body: like({
            refreshToken: "old_refresh_token",
          }),
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              accessToken: term({ generate: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", matcher: "^eyJ" }),
              refreshToken: term({ generate: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", matcher: "^eyJ" }),
              expiresIn: 3600,
              tokenType: "Bearer",
            }),
          }),
        },
      });
    });

    it("POST /v1/auth/logout - revoke refresh token", async () => {
      await provider.addInteraction({
        state: "an authenticated user session exists",
        uponReceiving: "a request to logout",
        withRequest: {
          method: "POST",
          path: "/v1/auth/logout",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer valid_access_token",
          },
          body: like({
            refreshToken: "valid_refresh_token",
          }),
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              message: "Logged out successfully",
            }),
          }),
        },
      });
    });
  });

  describe("User Profile", () => {
    it("GET /v1/user/me - get current user profile", async () => {
      await provider.addInteraction({
        state: "an authenticated user exists",
        uponReceiving: "a request to get current user profile",
        withRequest: {
          method: "GET",
          path: "/v1/user/me",
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              user: like({
                id: uuid(),
                email: "test@example.com",
                username: "testuser",
                displayName: "Test User",
                bio: "Test bio",
                avatarUrl: term({ generate: "https://storage.example.com/avatars/user123.jpg", matcher: "^https://" }),
                bannerUrl: term({ generate: "https://storage.example.com/banners/user123.jpg", matcher: "^https://" }),
                isVerified: true,
                isPrivate: false,
                followersCount: 100,
                followingCount: 50,
                postsCount: 25,
                createdAt: iso8601DateTime(),
                updatedAt: iso8601DateTime(),
              }),
            }),
          }),
        },
      });
    });

    it("PATCH /v1/user/me - update profile", async () => {
      await provider.addInteraction({
        state: "an authenticated user exists",
        uponReceiving: "a request to update user profile",
        withRequest: {
          method: "PATCH",
          path: "/v1/user/me",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer valid_access_token",
          },
          body: like({
            displayName: "Updated Name",
            bio: "Updated bio",
            website: "https://example.com",
          }),
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              user: like({
                id: uuid(),
                username: "testuser",
                displayName: "Updated Name",
                bio: "Updated bio",
                website: "https://example.com",
                updatedAt: iso8601DateTime(),
              }),
            }),
          }),
        },
      });
    });

    it("GET /v1/users/:username - get public profile", async () => {
      await provider.addInteraction({
        state: "a public user profile exists",
        uponReceiving: "a request to get public user profile",
        withRequest: {
          method: "GET",
          path: "/v1/users/testuser",
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              user: like({
                id: uuid(),
                username: "testuser",
                displayName: "Test User",
                bio: "Test bio",
                avatarUrl: term({ generate: "https://storage.example.com/avatars/user123.jpg", matcher: "^https://" }),
                bannerUrl: term({ generate: "https://storage.example.com/banners/user123.jpg", matcher: "^https://" }),
                isVerified: true,
                isPrivate: false,
                followersCount: 100,
                followingCount: 50,
                postsCount: 25,
                isFollowing: false,
                isFollowedBy: false,
                createdAt: iso8601DateTime(),
              }),
            }),
          }),
        },
      });
    });
  });

  describe("Posts", () => {
    it("POST /v1/posts - create post", async () => {
      await provider.addInteraction({
        state: "an authenticated user with media exists",
        uponReceiving: "a request to create a new post",
        withRequest: {
          method: "POST",
          path: "/v1/posts",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer valid_access_token",
          },
          body: like({
            caption: "Test post caption #hashtag",
            mediaIds: [uuid(), uuid()],
            locationId: uuid(),
            audience: "followers",
            allowComments: true,
            allowLikes: true,
          }),
        },
        willRespondWith: {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              post: like({
                id: uuid(),
                caption: "Test post caption #hashtag",
                userId: uuid(),
                media: eachLike(
                  like({
                    id: uuid(),
                    type: "image",
                    url: term({ generate: "https://storage.example.com/posts/abc123.jpg", matcher: "^https://" }),
                    thumbnailUrl: term({ generate: "https://storage.example.com/posts/thumb_abc123.jpg", matcher: "^https://" }),
                    width: 1080,
                    height: 1080,
                  })
                ),
                location: like({
                  id: uuid(),
                  name: "San Francisco, CA",
                  latitude: 37.7749,
                  longitude: -122.4194,
                }),
                likesCount: 0,
                commentsCount: 0,
                savesCount: 0,
                isLiked: false,
                isSaved: false,
                createdAt: iso8601DateTime(),
                updatedAt: iso8601DateTime(),
              }),
            }),
          }),
        },
      });
    });

    it("GET /v1/posts/:id - get single post", async () => {
      await provider.addInteraction({
        state: "a post exists",
        uponReceiving: "a request to get a single post",
        withRequest: {
          method: "GET",
          path: term({ generate: "/v1/posts/abc123", matcher: "^/v1/posts/" }),
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              post: like({
                id: uuid(),
                caption: "Test post caption",
                user: like({
                  id: uuid(),
                  username: "testuser",
                  displayName: "Test User",
                  avatarUrl: term({ generate: "https://storage.example.com/avatars/user123.jpg", matcher: "^https://" }),
                  isVerified: true,
                }),
                media: eachLike(
                  like({
                    id: uuid(),
                    type: "image",
                    url: term({ generate: "https://storage.example.com/posts/abc123.jpg", matcher: "^https://" }),
                    thumbnailUrl: term({ generate: "https://storage.example.com/posts/thumb_abc123.jpg", matcher: "^https://" }),
                    width: 1080,
                    height: 1080,
                  })
                ),
                location: like({
                  id: uuid(),
                  name: "San Francisco, CA",
                  latitude: 37.7749,
                  longitude: -122.4194,
                }),
                likesCount: 42,
                commentsCount: 5,
                savesCount: 3,
                isLiked: false,
                isSaved: false,
                createdAt: iso8601DateTime(),
                updatedAt: iso8601DateTime(),
              }),
            }),
          }),
        },
      });
    });

    it("GET /v1/posts/feed - get paginated feed", async () => {
      await provider.addInteraction({
        state: "feed items exist for user",
        uponReceiving: "a request to get home feed",
        withRequest: {
          method: "GET",
          path: "/v1/posts/feed",
          query: like({
            cursor: "eyJpZCI6IjEyMyJ9",
            limit: "20",
          }),
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              posts: eachLike(
                like({
                  id: uuid(),
                  caption: "Feed post",
                  user: like({
                    id: uuid(),
                    username: "feeduser",
                    displayName: "Feed User",
                    avatarUrl: term({ generate: "https://storage.example.com/avatars/feed.jpg", matcher: "^https://" }),
                    isVerified: false,
                  }),
                  media: eachLike(
                    like({
                      id: uuid(),
                      type: "image",
                      url: term({ generate: "https://storage.example.com/posts/feed1.jpg", matcher: "^https://" }),
                      thumbnailUrl: term({ generate: "https://storage.example.com/posts/thumb_feed1.jpg", matcher: "^https://" }),
                      width: 1080,
                      height: 1080,
                    })
                  ),
                  likesCount: 10,
                  commentsCount: 2,
                  isLiked: false,
                  createdAt: iso8601DateTime(),
                })
              ),
              nextCursor: term({ generate: "eyJpZCI6IjQ1NiJ9", matcher: "^eyJ" }),
              hasMore: true,
            }),
          }),
        },
      });
    });

    it("POST /v1/posts/:id/like - like a post", async () => {
      await provider.addInteraction({
        state: "a post exists and user is authenticated",
        uponReceiving: "a request to like a post",
        withRequest: {
          method: "POST",
          path: term({ generate: "/v1/posts/abc123/like", matcher: "^/v1/posts/.*/like$" }),
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              isLiked: true,
              likesCount: 43,
            }),
          }),
        },
      });
    });

    it("DELETE /v1/posts/:id/like - unlike a post", async () => {
      await provider.addInteraction({
        state: "a liked post exists",
        uponReceiving: "a request to unlike a post",
        withRequest: {
          method: "DELETE",
          path: term({ generate: "/v1/posts/abc123/like", matcher: "^/v1/posts/.*/like$" }),
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              isLiked: false,
              likesCount: 42,
            }),
          }),
        },
      });
    });
  });

  describe("Reels", () => {
    it("GET /v1/reels/feed - get reels feed", async () => {
      await provider.addInteraction({
        state: "reels exist for feed",
        uponReceiving: "a request to get reels feed",
        withRequest: {
          method: "GET",
          path: "/v1/reels/feed",
          query: like({
            cursor: "eyJpZCI6IjEyMyJ9",
            limit: "10",
          }),
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              reels: eachLike(
                like({
                  id: uuid(),
                  caption: "Amazing reel! 🎬",
                  user: like({
                    id: uuid(),
                    username: "reelcreator",
                    displayName: "Reel Creator",
                    avatarUrl: term({ generate: "https://storage.example.com/avatars/reel.jpg", matcher: "^https://" }),
                    isVerified: true,
                  }),
                  video: like({
                    id: uuid(),
                    url: term({ generate: "https://storage.example.com/reels/video123.mp4", matcher: "^https://" }),
                    thumbnailUrl: term({ generate: "https://storage.example.com/reels/thumb_video123.jpg", matcher: "^https://" }),
                    duration: 30.5,
                    width: 1080,
                    height: 1920,
                  }),
                  audio: like({
                    id: uuid(),
                    title: "Trending Audio",
                    artist: "Artist Name",
                    url: term({ generate: "https://storage.example.com/audio/trending.mp3", matcher: "^https://" }),
                    duration: 60,
                  }),
                  likesCount: 1000,
                  commentsCount: 50,
                  sharesCount: 25,
                  isLiked: false,
                  isSaved: false,
                  createdAt: iso8601DateTime(),
                })
              ),
              nextCursor: term({ generate: "eyJpZCI6IjQ1NiJ9", matcher: "^eyJ" }),
              hasMore: true,
            }),
          }),
        },
      });
    });

    it("POST /v1/reels - create reel", async () => {
      await provider.addInteraction({
        state: "an authenticated user with video exists",
        uponReceiving: "a request to create a new reel",
        withRequest: {
          method: "POST",
          path: "/v1/reels",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer valid_access_token",
          },
          body: like({
            videoId: uuid(),
            caption: "My new reel! #trending",
            audioId: uuid(),
            coverTimestamp: 5.0,
            audience: "public",
            allowComments: true,
            allowRemix: true,
          }),
        },
        willRespondWith: {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              reel: like({
                id: uuid(),
                caption: "My new reel! #trending",
                userId: uuid(),
                video: like({
                  id: uuid(),
                  url: term({ generate: "https://storage.example.com/reels/new_video.mp4", matcher: "^https://" }),
                  thumbnailUrl: term({ generate: "https://storage.example.com/reels/thumb_new.jpg", matcher: "^https://" }),
                  duration: 30.5,
                  width: 1080,
                  height: 1920,
                }),
                audio: like({
                  id: uuid(),
                  title: "Trending Audio",
                  artist: "Artist Name",
                }),
                likesCount: 0,
                commentsCount: 0,
                sharesCount: 0,
                isLiked: false,
                isSaved: false,
                createdAt: iso8601DateTime(),
              }),
            }),
          }),
        },
      });
    });
  });

  describe("Stories", () => {
    it("GET /v1/stories/feed - get stories tray", async () => {
      await provider.addInteraction({
        state: "stories exist for user",
        uponReceiving: "a request to get stories feed",
        withRequest: {
          method: "GET",
          path: "/v1/stories/feed",
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              stories: eachLike(
                like({
                  userId: uuid(),
                  username: "storyuser",
                  displayName: "Story User",
                  avatarUrl: term({ generate: "https://storage.example.com/avatars/story.jpg", matcher: "^https://" }),
                  isVerified: false,
                  items: eachLike(
                    like({
                      id: uuid(),
                      type: "image",
                      mediaUrl: term({ generate: "https://storage.example.com/stories/item1.jpg", matcher: "^https://" }),
                      duration: 5,
                      isViewed: false,
                      createdAt: iso8601DateTime(),
                    })
                  ),
                  hasUnviewed: true,
                })
              ),
            }),
          }),
        },
      });
    });

    it("POST /v1/stories - create story", async () => {
      await provider.addInteraction({
        state: "an authenticated user with media exists",
        uponReceiving: "a request to create a new story",
        withRequest: {
          method: "POST",
          path: "/v1/stories",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer valid_access_token",
          },
          body: like({
            mediaId: uuid(),
            type: "image",
            audience: "followers",
            stickers: eachLike(
              like({
                type: "mention",
                userId: uuid(),
                x: 0.5,
                y: 0.5,
              })
            ),
          }),
        },
        willRespondWith: {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              story: like({
                id: uuid(),
                userId: uuid(),
                items: eachLike(
                  like({
                    id: uuid(),
                    type: "image",
                    mediaUrl: term({ generate: "https://storage.example.com/stories/new_item.jpg", matcher: "^https://" }),
                    duration: 5,
                    createdAt: iso8601DateTime(),
                    expiresAt: iso8601DateTime(),
                  })
                ),
                audience: "followers",
                createdAt: iso8601DateTime(),
              }),
            }),
          }),
        },
      });
    });
  });

  describe("Conversations & Messages", () => {
    it("GET /v1/conversations - get conversation list", async () => {
      await provider.addInteraction({
        state: "user has conversations",
        uponReceiving: "a request to get conversation list",
        withRequest: {
          method: "GET",
          path: "/v1/conversations",
          query: like({
            cursor: "eyJpZCI6IjEyMyJ9",
            limit: "20",
          }),
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              conversations: eachLike(
                like({
                  id: uuid(),
                  type: "direct",
                  participants: eachLike(
                    like({
                      id: uuid(),
                      username: "friend",
                      displayName: "Friend Name",
                      avatarUrl: term({ generate: "https://storage.example.com/avatars/friend.jpg", matcher: "^https://" }),
                      isVerified: false,
                    })
                  ),
                  lastMessage: like({
                    id: uuid(),
                    type: "text",
                    content: "Hey! How are you?",
                    senderId: uuid(),
                    createdAt: iso8601DateTime(),
                  }),
                  unreadCount: 2,
                  isMuted: false,
                  updatedAt: iso8601DateTime(),
                })
              ),
              nextCursor: term({ generate: "eyJpZCI6IjQ1NiJ9", matcher: "^eyJ" }),
              hasMore: false,
            }),
          }),
        },
      });
    });

    it("POST /v1/conversations - create conversation", async () => {
      await provider.addInteraction({
        state: "authenticated user wants to start conversation",
        uponReceiving: "a request to create a new conversation",
        withRequest: {
          method: "POST",
          path: "/v1/conversations",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer valid_access_token",
          },
          body: like({
            participantIds: [uuid()],
            type: "direct",
          }),
        },
        willRespondWith: {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              conversation: like({
                id: uuid(),
                type: "direct",
                participants: eachLike(
                  like({
                    id: uuid(),
                    username: "friend",
                    displayName: "Friend Name",
                    avatarUrl: term({ generate: "https://storage.example.com/avatars/friend.jpg", matcher: "^https://" }),
                  })
                ),
                createdAt: iso8601DateTime(),
              }),
            }),
          }),
        },
      });
    });

    it("GET /v1/conversations/:id/messages - get messages", async () => {
      await provider.addInteraction({
        state: "conversation with messages exists",
        uponReceiving: "a request to get conversation messages",
        withRequest: {
          method: "GET",
          path: term({ generate: "/v1/conversations/abc123/messages", matcher: "^/v1/conversations/.*/messages$" }),
          query: like({
            cursor: "eyJpZCI6IjEyMyJ9",
            limit: "50",
          }),
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              messages: eachLike(
                like({
                  id: uuid(),
                  type: "text",
                  content: "Hello!",
                  senderId: uuid(),
                  conversationId: uuid(),
                  replyToId: null,
                  isEdited: false,
                  isDeleted: false,
                  reactions: eachLike(
                    like({
                      emoji: "👍",
                      count: 1,
                      userIds: [uuid()],
                    })
                  ),
                  createdAt: iso8601DateTime(),
                  updatedAt: iso8601DateTime(),
                })
              ),
              nextCursor: term({ generate: "eyJpZCI6IjQ1NiJ9", matcher: "^eyJ" }),
              hasMore: false,
            }),
          }),
        },
      });
    });

    it("POST /v1/conversations/:id/messages - send message", async () => {
      await provider.addInteraction({
        state: "authenticated user in conversation",
        uponReceiving: "a request to send a message",
        withRequest: {
          method: "POST",
          path: term({ generate: "/v1/conversations/abc123/messages", matcher: "^/v1/conversations/.*/messages$" }),
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer valid_access_token",
          },
          body: like({
            type: "text",
            content: "Hello there!",
            replyToId: null,
          }),
        },
        willRespondWith: {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              message: like({
                id: uuid(),
                type: "text",
                content: "Hello there!",
                senderId: uuid(),
                conversationId: uuid(),
                replyToId: null,
                isEdited: false,
                isDeleted: false,
                reactions: [],
                createdAt: iso8601DateTime(),
              }),
            }),
          }),
        },
      });
    });
  });

  describe("Notifications", () => {
    it("GET /v1/notifications - get notifications", async () => {
      await provider.addInteraction({
        state: "user has notifications",
        uponReceiving: "a request to get notifications",
        withRequest: {
          method: "GET",
          path: "/v1/notifications",
          query: like({
            cursor: "eyJpZCI6IjEyMyJ9",
            limit: "20",
          }),
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              notifications: eachLike(
                like({
                  id: uuid(),
                  type: "like",
                  groupKey: "like:post:abc123",
                  groupCount: 5,
                  actor: like({
                    id: uuid(),
                    username: "liker",
                    displayName: "Liker Name",
                    avatarUrl: term({ generate: "https://storage.example.com/avatars/liker.jpg", matcher: "^https://" }),
                  }),
                  target: like({
                    type: "post",
                    id: uuid(),
                    preview: "Test post caption...",
                  }),
                  isRead: false,
                  createdAt: iso8601DateTime(),
                })
              ),
              nextCursor: term({ generate: "eyJpZCI6IjQ1NiJ9", matcher: "^eyJ" }),
              hasMore: false,
              unreadCount: 3,
            }),
          }),
        },
      });
    });

    it("PATCH /v1/notifications/:id/read - mark as read", async () => {
      await provider.addInteraction({
        state: "unread notification exists",
        uponReceiving: "a request to mark notification as read",
        withRequest: {
          method: "PATCH",
          path: term({ generate: "/v1/notifications/abc123/read", matcher: "^/v1/notifications/.*/read$" }),
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              notification: like({
                id: uuid(),
                isRead: true,
              }),
            }),
          }),
        },
      });
    });
  });

  describe("Upload", () => {
    it("POST /v1/upload/presigned - get presigned URL", async () => {
      await provider.addInteraction({
        state: "authenticated user requesting upload",
        uponReceiving: "a request for presigned upload URL",
        withRequest: {
          method: "POST",
          path: "/v1/upload/presigned",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer valid_access_token",
          },
          body: like({
            filename: "photo.jpg",
            contentType: "image/jpeg",
            bucket: "uploads",
          }),
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              uploadUrl: term({ generate: "https://storage.example.com/uploads/abc123?X-Amz-Algorithm=AWS4-HMAC-SHA256...", matcher: "^https://" }),
              fields: like({
                key: "uploads/user123/abc123.jpg",
                policy: term({ generate: "eyJleHBpcmF0aW9uIjoiMjAyNC0wMS0wMVQwMDowMDowMFoiLCJjb25kaXRpb25zIjpbXX0=", matcher: "^eyJ" }),
                "x-amz-algorithm": "AWS4-HMAC-SHA256",
                "x-amz-credential": "AKIA...",
                "x-amz-date": "20240101T000000Z",
                "x-amz-signature": "abc123...",
              }),
              fileUrl: term({ generate: "https://storage.example.com/uploads/user123/abc123.jpg", matcher: "^https://" }),
              expiresIn: 3600,
            }),
          }),
        },
      });
    });
  });

  describe("Search", () => {
    it("GET /v1/search - unified search", async () => {
      await provider.addInteraction({
        state: "search index has data",
        uponReceiving: "a request to search",
        withRequest: {
          method: "GET",
          path: "/v1/search",
          query: like({
            q: "instagram",
            type: "all",
            limit: "20",
          }),
          headers: {
            "Authorization": "Bearer valid_access_token",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: like({
            success: true,
            data: like({
              users: eachLike(
                like({
                  id: uuid(),
                  username: "insta_user",
                  displayName: "Insta User",
                  avatarUrl: term({ generate: "https://storage.example.com/avatars/insta.jpg", matcher: "^https://" }),
                  isVerified: true,
                })
              ),
              posts: eachLike(
                like({
                  id: uuid(),
                  caption: "Instagram post",
                  media: eachLike(
                    like({
                      type: "image",
                      thumbnailUrl: term({ generate: "https://storage.example.com/posts/thumb_insta.jpg", matcher: "^https://" }),
                    })
                  ),
                })
              ),
              reels: eachLike(
                like({
                  id: uuid(),
                  caption: "Instagram reel",
                  video: like({
                    thumbnailUrl: term({ generate: "https://storage.example.com/reels/thumb_insta.jpg", matcher: "^https://" }),
                  }),
                })
              ),
              hashtags: eachLike(
                like({
                  tag: "instagram",
                  postsCount: 1000000,
                })
              ),
              locations: eachLike(
                like({
                  id: uuid(),
                  name: "Instagram HQ",
                  city: "Menlo Park",
                  country: "USA",
                })
              ),
            }),
          }),
        },
      });
    });
  });
});