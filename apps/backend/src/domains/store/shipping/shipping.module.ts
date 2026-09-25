import { Module } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';
import { ShippingCalculatorService } from './shipping-calculator.service';
import { StoreShippingMethodsService } from './services/store-shipping-methods.service';
import { StoreShippingMethodsController } from './controllers/store-shipping-methods.controller';
import { StoreShippingZonesService } from './services/store-shipping-zones.service';
import { StoreShippingZonesController } from './controllers/store-shipping-zones.controller';
import { ShippingTaxService } from './services/shipping-tax.service';
import { ShippingDistanceService } from './services/shipping-distance.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { SettingsModule } from '../settings/settings.module';
import { RoutingModule } from '../../ecommerce/routing/routing.module';

@Module({
  imports: [PrismaModule, ResponseModule, SettingsModule, RoutingModule],
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
    ShippingTaxService,
    ShippingDistanceService,
  ],
  exports: [
    ShippingService,
    ShippingCalculatorService,
    StoreShippingMethodsService,
    StoreShippingZonesService,
    // Copia del impuesto del envío: la inyectan payments, orders y checkout.
    ShippingTaxService,
    // Resolver del cobro por distancia: lo inyecta el checkout al confirmar.
    ShippingDistanceService,
  ],
})
export class ShippingModule {}
