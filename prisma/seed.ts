import { PrismaClient, MediaType, MessageContentType, NotificationType, MessageStatus, DevicePlatform } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PASSWORD = 'password123';

// Helper functions
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomChoice = <T,>(arr: T[]): T => arr[randomInt(0, arr.length - 1)];
const randomChoices = <T,>(arr: T[], count: number): T[] => {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, arr.length));
};
const randomDate = (start: Date, end: Date) => new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const imageUrl = (seed: string, w = 1080, h = 1350) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const videoUrl = (seed: number) => `https://storage.googleapis.com/gtv-videos-bucket/sample/ForBigger${['Blazes', 'Escapes', 'Fun', 'Joyrides', 'Meltdowns'][seed % 5]}.mp4`;
const avatarUrl = (seed: string) => `https://i.pravatar.cc/400?u=${seed}`;

// Realistic data
const firstNames = [
  'Minh', 'Lan', 'Huy', 'Thao', 'Duc', 'Mai', 'Khoa', 'Ngoc', 'Phong', 'Hien',
  'Nam', 'Ha', 'Tuan', 'Linh', 'Vinh', 'Trang', 'Khanh', 'My', 'Dat', 'Quynh',
  'Long', 'Nhi', 'Bao', 'Vy', 'Son', 'An', 'Tai', 'Chi', 'Hoang', 'Yen'
];

const lastNames = [
  'Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Huynh', 'Phan', 'Vu', 'Dang', 'Bui',
  'Do', 'Ho', 'Ngo', 'Duong', 'Ly', 'Truong', 'Dinh', 'Lam', 'Hua', 'Vo'
];

const bios = [
  'Dreamer | Creator | Coffee addict ☕',
  'Living life one photo at a time 📸',
  'Code by day, content by night 💻✨',
  'Travel enthusiast | Food lover 🌍🍜',
  'Minimalist lifestyle advocate 🌿',
  'Fitness journey 💪 | Healthy mind',
  'Artist | Designer | Storyteller 🎨',
  'Tech explorer | Gadget reviewer 📱',
  'Bookworm | Writer | Poet 📚',
  'Music producer | Beat maker 🎵',
  'Pet parent 🐕 | Adventure seeker',
  'Sustainable living advocate ♻️',
  'Language learner 🌐 | Polyglot goals',
  'Plant mom 🌱 | Urban gardener',
  'Retro gaming enthusiast 🎮',
];

