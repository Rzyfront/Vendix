import { Module } from '@nestjs/common';
import { GymAccessController } from './gym-access.controller';
import { GymAccessService } from './gym-access.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

/**
 * Store-scoped Gym Access module (Gym Suite — Ola 1).
 *
 * REDIS_CLIENT is provided by the @Global() RedisModule, so no explicit import
 * is required for the per-period access quota.
 */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [GymAccessController],
  providers: [GymAccessService],
  exports: [GymAccessService],
})
export class GymAccessModule {}
