import { Request, Response, NextFunction } from 'express';
import { User } from '@prisma/client';
import { auth } from '../config/firebase';
import { prisma } from '../config/database';
import { isFirebaseConfigured } from '../config/env';
import { UnauthorizedError } from '../utils/errors';

export interface AuthenticatedRequest extends Request {
  user: User;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'No token provided',
    });
    return;
  }

  if (!isFirebaseConfigured) {
    res.status(503).json({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
      message: 'Firebase is not configured',
    });
    return;
  }

  try {
    const decoded = await auth().verifyIdToken(token, true);
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });

    if (!user) {
      res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'User not found',
      });
      return;
    }

    (req as AuthenticatedRequest).user = user;
    next();
  } catch (error: unknown) {
    const firebaseError = error as { code?: string };
    if (firebaseError.code === 'auth/id-token-revoked') {
      res.status(401).json({
        success: false,
        error: 'SESSION_REVOKED',
        message: 'Session revoked, please login again',
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Invalid or expired token',
    });
  }
}

export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    next();
    return;
  }
  authMiddleware(req, res, next).catch(next);
}
