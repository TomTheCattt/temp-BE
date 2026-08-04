import admin from 'firebase-admin';
import { env, isFirebaseConfigured } from './env';

let initialized = false;

export function initFirebase(): admin.app.App | null {
  if (initialized) return admin.apps[0] ?? null;
  if (!isFirebaseConfigured) {
    console.warn('[Firebase] Not configured — auth/storage features disabled');
    return null;
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID!,
      privateKey: env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      clientEmail: env.FIREBASE_CLIENT_EMAIL!,
    }),
    storageBucket: env.FIREBASE_STORAGE_BUCKET,
  });

  initialized = true;
  return app;
}

export const auth = () => {
  initFirebase();
  return admin.auth();
};

export const storage = () => {
  initFirebase();
  return admin.storage();
};

export const messaging = () => {
  initFirebase();
  return admin.messaging();
};
