import {
  INestApplication,
  Injectable,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function createBaseClient(adapter: PrismaPg) {
  // Keep the shared Prisma client interface compatible with transaction consumers.
  // The runtime omit still applies to every default projection.
  return new PrismaClient<Prisma.PrismaClientOptions>({
    adapter,
    log: ['error', 'warn'],
    omit: { orders: { public_access_token: true } },
  });
}

@Injectable()
export abstract class BasePrismaService implements OnModuleInit {
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly baseClient: ReturnType<typeof createBaseClient>;

  constructor() {
    const connectionString = process.env.DATABASE_URL!;
    const parsedMax = parseInt(process.env.DATABASE_POOL_MAX ?? '', 10);
    const max = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 20;
    const pool = new Pool({ connectionString, max });
    const adapter = new PrismaPg(pool);

    // Guest capability is not an ordinary order field; only explicit select can expose it.
    this.baseClient = createBaseClient(adapter);
  }

  async onModuleInit() {
    await this.baseClient.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await this.baseClient.$disconnect();
      await app.close();
    });
  }

  // Métodos especiales delegados al baseClient
  $on: (...args: any[]) => any = (...args) => {
    return (this.baseClient as any).$on(...args);
  };

  $transaction(...args: any[]): any {
    return (this.baseClient as any).$transaction(...args);
  }

  $connect() {
    return this.baseClient.$connect();
  }

  $disconnect() {
    return this.baseClient.$disconnect();
  }

  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Promise<T> {
    return (this.baseClient as any).$queryRawUnsafe(query, ...values);
  }

  $executeRawUnsafe(query: string, ...values: any[]): Promise<number> {
    return (this.baseClient as any).$executeRawUnsafe(query, ...values);
  }

  /**
   * Ejecuta queries sin scope (útil para jobs, seeders, migraciones)
   */
  withoutScope() {
    return this.baseClient;
  }
}
