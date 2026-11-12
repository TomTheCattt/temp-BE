import './src/config/env.ts';
import { getRedisClient } from './src/middleware/rate-limit.ts';

async function resetRateLimits() {
  const redis = getRedisClient();
  try {
    // Since we're using in-memory store for dev, let's just restart the server
    // For now, let's just use the eval approach with a workaround
    const result = await redis.eval(`
      local keys = redis.call("KEYS", "ratelimit:*")
      for i=1, #keys do
        redis.call("DEL", keys[i])
      end
      return keys
    `, 0);
    console.log('Deleted keys:', result);
  } catch (e) {
    console.log('In-memory store - cannot reset via Redis');
  }
  process.exit(0);
}

resetRateLimits();
