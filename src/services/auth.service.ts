import { auth } from '../config/firebase';
import { prisma } from '../config/database';
import { env, isFirebaseConfigured } from '../config/env';
import { UnauthorizedError, ConflictError } from '../utils/errors';
import { generateUsername } from '../utils/helpers';

interface GoogleRefreshResponse {
  id_token: string;
  refresh_token: string;
  expires_in: string;
  user_id: string;
}

async function verifyIdToken(idToken: string) {
  if (!isFirebaseConfigured) {
    throw new UnauthorizedError('Firebase is not configured');
  }
  return auth().verifyIdToken(idToken, true);
}

export async function register(idToken: string, name: string, phone?: string) {
  const decoded = await verifyIdToken(idToken);
  const email = decoded.email;
  if (!email) throw new UnauthorizedError('Email not found in token');

  const existing = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
  if (existing) throw new ConflictError('User already registered');

  let username = generateUsername(email);
  let attempts = 0;
  while (attempts < 5) {
    const taken = await prisma.user.findUnique({ where: { username } });
    if (!taken) break;
    username = generateUsername(email);
    attempts++;
  }

  return prisma.user.create({
    data: {
      firebaseUid: decoded.uid,
      email,
      fullName: name,
      username,
      phone,
    },
  });
}

export async function login(idToken: string) {
  const decoded = await verifyIdToken(idToken);
  const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
  if (!user) throw new UnauthorizedError('User not found. Please register first.');
  return user;
}

export async function refreshToken(refreshToken: string) {
  if (!env.FIREBASE_WEB_API_KEY) {
    throw new UnauthorizedError('Firebase Web API Key not configured');
  }

  const url = `https://securetoken.googleapis.com/v1/token?key=${env.FIREBASE_WEB_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });

  if (!res.ok) throw new UnauthorizedError('Invalid or expired refresh token');

  const data = (await res.json()) as GoogleRefreshResponse;
  const user = await prisma.user.findUnique({ where: { firebaseUid: data.user_id } });
  if (!user) throw new UnauthorizedError('User not found');

  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export async function revokeAllSessions(firebaseUid: string) {
  if (!isFirebaseConfigured) {
    throw new UnauthorizedError('Firebase is not configured');
  }
  await auth().revokeRefreshTokens(firebaseUid);
}
