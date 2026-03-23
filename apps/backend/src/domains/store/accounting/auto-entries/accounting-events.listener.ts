import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AutoEntryService } from './auto-entry.service';

@Injectable()
export class AccountingEventsListener {
  private readonly logger = new Logger(AccountingEventsListener.name);

  constructor(private readonly auto_entry_service: AutoEntryService) {}

  @OnEvent('invoice.validated')
  async handleInvoiceValidated(event: {
    invoice_id: number;
    invoice_number: string;
    organization_id: number;
    store_id?: number;
    subtotal_amount: number;
    tax_amount: number;
    total_amount: number;
    user_id?: number;
  }) {
    try {
      await this.auto_entry_service.onInvoiceValidated({
        invoice_id: event.invoice_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        subtotal: event.subtotal_amount,
        tax_amount: event.tax_amount,
        total: event.total_amount,
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for invoice.validated #${event.invoice_id}`);
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for invoice.validated #${event.invoice_id}: ${error.message}`,
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
    discount_amount?: number;
    currency: string;
    payment_method: string;
    user_id?: number;
  }) {
    try {
      await this.auto_entry_service.onPaymentReceived({
        payment_id: event.payment_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        order_id: event.order_id,
        order_number: event.order_number,
        payment_method: event.payment_method,
        amount: Number(event.amount),
        subtotal_amount: event.subtotal_amount != null ? Number(event.subtotal_amount) : undefined,
        tax_amount: event.tax_amount != null ? Number(event.tax_amount) : undefined,
        discount_amount: event.discount_amount != null ? Number(event.discount_amount) : undefined,
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for payment.received #${event.payment_id}`);
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
    discount_amount?: number;
    total_amount: number;
    user_id?: number;
  }) {
    try {
      await this.auto_entry_service.onCreditSaleCreated({
        order_id: event.order_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        order_number: event.order_number,
        subtotal_amount: Number(event.subtotal_amount),
        tax_amount: Number(event.tax_amount),
        discount_amount: event.discount_amount != null ? Number(event.discount_amount) : undefined,
        total_amount: Number(event.total_amount),
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for credit_sale.created order #${event.order_id}`);
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
      await this.auto_entry_service.onExpenseApproved({
        expense_id: event.expense_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for expense.approved #${event.expense_id}`);
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
      await this.auto_entry_service.onExpensePaid({
        expense_id: event.expense_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for expense.paid #${event.expense_id}`);
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for expense.paid #${event.expense_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('payroll.approved')
  async handlePayrollApproved(event: {
    payroll_run_id: number;
    organization_id: number;
    store_id?: number;
    total_earnings: number;
    total_employer_costs: number;
    total_deductions: number;
    total_net_pay: number;
    health_deduction: number;
    pension_deduction: number;
    approved_by: number;
    cost_center_breakdown?: Record<string, { earnings: number; employer_costs: number }>;
  }) {
    try {
      await this.auto_entry_service.onPayrollApproved({
        payroll_run_id: event.payroll_run_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        total_earnings: Number(event.total_earnings),
        total_employer_costs: Number(event.total_employer_costs),
        total_deductions: Number(event.total_deductions),
        total_net_pay: Number(event.total_net_pay),
        health_deduction: Number(event.health_deduction),
        pension_deduction: Number(event.pension_deduction),
        user_id: event.approved_by,
        cost_center_breakdown: event.cost_center_breakdown,
      });
      this.logger.log(`Auto-entry created for payroll.approved #${event.payroll_run_id}`);
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
    total_net_pay: number;
    payment_date: Date;
    user_id?: number;
  }) {
    try {
      await this.auto_entry_service.onPayrollPaid({
        payroll_run_id: event.payroll_run_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        total_net_pay: Number(event.total_net_pay),
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for payroll.paid #${event.payroll_run_id}`);
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for payroll.paid #${event.payroll_run_id}: ${error.message}`,
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
      await this.auto_entry_service.onOrderCompleted({
        order_id: event.order_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        total_cost: Number(event.total_cost),
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for order.completed #${event.order_id}`);
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for order.completed #${event.order_id}: ${error.message}`,
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
    return_type?: string;
    user_id?: number;
  }) {
    try {
      await this.auto_entry_service.onRefundCompleted({
        refund_id: event.refund_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        tax_amount: event.tax_amount != null ? Number(event.tax_amount) : undefined,
        return_type: event.return_type,
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for refund.completed #${event.refund_id}`);
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
    organization_id: number;
    store_id?: number;
    total_amount: number;
    user_id?: number;
  }) {
    try {
      await this.auto_entry_service.onPurchaseOrderReceived({
        purchase_order_id: event.purchase_order_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        total_amount: Number(event.total_amount),
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for purchase_order.received #${event.purchase_order_id}`);
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for purchase_order.received #${event.purchase_order_id}: ${error.message}`,
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
      await this.auto_entry_service.onPurchaseOrderPayment({
        purchase_order_id: event.purchase_order_id,
        organization_id: event.organization_id,
        amount: Number(event.amount),
        payment_method: event.payment_method,
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for purchase_order.payment PO #${event.purchase_order_id}`);
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
      await this.auto_entry_service.onInventoryAdjusted({
        adjustment_id: event.adjustment_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        cost_amount: Number(event.cost_amount),
        quantity_change: Number(event.quantity_change),
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for inventory.adjusted #${event.adjustment_id}`);
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
      const organization_id = event.organization_id || await this.resolveOrgId(event.store_id);
      await this.auto_entry_service.onLayawayPaymentReceived({
        payment_id: event.payment_id,
        plan_number: event.plan_number,
        organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        payment_method: event.payment_method,
      });
      this.logger.log(`Auto-entry created for layaway.payment_received - plan ${event.plan_number}`);
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
      const organization_id = event.organization_id || await this.resolveOrgId(event.store_id);
      await this.auto_entry_service.onLayawayCompleted({
        plan_id: event.plan_id,
        plan_number: event.plan_number,
        organization_id,
        store_id: event.store_id,
        total_amount: Number(event.total_amount),
      });
      this.logger.log(`Auto-entry created for layaway.completed - plan ${event.plan_number}`);
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for layaway.completed - plan ${event.plan_number}: ${error.message}`,
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
      const organization_id = event.organization_id || await this.resolveOrgId(event.store_id);
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
      this.logger.log(`Auto-entry created for installment_payment.received - Credit ${event.credit_number} cuota #${event.installment_number}`);
    } catch (error) {
      this.logger.error(
        `Failed to create auto-entry for installment_payment.received - Credit ${event.credit_number}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===== PAYROLL SETTLEMENTS =====

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
      this.logger.log(`Auto-entry created for settlement.paid ${event.settlement_number}`);
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
      await this.auto_entry_service.onDepreciationPosted({
        asset_id: event.asset_id,
        asset_number: event.asset_number,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        period_date: new Date(event.period_date),
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for depreciation.posted - asset ${event.asset_number}`);
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
      this.logger.log(`Auto-entry created for disposal.fixed_asset - asset ${event.asset_number}`);
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
    user_id?: number;
  }) {
    try {
      await this.auto_entry_service.onWithholdingApplied({
        organization_id: event.organization_id,
        store_id: event.store_id,
        invoice_id: event.invoice_id,
        base_amount: Number(event.base_amount),
        withholding_amount: Number(event.withholding_amount),
        net_amount: Number(event.net_amount),
        concept_name: event.concept_name,
        supplier_name: event.supplier_name,
        user_id: event.user_id,
      });
      this.logger.log(`Auto-entry created for withholding.applied - invoice #${event.invoice_id}`);
    } catch (error) {
      this.logger.error(
        `Failed to create withholding auto-entry: ${error.message}`,
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
}
