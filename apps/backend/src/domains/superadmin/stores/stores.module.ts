import { Module } from '@nestjs/common';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';
import { StoreActivityController } from './activity/store-activity.controller';
import { StoreActivityModule } from './activity/store-activity.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { StoreBootstrapHelper } from '@common/helpers/store-bootstrap.helper';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module, StoreActivityModule],
  controllers: [StoresController, StoreActivityController],
  providers: [StoresService, StoreBootstrapHelper],
  exports: [StoresService],
})
export class StoresModule {}
