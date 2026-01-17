import IORedis from "ioredis";

let redisConnection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }

  if (!redisConnection) {
    redisConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  }

  return redisConnection;
}

