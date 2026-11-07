import { Injectable } from '@nestjs/common';
import { ExpensesService } from '../../../expenses/expenses.service';
import { ExpenseFlowService } from '../../../expenses/expense-flow/expense-flow.service';
import { CreateExpenseDto } from '../../../expenses/dto/create-expense.dto';
import { PurchaseOrdersService } from '../../../orders/purchase-orders/purchase-orders.service';
import { CreatePurchaseOrderDto } from '../../../orders/purchase-orders/dto/create-purchase-order.dto';
import { RegisterPaymentDto } from '../../../orders/purchase-orders/dto/register-payment.dto';
import { AccountsPayableService } from '../../../accounts-payable/accounts-payable.service';
import { RegisterApPaymentDto } from '../../../accounts-payable/dto/register-ap-payment.dto';
import {
  WorkflowActionContext,
  WorkflowActionGroup,
  WorkflowActionHandlerMap,
  WorkflowActionInputError,
  WorkflowActionResult,
  actionInputs,
  must,
  returnedId,
} from './workflow-action.types';

/** Same bounds the payment DTOs enforce on the HTTP routes (no pipe runs here). */
const PAYMENT_MIN_AMOUNT = 0.01;
const PO_PAYMENT_MAX_AMOUNT = 9999999999.99;

/** Calendar day (YYYY-MM-DD) used when the flow gives no date. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function paymentAmount(amount: number | undefined, max?: number): number {
  const value = must(amount, 'amount');
  if (value < PAYMENT_MIN_AMOUNT || (max !== undefined && value > max)) {
    throw new WorkflowActionInputError(
      `"amount" must be between ${PAYMENT_MIN_AMOUNT} and ${max ?? 'the open balance'} (got "${value}")`,
    );
  }
  return value;
}

/** Vendix actions of the registry (P1.2): gastos, órdenes de compra y cuentas por pagar. */
@Injectable()
export class WorkflowPurchasingActions implements WorkflowActionGroup {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly expenseFlow: ExpenseFlowService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly accountsPayable: AccountsPayableService,
  ) {}

  readonly handlers: WorkflowActionHandlerMap = {
    'vendix.expense.create': (ctx) => this.createExpense(ctx),
    'vendix.expense.approve': (ctx) => this.approveExpense(ctx),
    'vendix.expense.pay': (ctx) => this.payExpense(ctx),
    'vendix.purchase_order.create_draft': (ctx) => this.createPurchaseOrder(ctx),
    'vendix.purchase_order.approve': (ctx) => this.approvePurchaseOrder(ctx),
    'vendix.purchase_order.cancel': (ctx) => this.cancelPurchaseOrder(ctx),
    'vendix.purchase_order.register_payment': (ctx) =>
      this.registerPurchaseOrderPayment(ctx),
    'vendix.payable.register_payment': (ctx) => this.registerPayablePayment(ctx),
  };

  private async createExpense(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.expense.create', ctx.map);
    const categoryId = input.id('category_id');
    const dto: CreateExpenseDto = {
      amount: must(input.money('amount'), 'amount'),
      description: must(input.text('description', 500), 'description'),
      expense_date: input.date('expense_date') ?? today(),
      ...(categoryId !== undefined && { category_id: categoryId }),
    };
    const created = await ctx.asPublisher(() => this.expenses.create(dto));
    return { record_id: returnedId(created, 'Expense service') };
  }

  private async approveExpense(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const id = must(actionInputs('vendix.expense.approve', ctx.map).id('expense_id'), 'expense_id');
    const updated = await ctx.asPublisher(() => this.expenseFlow.approve(id));
    return { record_id: returnedId(updated, 'Expense approval') };
  }

  private async payExpense(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const id = must(actionInputs('vendix.expense.pay', ctx.map).id('expense_id'), 'expense_id');
    const updated = await ctx.asPublisher(() => this.expenseFlow.pay(id));
    return { record_id: returnedId(updated, 'Expense payment') };
  }

  /** One-line draft; the service decides the status (it is born as draft). */
  private async createPurchaseOrder(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.purchase_order.create_draft', ctx.map);
    const notes = input.text('notes');
    const expectedDate = input.date('expected_date');
    const dto = {
      supplier_id: must(input.id('supplier_id'), 'supplier_id'),
      location_id: must(input.id('location_id'), 'location_id'),
      items: [
        {
          product_id: must(input.id('product_id'), 'product_id'),
          quantity: must(input.int('quantity'), 'quantity'),
          unit_price: must(input.money('unit_price'), 'unit_price'),
        },
      ],
      ...(notes && { notes }),
      ...(expectedDate && { expected_date: expectedDate }),
      internal_notes: `Creada por el flujo ${ctx.instance.reference}`,
    } as unknown as CreatePurchaseOrderDto;
    const created = await ctx.asPublisher(() => this.purchaseOrders.create(dto));
    return { record_id: returnedId(created, 'Purchase order service') };
  }

  private async approvePurchaseOrder(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const id = must(
      actionInputs('vendix.purchase_order.approve', ctx.map).id('purchase_order_id'),
      'purchase_order_id',
    );
    const updated = await ctx.asPublisher(() => this.purchaseOrders.approve(id));
    return { record_id: returnedId(updated, 'Purchase order approval') };
  }

  /** The reason goes to the order's internal notes; default names the request. */
  private async cancelPurchaseOrder(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.purchase_order.cancel', ctx.map);
    const id = must(input.id('purchase_order_id'), 'purchase_order_id');
    const reason =
      input.text('reason', 500) ?? `Anulada por el flujo ${ctx.instance.reference}`;
    const updated = await ctx.asPublisher(() => this.purchaseOrders.cancel(id, reason));
    return { record_id: returnedId(updated, 'Purchase order cancellation') };
  }

  /** `record_id` is the payment row created. */
  private async registerPurchaseOrderPayment(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.purchase_order.register_payment', ctx.map);
    const orderId = must(input.id('purchase_order_id'), 'purchase_order_id');
    const reference = input.text('reference');
    const dto: RegisterPaymentDto = {
      amount: paymentAmount(input.money('amount'), PO_PAYMENT_MAX_AMOUNT),
      payment_date: today(),
      payment_method: must(input.text('payment_method', 100), 'payment_method'),
      ...(reference && { reference }),
      notes: `Registrado por el flujo ${ctx.instance.reference}`,
    };
    const payment = await ctx.asPublisher(() =>
      this.purchaseOrders.registerPayment(orderId, dto),
    );
    return { record_id: returnedId(payment, 'Purchase order payment') };
  }

  /** `record_id` is the payment row created. */
  private async registerPayablePayment(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.payable.register_payment', ctx.map);
    const payableId = must(input.id('payable_id'), 'payable_id');
    const reference = input.text('reference');
    const dto: RegisterApPaymentDto = {
      amount: paymentAmount(input.money('amount')),
      payment_method: must(input.text('payment_method', 100), 'payment_method'),
      ...(reference && { reference }),
      notes: `Registrado por el flujo ${ctx.instance.reference}`,
    };
    const result = await ctx.asPublisher(() =>
      this.accountsPayable.registerPayment(payableId, dto, ctx.actingUserId),
    );
    return { record_id: returnedId(result.payment, 'Payable payment') };
  }
}
