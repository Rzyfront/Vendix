import { Module } from '@nestjs/common';
import { MembershipsController } from './memberships.controller';
import { MemberProfilesController } from './member-profiles.controller';
import { MembershipsService } from './memberships.service';
import { MemberProfilesService } from './member-profiles.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { MembershipPlansModule } from '../membership-plans/membership-plans.module';
import { PaymentsModule } from '../payments/payments.module';

/**
 * Store-scoped Memberships module (generalized membership core).
 *
 * Depends on:
 *   - MembershipPlansModule → plan lookups (duration, price, backing product)
 *   - PaymentsModule        → PaymentsService.processPaymentWithOrder for renewal
 */
@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    MembershipPlansModule,
    PaymentsModule,
  ],
  controllers: [MembershipsController, MemberProfilesController],
  providers: [MembershipsService, MemberProfilesService],
  exports: [MembershipsService, MemberProfilesService],
})
export class MembershipsModule {}
