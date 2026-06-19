import { Module } from '@nestjs/common';
import { DispatchRoutesService } from './dispatch-routes.service';
import { DispatchRoutesController } from './dispatch-routes.controller';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { RouteFlowService } from './route-flow/route-flow.service';
import { RouteFlowController } from './route-flow/route-flow.controller';
import { CashSettlementService } from './route-flow/cash-settlement.service';
import { PdfExportService } from './route-flow/pdf-export.service';
import { RouteNumberGenerator } from './utils/route-number-generator';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CashRegistersModule } from '../cash-registers/cash-registers.module';

@Module({
  imports: [ResponseModule, PrismaModule, CashRegistersModule],
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
    RouteNumberGenerator,
  ],
  exports: [DispatchRoutesService, VehiclesService, RouteFlowService],
})
export class DispatchRoutesModule {}
