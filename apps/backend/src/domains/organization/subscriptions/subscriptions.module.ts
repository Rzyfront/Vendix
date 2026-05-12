import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { PlatformGatewayModule } from '../../superadmin/subscriptions/gateway/gateway.module';

import { OrgSubscriptionsController } from './controllers/org-subscriptions.controller';
import { OrgSubscriptionsService } from './services/org-subscriptions.service';

/**
 * Org-native subscriptions module. Exposes `/organization/subscriptions/*`
 * for ORG_ADMIN tokens.
 *
 * IMPORTANT: every store-side billing/payment service is registered as a
 * `@Global()` provider by `domains/store/subscriptions/subscriptions.module.ts`,
 * so this module imports them implicitly. `PlatformGatewayService`, however,
 * is NOT global — its module must be imported here explicitly to satisfy
 * the controller's dependency on Wompi platform credentials during checkout.
 */
@Module({
  imports: [PrismaModule, ResponseModule, PlatformGatewayModule],
  controllers: [OrgSubscriptionsController],
  providers: [OrgSubscriptionsService],
  exports: [OrgSubscriptionsService],
})
export class OrgSubscriptionsModule {}
