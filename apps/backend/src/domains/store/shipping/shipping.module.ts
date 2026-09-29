import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createShippingTools } from '../../../ai-engine/tools/domains/shipping.tools';
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
import { GeocodingModule } from '../../ecommerce/geocoding/geocoding.module';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    SettingsModule,
    RoutingModule,
    // Provee GeocodingService.forward() para ShippingDistanceService.resolveBuyerCoords
    // (geocodifica al comprador cuando el checkout no manda lat/lng). GeocodingModule
    // no importa nada de store/*, así que no hay ciclo (mismo patrón que
    // DispatchRoutesModule).
    GeocodingModule,
  ],
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
export class ShippingModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly shippingCalculatorService: ShippingCalculatorService,
    private readonly shippingDistanceService: ShippingDistanceService,
  ) {}

  /**
   * D-8: registro descentralizado en el módulo dueño, no en
   * `AIEngineModule` (ciclo DI). `AIToolRegistry` viene del módulo global.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createShippingTools({
        shippingCalculatorService: this.shippingCalculatorService,
        shippingDistanceService: this.shippingDistanceService,
      }),
    );
  }
}
