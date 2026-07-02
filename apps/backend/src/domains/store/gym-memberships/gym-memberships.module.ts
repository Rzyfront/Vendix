import { Module } from '@nestjs/common';
import { GymMembershipsController } from './gym-memberships.controller';
import { GymMemberProfilesController } from './gym-member-profiles.controller';
import { GymMembershipsService } from './gym-memberships.service';
import { GymMemberProfilesService } from './gym-member-profiles.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { GymPlansModule } from '../gym-plans/gym-plans.module';
import { PaymentsModule } from '../payments/payments.module';

/**
 * Store-scoped Gym Memberships module (Gym Suite — Ola 1).
 *
 * Depends on:
 *   - GymPlansModule  → plan lookups (duration, price, backing product)
 *   - PaymentsModule  → PaymentsService.processPaymentWithOrder for renewal
 */
@Module({
  imports: [ResponseModule, PrismaModule, GymPlansModule, PaymentsModule],
  controllers: [GymMembershipsController, GymMemberProfilesController],
  providers: [GymMembershipsService, GymMemberProfilesService],
  exports: [GymMembershipsService, GymMemberProfilesService],
})
export class GymMembershipsModule {}
