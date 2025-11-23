import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

const globalForRedis = global as unknown as {
  redis: Redis;
  redisSubscriber: Redis;
};

export const redis =
  globalForRedis.redis ||
  new Redis((process.env.REDIS_URL as string) || "redis://localhost:6379");

export const redisSubscriber =
  globalForRedis.redisSubscriber || redis.duplicate();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
  globalForRedis.redisSubscriber = redisSubscriber
}
