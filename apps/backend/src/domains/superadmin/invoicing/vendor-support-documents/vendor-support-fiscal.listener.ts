import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { VendorSupportFiscalService } from './vendor-support-fiscal.service';

/**
 * Listens for `expense.approved` (emitted by VendorSupportDocumentsService
 * on approve) and, when `platform_settings['vendor_support_fiscal'].auto_transmit`
 * is true, transmits the document to DIAN best-effort.
 *
 * Failures NEVER break the business approval flow — they are logged and
 * surfaced via the fiscal_transmissions row.
 */
@Injectable()
export class VendorSupportFiscalListener {
  private readonly logger = new Logger(VendorSupportFiscalListener.name);

  constructor(private readonly fiscalService: VendorSupportFiscalService) {}

  @OnEvent('expense.approved')
  async onExpenseApproved(payload: {
    expense_id?: number;
    organization_id?: number;
    store_id?: number;
    amount?: number;
    user_id?: number;
    source?: string;
  }): Promise<void> {
    if (!payload?.expense_id) return;

    try {
      const result = await this.fiscalService.transmit(payload.expense_id, {
        source: payload.source ?? 'expense_approved',
      });
      this.logger.debug(
        `vendor-support fiscal transmit doc=${payload.expense_id}: ${JSON.stringify(result)}`,
      );
    } catch (error) {
      this.logger.warn(
        `Non-blocking vendor-support fiscal transmit failed doc=${payload.expense_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
