import { Module } from '@nestjs/common';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { StoreBootstrapHelper } from '@common/helpers/store-bootstrap.helper';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [StoresController],
  providers: [StoresService, StoreBootstrapHelper],
  exports: [StoresService],
})
export class StoresModule {}
