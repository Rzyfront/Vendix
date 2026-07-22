import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AccountsPayableService } from '../accounts-payable.service';

@Injectable()
export class ApEventsListener {
  private readonly logger = new Logger(ApEventsListener.name);

  constructor(private readonly ap_service: AccountsPayableService) {}

  // ─── PURCHASE ORDER RECEIVED ───────────────────────────────
  @OnEvent('purchase_order.received')
  async handlePurchaseOrderReceived(event: {
    purchase_order_id: number;
    reception_id: number;
    supplier_id: number;
    /** BRUTO contributed by this reception (neto + vat_deductible for O-48,
     *  or net alone for O-49). Per `vendix-tax-typing` compras post solo el
     *  escalar `vat_deductible`, sin `tax_breakdown`. */
    gross_reception_share: number;
    document_number?: string;
    organization_id: number;
    store_id?: number;
    due_date?: Date;
    currency?: string;
  }) {
    try {
      const ap = await this.ap_service.upsertPayableForReception({
        supplier_id: event.supplier_id,
        source_id: event.purchase_order_id,
        reception_id: event.reception_id,
        gross_reception_share: event.gross_reception_share,
        document_number: event.document_number,
        currency: event.currency,
        due_date: event.due_date,
        organization_id: event.organization_id,
        store_id: event.store_id,
      });

      this.logger.log(
        `AP #${ap.id} upserted for purchase_order #${event.purchase_order_id} (reception #${event.reception_id})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to upsert AP for purchase_order #${event.purchase_order_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ─── EXPENSE APPROVED ──────────────────────────────────────
  @OnEvent('expense.approved')
  async handleExpenseApproved(event: {
    expense_id: number;
    supplier_id?: number;
    total_amount: number;
    document_number?: string;
    organization_id: number;
    store_id?: number;
    due_date?: Date;
    currency?: string;
    notes?: string;
  }) {
    // Only create AP if the expense has a supplier_id
    if (!event.supplier_id) return;

    try {
      const ap = await this.ap_service.createFromEvent({
        supplier_id: event.supplier_id,
        source_type: 'expense',
        source_id: event.expense_id,
        document_number: event.document_number,
        original_amount: event.total_amount,
        currency: event.currency,
        due_date: event.due_date,
        organization_id: event.organization_id,
        store_id: event.store_id,
        notes: event.notes,
      });

      this.logger.log(`AP #${ap.id} created for expense #${event.expense_id}`);
    } catch (error) {
      this.logger.error(
        `Failed to create AP for expense #${event.expense_id}: ${error.message}`,
        error.stack,
      );
    }
  }
}
