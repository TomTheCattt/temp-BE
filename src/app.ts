import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { initFirebase } from './config/firebase';
import { errorHandler } from './middleware/errorHandler';
import { defaultLimiter, authLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import postRoutes from './routes/post.routes';
import commentRoutes from './routes/comment.routes';
import uploadRoutes from './routes/upload.routes';
import messageRoutes from './routes/message.routes';
import notificationRoutes from './routes/notification.routes';
import storyRoutes from './routes/story.routes';
import reelRoutes from './routes/reel.routes';

export function createApp() {
  initFirebase();

  const app = express();

  app.use(pinoHttp({ level: env.LOG_LEVEL }));
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));
  app.use(express.json({ limit: '1mb' }));
  app.use(defaultLimiter);

  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
  });

  app.use('/v1/auth', authLimiter, authRoutes);
  app.use('/v1/users', userRoutes);
  app.use('/v1/posts/:postId/comments', commentRoutes);
  app.use('/v1/posts', postRoutes);
  app.use('/v1/upload', uploadRoutes);
  app.use('/v1/conversations', messageRoutes);
  app.use('/v1/notifications', notificationRoutes);
  app.use('/v1/stories', storyRoutes);
  app.use('/v1/reels', reelRoutes);

  app.use(errorHandler);

  return app;
}
