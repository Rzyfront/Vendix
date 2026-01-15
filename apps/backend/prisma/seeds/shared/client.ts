import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';

/**
 * Shared Prisma client for all seed modules
 * Implements singleton pattern to reuse connection across seeds
 */
let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (prismaInstance) {
    return prismaInstance;
  }

  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://username:password@localhost:5432/vendix_db?schema=public';

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  prismaInstance = new PrismaClient({ adapter });

  return prismaInstance;
}

/**
 * Disconnect the Prisma client
 * Should be called after all seeds are completed
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}
