function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
  };
}

// Workers must retry indefinitely so in-flight jobs are not lost during
// transient Redis outages. BullMQ requires maxRetriesPerRequest: null here.
export function getWorkerRedisConnection() {
  return { ...parseRedisUrl(process.env.REDIS_URL!), maxRetriesPerRequest: null as null };
}

// Queues/producers should fail fast so callers can surface errors immediately
// rather than blocking the request handler indefinitely on Redis unavailability.
export function getQueueRedisConnection() {
  return parseRedisUrl(process.env.REDIS_URL!);
}
