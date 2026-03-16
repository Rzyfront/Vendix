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
}
