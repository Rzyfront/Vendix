import { DynamicModule, Module } from '@nestjs/common';
import { PAYROLL_PROVIDER } from './payroll-provider.interface';
import { MockPayrollProvider } from './mock-payroll.provider';

@Module({})
export class PayrollProviderModule {
  static register(): DynamicModule {
    // In the future, use a factory to select the real provider
    // based on organization settings or environment variables.
    return {
      module: PayrollProviderModule,
      providers: [
        {
          provide: PAYROLL_PROVIDER,
          useClass: MockPayrollProvider,
        },
      ],
      exports: [PAYROLL_PROVIDER],
    };
  }
}
