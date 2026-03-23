import { DynamicModule, Module } from '@nestjs/common';
import { PAYROLL_PROVIDER } from './payroll-provider.interface';
import { MockPayrollProvider } from './mock-payroll.provider';
import { DianPayrollModule } from './dian-payroll/dian-payroll.module';
import { DianPayrollProvider } from './dian-payroll/dian-payroll.provider';

@Module({})
export class PayrollProviderModule {
  static register(): DynamicModule {
    return {
      module: PayrollProviderModule,
      imports: [DianPayrollModule],
      providers: [
        MockPayrollProvider,
        {
          provide: PAYROLL_PROVIDER,
          useClass: MockPayrollProvider,
          // TODO: Use factory to select provider based on
          // dian_configurations.configuration_type='payroll' existence.
          // For now, default to MockPayrollProvider.
          // The DianPayrollProvider can be injected directly via DianPayrollModule
          // when the store has a payroll DIAN configuration.
        },
      ],
      exports: [PAYROLL_PROVIDER, DianPayrollModule],
    };
  }
}
