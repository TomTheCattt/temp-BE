import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
export async function processImage(buffer: Buffer, avatar = false) {
  const image = sharp(buffer).rotate();
  const metadata = await image.metadata();
  const output = await image.resize(avatar ? 400 : 1080, avatar ? 400 : 1350, { fit: avatar ? 'cover' : 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { buffer: output, width: metadata.width, height: metadata.height };
}
export async function processVideo(buffer: Buffer) {
  const input = path.join(tmpdir(), `${crypto.randomUUID()}.mp4`); const thumbnail = path.join(tmpdir(), `${crypto.randomUUID()}.jpg`);
  await writeFile(input, buffer);
  try {
    const probe: any = await new Promise((resolve, reject) => ffmpeg.ffprobe(input, (error, data) => error ? reject(error) : resolve(data)));
    const stream = probe.streams.find((item: any) => item.codec_type === 'video');
    if (!stream) throw new Error('No video stream found');
    await new Promise<void>((resolve, reject) => ffmpeg(input).screenshots({ timestamps: ['00:00:01'], filename: path.basename(thumbnail), folder: tmpdir(), size: '300x?' }).on('end', () => resolve()).on('error', reject));
    return { duration: Number(probe.format.duration), width: stream.width as number, height: stream.height as number, thumbnail: await readFile(thumbnail) };
  } finally { await Promise.all([unlink(input).catch(() => undefined), unlink(thumbnail).catch(() => undefined)]); }
}
