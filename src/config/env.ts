import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),

  // Firebase (legacy - for migration)
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_WEB_API_KEY: z.string().optional(),

  // CORS
  CORS_ORIGIN: z.string().min(1), // Required, no wildcard default

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),

  // Email Provider (Resend, SendGrid, etc.)
  RESEND_API_KEY: z.string().optional(),

  // OAuth Providers
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),

  // Sentry
  SENTRY_DSN: z.string().optional(),

  // Redis/Upstash for Rate Limiting
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // OpenTelemetry
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('instagram-clone-api'),

  // Internal Cron Secret
  INTERNAL_CRON_SECRET: z.string().optional(),

  // Admin emails (comma-separated)
  ADMIN_EMAILS: z.string().optional(),

  // CDN base URL for media delivery
  CDN_BASE_URL: z.string().optional(),

  // Neon Object Storage (injected at runtime)
  NEON_STORAGE_ENDPOINT: z.string().optional(),
  NEON_STORAGE_ACCESS_KEY_ID: z.string().optional(),
  NEON_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),

  // AI Gateway (injected at runtime)
  NEON_AI_GATEWAY_TOKEN: z.string().optional(),
  NEON_AI_GATEWAY_BASE_URL: z.string().optional(),

  // Neon Auth (injected at runtime)
  NEON_AUTH_BASE_URL: z.string().optional(),
  NEON_AUTH_JWKS_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isFirebaseConfigured = Boolean(
  env.FIREBASE_PROJECT_ID &&
    env.FIREBASE_PRIVATE_KEY &&
    env.FIREBASE_CLIENT_EMAIL
);

// Helper to check if OAuth providers are configured
export const isGoogleOAuthConfigured = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
);

export const isAppleOAuthConfigured = Boolean(
  env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
);

// Helper to check if Upstash Redis is configured
export const isUpstashConfigured = Boolean(
  env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
);

// Helper to check if OpenTelemetry is configured
export const isOtelConfigured = Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT);