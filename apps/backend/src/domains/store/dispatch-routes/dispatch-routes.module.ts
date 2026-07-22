import { Module } from '@nestjs/common';
import { DispatchRoutesService } from './dispatch-routes.service';
import { DispatchRoutesController } from './dispatch-routes.controller';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { RouteFlowService } from './route-flow/route-flow.service';
import { RouteFlowController } from './route-flow/route-flow.controller';
import { CashSettlementService } from './route-flow/cash-settlement.service';
import { PdfExportService } from './route-flow/pdf-export.service';
import { RouteSheetScannerService } from './route-flow/route-sheet-scanner.service';
import { RouteNumberGenerator } from './utils/route-number-generator';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CashRegistersModule } from '../cash-registers/cash-registers.module';
import { S3Module } from '@common/services/s3.module';
import { GeocodingModule } from '../../ecommerce/geocoding/geocoding.module';
import { OrderFlowModule } from '../orders/order-flow/order-flow.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    CashRegistersModule,
    S3Module,
    // Provides GeocodingService.forward() for resolving stop coordinates on
    // the route map (fallback when no lat/lng is stored on the address).
    GeocodingModule,
    // QUI-498: provides OrderFlowService so RouteFlowService reconciles the
    // linked COD order state post-commit via the single reconciler
    // (reconcileOrderFromDispatch) instead of writing orders.state directly.
    // OrderFlowModule does NOT import DispatchRoutesModule → acyclic.
    OrderFlowModule,
  ],
  controllers: [
    DispatchRoutesController,
    VehiclesController,
    RouteFlowController,
  ],
  providers: [
    DispatchRoutesService,
    VehiclesService,
    RouteFlowService,
    CashSettlementService,
    PdfExportService,
    RouteSheetScannerService,
    RouteNumberGenerator,
  ],
  exports: [DispatchRoutesService, VehiclesService, RouteFlowService],
})
export class DispatchRoutesModule {}
