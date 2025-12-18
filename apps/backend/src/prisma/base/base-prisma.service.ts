import {
  INestApplication,
  Injectable,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export abstract class BasePrismaService implements OnModuleInit {
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly baseClient: PrismaClient;

  constructor() {
    const connectionString = process.env.DATABASE_URL!;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    this.baseClient = new PrismaClient({
      adapter,
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'error', 'warn']
          : ['error'],
    });

    this.logger.log(`🚀 [${this.constructor.name}] PrismaClient initialized`);
  }

  async onModuleInit() {
    await this.baseClient.$connect();
    this.logger.log('✅ Prisma connected to database');
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

  /**
   * Ejecuta queries sin scope (útil para jobs, seeders, migraciones)
   */
  withoutScope() {
    return this.baseClient;
  }
}
