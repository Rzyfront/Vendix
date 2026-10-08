import { Module } from '@nestjs/common';
import { EcommerceReviewsService } from './reviews.service';
import { EcommerceReviewsController } from './reviews.controller';
import { OrderReviewsService } from './order-reviews.service';
import { OrderReviewsController } from './order-reviews.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module],
  controllers: [EcommerceReviewsController, OrderReviewsController],
  providers: [EcommerceReviewsService, OrderReviewsService],
  exports: [EcommerceReviewsService],
})
export class EcommerceReviewsModule {}
