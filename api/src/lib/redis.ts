function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    maxRetriesPerRequest: null as null,
  };
}

export function getRedisConnection() {
  return parseRedisUrl(process.env.REDIS_URL!);
}
