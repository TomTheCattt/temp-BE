import { storage } from '../config/firebase';
import { isFirebaseConfigured } from '../config/env';
import { AppError } from '../utils/errors';

export async function uploadFile(buffer: Buffer, destination: string, contentType: string) {
  if (!isFirebaseConfigured) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Firebase Storage is not configured');
  const file = storage().bucket().file(destination);
  await file.save(buffer, { contentType, resumable: false, metadata: { cacheControl: 'public,max-age=31536000,immutable' } });
  await file.makePublic();
  return file.publicUrl();
}
export async function deleteFile(destination: string) { if (isFirebaseConfigured) await storage().bucket().file(destination).delete({ ignoreNotFound: true }); }