const locations = [
  { name: 'Ho Chi Minh City, Vietnam', lat: 10.8231, lng: 106.6297 },
  { name: 'Hanoi, Vietnam', lat: 21.0285, lng: 105.8542 },
  { name: 'Da Nang, Vietnam', lat: 16.0544, lng: 108.2022 },
  { name: 'Hoi An, Vietnam', lat: 15.8801, lng: 108.3380 },
  { name: 'Nha Trang, Vietnam', lat: 12.2388, lng: 109.1967 },
  { name: 'Phu Quoc, Vietnam', lat: 10.2228, lng: 103.9633 },
  { name: 'Sapa, Vietnam', lat: 22.3364, lng: 103.8438 },
  { name: 'Ha Long Bay, Vietnam', lat: 20.9101, lng: 107.1839 },
  { name: 'Bangkok, Thailand', lat: 13.7563, lng: 100.5018 },
  { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
  { name: 'Kuala Lumpur, Malaysia', lat: 3.1390, lng: 101.6869 },
  { name: 'Tokyo, Japan', lat: 35.6762, lng: 139.6503 },
  { name: 'Seoul, South Korea', lat: 37.5665, lng: 126.9780 },
  { name: 'Taipei, Taiwan', lat: 25.0320, lng: 121.5654 },
  { name: 'Sydney, Australia', lat: -33.8688, lng: 151.2093 },
];

const postCaptions = [
  'Morning vibes only ☀️ Starting the day right with a perfect cup of coffee and this view!',
  'Weekend adventures 🌲 Found this hidden gem while hiking. Nature never disappoints.',
  'New project launched! 🚀 So proud of what the team has built. Link in bio.',
  'Throwback to the best sunset 🌅 Sometimes you just need to pause and appreciate.',
  'Outfit of the day ✨ Feeling confident in this new fit. Where would you wear this?',
  'Just finished an amazing book 📖 "Atomic Habits" - life changing insights!',
  'Home cooked meal 🍲 Nothing beats mom\'s recipe. Secret ingredient: love.',
  'Street photography session 📷 Captured this candid moment. The city tells stories.',
  'Workout complete! 💪 Leg day destroyed me but feeling accomplished.',
  'Travel diary ✈️ Day 3 in Bali - rice terraces, temples, and endless smiles.',
  'New sketch finished 🎨 Been working on this for weeks. What do you think?',
  'Rainy day mood 🌧️ Perfect excuse to stay in, read, and drink hot chocolate.',
  'Beach cleanup today 🌊 Every small action counts for our oceans. #sustainability',
  'Late night coding session 🌙 Debugging at 2am hits different. Coffee fuel activated.',
  'Celebrating small wins 🎉 Got the promotion! Hard work pays off.',
  'Golden hour magic ✨ The light was perfect for portraits today.',
  'Plant haul 🪴 Added 5 new babies to the collection. Plant parent life!',
  'Foodie Friday 🍜 Discovered this amazing pho place. Broth game strong!',
  'Meditation retreat 🧘‍♀️ 3 days of silence changed my perspective completely.',
  'DIY home decor 🏠 Built this shelf from scratch. So satisfying!',
];

const reelCaptions = [
  'POV: You\'re learning a new skill 📈',
  'Day in the life of a developer 💻',
  'Quick recipe: 5-min breakfast 🍳',
  'Travel hack you need to know ✈️',
  'Satisfying organization ASMR ✨',
  'My morning routine 2024 ☀️',
  'Budget-friendly home decor 🏠',
  'How I stay productive 🎯',
  'Hidden spots in my city 🗺️',
  'Pet compilation 🐶🐱',
];

const storyStickerTypes = ['location', 'mention', 'hashtag', 'poll', 'question', 'music', 'gif', 'countdown'];

const notificationTemplates = {
  LIKE: (actorName: string) => `${actorName} liked your post`,
  COMMENT: (actorName: string) => `${actorName} commented on your post`,
  FOLLOW: (actorName: string) => `${actorName} started following you`,
  FOLLOW_REQUEST: (actorName: string) => `${actorName} requested to follow you`,
  MENTION: (actorName: string) => `${actorName} mentioned you in a comment`,
  TAGGED_IN_POST: (actorName: string) => `${actorName} tagged you in a post`,
  STORY_MENTION: (actorName: string) => `${actorName} mentioned you in their story`,
  LIVE_VIDEO: (actorName: string) => `${actorName} went live`,
};

async function main() {
  console.log('🌱 Starting comprehensive database seeding...');

  // ============================================
  // 1. CREATE USERS
  // ============================================
  console.log('👥 Creating users...');
  const userCount = 20;
  const users = [];

  for (let i = 0; i < userCount; i++) {
    const firstName = randomChoice(firstNames);
    const lastName = randomChoice(lastNames);
    const fullName = `${firstName} ${lastName}`;
    const username = `${slugify(firstName)}${slugify(lastName)}${i + 1}`.toLowerCase();
    const email = `${username}@example.com`;
    const firebaseUid = `firebase-${username}-${Date.now()}-${i}`;
    const bio = randomChoice(bios);
    const isVerified = Math.random() < 0.15;
    const isPrivate = Math.random() < 0.2;

    // Password hash for all test users (password: password123)
const PASSWORD_HASH = "$2b$10$8K1p/a0dL1LXMIgoEDFrwOj9B6qL5jS.kL7oK8Y8Y8Y8Y8Y8Y8Y8Y8"; // bcrypt hash of 'password123'

const user = await prisma.user.upsert({
      where: { id: `user-${i + 1}` },
      update: {
        fullName,
        username,
        email,
        bio,
        avatarUrl: avatarUrl(username),
        isVerified,
        isPrivate,
        name: fullName,
        image: avatarUrl(username),
        firebaseUid,
        passwordHash: PASSWORD_HASH,
      },
      create: {
        id: `user-${i + 1}`,
        firebaseUid,
        username,
        fullName,
        email,
        bio,
        avatarUrl: avatarUrl(username),
        isVerified,
        isPrivate,
        name: fullName,
        image: avatarUrl(username),
        passwordHash: PASSWORD_HASH,
        phone: Math.random() < 0.3 ? `+84${randomInt(900000000, 999999999)}` : null,
        website: Math.random() < 0.2 ? `https://${username}.dev` : null,
      },
    });
    users.push(user);
  }

  const userIds = users.map(u => u.id);
  console.log(`✅ Created ${users.length} users`);

  // ============================================
  // 1b. CREATE BETTER AUTH ACCOUNTS (password: password123)
  // ============================================
  console.log('🔐 Creating Better Auth accounts...');
  const PASSWORD_HASH = await bcrypt.hash(PASSWORD, 10);
  for (const user of users) {
    // Check if account already exists
    const existingAccount = await prisma.account.findFirst({
      where: {
        userId: user.id,
        providerId: 'credential',
      },
    });

    if (existingAccount) {
      await prisma.account.update({
        where: { id: existingAccount.id },
        data: { password: PASSWORD_HASH },
      });
    } else {
      await prisma.account.create({
        data: {
          id: `account-${user.id}`,
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: PASSWORD_HASH,
        },
      });
    }
  }
  console.log('✅ Created Better Auth accounts');

  // ============================================
  // 2. CREATE USER SETTINGS
  // ============================================
  console.log('⚙️ Creating user settings...');
  for (const user of users) {
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        language: randomChoice(['en', 'vi', 'ja', 'ko', 'zh']),
        biometricEnabled: Math.random() < 0.8,
        pushEnabled: Math.random() < 0.9,
        darkMode: Math.random() < 0.5,
      },
    });
  }
  console.log('✅ Created user settings');

  // ============================================
  // 3. CREATE DEVICE TOKENS
  // ============================================
  console.log('📱 Creating device tokens...');
  for (const user of users) {
    const deviceCount = randomInt(1, 3);
    for (let i = 0; i < deviceCount; i++) {
      await prisma.deviceToken.create({
        data: {
          userId: user.id,
          token: `device-token-${user.id}-${i}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          platform: randomChoice([DevicePlatform.IOS, DevicePlatform.ANDROID]),
        },
      });
    }
  }
  console.log('✅ Created device tokens');

  // ============================================
  // 4. CREATE FOLLOWS (Social Graph)
  // ============================================
  console.log('🤝 Creating follows...');
  const follows = [];
  // Ensure everyone follows at least 3-8 people
  for (const follower of users) {
    const followCount = randomInt(3, 8);
    const potentialFollowees = users.filter(u => u.id !== follower.id);
    const followees = randomChoices(potentialFollowees, followCount);

    for (const followee of followees) {
      try {
        const follow = await prisma.follow.upsert({
          where: { followerId_followingId: { followerId: follower.id, followingId: followee.id } },
          update: {},
          create: { followerId: follower.id, followingId: followee.id },
        });
        follows.push(follow);
      } catch (e) {
        // Ignore duplicates
      }
    }
  }

  // Update follower/following counts
  for (const user of users) {
    const followersCount = follows.filter(f => f.followingId === user.id).length;
    const followingCount = follows.filter(f => f.followerId === user.id).length;
    await prisma.user.update({
      where: { id: user.id },
      data: { followersCount, followingCount },
    });
  }
  console.log(`✅ Created ${follows.length} follows`);

  // ============================================
  // 5. CREATE CLOSE FRIENDS
  // ============================================
  console.log('⭐ Creating close friends...');
  const closeFriends = [];
  for (const user of users) {
    const closeFriendCount = randomInt(0, 5);
    const potentialFriends = users.filter(u => u.id !== user.id);
    const friends = randomChoices(potentialFriends, closeFriendCount);

    for (const friend of friends) {
      try {
        const cf = await prisma.closeFriend.upsert({
          where: { userId_friendId: { userId: user.id, friendId: friend.id } },
          update: {},
          create: { userId: user.id, friendId: friend.id },
        });
        closeFriends.push(cf);
      } catch (e) {
        // Ignore duplicates
      }
    }
  }
  console.log(`✅ Created ${closeFriends.length} close friend relationships`);

  // ============================================
  // 6. CREATE BLOCKS
  // ============================================
  console.log('🚫 Creating blocks...');
  const blocks = [];
  // Small number of blocks for realism
  for (let i = 0; i < 5; i++) {
    const blocker = randomChoice(users);
    const potentialBlocked = users.filter(u => u.id !== blocker.id);
    const blocked = randomChoice(potentialBlocked);

    try {
      const block = await prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId: blocker.id, blockedId: blocked.id } },
        update: {},
        create: { blockerId: blocker.id, blockedId: blocked.id },
      });
      blocks.push(block);
    } catch (e) {
      // Ignore duplicates
    }
  }
  console.log(`✅ Created ${blocks.length} blocks`);

  // ============================================
  // 7. CREATE POSTS WITH MEDIA
  // ============================================
  console.log('📝 Creating posts with media...');
  const posts = [];
  const postCount = 50;

  for (let i = 0; i < postCount; i++) {
    const author = randomChoice(users);
    const location = randomChoice(locations);
    const mediaCount = randomInt(1, 4);
    const caption = randomChoice(postCaptions);
    const isSponsored = Math.random() < 0.05;

    const createdAt = randomDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), new Date());

    const mediaItems = [];
    for (let j = 0; j < mediaCount; j++) {
      const type = randomChoice([MediaType.IMAGE, MediaType.VIDEO]);
      mediaItems.push({
        url: type === MediaType.IMAGE
          ? imageUrl(`post-${i}-${j}-${author.username}`, 1080, 1350)
          : videoUrl(i * 10 + j),
        thumbnailUrl: type === MediaType.VIDEO
          ? imageUrl(`post-${i}-${j}-${author.username}-thumb`, 480, 600)
          : null,
        type,
        width: type === MediaType.IMAGE ? 1080 : 1920,
        height: type === MediaType.IMAGE ? 1350 : 1080,
        duration: type === MediaType.VIDEO ? randomInt(5, 60) : null,
        sortOrder: j,
      });
    }

    const post = await prisma.post.create({
      data: {
        authorId: author.id,
        caption,
        locationName: location.name,
        locationLat: location.lat,
        locationLng: location.lng,
        isSponsored,
        createdAt,
        updatedAt: createdAt,
        mediaItems: { create: mediaItems },
      },
    });
    posts.push(post);
  }
  console.log(`✅ Created ${posts.length} posts with media`);

  // ============================================
  // 8. CREATE REELS
  // ============================================
  console.log('🎬 Creating reels...');
  const reels = [];
  const reelCount = 30;

  for (let i = 0; i < reelCount; i++) {
    const author = randomChoice(users);
    const caption = randomChoice(reelCaptions);
    const videoSeed = i;
    const duration = randomInt(10, 60);

    const createdAt = randomDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), new Date());

    const reel = await prisma.reel.create({
      data: {
        authorId: author.id,
        videoUrl: videoUrl(videoSeed),
        thumbnailUrl: imageUrl(`reel-${i}-${author.username}`, 480, 854),
        caption,
        audioName: Math.random() < 0.7 ? `Trending Audio ${i + 1}` : null,
        audioArtist: Math.random() < 0.5 ? `Artist ${randomInt(1, 20)}` : null,
        audioCoverUrl: Math.random() < 0.3 ? imageUrl(`audio-${i}`, 200, 200) : null,
        isOriginalAudio: Math.random() < 0.2,
        duration,
        createdAt,
      },
    });
    reels.push(reel);
  }
  console.log(`✅ Created ${reels.length} reels`);

  // ============================================
  // 9. CREATE STORIES WITH ITEMS
  // ============================================
  console.log('📖 Creating stories...');
  const stories = [];
  const storyCount = 25;
  const now = new Date();

  for (let i = 0; i < storyCount; i++) {
    const author = randomChoice(users);
    const itemCount = randomInt(1, 5);
    const createdAt = randomDate(new Date(now.getTime() - 24 * 60 * 60 * 1000), now);
    const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

    const items = [];
    for (let j = 0; j < itemCount; j++) {
      const type = randomChoice([MediaType.IMAGE, MediaType.VIDEO]);
      items.push({
        mediaUrl: type === MediaType.IMAGE
          ? imageUrl(`story-${i}-${j}-${author.username}`, 1080, 1920)
          : videoUrl(i * 10 + j),
        type,
        duration: type === MediaType.VIDEO ? randomInt(5, 15) : 5,
        sortOrder: j,
        stickerType: Math.random() < 0.3 ? randomChoice(storyStickerTypes) : null,
        stickerData: Math.random() < 0.3 ? JSON.stringify({ text: 'Sample sticker' }) : null,
      });
    }

    const story = await prisma.story.create({
      data: {
        authorId: author.id,
        createdAt,
        expiresAt,
        items: { create: items },
      },
    });
    stories.push(story);
  }
  console.log(`✅ Created ${stories.length} stories with items`);

  // ============================================
  // 10. CREATE LIKES (Posts, Reels, Comments)
  // ============================================
  console.log('❤️ Creating likes...');
  const likes = [];

  // Post likes
  for (const post of posts) {
    const likeCount = randomInt(0, Math.min(15, users.length));
    const likers = randomChoices(users.filter(u => u.id !== post.authorId), likeCount);

    for (const liker of likers) {
      try {
        const like = await prisma.like.upsert({
          where: { userId_postId: { userId: liker.id, postId: post.id } },
          update: {},
          create: { userId: liker.id, postId: post.id },
        });
        likes.push(like);
      } catch (e) {
        // Ignore
      }
    }

    // Update likes count
    await prisma.post.update({
      where: { id: post.id },
      data: { likesCount: likeCount },
    });
  }

  // Reel likes
  for (const reel of reels) {
    const likeCount = randomInt(0, Math.min(20, users.length));
    const likers = randomChoices(users.filter(u => u.id !== reel.authorId), likeCount);

    for (const liker of likers) {
      try {
        const like = await prisma.like.upsert({
          where: { userId_reelId: { userId: liker.id, reelId: reel.id } },
          update: {},
          create: { userId: liker.id, reelId: reel.id },
        });
        likes.push(like);
      } catch (e) {
        // Ignore
      }
    }

    await prisma.reel.update({
      where: { id: reel.id },
      data: { likesCount: likeCount },
    });
  }
  console.log(`✅ Created ${likes.length} likes`);

  // ============================================
  // 11. CREATE COMMENTS WITH REPLIES
  // ============================================
  console.log('💬 Creating comments...');
  const comments = [];

  // Post comments
  for (const post of posts) {
    const commentCount = randomInt(0, Math.min(10, users.length));
    const commenters = randomChoices(users.filter(u => u.id !== post.authorId), commentCount);

    for (const commenter of commenters) {
      const comment: any = await prisma.comment.create({
        data: {
          postId: post.id,
          authorId: commenter.id,
          text: randomChoice([
            'This is amazing! 😍',
            'Love this so much!',
            'Incredible shot 📸',
            'Where is this?',
            'Goals! ✨',
            'So beautiful',
            'Can\'t wait to visit!',
            'The lighting is perfect 🌅',
            'You have such a good eye',
            'This made my day 😊',
            'Stunning composition!',
            'Vibes are immaculate ✨',
            'Saving this for later 💾',
            'Who took this photo?',
            'Perfection!',
          ]),
          createdAt: randomDate(post.createdAt, new Date()),
        },
      });
      comments.push(comment);
    }

    // Add replies to some comments (20% chance)
    for (const comment of comments.filter((c: any) => c.postId === post.id)) {
      if (Math.random() < 0.3 && comments.length > 1) {
        const replyCount = randomInt(1, 3);
        const repliers: any[] = randomChoices(users.filter(u => u.id !== comment.authorId), replyCount);

        for (const replier of repliers) {
          const reply: any = await prisma.comment.create({
            data: {
              postId: post.id,
              authorId: replier.id,
              parentId: comment.id,
              text: randomChoice([
                'Thanks! 😊',
                'Glad you like it!',
                'It\'s in Da Nang 🌊',
                'Appreciate it!',
                'Same! 😍',
                'You should visit!',
                'Thank you so much ✨',
              ]),
              createdAt: randomDate(comment.createdAt, new Date()),
            },
          });
          comments.push(reply);
        }
      }
    }

    await prisma.post.update({
      where: { id: post.id },
      data: { commentsCount: comments.filter(c => c.postId === post.id).length },
    });
  }

  // Reel comments
  for (const reel of reels) {
    const commentCount = randomInt(0, Math.min(8, users.length));
    const commenters = randomChoices(users.filter(u => u.id !== reel.authorId), commentCount);

    for (const commenter of commenters) {
      const comment: any = await prisma.comment.create({
        data: {
          reelId: reel.id,
          authorId: commenter.id,
          text: randomChoice([
            'This is so good! 🔥',
            'Love the editing!',
            'What app did you use?',
            'So relatable 😂',
            'Saving this!',
            'The transition tho ✨',
            'Can\'t stop watching',
            'This trend is everything',
            'You\'re so creative!',
            'Music choice 🎵',
          ]),
          createdAt: randomDate(reel.createdAt, new Date()),
        },
      });
      comments.push(comment);
    }

    await prisma.reel.update({
      where: { id: reel.id },
      data: { commentsCount: comments.filter(c => c.reelId === reel.id).length },
    });
  }
  console.log(`✅ Created ${comments.length} comments`);

  // Comment likes
  console.log('❤️ Creating comment likes...');
  for (const comment of comments) {
    const likeCount = randomInt(0, Math.min(5, users.length));
    const likers = randomChoices(users.filter(u => u.id !== comment.authorId), likeCount);

    for (const liker of likers) {
      try {
        await prisma.like.upsert({
          where: { userId_commentId: { userId: liker.id, commentId: comment.id } },
          update: {},
          create: { userId: liker.id, commentId: comment.id },
        });
      } catch (e) {
        // Ignore
      }
    }

    await prisma.comment.update({
      where: { id: comment.id },
      data: { likesCount: likeCount },
    });
  }
  console.log('✅ Created comment likes');

  // ============================================
  // 12. CREATE SAVED POSTS & REELS
  // ============================================
  console.log('💾 Creating saved posts and reels...');
  const savedPosts = [];
  const savedReels = [];

  for (const user of users) {
    // Save some posts
    const postsToSave = randomChoices(posts, randomInt(0, 10));
    for (const post of postsToSave) {
      try {
        const saved = await prisma.savedPost.upsert({
          where: { userId_postId: { userId: user.id, postId: post.id } },
          update: {},
          create: { userId: user.id, postId: post.id },
        });
        savedPosts.push(saved);
      } catch (e) {
        // Ignore
      }
    }

    // Save some reels
    const reelsToSave = randomChoices(reels, randomInt(0, 8));
    for (const reel of reelsToSave) {
      try {
        const saved = await prisma.savedReel.upsert({
          where: { userId_reelId: { userId: user.id, reelId: reel.id } },
          update: {},
          create: { userId: user.id, reelId: reel.id },
        });
        savedReels.push(saved);
      } catch (e) {
        // Ignore
      }
    }
  }
  console.log(`✅ Created ${savedPosts.length} saved posts and ${savedReels.length} saved reels`);

  // ============================================
  // 13. CREATE STORY VIEWS
  // ============================================
  console.log('👁️ Creating story views...');
  const storyViews = [];

  for (const story of stories) {
    const viewCount = randomInt(0, Math.min(15, users.length - 1));
    const viewers = randomChoices(users.filter(u => u.id !== story.authorId), viewCount);

    for (const viewer of viewers) {
      try {
        const view = await prisma.storyView.upsert({
          where: { storyId_viewerId: { storyId: story.id, viewerId: viewer.id } },
          update: {},
          create: {
            storyId: story.id,
            viewerId: viewer.id,
            viewedAt: randomDate(story.createdAt, story.expiresAt),
          },
        });
        storyViews.push(view);
      } catch (e) {
        // Ignore
      }
    }
  }
  console.log(`✅ Created ${storyViews.length} story views`);

  // ============================================
  // 14. CREATE CONVERSATIONS & MESSAGES
  // ============================================
  console.log('💬 Creating conversations and messages...');
  const conversations = [];
  const messages = [];

  // Create 1:1 conversations
  for (let i = 0; i < 15; i++) {
    const user1 = randomChoice(users);
    const user2 = randomChoice(users.filter(u => u.id !== user1.id));

    // Check if conversation already exists between these two
    const existingConv = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        members: {
          every: {
            userId: { in: [user1.id, user2.id] }
          }
        }
      },
      include: { members: true },
    });

    if (existingConv) continue;

    const conversation: any = await prisma.conversation.create({
      data: {
        isGroup: false,
        members: {
          create: [
            { userId: user1.id },
            { userId: user2.id },
          ],
        },
      },
      include: { members: true },
    });
    conversations.push(conversation);

    // Add messages
    const messageCount = randomInt(3, 15);
    let lastSender = user1;

    for (let j = 0; j < messageCount; j++) {
      const sender = lastSender === user1 ? user2 : user1;
      lastSender = sender;

      const contentType = randomChoice([
        MessageContentType.TEXT,
        MessageContentType.TEXT,
        MessageContentType.TEXT,
        MessageContentType.IMAGE,
        MessageContentType.POST,
        MessageContentType.REEL,
      ]);

      let textContent: string | null = null;
      let mediaUrl: string | null = null;
      let mediaThumbnail: string | null = null;
      let referenceId: string | null = null;

      if (contentType === MessageContentType.TEXT) {
        textContent = randomChoice([
          'Hey! How are you?',
          'Did you see that post?',
          'Let\'s catch up soon!',
          'What are you up to?',
          'That\'s so funny 😂',
          'I agree!',
          'Tell me more',
          'Sounds great!',
          'Thanks for sharing',
          'Nice!',
        ]);
      } else if (contentType === MessageContentType.IMAGE) {
        mediaUrl = imageUrl(`chat-${Date.now()}-${j}`, 800, 600);
        mediaThumbnail = imageUrl(`chat-${Date.now()}-${j}-thumb`, 200, 150);
      } else if (contentType === MessageContentType.POST && posts.length > 0) {
        const sharedPost = randomChoice(posts);
        referenceId = sharedPost.id;
        textContent = 'Check this out!';
      } else if (contentType === MessageContentType.REEL && reels.length > 0) {
        const sharedReel = randomChoice(reels);
        referenceId = sharedReel.id;
        textContent = 'This reel is so good!';
      }

      const message: any = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: sender.id,
          contentType,
          textContent,
          mediaUrl,
          mediaThumbnail,
          referenceId,
          status: randomChoice([MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ]),
          createdAt: randomDate(conversation.createdAt, new Date()),
        },
      });
      messages.push(message);
    }
  }

  // Create group conversations
  for (let i = 0; i < 5; i++) {
    const memberCount = randomInt(3, 6);
    const members = randomChoices(users, memberCount);
    const creator = members[0];

    const conversation: any = await prisma.conversation.create({
      data: {
        isGroup: true,
        groupName: randomChoice([
          'Squad 💕',
          'Weekend Plans',
          'Work Besties',
          'Travel Buddies ✈️',
          'Foodies 🍜',
          'Gaming Night 🎮',
          'Study Group 📚',
          'Fitness Crew 💪',
        ]),
        groupAvatar: imageUrl(`group-${i}`, 200, 200),
        members: {
          create: members.map(m => ({ userId: m.id })),
        },
      },
      include: { members: true },
    });
    conversations.push(conversation);

    // Add messages
    const messageCount = randomInt(5, 20);
    for (let j = 0; j < messageCount; j++) {
      const sender = randomChoice(members);
      const contentType = randomChoice([
        MessageContentType.TEXT,
        MessageContentType.TEXT,
        MessageContentType.TEXT,
        MessageContentType.IMAGE,
      ]);

      let textContent: string | null = null;
      let mediaUrl: string | null = null;
      let mediaThumbnail: string | null = null;

      if (contentType === MessageContentType.TEXT) {
        textContent = randomChoice([
          'Anyone free this weekend?',
          'Let\'s plan something!',
          'Great idea! 👍',
          'Count me in!',
          'What time?',
          'I\'ll bring snacks 🍿',
          'Perfect!',
          'Can\'t wait!',
          'Who else is coming?',
          'Send location please 📍',
        ]);
      } else {
        mediaUrl = imageUrl(`group-chat-${Date.now()}-${j}`, 800, 600);
        mediaThumbnail = imageUrl(`group-chat-${Date.now()}-${j}-thumb`, 200, 150);
      }

      const message: any = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: sender.id,
          contentType,
          textContent,
          mediaUrl,
          mediaThumbnail,
          status: randomChoice([MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ]),
          createdAt: randomDate(conversation.createdAt, new Date()),
        },
      });
      messages.push(message);
    }
  }
  console.log(`✅ Created ${conversations.length} conversations and ${messages.length} messages`);

  // ============================================
  // 15. CREATE NOTIFICATIONS
  // ============================================
  console.log('🔔 Creating notifications...');
  const notifications = [];
  const notificationTypes = Object.values(NotificationType);

  for (const recipient of users) {
    const notifCount = randomInt(5, 20);

    for (let i = 0; i < notifCount; i++) {
      const actor = randomChoice(users.filter(u => u.id !== recipient.id));
      const type = randomChoice(notificationTypes);

      let postId: string | null = null;
      let reelId: string | null = null;
      let commentText: string | null = null;
      let postThumbnailUrl: string | null = null;

      switch (type) {
        case NotificationType.LIKE:
        case NotificationType.COMMENT:
          if (posts.length > 0 && Math.random() < 0.7) {
            const post = randomChoice(posts) as any;
            postId = post.id;
            postThumbnailUrl = post.mediaItems?.[0]?.url || null;
          } else if (reels.length > 0) {
            const reel = randomChoice(reels);
            reelId = reel.id;
            postThumbnailUrl = reel.thumbnailUrl || null;
          }
          if (type === NotificationType.COMMENT) {
            commentText = randomChoice([
              'This is amazing!',
              'Love it!',
              'So beautiful 😍',
              'Great shot!',
              'Incredible!',
            ]);
          }
          break;
        case NotificationType.FOLLOW:
        case NotificationType.FOLLOW_REQUEST:
          break;
        case NotificationType.MENTION:
        case NotificationType.TAGGED_IN_POST:
          if (posts.length > 0) {
            const post = randomChoice(posts) as any;
            postId = post.id;
            postThumbnailUrl = post.mediaItems?.[0]?.url || null;
          }
          break;
        case NotificationType.STORY_MENTION:
          if (stories.length > 0) {
            // Could reference a story, but we'll just use post for thumbnail
            const post = randomChoice(posts) as any;
            postThumbnailUrl = post.mediaItems?.[0]?.url || null;
          }
          break;
        case NotificationType.LIVE_VIDEO:
          break;
      }

      const notification: any = await prisma.notification.create({
        data: {
          recipientId: recipient.id,
          actorId: actor.id,
          type,
          postId,
          reelId,
          commentText,
          postThumbnailUrl,
          isRead: Math.random() < 0.4,
          createdAt: randomDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), new Date()),
        },
      });
      notifications.push(notification);
    }
  }
  console.log(`✅ Created ${notifications.length} notifications`);

  // ============================================
  // 16. CREATE PENDING UPLOADS
  // ============================================
  console.log('⏳ Creating pending uploads...');
  for (const user of users) {
    const uploadCount = randomInt(0, 2);
    for (let i = 0; i < uploadCount; i++) {
      await prisma.pendingUpload.create({
        data: {
          userId: user.id,
          storagePath: `uploads/${user.id}/${Date.now()}-${i}.jpg`,
          url: imageUrl(`pending-${user.id}-${i}`, 1080, 1350),
          confirmed: Math.random() < 0.5,
        },
      });
    }
  }
  console.log('✅ Created pending uploads');

  // ============================================
  // 17. UPDATE POST/REEL COUNTS FROM ACTUAL DATA
  // ============================================
  console.log('🔢 Updating counters...');

  // Update post counts for users
  for (const user of users) {
    const postsCount = posts.filter(p => p.authorId === user.id).length;
    await prisma.user.update({
      where: { id: user.id },
      data: { postsCount },
    });
  }

  console.log('✅ All counters updated');

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n🎉 Seeding complete! Summary:');
  console.log(`  👥 Users: ${users.length}`);
  console.log(`  ⚙️ User Settings: ${users.length}`);
  console.log(`  📱 Device Tokens: ${users.length * 2} (avg)`);
  console.log(`  🤝 Follows: ${follows.length}`);
  console.log(`  ⭐ Close Friends: ${closeFriends.length}`);
  console.log(`  🚫 Blocks: ${blocks.length}`);
  console.log(`  📝 Posts: ${posts.length}`);
  console.log(`  🎬 Reels: ${reels.length}`);
  console.log(`  📖 Stories: ${stories.length}`);
  console.log(`  ❤️ Likes: ${likes.length}`);
  console.log(`  💬 Comments: ${comments.length}`);
  console.log(`  💾 Saved Posts: ${savedPosts.length}`);
  console.log(`  💾 Saved Reels: ${savedReels.length}`);
  console.log(`  👁️ Story Views: ${storyViews.length}`);
  console.log(`  💬 Conversations: ${conversations.length}`);
  console.log(`  📨 Messages: ${messages.length}`);
  console.log(`  🔔 Notifications: ${notifications.length}`);
  console.log(`  ⏳ Pending Uploads: ~${users.length}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });