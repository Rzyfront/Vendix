import { Module } from '@nestjs/common';
import { MembershipAccessController } from './membership-access.controller';
import { MembershipAccessService } from './membership-access.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { MenusModule } from '../menus/menus.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Store-scoped Membership Access module (generalized membership core).
 *
 * REDIS_CLIENT is provided by the @Global() RedisModule, so no explicit import
 * is required for the per-period access quota.
 *
 * Imports:
 *   - MenusModule:         MenuAvailabilityCheckerService — reused so the
 *     per-plan access schedule (`features.access_schedule`) uses the EXACT same
 *     timezone/window math as menu availability windows.
 *   - NotificationsModule: NotificationsSseService — per-store SSE hub reused to
 *     fan out `membership-access` decision events to the ambient-access stream.
 */
@Module({
  imports: [ResponseModule, PrismaModule, MenusModule, NotificationsModule],
  controllers: [MembershipAccessController],
  providers: [MembershipAccessService],
  exports: [MembershipAccessService],
})
export class MembershipAccessModule {}
