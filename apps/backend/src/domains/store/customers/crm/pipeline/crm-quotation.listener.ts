import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CrmPipelineService } from './crm-pipeline.service';

export interface CrmQuotationEvent {
  store_id?: number;
  quotation_id: number;
  order_id?: number;
}

/**
 * Quotation → opportunity link (PLAN-CRM §2.5): accepting or converting a
 * linked quotation wins its open opportunities. Never throws back into the
 * quotation flow, which already succeeded.
 */
@Injectable()
export class CrmQuotationListener {
  private readonly logger = new Logger(CrmQuotationListener.name);

  constructor(private readonly pipeline: CrmPipelineService) {}

  @OnEvent('quotation.accepted')
  handleAccepted(payload: CrmQuotationEvent) {
    return this.win(payload);
  }

  @OnEvent('quotation.converted')
  handleConverted(payload: CrmQuotationEvent) {
    return this.win(payload);
  }

  private async win(payload: CrmQuotationEvent): Promise<void> {
    if (!payload?.store_id || !payload.quotation_id) return;
    try {
      const won = await this.pipeline.winByQuotation(
        payload.store_id,
        payload.quotation_id,
        payload.order_id ?? null,
      );
      if (won) {
        this.logger.log(
          `Quotation ${payload.quotation_id}: ${won} opportunity(ies) won`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Quotation ${payload.quotation_id}: could not win its opportunities: ${(error as Error)?.message}`,
      );
    }
  }
}
