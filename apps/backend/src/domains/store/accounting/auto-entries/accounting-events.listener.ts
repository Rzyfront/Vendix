import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AutoEntryService, AutoEntryLine } from './auto-entry.service';
import { AccountMappingService } from '../account-mappings/account-mapping.service';
import { FiscalGateService } from '../../../../common/services/fiscal-gate.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { TaxBreakdownItem } from '@common/interfaces/tax-breakdown.interface';
import { WithholdingLine } from '@common/interfaces/withholding-breakdown.interface';

@Injectable()
export class AccountingEventsListener {
  private readonly logger = new Logger(AccountingEventsListener.name);

  constructor(
    private readonly auto_entry_service: AutoEntryService,
    private readonly account_mapping_service: AccountMappingService,
    private readonly fiscal_gate: FiscalGateService,
    private readonly platform_org_service: PlatformOrgService,
  ) {}

  /**
   * RNC-31 helper — resolve a mapping key into an AutoEntryLine. Lives on
   * the listener (instead of reusing AutoEntryService's private method via
   * bracket access) because the SaaS double-entry posts to two different
   * `organization_id`s (store + Vendix platform) and the helper needs to be
   * callable for either side.
   */
  private async resolveSaasLine(
    org_id: number,
    mapping_key: string,
    description: string,
    debit_amount: number,
    credit_amount: number,
    store_id?: number,
  ): Promise<AutoEntryLine | null> {
    const mapping = await this.account_mapping_service.getMapping(
      org_id,
      mapping_key,
      store_id,
    );
    if (!mapping) return null;
    return {
      account_code: mapping.account_code,
      description,
      debit_amount,
      credit_amount,
    };
  }

  /**
   * Gate de generación automática. Delega en FiscalGateService (fuente única
   * compartida con ModuleFlowGuard): el maestro `fiscal_status.<area>` decide,
   * `module_flows.accounting.<subflow>` refina. Resuelve la organización desde
   * el store cuando el evento no la trae; fail-closed si no se puede resolver
   * (default ESTRICTO: sin responsabilidad fiscal activa, no se generan asientos).
   *
   * `flow_key` es un subflow (payments, inventory, invoicing, payroll, …); el
   * gate lo mapea a su área fiscal gobernante vía SUBFLOW_TO_AREA.
   */
  private async isFlowEnabled(
    store_id: number | undefined,
    flow_key: string,
    organization_id?: number,
  ): Promise<boolean> {
    const org_id =
      organization_id ?? (store_id ? await this.resolveOrgId(store_id) : 0);
    if (!org_id) return false;
    return this.fiscal_gate.isSubflowEnabled(
      org_id,
      store_id ?? null,
      flow_key,
    );
  }

