import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createPayrollTools } from '../../../ai-engine/tools/domains/payroll.tools';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { S3Module } from '../../../common/services/s3.module';
import { PayrollProviderModule } from './providers/payroll-provider.module';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { EmployeeFiscalProfileService } from './employees/employee-fiscal-profile.service';
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
import { NoveltiesController } from './novelties/novelties.controller';
import { NoveltiesService } from './novelties/novelties.service';
import { SettlementsController } from './settlements/settlements.controller';
import { SettlementsService } from './settlements/settlements.service';
import { SettlementCalculationService } from './settlements/settlement-calculation.service';
import { SettlementFlowService } from './settlements/settlement-flow.service';
import { PayrollBankExportService } from './bank-export/payroll-bank-export.service';
import { PilaReportController } from './pila/pila-report.controller';
import { PilaReportService } from './pila/pila-report.service';
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
    NoveltiesController,
    SettlementsController,
    PaystubController,
    PilaReportController,
  ],
  providers: [
    EmployeesService,
    EmployeeFiscalProfileService,
    EmployeesBulkService,
    PayrollRunsService,
    PayrollFlowService,
    PayrollCalculationService,
    PayrollRulesService,
    DefaultPanelUIService,
    AdvancesService,
    NoveltiesService,
    SettlementsService,
    SettlementCalculationService,
    SettlementFlowService,
    PaystubService,
    PayrollBankExportService,
    PilaReportService,
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
    NoveltiesService,
    SettlementsService,
    PaystubService,
    PayrollBankExportService,
  ],
})
export class PayrollModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly payrollRunsService: PayrollRunsService,
    private readonly payrollFlowService: PayrollFlowService,
    private readonly pilaReportService: PilaReportService,
  ) {}

  /**
   * Registra la familia payroll (F-50, F-51, F-56, F-68) para el agente. Vive
   * aquí y no en `AIEngineModule` porque ese módulo es `@Global()`: importar
   * un dominio por familia genera ciclos de dependencia. `AIToolRegistry` se
   * exporta global, así que la dependencia apunta del dominio al motor y este
   * módulo no importa nada extra.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createPayrollTools({
        payrollRunsService: this.payrollRunsService,
        payrollFlowService: this.payrollFlowService,
        pilaReportService: this.pilaReportService,
      }),
    );
  }
}
