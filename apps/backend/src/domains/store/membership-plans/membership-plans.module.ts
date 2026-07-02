import { Module } from '@nestjs/common';
import { MembershipPlansController } from './membership-plans.controller';
import { MembershipPlansService } from './membership-plans.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

/**
 * Store-scoped Membership Plans module (generalized membership core).
 *
 * The service is exported so sibling membership modules (memberships/access)
 * can reuse plan lookups without duplicating the provider.
 */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [MembershipPlansController],
  providers: [MembershipPlansService],
  exports: [MembershipPlansService],
})
export class MembershipPlansModule {}
