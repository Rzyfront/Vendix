import { Injectable, Logger } from '@nestjs/common';
import {
  PayrollProviderAdapter,
  PayrollProviderResponse,
  PayrollStatusResponse,
} from './payroll-provider.interface';
import { randomUUID } from 'crypto';

@Injectable()
export class MockPayrollProvider implements PayrollProviderAdapter {
  private readonly logger = new Logger(MockPayrollProvider.name);

  private assertNonProduction(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Mock payroll provider is disabled in production. Configure DIAN own-software payroll credentials and the customer certificate.',
      );
    }
  }

  async sendPayroll(payroll_data: {
    payroll_run_id: number;
    payroll_number: string;
    period_start: Date;
    period_end: Date;
    items: Array<Record<string, any>>;
  }): Promise<PayrollProviderResponse> {
    this.assertNonProduction();
    const tracking_id = randomUUID();
    const fake_cune = `CUNE-MOCK-${Date.now()}-${randomUUID().slice(0, 8)}`;

    this.logger.log(
      `[MOCK] Sending payroll #${payroll_data.payroll_number} with ${payroll_data.items.length} items. Tracking: ${tracking_id}`,
    );

    return {
      success: true,
      tracking_id,
      cune: fake_cune,
      xml_document: `<mock-dspne payroll="${payroll_data.payroll_number}" />`,
      message: 'Mock payroll sent successfully',
      raw_response: {
        mock: true,
        sent_at: new Date().toISOString(),
      },
    };
  }

  async checkStatus(tracking_id: string): Promise<PayrollStatusResponse> {
    this.assertNonProduction();
    this.logger.log(`[MOCK] Checking status for tracking: ${tracking_id}`);

    return {
      tracking_id,
      status: 'accepted',
      cune: `CUNE-MOCK-${tracking_id.slice(0, 8)}`,
      message: 'Mock status: accepted',
      raw_response: {
        mock: true,
        checked_at: new Date().toISOString(),
      },
    };
  }
}
