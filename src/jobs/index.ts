import cron from 'node-cron';
import { prisma } from '../config/database';
import { deleteFile } from '../services/storage.service';

let registered = false;
export function registerJobs() {
  if (registered) return; registered = true;
  cron.schedule('0 * * * *', async () => { await prisma.story.deleteMany({ where: { expiresAt: { lt: new Date() } } }); });
  cron.schedule('0 3 * * *', async () => {
    const uploads = await prisma.pendingUpload.findMany({ where: { confirmed: false, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
    await Promise.all(uploads.map((upload) => deleteFile(upload.storagePath)));
    if (uploads.length) await prisma.pendingUpload.deleteMany({ where: { id: { in: uploads.map((upload) => upload.id) } } });
  });
}
