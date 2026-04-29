import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { S3Module } from '../../../common/services/s3.module';
import { PayrollProviderModule } from './providers/payroll-provider.module';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { EmployeesBulkController } from './employees/employees-bulk.controller';
import { EmployeesBulkService } from './employees/employees-bulk.service';
import { PayrollRunsController } from './payroll-runs/payroll-runs.controller';
import { PayrollRunsService } from './payroll-runs/payroll-runs.service';
import { PayrollFlowService } from './payroll-runs/payroll-flow.service';
import { PayrollCalculationService } from './calculation/payroll-calculation.service';
import { PayrollRulesService } from './calculation/payroll-rules.service';
import { PayrollRulesController } from './calculation/payroll-rules.controller';
import { PaystubController } from './paystubs/paystub.controller';
import { PaystubService } from './paystubs/paystub.service';
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';
import { AdvancesController } from './advances/advances.controller';
import { AdvancesService } from './advances/advances.service';
import { SettlementsController } from './settlements/settlements.controller';
import { SettlementsService } from './settlements/settlements.service';
import { SettlementCalculationService } from './settlements/settlement-calculation.service';
import { SettlementFlowService } from './settlements/settlement-flow.service';
import { PayrollBankExportService } from './bank-export/payroll-bank-export.service';
import { BANK_BATCH_BUILDER_REGISTRY } from './bank-export/interfaces/bank-batch-builder.interface';
import { BancolombiaBatchBuilder } from './bank-export/builders/bancolombia-batch.builder';
import { DaviviendaBatchBuilder } from './bank-export/builders/davivienda-batch.builder';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    S3Module,
    PayrollProviderModule.register(),
  ],
  controllers: [
    EmployeesController,
    EmployeesBulkController,
    PayrollRunsController,
    PayrollRulesController,
    AdvancesController,
    SettlementsController,
    PaystubController,
  ],
  providers: [
    EmployeesService,
    EmployeesBulkService,
    PayrollRunsService,
    PayrollFlowService,
    PayrollCalculationService,
    PayrollRulesService,
    DefaultPanelUIService,
    AdvancesService,
    SettlementsService,
    SettlementCalculationService,
    SettlementFlowService,
    PaystubService,
    PayrollBankExportService,
    {
      provide: BANK_BATCH_BUILDER_REGISTRY,
      useFactory: () => [
        new BancolombiaBatchBuilder(),
        new DaviviendaBatchBuilder(),
      ],
    },
  ],
  exports: [
    EmployeesService,
    PayrollRunsService,
    PayrollRulesService,
    AdvancesService,
    SettlementsService,
    PaystubService,
    PayrollBankExportService,
  ],
})
export class PayrollModule {}
