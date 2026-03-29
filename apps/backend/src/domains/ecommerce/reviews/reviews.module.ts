import { Module } from '@nestjs/common';
import { EcommerceReviewsService } from './reviews.service';
import { EcommerceReviewsController } from './reviews.controller';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EcommerceReviewsController],
  providers: [EcommerceReviewsService],
  exports: [EcommerceReviewsService],
})
export class EcommerceReviewsModule {}
