import { MediaType, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { getOffset, PaginationParams, paginatedResponse } from '../utils/helpers';

export interface MediaInput { url: string; thumbnailUrl?: string; type: MediaType; width?: number; height?: number; duration?: number; pendingUploadId?: string; }
const postInclude = { author: { select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true, isPrivate: true } }, mediaItems: { orderBy: { sortOrder: 'asc' as const } } };

export async function createPost(authorId: string, data: { caption?: string; locationName?: string; locationLat?: number; locationLng?: number; media: MediaInput[] }) {
  return prisma.$transaction(async (tx) => {
    const pendingIds = data.media.map((media) => media.pendingUploadId).filter((id): id is string => Boolean(id));
    if (pendingIds.length) {
      const uploads = await tx.pendingUpload.findMany({ where: { id: { in: pendingIds }, userId: authorId, confirmed: false } });
      if (uploads.length !== pendingIds.length || !data.media.every((media) => !media.pendingUploadId || uploads.some((upload) => upload.id === media.pendingUploadId && upload.url === media.url))) throw new ForbiddenError('Invalid pending upload');
    }
    const post = await tx.post.create({ data: { authorId, caption: data.caption, locationName: data.locationName, locationLat: data.locationLat, locationLng: data.locationLng, mediaItems: { create: data.media.map(({ pendingUploadId: _pendingUploadId, ...media }, sortOrder) => ({ ...media, sortOrder })) } }, include: postInclude });
    await tx.user.update({ where: { id: authorId }, data: { postsCount: { increment: 1 } } });
    if (pendingIds.length) await tx.pendingUpload.updateMany({ where: { id: { in: pendingIds } }, data: { confirmed: true } });
    return post;
  });
}

export async function getPost(postId: string, viewerId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId }, include: postInclude });
  if (!post) throw new NotFoundError('Post');
  await assertCanView(post.authorId, viewerId, post.author.isPrivate);
  const [like, saved] = await Promise.all([prisma.like.findUnique({ where: { userId_postId: { userId: viewerId, postId } } }), prisma.savedPost.findUnique({ where: { userId_postId: { userId: viewerId, postId } } })]);
  return { ...post, isLiked: Boolean(like), isSaved: Boolean(saved) };
}

async function assertCanView(authorId: string, viewerId: string, isPrivate = false) {
  if (authorId === viewerId) return;
  const [block, follow] = await Promise.all([prisma.block.findFirst({ where: { OR: [{ blockerId: viewerId, blockedId: authorId }, { blockerId: authorId, blockedId: viewerId }] } }), prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: authorId } } })]);
  if (block || (isPrivate && !follow)) throw new ForbiddenError('This content is not available');
}

export async function listFeed(userId: string, pagination: PaginationParams, explore = false) {
  const following = await prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } });
  const blocked = await prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } });
  const authorIds = following.map((row) => row.followingId);
  const where = explore ? { authorId: { notIn: [...blocked.map((row) => row.blockedId), userId] }, author: { isPrivate: false } } : { authorId: { in: authorIds, notIn: blocked.map((row) => row.blockedId) } };
  const [items, total] = await prisma.$transaction([prisma.post.findMany({ where, include: postInclude, skip: getOffset(pagination), take: pagination.perPage, orderBy: explore ? [{ likesCount: 'desc' }, { createdAt: 'desc' }] : { createdAt: 'desc' } }), prisma.post.count({ where })]);
  const ids = items.map((item) => item.id);
  const [liked, saved] = await Promise.all([prisma.like.findMany({ where: { userId, postId: { in: ids } }, select: { postId: true } }), prisma.savedPost.findMany({ where: { userId, postId: { in: ids } }, select: { postId: true } })]);
  const likedIds = new Set(liked.map((row) => row.postId)); const savedIds = new Set(saved.map((row) => row.postId));
  return paginatedResponse(items.map((item) => ({ ...item, isLiked: likedIds.has(item.id), isSaved: savedIds.has(item.id) })), total, pagination);
}

export async function deletePost(userId: string, postId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true } });
  if (!post) throw new NotFoundError('Post');
  if (post.authorId !== userId) throw new ForbiddenError('Only the author can delete this post');
  await prisma.$transaction([prisma.post.delete({ where: { id: postId } }), prisma.user.update({ where: { id: userId }, data: { postsCount: { decrement: 1 } } })]);
}

export async function likePost(userId: string, postId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId }, include: { author: { select: { isPrivate: true } } } });
  if (!post) throw new NotFoundError('Post');
  await assertCanView(post.authorId, userId, post.author.isPrivate);
  try { await prisma.$transaction([prisma.like.create({ data: { userId, postId } }), prisma.post.update({ where: { id: postId }, data: { likesCount: { increment: 1 } } })]); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return; throw error; }
}
export async function unlikePost(userId: string, postId: string) { await prisma.$transaction(async (tx) => { const deleted = await tx.like.deleteMany({ where: { userId, postId } }); if (deleted.count) await tx.post.update({ where: { id: postId }, data: { likesCount: { decrement: 1 } } }); }); }
export function savePost(userId: string, postId: string) { return prisma.savedPost.upsert({ where: { userId_postId: { userId, postId } }, create: { userId, postId }, update: {} }); }
export function unsavePost(userId: string, postId: string) { return prisma.savedPost.deleteMany({ where: { userId, postId } }); }
export async function listSaved(userId: string, pagination: PaginationParams) { const [saved, total] = await prisma.$transaction([prisma.savedPost.findMany({ where: { userId }, include: { post: { include: postInclude } }, orderBy: { createdAt: 'desc' }, skip: getOffset(pagination), take: pagination.perPage }), prisma.savedPost.count({ where: { userId } })]); return paginatedResponse(saved.map((row) => ({ ...row.post, isLiked: false, isSaved: true })), total, pagination); }
export async function listUserPosts(authorId: string, viewerId: string, pagination: PaginationParams) { const profile = await prisma.user.findUnique({ where: { id: authorId }, select: { isPrivate: true } }); if (!profile) throw new NotFoundError('User'); await assertCanView(authorId, viewerId, profile.isPrivate); const where = { authorId }; const [items, total] = await prisma.$transaction([prisma.post.findMany({ where, include: postInclude, orderBy: { createdAt: 'desc' }, skip: getOffset(pagination), take: pagination.perPage }), prisma.post.count({ where })]); return paginatedResponse(items, total, pagination); }
