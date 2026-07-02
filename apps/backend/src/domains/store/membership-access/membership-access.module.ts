import { Module } from '@nestjs/common';
import { MembershipAccessController } from './membership-access.controller';
import { MembershipAccessService } from './membership-access.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

/**
 * Store-scoped Membership Access module (generalized membership core).
 *
 * REDIS_CLIENT is provided by the @Global() RedisModule, so no explicit import
 * is required for the per-period access quota.
 */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [MembershipAccessController],
  providers: [MembershipAccessService],
  exports: [MembershipAccessService],
})
export class MembershipAccessModule {}
