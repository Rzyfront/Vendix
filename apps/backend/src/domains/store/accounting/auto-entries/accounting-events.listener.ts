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
    currency: string;
    payment_method: string;
    user_id?: number;
  }) {
    try {
      await this.auto_entry_service.onPaymentReceived({
        payment_id: event.payment_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
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

  @OnEvent('expense.approved')
  async handleExpenseApproved(event: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    expense_account_code?: string;
    user_id?: number;
  }) {
    try {
      await this.auto_entry_service.onExpenseApproved({
        expense_id: event.expense_id,
        organization_id: event.organization_id,
        store_id: event.store_id,
        amount: Number(event.amount),
        expense_account_code: event.expense_account_code,
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
}
