import { Module, OnModuleInit } from '@nestjs/common';
import { MembershipsController } from './memberships.controller';
import { MemberProfilesController } from './member-profiles.controller';
import { MemberBulkScannerController } from './member-bulk-scanner.controller';
import { MembershipsService } from './memberships.service';
import { MemberProfilesService } from './member-profiles.service';
import { MemberBulkScannerService } from './member-bulk-scanner.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { MembershipPlansModule } from '../membership-plans/membership-plans.module';
import { MembershipPlansService } from '../membership-plans/membership-plans.service';
import { MembershipAccessModule } from '../membership-access/membership-access.module';
import { MembershipAccessService } from '../membership-access/membership-access.service';
import { PaymentsModule } from '../payments/payments.module';
import { OrderFlowModule } from '../orders/order-flow/order-flow.module';
import { CustomersModule } from '../customers/customers.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createMembershipTools } from '../../../ai-engine/tools/domains/memberships.tools';

/**
 * Store-scoped Memberships module (generalized membership core).
 *
 * Depends on:
 *   - MembershipPlansModule → plan lookups (duration, price, backing product)
 *   - PaymentsModule        → PaymentsService.processPaymentWithOrder for renewal
 *   - OrderFlowModule       → OrderFlowService.finishOrder to close the renewal
 *     order immediately (a membership is delivered on payment).
 *   - CustomersModule       → CustomersService (create / link) for the bulk
 *     member roster scanner (Block 2 of the bulk-import feature).
 */
@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    MembershipPlansModule,
    // Only for the memberships tool family (sell/check-in need the access
    // side); does not import back, so no cycle.
    MembershipAccessModule,
    PaymentsModule,
    OrderFlowModule,
    CustomersModule,
  ],
  controllers: [
    MembershipsController,
    MemberProfilesController,
    MemberBulkScannerController,
  ],
  providers: [
    MembershipsService,
    MemberProfilesService,
    MemberBulkScannerService,
  ],
  exports: [MembershipsService, MemberProfilesService],
})
export class MembershipsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly memberships: MembershipsService,
    private readonly access: MembershipAccessService,
    private readonly plans: MembershipPlansService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createMembershipTools({
        membershipsService: this.memberships,
        membershipAccessService: this.access,
        membershipPlansService: this.plans,
      }),
    );
  }
}
