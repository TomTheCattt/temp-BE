import multer from 'multer';
import { ValidationError } from '../utils/errors';

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const videoTypes = new Set(['video/mp4', 'video/quicktime']);

function uploader(types: Set<string>, limit: number) {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: limit, files: 10 }, fileFilter: (_req, file, callback) => callback(null, types.has(file.mimetype)) });
}
export const imageUpload = uploader(imageTypes, 10 * 1024 * 1024);
export const videoUpload = uploader(videoTypes, 100 * 1024 * 1024);
export function requireFile(file: Express.Multer.File | undefined) { if (!file) throw new ValidationError('A valid file is required'); return file; }
