import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import * as authService from '../services/auth.service';

const router = Router();

const registerSchema = z.object({
  idToken: z.string().min(1),
  name: z.string().min(1).max(100),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  idToken: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

router.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const { idToken, name, phone } = req.body;
    const user = await authService.register(idToken, name, phone);
    res.status(201).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

router.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { idToken } = req.body;
    const user = await authService.login(idToken);
    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', validateBody(refreshSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const tokens = await authService.refreshToken(refreshToken);
    res.json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
});

router.post('/logout-all-devices', authMiddleware, async (req, res, next) => {
  try {
    const { user } = req as AuthenticatedRequest;
    await authService.revokeAllSessions(user.firebaseUid);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', authMiddleware, (_req, res) => {
  res.json({
    success: true,
    message: 'Use Firebase Auth SDK updatePassword() on the client side',
  });
});

export default router;
