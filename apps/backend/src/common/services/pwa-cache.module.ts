import { Global, Module } from '@nestjs/common';
import { PwaCacheService } from './pwa-cache.service';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * PWA cache invalidation, exposed globally.
 *
 * `@Global()` because the callers are scattered across unrelated domains
 * (store settings, organization settings, store CRUD) and every one of them
 * only ever needs the single invalidation call. Threading the import through
 * each module would add churn without adding a boundary — `StorageModule` and
 * `HelpersModule`, which this service depends on, are global for the same
 * reason.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [PwaCacheService],
  exports: [PwaCacheService],
})
export class PwaCacheModule {}
