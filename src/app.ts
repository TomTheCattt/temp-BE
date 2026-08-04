import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { initFirebase } from './config/firebase';
import { errorHandler } from './middleware/errorHandler';
import { defaultLimiter, authLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/auth.routes';

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

  app.use(errorHandler);

  return app;
}
