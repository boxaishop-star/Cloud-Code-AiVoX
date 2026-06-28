import 'dotenv/config';
// @ts-ignore — generated file uses Prisma 7 runtime; types are inferred at callsite
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

/** Creates a fresh PrismaClient instance. Use in tests so each suite gets its own connection. */
export function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL environment variable is required');
  const adapter = new PrismaPg({ connectionString });
  // @ts-ignore — Prisma 7 class constructor accepts { adapter }
  return new PrismaClient({ adapter });
}

let _singleton: ReturnType<typeof createPrismaClient> | undefined;

/** Singleton for production use. Returns the same instance across calls. */
export function getPrismaClient(): ReturnType<typeof createPrismaClient> {
  if (!_singleton) _singleton = createPrismaClient();
  return _singleton;
}
