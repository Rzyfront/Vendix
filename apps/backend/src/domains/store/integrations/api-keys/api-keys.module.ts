import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ApiKeyAuthService } from './api-key-auth.service';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';
import { StoreApiKeysController } from './store-api-keys.controller';
import { StoreApiKeysService } from './store-api-keys.service';

/**
 * Store API keys: management (`store/integrations/api-keys`, JWT) and the
 * guards the `/api/v1` surface authenticates with. `SubscriptionsModule` and
 * `ThrottlerModule` are global.
 */
@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [StoreApiKeysController],
  providers: [
    ApiKeyAuthService,
    ApiKeyGuard,
    ApiKeyThrottlerGuard,
    StoreApiKeysService,
  ],
  exports: [ApiKeyAuthService, ApiKeyGuard, ApiKeyThrottlerGuard],
})
export class ApiKeysModule {}
