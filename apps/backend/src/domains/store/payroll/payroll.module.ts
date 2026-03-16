import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
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
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    PayrollProviderModule.register(),
  ],
  controllers: [EmployeesController, EmployeesBulkController, PayrollRunsController, PayrollRulesController],
  providers: [
    EmployeesService,
    EmployeesBulkService,
    PayrollRunsService,
    PayrollFlowService,
    PayrollCalculationService,
    PayrollRulesService,
    DefaultPanelUIService,
  ],
  exports: [EmployeesService, PayrollRunsService, PayrollRulesService],
})
export class PayrollModule {}
