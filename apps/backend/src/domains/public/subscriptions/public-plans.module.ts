import { Module } from '@nestjs/common';
import { PublicPlansController } from './public-plans.controller';
import { PublicPlansService } from './public-plans.service';
import { ResponseModule } from '@common/responses';
import { PrismaModule } from '../../../prisma/prisma.module';

/**
 * 📦 PublicPlansModule
 *
 * Exposes the GET /api/public/plans endpoint without authentication.
 * Rate-limited at the controller level via @Throttle (100 req/min/IP).
 */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
  ],
  controllers: [PublicPlansController],
  providers: [PublicPlansService],
})
export class PublicPlansModule {}
