#!/usr/bin/env tsx
/**
 * Pact Contract Publishing Script
 *
 * This script publishes consumer contracts to the Pact Broker
 * Run after consumer tests pass: npm run pact:publish
 */

import { publisher } from "@pact-foundation/pact";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACT_DIR = path.resolve(__dirname, "../pacts");
const PACT_BROKER_URL = process.env.PACT_BROKER_URL || "http://localhost:9292";
const PACT_BROKER_USERNAME = process.env.PACT_BROKER_USERNAME;
const PACT_BROKER_PASSWORD = process.env.PACT_BROKER_PASSWORD;
const CONSUMER_VERSION = process.env.GITHUB_SHA || process.env.npm_package_version || "dev";
const CONSUMER_BRANCH = process.env.GITHUB_REF_NAME || "local";

async function publishContracts() {
  console.log("📦 Publishing Pact contracts...");
  console.log(`Broker: ${PACT_BROKER_URL}`);
  console.log(`Consumer: instagram-ios-app`);
  console.log(`Version: ${CONSUMER_VERSION}`);
  console.log(`Branch: ${CONSUMER_BRANCH}`);

  const opts = {
    pactFilesOrDirs: [PACT_DIR],
    pactBroker: PACT_BROKER_URL,
    consumerVersion: CONSUMER_VERSION,
    consumerVersionTags: [CONSUMER_BRANCH, "latest"],
    brokerUsername: PACT_BROKER_USERNAME,
    brokerPassword: PACT_BROKER_PASSWORD,
    retry: 3,
    retryInterval: 1000,
  };

  try {
    await publisher.publishPacts(opts);
    console.log("✅ Contracts published successfully!");

    // Also tag the version for production deployments
    if (CONSUMER_BRANCH === "main" || CONSUMER_BRANCH === "production") {
      console.log("🏷️ Tagging as production release...");
      // Tagging is done via tags above
    }
  } catch (error) {
    console.error("❌ Failed to publish contracts:", error);
    process.exit(1);
  }
}

publishContracts();