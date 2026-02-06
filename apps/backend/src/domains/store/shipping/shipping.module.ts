import { Module } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';
import { ShippingCalculatorService } from './shipping-calculator.service';
import { StoreShippingMethodsService } from './services/store-shipping-methods.service';
import { StoreShippingMethodsController } from './controllers/store-shipping-methods.controller';
import { StoreShippingZonesService } from './services/store-shipping-zones.service';
import { StoreShippingZonesController } from './controllers/store-shipping-zones.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [
    ShippingController,
    StoreShippingMethodsController,
    StoreShippingZonesController,
  ],
  providers: [
    ShippingService,
    ShippingCalculatorService,
    StoreShippingMethodsService,
    StoreShippingZonesService,
  ],
  exports: [
    ShippingService,
    ShippingCalculatorService,
    StoreShippingMethodsService,
    StoreShippingZonesService,
  ],
})
export class ShippingModule {}
