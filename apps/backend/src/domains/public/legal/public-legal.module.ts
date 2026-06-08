import { Module } from '@nestjs/common';
import { PublicLegalController } from './public-legal.controller';
import { PublicLegalService } from './public-legal.service';
import { ResponseModule } from '@common/responses';
import { PrismaModule } from '../../../prisma/prisma.module';
import { S3Module } from '../../../common/services/s3.module';

/**
 * 📜 PublicLegalModule
 *
 * Exposes the GET /api/public/legal/:documentType endpoint without
 * authentication. Rate-limited at the controller level via @Throttle
 * (100 req/min/IP). Uses the global Prisma source and S3 to hydrate document
 * content from storage when needed.
 */
@Module({
  imports: [PrismaModule, ResponseModule, S3Module],
  controllers: [PublicLegalController],
  providers: [PublicLegalService],
})
export class PublicLegalModule {}
