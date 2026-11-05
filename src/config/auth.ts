import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../index";
import * as schema from "../db/schema";

// Use process.env directly since parseEnv types don't include function env vars
const CORS_ORIGIN = process.env.CORS_ORIGIN!;
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET!;
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL!;

// Create Better Auth instance
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    autoSignIn: false,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600, // 1 hour
  },
  trustedOrigins: CORS_ORIGIN === "*" ? ["*"] : CORS_ORIGIN.split(","),
  secret: BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,

  // Plugins
  plugins: [],

  // Advanced options
  advanced: {
    cookiePrefix: "instagram-clone",
    useSecureCookies: process.env.NODE_ENV === "production",
    crossSubDomainCookies: {
      enabled: true,
      domain: new URL(BETTER_AUTH_URL).hostname,
    },
  },

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  // User configuration
  user: {
    additionalFields: {
      username: { type: "string", required: true, unique: true },
      fullName: { type: "string", required: true },
      phone: { type: "string", required: false },
      avatarUrl: { type: "string", required: false },
      bio: { type: "string", required: false },
      website: { type: "string", required: false },
      isVerified: { type: "boolean", defaultValue: false },
      isPrivate: { type: "boolean", defaultValue: false },
    },
  },

  // Social providers (configure as needed)
  // socialProviders: {
  //   google: {
  //     clientId: process.env.GOOGLE_CLIENT_ID!,
  //     clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  //   },
  //   github: {
  //     clientId: process.env.GITHUB_CLIENT_ID!,
  //     clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  //   },
  // },
});

// Export types
export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = typeof auth.$Infer.Session.user;