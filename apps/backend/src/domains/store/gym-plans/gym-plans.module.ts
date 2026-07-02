import { Module } from '@nestjs/common';
import { GymPlansController } from './gym-plans.controller';
import { GymPlansService } from './gym-plans.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

/**
 * Store-scoped Gym Plans module (Gym Suite — Ola 1).
 *
 * The service is exported so sibling gym modules (memberships/access) can reuse
 * plan lookups without duplicating the provider.
 */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [GymPlansController],
  providers: [GymPlansService],
  exports: [GymPlansService],
})
export class GymPlansModule {}
