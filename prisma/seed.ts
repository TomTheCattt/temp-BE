import { PrismaClient, MediaType, MessageContentType } from '@prisma/client';

const prisma = new PrismaClient();
const users = [
  ['00000000-0000-4000-8000-000000000001', 'seed-alice', 'alice', 'Alice Nguyen'],
  ['00000000-0000-4000-8000-000000000002', 'seed-bob', 'bob', 'Bob Tran'],
  ['00000000-0000-4000-8000-000000000003', 'seed-carol', 'carol', 'Carol Le'],
  ['00000000-0000-4000-8000-000000000004', 'seed-david', 'david', 'David Pham'],
  ['00000000-0000-4000-8000-000000000005', 'seed-emma', 'emma', 'Emma Vo'],
] as const;
const image = (id: string) => `https://picsum.photos/seed/${id}/1080/1350`;

async function main() {
  for (const [id, firebaseUid, username, fullName] of users) await prisma.user.upsert({ where: { id }, update: { fullName, bio: `Seed account for ${fullName}`, avatarUrl: `https://i.pravatar.cc/400?u=${username}` }, create: { id, firebaseUid, username, fullName, email: `${username}@example.test`, bio: `Seed account for ${fullName}`, avatarUrl: `https://i.pravatar.cc/400?u=${username}` } });
  const [alice, bob, carol, david, emma] = users.map(([id]) => id);
  for (const [followerId, followingId] of [[alice, bob], [alice, carol], [bob, alice], [carol, alice], [david, bob]] as const) await prisma.follow.upsert({ where: { followerId_followingId: { followerId, followingId } }, update: {}, create: { followerId, followingId } });
  await prisma.user.update({ where: { id: alice }, data: { followingCount: 2, followersCount: 2 } }); await prisma.user.update({ where: { id: bob }, data: { followingCount: 1, followersCount: 2 } }); await prisma.user.update({ where: { id: carol }, data: { followingCount: 1, followersCount: 1 } }); await prisma.user.update({ where: { id: david }, data: { followingCount: 1 } });
  for (const [authorId, caption, slug] of [[bob, 'A calm morning in Da Nang.', 'danang'], [carol, 'Coffee, code, and good ideas.', 'coffee'], [alice, 'Welcome to the local development feed.', 'welcome']] as const) {
    const post = await prisma.post.upsert({ where: { id: `10000000-0000-4000-8000-00000000000${slug === 'danang' ? '1' : slug === 'coffee' ? '2' : '3'}` }, update: { caption }, create: { id: `10000000-0000-4000-8000-00000000000${slug === 'danang' ? '1' : slug === 'coffee' ? '2' : '3'}`, authorId, caption, mediaItems: { create: { url: image(slug), type: MediaType.IMAGE } } } });
    await prisma.like.upsert({ where: { userId_postId: { userId: alice, postId: post.id } }, update: {}, create: { userId: alice, postId: post.id } });
    await prisma.post.update({ where: { id: post.id }, data: { likesCount: 1 } });
  }
  const post = await prisma.post.findFirstOrThrow({ where: { authorId: bob } }); await prisma.comment.upsert({ where: { id: '20000000-0000-4000-8000-000000000001' }, update: {}, create: { id: '20000000-0000-4000-8000-000000000001', postId: post.id, authorId: alice, text: 'Looks wonderful!' } }); await prisma.post.update({ where: { id: post.id }, data: { commentsCount: 1 } });
  await prisma.reel.upsert({ where: { id: '30000000-0000-4000-8000-000000000001' }, update: {}, create: { id: '30000000-0000-4000-8000-000000000001', authorId: carol, videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', thumbnailUrl: image('reel'), caption: 'A sample reel for development.', duration: 15 } });
  await prisma.story.upsert({ where: { id: '40000000-0000-4000-8000-000000000001' }, update: { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }, create: { id: '40000000-0000-4000-8000-000000000001', authorId: bob, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), items: { create: { mediaUrl: image('story'), type: MediaType.IMAGE } } } });
  const conversation = await prisma.conversation.upsert({ where: { id: '50000000-0000-4000-8000-000000000001' }, update: {}, create: { id: '50000000-0000-4000-8000-000000000001', members: { create: [{ userId: alice }, { userId: bob }] } } }); await prisma.message.upsert({ where: { id: '60000000-0000-4000-8000-000000000001' }, update: {}, create: { id: '60000000-0000-4000-8000-000000000001', conversationId: conversation.id, senderId: bob, contentType: MessageContentType.TEXT, textContent: 'Welcome! This is seeded test data.' } });
  console.log('Seed data created. Firebase UIDs are fixtures only; use Firebase accounts for authenticated API testing.');
}
main().finally(() => prisma.$disconnect());
