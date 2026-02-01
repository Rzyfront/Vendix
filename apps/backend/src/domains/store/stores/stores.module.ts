import { Module } from '@nestjs/common';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { StoreEcommerceModule } from '../ecommerce/ecommerce.module';
import { LocationsModule } from '../inventory/locations/locations.module';

@Module({
  imports: [ResponseModule, PrismaModule, StoreEcommerceModule, LocationsModule],
  controllers: [StoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule { }
