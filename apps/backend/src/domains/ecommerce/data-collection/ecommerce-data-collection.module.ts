import { Module } from '@nestjs/common';
import { EcommerceDataCollectionController } from './ecommerce-data-collection.controller';
import { DataCollectionModule } from '../../store/data-collection/data-collection.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [DataCollectionModule, ResponseModule, S3Module, PrismaModule],
  controllers: [EcommerceDataCollectionController],
})
export class EcommerceDataCollectionModule {}
