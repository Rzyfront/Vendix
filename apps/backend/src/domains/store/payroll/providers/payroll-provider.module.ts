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
          useFactory: (
            mockProvider: MockPayrollProvider,
            dianProvider: DianPayrollProvider,
          ) =>
            process.env.NODE_ENV === 'production'
              ? dianProvider
              : mockProvider,
          inject: [MockPayrollProvider, DianPayrollProvider],
        },
      ],
      exports: [PAYROLL_PROVIDER, DianPayrollModule],
    };
  }
}
