import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { DynamicCorsService } from './dynamic-cors.service';

/**
 * Provides `DynamicCorsService` for the future custom-domains CORS workflow.
 *
 * Notes on dependencies:
 * - `CacheModule` is NOT imported here. `VendixCacheModule` is already
 *   registered globally (`isGlobal: true`) in `app.module.ts`, so
 *   `CACHE_MANAGER` is injectable repo-wide.
 * - `EventEmitterModule.forRoot()` is registered in `app.module.ts`, so
 *   `@OnEvent` works without further imports.
 * - `PrismaModule` is imported because `GlobalPrismaService` is exported
 *   from there.
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [DynamicCorsService],
  exports: [DynamicCorsService],
})
export class CorsModule {}
