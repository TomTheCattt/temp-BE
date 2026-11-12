import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { env } from "../config/env";
import bcrypt from "bcrypt";

const CORS_ORIGIN = env.CORS_ORIGIN;
const BETTER_AUTH_SECRET = env.BETTER_AUTH_SECRET;
const BETTER_AUTH_URL = env.BETTER_AUTH_URL;

// Helper to get trusted origins
function getTrustedOrigins(): string[] {
  if (CORS_ORIGIN === "*") return ["*"];
  return CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
}

// Helper to check if Google OAuth is configured
const isGoogleOAuthConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

// Helper to check if Apple OAuth is configured
const isAppleOAuthConfigured = Boolean(
  env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
);

// Build social providers object dynamically
function buildSocialProviders() {
  const providers: Record<string, any> = {};

  if (isGoogleOAuthConfigured) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
      scope: ["openid", "email", "profile"],
    };
  }

  if (isAppleOAuthConfigured) {
    providers.apple = {
      clientId: env.APPLE_CLIENT_ID!,
      clientSecret: env.APPLE_PRIVATE_KEY!,
      teamId: env.APPLE_TEAM_ID!,
      keyId: env.APPLE_KEY_ID!,
      appBundleIdentifier: env.APPLE_CLIENT_ID!,
      scope: ["name", "email"],
    };
  }

  return providers;
}

// Create Better Auth instance
const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      refreshToken: schema.refreshTokens,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: env.NODE_ENV === "production", // Require verification in production
    autoSignIn: true,
    password: {
      // Use bcrypt to match seeded password hashes (bcrypt with cost 10)
      hash: async (password: string) => {
        return await bcrypt.hash(password, 10);
      },
      verify: async ({ password, hash }) => {
        return await bcrypt.compare(password, hash);
      },
      // Password strength requirements handled in routes via validatePasswordStrength()
      // minLength/maxLength not supported in Better Auth config
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600, // 1 hour
    // Custom email template would go here
  },
  trustedOrigins: getTrustedOrigins(),
  secret: BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,

  // Social providers (only enabled when credentials are configured)
  socialProviders: buildSocialProviders(),

  // Plugins - add more as needed
  plugins: [
    // Organization plugin can be added later
    // admin plugin can be added later
  ],

  // Advanced options
  advanced: {
    cookiePrefix: "instagram-clone",
    useSecureCookies: process.env.NODE_ENV === "production",
    crossSubDomainCookies: {
      enabled: true,
      domain: new URL(BETTER_AUTH_URL).hostname,
    },
    // Rate limiting for auth endpoints (handled separately in middleware)
    // ipHeader: "x-forwarded-for",
  },

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day (sliding window)
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
    // Store additional session data
    // sessionData: { ... },
  },

  // Account linking configuration
  account: {
    // Allow linking multiple OAuth accounts to same user
    accountLinking: {
      enabled: true,
      // Allow linking if emails match
      trustedProviders: ["google", "apple"],
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
    // Delete user configuration
    deleteUser: {
      enabled: true,
      // Soft delete by default (handled by deletedAt)
    },
    // Change email configuration
    changeEmail: {
      enabled: true,
    },
  },

  // Hooks for audit logging and custom logic
  hooks: {
    // Note: Better Auth hook signatures vary by version
    // Custom logging is handled in routes via AuthAuditService
  },

  // Rate limiting configuration (handled by middleware, but can be configured here too)
  // rateLimit: {
  //   window: 15 * 60 * 1000, // 15 minutes
  //   max: 10, // 10 requests per window
  // },
});

// Patch internalAdapter.findCredentialAccount to fix Better Auth v1.7.17 bug
// Bug: findCredentialAccount uses email parameter for both userId and accountId fields
// Fix: Use findAccountByKey with providerId='credential' and accountId=email
auth.$context.then((context) => {
  const internalAdapter = context.internalAdapter;

  // Patch findCredentialAccount
  const originalFindCredentialAccount = internalAdapter.findCredentialAccount;
  internalAdapter.findCredentialAccount = async (email: string) => {
    console.log("[Better Auth] findCredentialAccount called with email:", email);
    // Correct implementation: find credential account by email (accountId)
    const result = await internalAdapter.findAccountByKey({
      providerId: "credential",
      accountId: email,
    });
    console.log("[Better Auth] findCredentialAccount result:", result ? "found" : "not found");
    return result;
  };

  // Patch findUserByEmail to properly fetch accounts AND work around Better Auth core bug
  // Bug in core: signInEmail compares account.accountId === userRecord.user.id (email vs userId)
  // Workaround: Transform credential account's accountId to user.id so core's comparison works
  const originalFindUserByEmail = internalAdapter.findUserByEmail;
  internalAdapter.findUserByEmail = async (email: string, options?: { includeAccounts?: boolean }) => {
    console.log("[Better Auth] findUserByEmail called with email:", email, "options:", options);
    // Use base adapter with join to fetch user and accounts in one query
    const adapter = context.adapter;
    const userWithAccounts = await adapter.findOne({
      model: "user",
      where: [{ field: "email", operator: "eq", value: email }],
      join: { account: true },
    });

    if (!userWithAccounts) {
      console.log("[Better Auth] findUserByEmail: user not found");
      return null;
    }

    // Extract accounts from the joined result
    const accounts = userWithAccounts.account || [];
    // Remove the account field from user object
    const { account, ...user } = userWithAccounts;

    // WORKAROUND for Better Auth v1.7.17 bug:
    // Core's signInEmail does: accounts.find(a => a.providerId === 'credential' && a.accountId === user.id)
    // But accountId is email, not user.id. Transform credential account's accountId to user.id.
    const transformedAccounts = accounts.map(acc => {
      if (acc.providerId === "credential") {
        return { ...acc, accountId: user.id };
      }
      return acc;
    });

    console.log("[Better Auth] findUserByEmail result:", { user: !!user, accounts: transformedAccounts.length });
    return { user, accounts: transformedAccounts };
  };

  console.log("[Better Auth] Patched internalAdapter.findCredentialAccount and findUserByEmail");
});

// Export patched auth instance
export { auth };

// Export types
export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = typeof auth.$Infer.Session.user;

// Export helpers
export { isGoogleOAuthConfigured, isAppleOAuthConfigured };