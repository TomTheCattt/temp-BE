import { NotificationType } from '@prisma/client';
import { prisma } from '../config/database';
import { NotFoundError } from '../utils/errors';
import { getOffset, PaginationParams, paginatedResponse } from '../utils/helpers';
import { sendToUser } from '../websocket/server';

export async function createNotification(input: { recipientId: string; actorId: string; type: NotificationType; postId?: string; commentText?: string }) {
  if (input.recipientId === input.actorId) return null;
  const notification = await prisma.notification.create({ data: input, include: { actor: { select: { id: true, username: true, fullName: true, avatarUrl: true } } } });
  sendToUser(input.recipientId, { type: 'new_notification', notification }); return notification;
}
export async function listNotifications(userId: string, pagination: PaginationParams) { const where = { recipientId: userId }; const [items, total] = await prisma.$transaction([prisma.notification.findMany({ where, include: { actor: { select: { id: true, username: true, fullName: true, avatarUrl: true } } }, orderBy: { createdAt: 'desc' }, skip: getOffset(pagination), take: pagination.perPage }), prisma.notification.count({ where })]); return paginatedResponse(items, total, pagination); }
export async function markRead(userId: string, id: string) { const result = await prisma.notification.updateMany({ where: { id, recipientId: userId }, data: { isRead: true } }); if (!result.count) throw new NotFoundError('Notification'); }
export function markAllRead(userId: string) { return prisma.notification.updateMany({ where: { recipientId: userId, isRead: false }, data: { isRead: true } }); }
export function unreadCount(userId: string) { return prisma.notification.count({ where: { recipientId: userId, isRead: false } }); }
