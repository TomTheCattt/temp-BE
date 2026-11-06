import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachDatabasePool } from "@neon/functions";
import * as schema from "./schema";

// Use process.env directly since parseEnv types don't include function env vars
const DATABASE_URL = process.env.DATABASE_URL!;

// Create PostgreSQL connection pool at module scope (reused across requests)
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5, // Small pool per isolate
});
attachDatabasePool(pool);

// Create Drizzle instance with schema for type safety
export const db = drizzle(pool, { schema });