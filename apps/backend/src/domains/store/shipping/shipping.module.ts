import { Module } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';
import { ShippingCalculatorService } from './shipping-calculator.service';
import { StoreShippingMethodsService } from './services/store-shipping-methods.service';
import { StoreShippingMethodsController } from './controllers/store-shipping-methods.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [ShippingController, StoreShippingMethodsController],
  providers: [
    ShippingService,
    ShippingCalculatorService,
    StoreShippingMethodsService,
  ],
  exports: [ShippingService, ShippingCalculatorService, StoreShippingMethodsService],
})
export class ShippingModule { }
