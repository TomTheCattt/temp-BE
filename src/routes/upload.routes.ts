import { Router } from 'express';
import crypto from 'crypto';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { imageUpload, requireFile, videoUpload } from '../middleware/upload';
import { processImage, processVideo } from '../services/media.service';
import { uploadFile } from '../services/storage.service';
import { prisma } from '../config/database';

const router = Router(); router.use(authMiddleware);
const wrap = (handler: (req: AuthenticatedRequest, res: any) => Promise<void>) => (req: any, res: any, next: any) => handler(req, res).catch(next);
router.post('/image', imageUpload.single('file'), wrap(async (req, res) => { const image = await processImage(requireFile(req.file).buffer); const storagePath = `uploads/${req.user.id}/${crypto.randomUUID()}.jpg`; const url = await uploadFile(image.buffer, storagePath, 'image/jpeg'); const pending = await prisma.pendingUpload.create({ data: { userId: req.user.id, storagePath, url } }); res.status(201).json({ success: true, data: { url, width: image.width, height: image.height, pendingUploadId: pending.id } }); }));
router.post('/video', videoUpload.single('file'), wrap(async (req, res) => { const file = requireFile(req.file); const media = await processVideo(file.buffer); const id = crypto.randomUUID(); const storagePath = `uploads/${req.user.id}/${id}.mp4`; const thumbnailPath = `uploads/${req.user.id}/${id}_thumb.jpg`; const [url, thumbnailUrl] = await Promise.all([uploadFile(file.buffer, storagePath, file.mimetype), uploadFile(media.thumbnail, thumbnailPath, 'image/jpeg')]); const pending = await prisma.pendingUpload.create({ data: { userId: req.user.id, storagePath, url } }); res.status(201).json({ success: true, data: { url, thumbnailUrl, duration: media.duration, width: media.width, height: media.height, pendingUploadId: pending.id } }); }));
router.post('/avatar', imageUpload.single('file'), wrap(async (req, res) => { const image = await processImage(requireFile(req.file).buffer, true); const storagePath = `avatars/${req.user.id}/avatar.jpg`; const url = await uploadFile(image.buffer, storagePath, 'image/jpeg'); await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: url } }); res.json({ success: true, data: { url } }); }));
export default router;
