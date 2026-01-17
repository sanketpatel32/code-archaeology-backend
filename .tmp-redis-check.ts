import IORedis from "ioredis";

const url = process.env.REDIS_URL;
if (!url) {
  console.error("REDIS_URL missing");
  process.exit(1);
}

function withScheme(input, scheme) {
  if (input.startsWith("redis://") && scheme === "rediss") {
    return input.replace(/^redis:\/\//, "rediss://");
  }
  return input;
}

async function tryPing(candidate) {
  const useTls =
    candidate.startsWith("rediss://") || candidate.includes("redislabs.com");
  const redis = new IORedis(candidate, {
    lazyConnect: true,
    connectTimeout: 4000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    tls: useTls ? {} : undefined,
  });
  const timeout = (ms) =>
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    );

  try {
    await Promise.race([redis.connect(), timeout(5000)]);
    const pong = await Promise.race([redis.ping(), timeout(5000)]);
    return { connected: pong === "PONG", response: pong, url: candidate };
  } finally {
    redis.disconnect();
  }
}

try {
  const primary = await tryPing(url);
  console.log(JSON.stringify(primary));
} catch (err) {
  const fallbackUrl = withScheme(url, "rediss");
  if (fallbackUrl !== url) {
    try {
      const fallback = await tryPing(fallbackUrl);
      console.log(JSON.stringify({ ...fallback, fallback: true }));
      process.exit(0);
    } catch (fallbackErr) {
      console.log(
        JSON.stringify({
          connected: false,
          error:
            fallbackErr instanceof Error
              ? fallbackErr.message
              : String(fallbackErr),
        }),
      );
      process.exit(1);
    }
  }

  console.log(
    JSON.stringify({
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
}
