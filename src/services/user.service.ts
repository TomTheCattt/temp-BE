import { DevicePlatform, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors';
import { getOffset, PaginationParams, paginatedResponse } from '../utils/helpers';

const publicUser = { id: true, username: true, fullName: true, avatarUrl: true, bio: true, website: true, isVerified: true, isPrivate: true, postsCount: true, followersCount: true, followingCount: true } as const;

export async function getProfile(id: string, viewerId?: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: publicUser });
  if (!user) throw new NotFoundError('User');
  if (!viewerId || viewerId === id) return { ...user, isFollowing: false, isFollowedBy: false };
  const [following, followedBy] = await Promise.all([
    prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: id } } }),
    prisma.follow.findUnique({ where: { followerId_followingId: { followerId: id, followingId: viewerId } } }),
  ]);
  return { ...user, isFollowing: Boolean(following), isFollowedBy: Boolean(followedBy) };
}

export function updateProfile(userId: string, data: { fullName?: string; bio?: string | null; website?: string | null; isPrivate?: boolean }) {
  return prisma.user.update({ where: { id: userId }, data, select: publicUser });
}

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) throw new ConflictError('Cannot follow yourself');
  const target = await prisma.user.findUnique({ where: { id: followingId }, select: { id: true } });
  if (!target) throw new NotFoundError('User');
  const block = await prisma.block.findFirst({ where: { OR: [{ blockerId: followerId, blockedId: followingId }, { blockerId: followingId, blockedId: followerId }] } });
  if (block) throw new ForbiddenError('Cannot follow this user');
  try {
    await prisma.$transaction([
      prisma.follow.create({ data: { followerId, followingId } }),
      prisma.user.update({ where: { id: followerId }, data: { followingCount: { increment: 1 } } }),
      prisma.user.update({ where: { id: followingId }, data: { followersCount: { increment: 1 } } }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
    throw error;
  }
}

export async function unfollowUser(followerId: string, followingId: string) {
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.follow.deleteMany({ where: { followerId, followingId } });
    if (!deleted.count) return;
    await Promise.all([
      tx.user.update({ where: { id: followerId }, data: { followingCount: { decrement: 1 } } }),
      tx.user.update({ where: { id: followingId }, data: { followersCount: { decrement: 1 } } }),
    ]);
  });
}

export async function blockUser(blockerId: string, blockedId: string) {
  if (blockerId === blockedId) throw new ConflictError('Cannot block yourself');
  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!target) throw new NotFoundError('User');
  await prisma.$transaction(async (tx) => {
    await tx.block.upsert({ where: { blockerId_blockedId: { blockerId, blockedId } }, create: { blockerId, blockedId }, update: {} });
    const follows = await tx.follow.findMany({ where: { OR: [{ followerId: blockerId, followingId: blockedId }, { followerId: blockedId, followingId: blockerId }] } });
    if (follows.length) {
      await tx.follow.deleteMany({ where: { id: { in: follows.map((follow) => follow.id) } } });
      for (const follow of follows) await Promise.all([
        tx.user.update({ where: { id: follow.followerId }, data: { followingCount: { decrement: 1 } } }),
        tx.user.update({ where: { id: follow.followingId }, data: { followersCount: { decrement: 1 } } }),
      ]);
    }
  });
}

export function unblockUser(blockerId: string, blockedId: string) { return prisma.block.deleteMany({ where: { blockerId, blockedId } }); }

export async function listConnections(userId: string, kind: 'followers' | 'following', pagination: PaginationParams) {
  const where = kind === 'followers' ? { followingId: userId } : { followerId: userId };
  const [items, total] = await prisma.$transaction([
    prisma.follow.findMany({ where, skip: getOffset(pagination), take: pagination.perPage, orderBy: { createdAt: 'desc' }, select: kind === 'followers' ? { follower: { select: publicUser } } : { following: { select: publicUser } } }),
    prisma.follow.count({ where }),
  ]);
  return paginatedResponse(items.map((item: any) => item.follower ?? item.following), total, pagination);
}

export async function searchUsers(query: string, pagination: PaginationParams) {
  const where = { OR: [{ username: { contains: query, mode: 'insensitive' as const } }, { fullName: { contains: query, mode: 'insensitive' as const } }] };
  const [items, total] = await prisma.$transaction([prisma.user.findMany({ where, select: publicUser, skip: getOffset(pagination), take: pagination.perPage, orderBy: { username: 'asc' } }), prisma.user.count({ where })]);
  return paginatedResponse(items, total, pagination);
}

export async function suggestedUsers(userId: string, pagination: PaginationParams) {
  const following = await prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } });
  const blocked = await prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } });
  const excluded = [userId, ...following.map((item) => item.followingId), ...blocked.map((item) => item.blockedId)];
  const where = { id: { notIn: excluded }, isPrivate: false };
  const [items, total] = await prisma.$transaction([prisma.user.findMany({ where, select: publicUser, orderBy: [{ followersCount: 'desc' }, { createdAt: 'desc' }], skip: getOffset(pagination), take: pagination.perPage }), prisma.user.count({ where })]);
  return paginatedResponse(items, total, pagination);
}

export function registerDeviceToken(userId: string, token: string, platform: DevicePlatform) { return prisma.deviceToken.upsert({ where: { token }, create: { userId, token, platform }, update: { userId, platform } }); }
export function unregisterDeviceToken(userId: string, token: string) { return prisma.deviceToken.deleteMany({ where: { userId, token } }); }
