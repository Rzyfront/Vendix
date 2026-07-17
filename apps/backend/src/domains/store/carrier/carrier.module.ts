import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DispatchNotesModule } from '../dispatch-notes/dispatch-notes.module';
import { DispatchRoutesModule } from '../dispatch-routes/dispatch-routes.module';
import { RouteNumberGenerator } from '../dispatch-routes/utils/route-number-generator';
import { CarrierDeliveryController } from './carrier-delivery.controller';
import { CarrierDeliveryService } from './carrier-delivery.service';

/**
 * Carrier namespace module (Repartos Fase B6).
 *
 * Reuso, no duplicación:
 *  - `DispatchNotesModule` → `DispatchNotesService.createFromOrder` (remisión +
 *    parada) para el claim.
 *  - `DispatchRoutesModule` → deja disponible `RouteFlowService` para la Fase B7
 *    (dispatch/start/settle/release/close) sin volver a tocar este módulo.
 *
 * `RouteNumberGenerator` se provee localmente (stateless, sólo depende de
 * StorePrismaService) para generar `route_number` al crear la ruta carrier.
 */
@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    DispatchNotesModule,
    DispatchRoutesModule,
  ],
  controllers: [CarrierDeliveryController],
  providers: [CarrierDeliveryService, RouteNumberGenerator],
  exports: [CarrierDeliveryService],
})
export class CarrierModule {}