  @OnEvent('invoice.accepted')
  async handleInvoiceAccepted(event: {
    invoice_id: number;
    invoice_number: string;
    invoice_type?: string;
    organization_id: number;
    store_id?: number;
    accounting_entity_id?: number;
    subtotal_amount: number;
    tax_amount: number;
    tax_breakdown?: TaxBreakdownItem[];
    withholding_breakdown?: WithholdingLine[];
    total_amount: number;
    user_id?: number;
    /** C4-followup: propagado desde invoice-flow.service.ts (updated.customer). */
    customer?: { id: number; name?: string; tax_id?: string };
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'invoicing'))) return;

      // Una nota crédito aceptada llega por el MISMO evento invoice.accepted:
      // debe reversar la venta (DR devoluciones/impuestos, CR cartera), nunca
      // sumar ingresos. Una nota débito aumenta el cobro como factura normal.
      if (event.invoice_type === 'credit_note') {
        await this.auto_entry_service.onCreditNoteAccepted({
          invoice_id: event.invoice_id,
          organization_id: event.organization_id,
          store_id: event.store_id,
          accounting_entity_id: event.accounting_entity_id,
          subtotal: event.subtotal_amount,
          tax_amount: event.tax_amount,
          tax_breakdown: event.tax_breakdown,
          total: event.total_amount,
          user_id: event.user_id,
        });
        this.logger.log(
          `Auto-entry (credit note reversal) created for invoice.accepted #${event.invoice_id}`,
        );
        return;
      }

      await this.auto_entry_service.onInvoiceValidated({
        invoice_id: event.invoice_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        accounting_entity_id: event.accounting_entity_id,
        subtotal: event.subtotal_amount,
        tax_amount: event.tax_amount,
        // Plan Despacho Economía — FASE 4 paso 14. Propagar el monto del flete
        // para que el split producto/flete se contabilice correctamente.
        shipping_amount: (event as any).shipping_amount ?? 0,
        tax_breakdown: event.tax_breakdown,
        withholding_breakdown: event.withholding_breakdown,
        total: event.total_amount,
        user_id: event.user_id,
        customer: event.customer,
      });
      this.logger.log(
        `Auto-entry created for invoice.accepted #${event.invoice_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for invoice.accepted #${event.invoice_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('support_document.accepted')
  async handleSupportDocumentAccepted(event: {
    invoice_id: number;
    invoice_number: string;
    invoice_type?: string;
    organization_id: number;
    store_id?: number;
    accounting_entity_id?: number;
    subtotal_amount: number;
    discount_amount?: number;
    tax_amount: number;
    withholding_amount?: number;
    withholding_breakdown?: WithholdingLine[];
    total_amount: number;
    supplier_id?: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'purchases'))) return;
      await this.auto_entry_service.onSupportDocumentAccepted({
        invoice_id: event.invoice_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        accounting_entity_id: event.accounting_entity_id,
        subtotal: Number(event.subtotal_amount),
        discount_amount: Number(event.discount_amount || 0),
        tax_amount: Number(event.tax_amount || 0),
        withholding_amount: Number(event.withholding_amount || 0),
        withholding_breakdown: event.withholding_breakdown,
        total: Number(event.total_amount),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for support_document.accepted #${event.invoice_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for support_document.accepted #${event.invoice_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('payment.received')
  async handlePaymentReceived(event: {
    payment_id: number;
    store_id: number;
    organization_id: number;
    order_id: number;
    order_number: string;
    amount: number;
    subtotal_amount?: number;
    tax_amount?: number;
    tax_breakdown?: TaxBreakdownItem[];
    withholding_breakdown?: WithholdingLine[];
    discount_amount?: number;
    /** GAP-6 — propina (sin IVA): pasivo custodio, línea CR en el asiento. */
    tip_amount?: number;
    currency: string;
    payment_method: string;
    user_id?: number;
    /** C4-followup: propagado desde payments.service.ts (order.customer_id). */
    customer?: { id: number; name?: string; tax_id?: string };
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'payments'))) return;
      await this.auto_entry_service.onPaymentReceived({
        payment_id: event.payment_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        order_id: event.order_id,
        order_number: event.order_number,
        payment_method: event.payment_method,
        amount: Number(event.amount),
        subtotal_amount:
          event.subtotal_amount != null
            ? Number(event.subtotal_amount)
            : undefined,
        tax_amount:
          event.tax_amount != null ? Number(event.tax_amount) : undefined,
        tax_breakdown: event.tax_breakdown,
        withholding_breakdown: event.withholding_breakdown,
        discount_amount:
          event.discount_amount != null
            ? Number(event.discount_amount)
            : undefined,
        tip_amount:
          event.tip_amount != null ? Number(event.tip_amount) : undefined,
        user_id: event.user_id,
        customer: event.customer,
      });
      this.logger.log(
        `Auto-entry created for payment.received #${event.payment_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for payment.received: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('credit_sale.created')
  async handleCreditSaleCreated(event: {
    order_id: number;
    organization_id: number;
    store_id?: number;
    order_number?: string;
    subtotal_amount: number;
    tax_amount: number;
    tax_breakdown?: TaxBreakdownItem[];
    withholding_breakdown?: WithholdingLine[];
    discount_amount?: number;
    total_amount: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'credit_sales'))) return;
      await this.auto_entry_service.onCreditSaleCreated({
        order_id: event.order_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        order_number: event.order_number,
        subtotal_amount: Number(event.subtotal_amount),
        tax_amount: Number(event.tax_amount),
        tax_breakdown: event.tax_breakdown,
        withholding_breakdown: event.withholding_breakdown,
        discount_amount:
          event.discount_amount != null
            ? Number(event.discount_amount)
            : undefined,
        total_amount: Number(event.total_amount),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for credit_sale.created order #${event.order_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for credit_sale.created order #${event.order_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('expense.approved')
  async handleExpenseApproved(event: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    user_id?: number;
  }) {
    try {
      // Pass organization_id so platform-scoped expenses (store_id null, e.g.
      // vendor support documents) resolve the fiscal gate instead of falling
      // back to org_id=0 and being silently skipped.
      if (
        !(await this.isFlowEnabled(
          event.store_id,
          'expenses',
          event.organization_id,
        ))
      )
        return;
      await this.auto_entry_service.onExpenseApproved({
        expense_id: event.expense_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for expense.approved #${event.expense_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for expense.approved #${event.expense_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('expense.paid')
  async handleExpensePaid(event: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'expenses'))) return;
      await this.auto_entry_service.onExpensePaid({
        expense_id: event.expense_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for expense.paid #${event.expense_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for expense.paid #${event.expense_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // NOTA: no existe un handler @OnEvent('payroll.approved'). El evento
  // EventEmitter2 `payroll.approved` NUNCA se emite — `PayrollFlowService.approve()`
  // solo estampa `approved_by`/`approved_at` sin emitir (ver payroll-flow.service.spec).
  // La causación fiscal entra por `payroll.dian_accepted` (ruta electrónica) y el
  // pago por `payroll.paid`. Ojo: el string `payroll.approved` SÍ sigue vivo como
  // `source_type` persistido y prefijo de mapping keys en auto-entry.service.ts /
  // account-mapping.service.ts (naming histórico, igual que invoice.accepted vs
  // source_type 'invoice.validated'); no confundir el nombre del evento con esos.
  @OnEvent('payroll.dian_accepted')
  async handlePayrollDianAccepted(event: {
    payroll_run_id: number;
    organization_id: number;
    store_id?: number;
    accounting_entity_id?: number;
    total_earnings: number;
    total_employer_costs: number;
    total_deductions: number;
    total_net_pay: number;
    health_deduction: number;
    pension_deduction: number;
    /** B1: suma de retenciones laborales (retefuente del empleado). */
    total_retention?: number;
    approved_by: number;
    cost_center_breakdown?: Record<
      string,
      { earnings: number; employer_costs: number }
    >;
  }) {
    await this.createPayrollAcceptedEntry(event);
  }

  private async createPayrollAcceptedEntry(event: {
    payroll_run_id: number;
    organization_id: number;
    store_id?: number;
    accounting_entity_id?: number;
    total_earnings: number;
    total_employer_costs: number;
    total_deductions: number;
    total_net_pay: number;
    health_deduction: number;
    pension_deduction: number;
    /** B1: suma de retenciones laborales (retefuente del empleado). */
    total_retention?: number;
    approved_by: number;
    cost_center_breakdown?: Record<
      string,
      { earnings: number; employer_costs: number }
    >;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'payroll'))) return;
      await this.auto_entry_service.onPayrollApproved({
        payroll_run_id: event.payroll_run_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        accounting_entity_id: event.accounting_entity_id,
        total_earnings: Number(event.total_earnings),
        total_employer_costs: Number(event.total_employer_costs),
        total_deductions: Number(event.total_deductions),
        total_net_pay: Number(event.total_net_pay),
        health_deduction: Number(event.health_deduction),
        pension_deduction: Number(event.pension_deduction),
        total_retention:
          event.total_retention !== undefined
            ? Number(event.total_retention)
            : undefined,
        user_id: event.approved_by,
        cost_center_breakdown: event.cost_center_breakdown,
      });
      this.logger.log(
        `Auto-entry created for payroll.approved #${event.payroll_run_id} (consolidated)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for payroll.approved #${event.payroll_run_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('payroll.paid')
  async handlePayrollPaid(event: {
    payroll_run_id: number;
    organization_id: number;
    store_id?: number;
    user_id?: number;
    payroll_items: Array<{
      payroll_item_id: number;
      employee_id: number;
      cost_center: string;
      /** C4-followup: propagado desde payroll-flow.service.ts (item.employee). */
      employee_name?: string;
      employee_document?: string;
      earnings: any;
      deductions: any;
      employer_costs: any;
      provisions: any;
      net_pay: number;
    }>;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'payroll'))) return;
      await this.auto_entry_service.onPayrollPaid({
        payroll_run_id: event.payroll_run_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        user_id: event.user_id,
        payroll_items: event.payroll_items ?? [],
      });
      this.logger.log(
        `Auto-entries created for payroll.paid #${event.payroll_run_id} (${event.payroll_items?.length ?? 0} employees)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entries for payroll.paid #${event.payroll_run_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('order.completed')
  async handleOrderCompleted(event: {
    order_id: number;
    order_number: string;
    organization_id: number;
    store_id?: number;
    total_cost: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'inventory'))) return;
      await this.auto_entry_service.onOrderCompleted({
        order_id: event.order_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        total_cost: Number(event.total_cost),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for order.completed #${event.order_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for order.completed #${event.order_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('production.completed')
  async handleProductionCompleted(event: {
    production_order_id: number;
    organization_id: number;
    store_id?: number;
    product_name: string;
    produced_qty: number;
    produced_unit_cost: number;
    total_cost: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'inventory'))) return;
      await this.auto_entry_service.onProductionCompleted({
        production_order_id: event.production_order_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        product_name: event.product_name,
        produced_qty: Number(event.produced_qty),
        produced_unit_cost: Number(event.produced_unit_cost),
        total_cost: Number(event.total_cost),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for production.completed #${event.production_order_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for production.completed #${event.production_order_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('kitchen.fired')
  async handleKitchenFired(event: {
    kitchen_ticket_id: number;
    order_id: number;
    organization_id: number;
    store_id?: number;
    total_cost: number;
    consumed_line_count: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'inventory'))) return;
      await this.auto_entry_service.onKitchenFired({
        kitchen_ticket_id: event.kitchen_ticket_id,
        order_id: event.order_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        total_cost: Number(event.total_cost),
        consumed_line_count: Number(event.consumed_line_count),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for kitchen.fired ticket #${event.kitchen_ticket_id} (order #${event.order_id})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for kitchen.fired #${event.kitchen_ticket_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('refund.completed')
  async handleRefundCompleted(event: {
    refund_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    tax_amount?: number;
    tax_breakdown?: TaxBreakdownItem[];
    return_type?: string;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'returns'))) return;
      await this.auto_entry_service.onRefundCompleted({
        refund_id: event.refund_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        tax_amount:
          event.tax_amount != null ? Number(event.tax_amount) : undefined,
        tax_breakdown: event.tax_breakdown,
        return_type: event.return_type,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for refund.completed #${event.refund_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for refund.completed #${event.refund_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('purchase_order.received')
  async handlePurchaseOrderReceived(event: {
    purchase_order_id: number;
    /**
     * D2: id of the specific `purchase_order_receptions` row that triggered
     * this event. Used as the auto-entry `source_id` (NOT purchase_order_id)
     * so each partial reception of the same order gets its own idempotency
     * key instead of being skipped as a duplicate of the first.
     */
    reception_id: number;
    organization_id: number;
    store_id?: number;
    /** F2: entidad fiscal resuelta por el emisor (propagación explícita). */
    accounting_entity_id?: number;
    total_amount: number;
    user_id?: number;
    /** C4-followup: propagado desde purchase-orders.service.ts (updated_po.suppliers). */
    supplier?: { id: number; name?: string; tax_id?: string };
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'purchases'))) return;
      await this.auto_entry_service.onPurchaseOrderReceived({
        purchase_order_id: event.purchase_order_id,
        reception_id: event.reception_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        accounting_entity_id: event.accounting_entity_id,
        total_amount: Number(event.total_amount),
        user_id: event.user_id,
        supplier: event.supplier,
      });
      this.logger.log(
        `Auto-entry created for purchase_order.received #${event.purchase_order_id} (reception #${event.reception_id})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for purchase_order.received #${event.purchase_order_id} (reception #${event.reception_id}): ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * F2 IVA lifecycle — VAT-only recognition of a POP purchase's deductible VAT.
   * The purchase-orders service already materialized the fiscal document
   * (`invoices` row that feeds calculateVat) and emitted this event carrying
   * its `invoice_id`. Here we only post the ledger complement DR 240804 / CR
   * 2205 (see AutoEntryService.onPurchaseVatRecognized). Gated by the same
   * `purchases` subflow as purchase_order.received. Accounting failures are
   * logged and never roll back the already-completed reception.
   */
  @OnEvent('purchase.vat_recognized')
  async handlePurchaseVatRecognized(event: {
    invoice_id: number;
    purchase_order_id: number;
    reception_id: number;
    organization_id: number;
    store_id?: number;
    accounting_entity_id?: number;
    iva_amount: number;
    supplier?: { id: number; name?: string; tax_id?: string };
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'purchases'))) return;
      await this.auto_entry_service.onPurchaseVatRecognized({
        invoice_id: event.invoice_id,
        purchase_order_id: event.purchase_order_id,
        reception_id: event.reception_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        accounting_entity_id: event.accounting_entity_id,
        iva_amount: Number(event.iva_amount),
        supplier: event.supplier,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for purchase.vat_recognized invoice #${event.invoice_id} (PO #${event.purchase_order_id})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for purchase.vat_recognized invoice #${event.invoice_id} (PO #${event.purchase_order_id}): ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('purchase_order.payment')
  async handlePurchaseOrderPayment(event: {
    purchase_order_id: number;
    organization_id: number;
    amount: number;
    payment_method: string;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled((event as any).store_id, 'purchases')))
        return;
      await this.auto_entry_service.onPurchaseOrderPayment({
        purchase_order_id: event.purchase_order_id,
        organization_id: event.organization_id,
        amount: Number(event.amount),
        payment_method: event.payment_method,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for purchase_order.payment PO #${event.purchase_order_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for purchase_order.payment PO #${event.purchase_order_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('inventory.adjusted')
  async handleInventoryAdjusted(event: {
    adjustment_id: number;
    organization_id: number;
    store_id?: number;
    cost_amount: number;
    quantity_change: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'inventory'))) return;
      await this.auto_entry_service.onInventoryAdjusted({
        adjustment_id: event.adjustment_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        cost_amount: Number(event.cost_amount),
        quantity_change: Number(event.quantity_change),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for inventory.adjusted #${event.adjustment_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for inventory.adjusted #${event.adjustment_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== LAYAWAY (PLAN SEPARÉ) =====

  @OnEvent('layaway.payment_received')
  async handleLayawayPaymentReceived(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    payment_id: number;
    amount: number;
    customer_id: number;
    payment_method?: string;
    organization_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'layaway'))) return;
      const organization_id =
        event.organization_id || (await this.resolveOrgId(event.store_id));
      await this.auto_entry_service.onLayawayPaymentReceived({
        payment_id: event.payment_id,
        plan_number: event.plan_number,
        organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        payment_method: event.payment_method,
      });
      this.logger.log(
        `Auto-entry created for layaway.payment_received - plan ${event.plan_number}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for layaway.payment_received - plan ${event.plan_number}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('layaway.completed')
  async handleLayawayCompleted(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    customer_id: number;
    total_amount: any;
    organization_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'layaway'))) return;
      const organization_id =
        event.organization_id || (await this.resolveOrgId(event.store_id));
      await this.auto_entry_service.onLayawayCompleted({
        plan_id: event.plan_id,
        plan_number: event.plan_number,
        organization_id,
        store_id: event.store_id,
        total_amount: Number(event.total_amount),
      });
      this.logger.log(
        `Auto-entry created for layaway.completed - plan ${event.plan_number}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for layaway.completed - plan ${event.plan_number}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('layaway.cancelled')
  async handleLayawayCancelled(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    customer_id?: number;
    total_paid?: number;
    refund_amount?: number;
    cancellation_fee?: number;
    refund_method?: string;
    organization_id?: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'layaway'))) return;
      const organization_id =
        event.organization_id || (await this.resolveOrgId(event.store_id));
      await this.auto_entry_service.onLayawayCancelled({
        plan_id: event.plan_id,
        plan_number: event.plan_number,
        organization_id,
        store_id: event.store_id,
        total_paid: Number(event.total_paid || 0),
        refund_amount: Number(event.refund_amount || 0),
        cancellation_fee: Number(event.cancellation_fee || 0),
        refund_method: event.refund_method,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for layaway.cancelled - plan ${event.plan_number}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for layaway.cancelled - plan ${event.plan_number}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== CREDIT INSTALLMENT PAYMENTS =====

  @OnEvent('installment_payment.received')
  async handleInstallmentPaymentReceived(event: {
    credit_id: number;
    installment_id: number;
    payment_id: number;
    amount: number;
    store_id: number;
    store_payment_method_id?: number;
    credit_number: string;
    installment_number: number;
    customer_id: number;
    order_id: number;
    organization_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'installments'))) return;
      const organization_id =
        event.organization_id || (await this.resolveOrgId(event.store_id));
      await this.auto_entry_service.onInstallmentPaymentReceived({
        credit_id: event.credit_id,
        installment_id: event.installment_id,
        payment_id: event.payment_id,
        amount: Number(event.amount),
        store_id: event.store_id,
        organization_id,
        store_payment_method_id: event.store_payment_method_id,
        credit_number: event.credit_number,
        installment_number: event.installment_number,
        customer_id: event.customer_id,
        order_id: event.order_id,
      });
      this.logger.log(
        `Auto-entry created for installment_payment.received - Credit ${event.credit_number} cuota #${event.installment_number}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for installment_payment.received - Credit ${event.credit_number}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== PAYROLL SETTLEMENTS =====

  /**
   * settlement.approved (DEVENGO): causa el COSTO laboral de la liquidación
   * (gasto/provisiones) contra el pasivo 2505. El pago posterior SOLO drena
   * 2505 (ver handleSettlementPaid) → approved + paid juntos NO duplican el
   * gasto. Idempotente: createAutoEntry deduplica por source_type/source_id,
   * por lo que un re-emit de settlement.approved es un no-op.
   */
  @OnEvent('settlement.approved')
  async handleSettlementApproved(event: {
    settlement_id: number;
    settlement_number?: string;
    organization_id: number;
    store_id?: number;
    accounting_entity_id?: number;
    employee_id?: number;
    employee_name?: string;
    severance?: number;
    severance_interest?: number;
    bonus?: number;
    vacation?: number;
    pending_salary?: number;
    indemnification?: number;
    net_settlement?: number;
    approved_by?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'settlements'))) return;
      await this.auto_entry_service.onSettlementApproved({
        settlement_id: event.settlement_id,
        settlement_number: event.settlement_number ?? `#${event.settlement_id}`,
        organization_id: event.organization_id,
        store_id: event.store_id,
        accounting_entity_id: event.accounting_entity_id,
        employee_name: event.employee_name ?? '',
        severance: Number(event.severance || 0),
        severance_interest: Number(event.severance_interest || 0),
        bonus: Number(event.bonus || 0),
        vacation: Number(event.vacation || 0),
        pending_salary: Number(event.pending_salary || 0),
        indemnification: Number(event.indemnification || 0),
        user_id: event.approved_by,
      });
      this.logger.log(
        `Auto-entry (accrual) created for settlement.approved #${event.settlement_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for settlement.approved #${event.settlement_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('settlement.paid')
  async handleSettlementPaid(event: {
    settlement_id: number;
    settlement_number: string;
    organization_id: number;
    store_id?: number;
    employee_name: string;
    severance: number;
    severance_interest: number;
    bonus: number;
    vacation: number;
    pending_salary: number;
    indemnification: number;
    health_deduction: number;
    pension_deduction: number;
    net_settlement: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'settlements'))) return;
      await this.auto_entry_service.onSettlementPaid({
        settlement_id: event.settlement_id,
        settlement_number: event.settlement_number,
        organization_id: event.organization_id,
        store_id: event.store_id,
        employee_name: event.employee_name,
        severance: Number(event.severance),
        severance_interest: Number(event.severance_interest),
        bonus: Number(event.bonus),
        vacation: Number(event.vacation),
        pending_salary: Number(event.pending_salary),
        indemnification: Number(event.indemnification),
        health_deduction: Number(event.health_deduction),
        pension_deduction: Number(event.pension_deduction),
        net_settlement: Number(event.net_settlement),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for settlement.paid ${event.settlement_number}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for settlement.paid ${event.settlement_number}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== FIXED ASSETS - DEPRECIATION =====

  @OnEvent('depreciation.posted')
  async handleDepreciationPosted(event: {
    asset_id: number;
    asset_number: string;
    organization_id: number;
    store_id?: number;
    amount: number;
    period_date: Date;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'fixed_assets'))) return;
      await this.auto_entry_service.onDepreciationPosted({
        asset_id: event.asset_id,
        asset_number: event.asset_number,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        period_date: new Date(event.period_date),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for depreciation.posted - asset ${event.asset_number}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for depreciation.posted - asset ${event.asset_number}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('disposal.fixed_asset')
  async handleFixedAssetDisposed(event: {
    asset_id: number;
    asset_number: string;
    organization_id: number;
    store_id?: number;
    acquisition_cost: number;
    accumulated_depreciation: number;
    disposal_amount: number;
    book_value: number;
    gain_loss: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'fixed_assets'))) return;
      await this.auto_entry_service.onFixedAssetDisposed({
        asset_id: event.asset_id,
        asset_number: event.asset_number,
        organization_id: event.organization_id,
        store_id: event.store_id,
        acquisition_cost: Number(event.acquisition_cost),
        accumulated_depreciation: Number(event.accumulated_depreciation),
        disposal_amount: Number(event.disposal_amount),
        book_value: Number(event.book_value),
        gain_loss: Number(event.gain_loss),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for disposal.fixed_asset - asset ${event.asset_number}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for disposal.fixed_asset - asset ${event.asset_number}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== WITHHOLDING TAX (Retención en la Fuente) =====

  @OnEvent('withholding.applied')
  async handleWithholdingApplied(event: {
    organization_id: number;
    store_id?: number;
    invoice_id: number;
    base_amount: number;
    withholding_amount: number;
    net_amount: number;
    concept_name: string;
    supplier_name: string;
    withholding_breakdown?: WithholdingLine[];
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'withholding'))) return;
      await this.auto_entry_service.onWithholdingApplied({
        organization_id: event.organization_id,
        store_id: event.store_id,
        invoice_id: event.invoice_id,
        base_amount: Number(event.base_amount),
        withholding_amount: Number(event.withholding_amount),
        net_amount: Number(event.net_amount),
        concept_name: event.concept_name,
        supplier_name: event.supplier_name,
        withholding_breakdown: event.withholding_breakdown,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for withholding.applied - invoice #${event.invoice_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create withholding auto-entry: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== STOCK TRANSFERS =====

  @OnEvent('stock_transfer.completed')
  async handleStockTransferCompleted(event: {
    transfer_id: number;
    transfer_number: string;
    organization_id: number;
    store_id?: number;
    from_store_id?: number;
    to_store_id?: number;
    from_location_id: number;
    to_location_id: number;
    total_cost: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'stock_transfers'))) {
        this.logger.debug(
          `Skipping stock_transfer.completed auto-entry #${event.transfer_id}: stock_transfers accounting flow disabled for store=${event.store_id ?? 'n/a'}`,
        );
        return;
      }
      await this.auto_entry_service.onStockTransferCompleted({
        transfer_id: event.transfer_id,
        transfer_number: event.transfer_number,
        organization_id: event.organization_id,
        store_id: event.store_id,
        from_store_id: event.from_store_id,
        to_store_id: event.to_store_id,
        from_location_id: event.from_location_id,
        to_location_id: event.to_location_id,
        total_cost: Number(event.total_cost),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for stock_transfer.completed #${event.transfer_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for stock_transfer.completed #${event.transfer_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== DISPATCH NOTES (remisiones bidireccionales — Fase 4) =====

  /**
   * COGS de una remisión de salida STANDALONE (sin orden ni sales_order). El
   * stock listener sólo emite este evento cuando la remisión no está ligada a
   * una orden/SO (esas reconocen COGS vía order.completed) — aquí no hay que
   * re-gatear el anti-doble-COGS. total_cost es el costo REAL devuelto por
   * commitDispatchDelivery.
   */
  @OnEvent('dispatch_note.accounting.cogs')
  async handleDispatchNoteCogs(event: {
    dispatch_note_id: number;
    dispatch_number: string;
    organization_id: number;
    store_id?: number;
    total_cost: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'inventory'))) return;
      await this.auto_entry_service.onDispatchNoteDelivered({
        dispatch_note_id: event.dispatch_note_id,
        dispatch_number: event.dispatch_number,
        organization_id: event.organization_id,
        store_id: event.store_id,
        total_cost: Number(event.total_cost),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for dispatch_note.delivered #${event.dispatch_note_id} (COGS)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for dispatch_note.delivered #${event.dispatch_note_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Entrada de inventario de una remisión de entrada: purchase_receipt
   * (DR inventario / CR proveedores) o customer_return (DR inventario /
   * CR reversa COGS). transfer_in NO emite este evento (diferido).
   */
  @OnEvent('dispatch_note.accounting.received')
  async handleDispatchNoteReceived(event: {
    dispatch_note_id: number;
    dispatch_number: string;
    organization_id: number;
    store_id?: number;
    subtype: string;
    total_cost: number;
    user_id?: number;
    supplier?: { id: number; name?: string; tax_id?: string };
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'inventory'))) return;
      await this.auto_entry_service.onDispatchNoteReceived({
        dispatch_note_id: event.dispatch_note_id,
        dispatch_number: event.dispatch_number,
        organization_id: event.organization_id,
        store_id: event.store_id,
        subtype: event.subtype,
        total_cost: Number(event.total_cost),
        user_id: event.user_id,
        supplier: event.supplier,
      });
      this.logger.log(
        `Auto-entry created for dispatch_note.received #${event.dispatch_note_id} (${event.subtype})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for dispatch_note.received #${event.dispatch_note_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Reversa contable al anular una remisión ya materializada. Sólo llega para
   * los casos cuyo asiento original posteó este módulo (customer_delivery
   * standalone, purchase_receipt, customer_return). Postea el asiento espejo
   * (débito↔crédito invertidos) con source_type='dispatch_note.void'.
   */
  @OnEvent('dispatch_note.accounting.void')
  async handleDispatchNoteVoid(event: {
    dispatch_note_id: number;
    dispatch_number: string;
    organization_id: number;
    store_id?: number;
    direction: string;
    subtype: string;
    total_cost: number;
    user_id?: number;
    supplier?: { id: number; name?: string; tax_id?: string };
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'inventory'))) return;
      await this.auto_entry_service.onDispatchNoteVoided({
        dispatch_note_id: event.dispatch_note_id,
        dispatch_number: event.dispatch_number,
        organization_id: event.organization_id,
        store_id: event.store_id,
        direction: event.direction,
        subtype: event.subtype,
        total_cost: Number(event.total_cost),
        user_id: event.user_id,
        supplier: event.supplier,
      });
      this.logger.log(
        `Auto-entry created for dispatch_note.void #${event.dispatch_note_id} (${event.direction}/${event.subtype})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for dispatch_note.void #${event.dispatch_note_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== CASH REGISTER =====

  @OnEvent('cash_register.opened')
  async handleCashRegisterOpened(event: {
    session_id: number;
    store_id: number;
    organization_id: number;
    opening_amount: number;
    user_id: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'cash_register'))) return;
      await this.auto_entry_service.onCashRegisterOpened({
        session_id: event.session_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        opening_amount: Number(event.opening_amount),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for cash_register.opened session #${event.session_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for cash_register.opened session #${event.session_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('cash_register.closed')
  async handleCashRegisterClosed(event: {
    session_id: number;
    store_id: number;
    organization_id: number;
    expected_amount: number;
    actual_amount: number;
    difference: number;
    user_id: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'cash_register'))) return;
      await this.auto_entry_service.onCashRegisterClosed({
        session_id: event.session_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        expected_amount: Number(event.expected_amount),
        actual_amount: Number(event.actual_amount),
        difference: Number(event.difference),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for cash_register.closed session #${event.session_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for cash_register.closed session #${event.session_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('cash_register.movement')
  async handleCashRegisterMovement(event: {
    movement_id: number;
    session_id: number;
    store_id: number;
    organization_id: number;
    type: 'cash_in' | 'cash_out';
    amount: number;
    reference?: string;
    notes?: string;
    user_id: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'cash_register'))) return;
      await this.auto_entry_service.onCashRegisterMovement({
        movement_id: event.movement_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        type: event.type,
        amount: Number(event.amount),
        reference: event.reference,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for cash_register.movement #${event.movement_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for cash_register.movement #${event.movement_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== DISPATCH ROUTES (PLANILLAS DSD) =====

  /**
   * dispatch_route.closed — contabiliza SOLO el cuadre de efectivo
   * (cash_variance) del conductor al cerrar la planilla. El recaudo y las
   * retenciones por parada ya se contabilizan al liquidar cada parada vía
   * payment.received / withholding; este handler NO los re-contabiliza.
   */
  @OnEvent('dispatch_route.closed')
  async handleDispatchRouteClosed(event: {
    route_id: number;
    route_number: string;
    store_id: number;
    organization_id?: number;
    cash_variance?: number;
    driver_user_id?: number;
    driver_label?: string;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'cash_register'))) return;
      const organization_id =
        event.organization_id || (await this.resolveOrgId(event.store_id));
      await this.auto_entry_service.onDispatchRouteClosed({
        route_id: event.route_id,
        route_number: event.route_number,
        organization_id,
        store_id: event.store_id,
        cash_variance: Number(event.cash_variance || 0),
        driver_user_id: event.driver_user_id,
        driver_label: event.driver_label,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry processed for dispatch_route.closed route ${event.route_number}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for dispatch_route.closed route ${event.route_number}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== ACCOUNTS RECEIVABLE =====

  @OnEvent('ar.written_off')
  async handleArWrittenOff(event: {
    ar_id: number;
    store_id: number;
    organization_id: number;
    customer_id: number;
    amount: number;
    document_number?: string;
    user_id: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'ar_ap'))) return;
      await this.auto_entry_service.onArWrittenOff({
        ar_id: event.ar_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        document_number: event.document_number,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for ar.written_off AR #${event.ar_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for ar.written_off AR #${event.ar_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== ACCOUNTS PAYABLE =====

  @OnEvent('ap.payment_registered')
  async handleApPaymentRegistered(event: {
    ap_id: number;
    organization_id: number;
    store_id: number;
    supplier_id: number;
    amount: number;
    payment_method?: string;
    document_number?: string;
    user_id: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'ar_ap'))) return;
      await this.auto_entry_service.onApPaymentRegistered({
        ap_id: event.ap_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        payment_method: event.payment_method,
        document_number: event.document_number,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for ap.payment_registered AP #${event.ap_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for ap.payment_registered AP #${event.ap_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('ap.written_off')
  async handleApWrittenOff(event: {
    ap_id: number;
    organization_id: number;
    store_id: number;
    supplier_id: number;
    amount: number;
    document_number?: string;
    user_id: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'ar_ap'))) return;
      await this.auto_entry_service.onApWrittenOff({
        ap_id: event.ap_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        document_number: event.document_number,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for ap.written_off AP #${event.ap_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for ap.written_off AP #${event.ap_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== COMMISSIONS =====

  @OnEvent('commission.calculated')
  async handleCommissionCalculated(event: {
    store_id: number;
    organization_id: number;
    payment_id: number;
    commission_amount: number;
    rule_id: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'commissions'))) return;
      await this.auto_entry_service.onCommissionCalculated({
        payment_id: event.payment_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        commission_amount: Number(event.commission_amount),
        rule_id: event.rule_id,
      });
      this.logger.log(
        `Auto-entry created for commission.calculated payment #${event.payment_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for commission.calculated payment #${event.payment_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== WALLET =====

  @OnEvent('wallet.credited')
  async handleWalletCredited(event: {
    wallet_id: number;
    store_id: number;
    organization_id: number;
    amount: number;
    reference_type: string;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'wallet'))) return;
      await this.auto_entry_service.onWalletCredited({
        wallet_id: event.wallet_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        reference_type: event.reference_type,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for wallet.credited wallet #${event.wallet_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for wallet.credited wallet #${event.wallet_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('wallet.debited')
  async handleWalletDebited(event: {
    wallet_id: number;
    store_id: number;
    organization_id: number;
    amount: number;
    reference_type: string;
    order_id?: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'wallet'))) return;
      await this.auto_entry_service.onWalletDebited({
        wallet_id: event.wallet_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        reference_type: event.reference_type,
        order_id: event.order_id,
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for wallet.debited wallet #${event.wallet_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for wallet.debited wallet #${event.wallet_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('expense.refunded')
  async handleExpenseRefunded(event: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'expenses'))) return;
      await this.auto_entry_service.onExpenseRefunded({
        expense_id: event.expense_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for expense.refunded #${event.expense_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for expense.refunded #${event.expense_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('expense.cancelled')
  async handleExpenseCancelled(event: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    user_id?: number;
  }) {
    try {
      if (!(await this.isFlowEnabled(event.store_id, 'expenses'))) return;
      await this.auto_entry_service.onExpenseCancelled({
        expense_id: event.expense_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for expense.cancelled #${event.expense_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for expense.cancelled #${event.expense_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  private async resolveOrgId(store_id: number): Promise<number> {
    const store = await this.auto_entry_service['prisma'].stores.findUnique({
      where: { id: store_id },
      select: { organization_id: true },
    });
    return store?.organization_id || 0;
  }

  /**
   * RNC-31 — Double accounting entry on a successful SaaS subscription
   * payment.
   *
   *   Store-cliente side  : DR 5135xx (SaaS expense)
   *                         CR 1110xx (cash/bank)
   *
   *   Vendix-platform side: DR 1110xx (cash/bank)
   *                         CR 4135xx (SaaS revenue)            -> vendix_share
   *                         CR 2335xx (partner payable)         -> partner_share (if any)
   *
   * Account codes are NOT hard-coded — they are resolved via
   * AccountMappingService against the new keys:
   *   - saas_subscription_expense.expense        (DR, store side)
   *   - saas_subscription_expense.cash_bank      (CR, store side)
   *   - saas_revenue.cash_bank                   (DR, platform side)
   *   - saas_revenue.revenue                     (CR vendix_share)
   *   - saas_revenue.partner_payable             (CR partner_share, optional)
   *
   * Idempotency
   * -----------
   * Source uniqueness is `(source_type, source_id)` where source_id is the
   * `subscription_payment.id`. Two calls with the same payment id will
   * collide on AutoEntryService's entry-number / source-id constraint and
   * fail to create a duplicate row, satisfying the RNC-31 dedup contract.
   *
   * Failure isolation: each side runs in its own try/catch — a missing
   * mapping on the platform side must NOT block the store-side expense, and
   * vice versa.
   */
  @OnEvent('accounting.saas_subscription_payment.succeeded')
  async handleSaasSubscriptionPaymentSucceeded(event: {
    invoiceId: number;
    invoiceNumber?: string;
    paymentId: number;
    subscriptionId?: number;
    dedupKey: number;
    entryDate: Date | string;
    currency?: string;
    store: {
      organization_id: number;
      store_id: number;
      amount: number;
    };
    platform: {
      organization_id: number;
      amount_total: number;
      vendix_share: number;
      partner_share: number;
      partner_organization_id: number | null;
    } | null;
  }) {
    const entryDate =
      event.entryDate instanceof Date
        ? event.entryDate
        : new Date(event.entryDate);
    const description = `Pago suscripción SaaS — Factura ${event.invoiceNumber ?? `#${event.invoiceId}`}`;

    // ── Store-cliente side: SaaS expense ────────────────────────────────
    if (
      (await this.isFlowEnabled(event.store.store_id, 'expenses')) &&
      event.store.amount > 0
    ) {
      try {
        const lines = await Promise.all([
          this.resolveSaasLine(
            event.store.organization_id,
            'saas_subscription_expense.expense',
            'Gasto suscripción SaaS Vendix',
            event.store.amount,
            0,
            event.store.store_id,
          ),
          this.resolveSaasLine(
            event.store.organization_id,
            'saas_subscription_expense.cash_bank',
            'Pago a Vendix (suscripción)',
            0,
            event.store.amount,
            event.store.store_id,
          ),
        ]);

        await this.auto_entry_service.createAutoEntry({
          source_type: 'saas_subscription_expense',
          source_id: event.dedupKey,
          organization_id: event.store.organization_id,
          store_id: event.store.store_id,
          entry_date: entryDate,
          description,
          lines,
        });

        this.logger.log(
          `Auto-entry (store side) created for saas_subscription_expense ` +
            `payment=${event.paymentId} invoice=${event.invoiceId}`,
        );
      } catch (error: any) {
        this.logger.error(
          `Failed store-side auto-entry for SaaS payment #${event.paymentId}: ${error?.message ?? error}`,
          error?.stack,
        );
      }
    }

    // ── Vendix-platform side: SaaS revenue (+ partner payable split) ───
    if (event.platform && event.platform.amount_total > 0) {
      try {
        const lines: (AutoEntryLine | null)[] = [
          await this.resolveSaasLine(
            event.platform.organization_id,
            'saas_revenue.cash_bank',
            'Cobro suscripción SaaS',
            event.platform.amount_total,
            0,
          ),
          await this.resolveSaasLine(
            event.platform.organization_id,
            'saas_revenue.revenue',
            'Ingreso suscripción SaaS',
            0,
            event.platform.vendix_share,
          ),
        ];

        if (event.platform.partner_share > 0) {
          lines.push(
            await this.resolveSaasLine(
              event.platform.organization_id,
              'saas_revenue.partner_payable',
              `Comisión partner ${event.platform.partner_organization_id ?? ''}`.trim(),
              0,
              event.platform.partner_share,
            ),
          );
        }

        await this.auto_entry_service.createAutoEntry({
          source_type: 'saas_revenue',
          source_id: event.dedupKey,
          organization_id: event.platform.organization_id,
          entry_date: entryDate,
          description,
          lines,
        });

        this.logger.log(
          `Auto-entry (platform side) created for saas_revenue ` +
            `payment=${event.paymentId} invoice=${event.invoiceId} ` +
            `vendix_share=${event.platform.vendix_share} partner_share=${event.platform.partner_share}`,
        );
      } catch (error: any) {
        this.logger.error(
          `Failed platform-side auto-entry for SaaS payment #${event.paymentId}: ${error?.message ?? error}`,
          error?.stack,
        );
      }
    }
  }

  // ===== SAAS PLATFORM AUTO-ENTRY HANDLERS (RNC-MF-3) =====
  // These three listeners post journal entries against the Vendix platform
  // organization. The platform org is resolved via PlatformOrgService; when
  // the platform org is not bootstrapped (null context), the listener is a
  // no-op that logs a warning — the SaaS business flow must never fail because
  // of a missing platform accounting target.
  //
  // All three handlers share the same idempotency contract as the existing
  // SaaS succeeded handler: `source_id` is the business entity id (refund,
  // payment, or batch) and `createAutoEntry` guards on
  // `(source_type, source_id)` so redeliveries never produce a second entry.

  private async resolvePlatformOrgForSaasEntry(): Promise<number | null> {
    try {
      const ctx = await this.platform_org_service.getPlatformContext();
      return ctx?.organization_id ?? null;
    } catch (err: any) {
      this.logger.warn(
        `Failed to resolve platform org for SaaS auto-entry: ${err?.message ?? err}`,
      );
      return null;
    }
  }

  @OnEvent('subscription.payment.refunded')
  async handleSaasPaymentRefunded(event: {
    refundEventId: number;
    amount: number;
    entryDate: Date | string;
    userId?: number;
  }) {
    try {
      const platform_org_id = await this.resolvePlatformOrgForSaasEntry();
      if (!platform_org_id) {
        this.logger.warn(
          `Skipping saas_refund auto-entry for refund=${event.refundEventId}: platform org not bootstrapped`,
        );
        return;
      }

      const entryDate =
        event.entryDate instanceof Date
          ? event.entryDate
          : new Date(event.entryDate);

      await this.auto_entry_service.onSaasRefund({
        refund_event_id: event.refundEventId,
        organization_id: platform_org_id,
        amount: Number(event.amount),
        entry_date: entryDate,
        user_id: event.userId,
      });

      this.logger.log(
        `Auto-entry (saas_refund) created for refund=${event.refundEventId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to create auto-entry for subscription.payment.refunded #${event.refundEventId}: ${error?.message ?? error}`,
        error?.stack,
      );
    }
  }

  @OnEvent('subscription.payment.failed')
  async handleSaasPaymentFailed(event: {
    paymentId: number;
    amount: number;
    entryDate: Date | string;
    userId?: number;
  }) {
    try {
      const platform_org_id = await this.resolvePlatformOrgForSaasEntry();
      if (!platform_org_id) {
        this.logger.warn(
          `Skipping saas_bad_debt auto-entry for payment=${event.paymentId}: platform org not bootstrapped`,
        );
        return;
      }

      const entryDate =
        event.entryDate instanceof Date
          ? event.entryDate
          : new Date(event.entryDate);

      await this.auto_entry_service.onSaasPaymentFailed({
        payment_id: event.paymentId,
        organization_id: platform_org_id,
        amount: Number(event.amount),
        entry_date: entryDate,
        user_id: event.userId,
      });

      this.logger.log(
        `Auto-entry (saas_bad_debt) created for payment=${event.paymentId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to create auto-entry for subscription.payment.failed #${event.paymentId}: ${error?.message ?? error}`,
        error?.stack,
      );
    }
  }

  @OnEvent('partner_payout_batch.paid')
  async handlePartnerPayoutPaid(event: {
    batchId: number;
    amount: number;
    entryDate: Date | string;
    userId?: number;
  }) {
    try {
      const platform_org_id = await this.resolvePlatformOrgForSaasEntry();
      if (!platform_org_id) {
        this.logger.warn(
          `Skipping saas_partner_payout auto-entry for batch=${event.batchId}: platform org not bootstrapped`,
        );
        return;
      }

      const entryDate =
        event.entryDate instanceof Date
          ? event.entryDate
          : new Date(event.entryDate);

      await this.auto_entry_service.onPartnerPayoutPaid({
        batch_id: event.batchId,
        organization_id: platform_org_id,
        amount: Number(event.amount),
        entry_date: entryDate,
        user_id: event.userId,
      });

      this.logger.log(
        `Auto-entry (saas_partner_payout) created for batch=${event.batchId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to create auto-entry for partner_payout_batch.paid #${event.batchId}: ${error?.message ?? error}`,
        error?.stack,
      );
    }
  }

  /**
   * F5 (paso 17) — Liquidación de IVA al aprobar la declaración `vat`. El
   * evento lo emite TaxDeclarationDraftService.approveDraft con el período AÚN
   * abierto, así que el asiento (fechado en period_end) no choca con el guard
   * FISCAL_PERIOD_CLOSED. Gated por el área `accounting` (resolveArea cae a
   * 'accounting' para subflows desconocidos). Los fallos se loguean y NUNCA
   * revierten la aprobación de la declaración.
   */
  @OnEvent('vat.declaration.approved')
  async handleVatDeclarationApproved(event: {
    declaration_id: number;
    organization_id: number;
    store_id?: number | null;
    accounting_entity_id?: number;
    generated_tax_amount: number;
    deductible_tax_amount: number;
    period_end: Date | string;
    user_id?: number;
  }) {
    try {
      if (
        !(await this.isFlowEnabled(
          event.store_id ?? undefined,
          'accounting',
          event.organization_id,
        ))
      )
        return;
      await this.auto_entry_service.onVatSettlement({
        declaration_id: event.declaration_id,
        organization_id: event.organization_id,
        store_id: event.store_id ?? undefined,
        accounting_entity_id: event.accounting_entity_id,
        generated_tax_amount: Number(event.generated_tax_amount),
        deductible_tax_amount: Number(event.deductible_tax_amount),
        period_end:
          event.period_end instanceof Date
            ? event.period_end
            : new Date(event.period_end),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry created for vat.declaration.approved #${event.declaration_id}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to create auto-entry for vat.declaration.approved #${event.declaration_id}: ${error?.message ?? error}`,
        error?.stack,
      );
    }
  }

  /**
   * F5 (paso 18) — Reversa de la liquidación de IVA al anular/rechazar una
   * declaración `vat` ya liquidada. Postea el asiento espejo
   * (source_type='vat_declaration_reversal'). Si la declaración nunca se
   * liquidó, onVatSettlementReversed no hace nada. Si el período ya está
   * cerrado, createAutoEntry rechaza el espejo (FISCAL_PERIOD_CLOSED) y se
   * exige período correctivo. Los fallos se loguean y NUNCA revierten la
   * anulación/rechazo de la declaración.
   */
  @OnEvent('vat.declaration.reversed')
  async handleVatDeclarationReversed(event: {
    declaration_id: number;
    organization_id: number;
    store_id?: number | null;
    accounting_entity_id?: number;
    generated_tax_amount: number;
    deductible_tax_amount: number;
    period_end: Date | string;
    user_id?: number;
  }) {
    try {
      if (
        !(await this.isFlowEnabled(
          event.store_id ?? undefined,
          'accounting',
          event.organization_id,
        ))
      )
        return;
      await this.auto_entry_service.onVatSettlementReversed({
        declaration_id: event.declaration_id,
        organization_id: event.organization_id,
        store_id: event.store_id ?? undefined,
        accounting_entity_id: event.accounting_entity_id,
        generated_tax_amount: Number(event.generated_tax_amount),
        deductible_tax_amount: Number(event.deductible_tax_amount),
        period_end:
          event.period_end instanceof Date
            ? event.period_end
            : new Date(event.period_end),
        user_id: event.user_id,
      });
      this.logger.log(
        `Auto-entry (reversal) created for vat.declaration.reversed #${event.declaration_id}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to create auto-entry for vat.declaration.reversed #${event.declaration_id}: ${error?.message ?? error}`,
        error?.stack,
      );
    }
  }
}
