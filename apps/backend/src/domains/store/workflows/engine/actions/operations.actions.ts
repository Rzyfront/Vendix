import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { InventoryAdjustmentsService } from '../../../inventory/adjustments/inventory-adjustments.service';
import { AdjustmentType } from '../../../inventory/adjustments/interfaces/inventory-adjustment.interface';
import { StockTransfersService } from '../../../orders/stock-transfers/stock-transfers.service';
import { InvoicingService } from '../../../invoicing/invoicing.service';
import { CreditNotesService } from '../../../invoicing/credit-notes/credit-notes.service';
import { InvoiceDeliveryService } from '../../../invoicing/delivery/invoice-delivery.service';
import { OrderFlowService } from '../../../orders/order-flow/order-flow.service';
import {
  PaymentType,
} from '../../../orders/order-flow/dto/pay-order.dto';
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

type OrderTargetState = 'shipped' | 'delivered' | 'cancelled';

/** Same floor the cancel route enforces on its `reason`. */
const MIN_CANCEL_REASON_LENGTH = 3;

/**
 * Vendix actions of the registry (P1.2): inventario, facturación y ventas.
 * Every handler calls the SAME domain service method the UI route calls, as
 * the publisher; the services scope by store, so an id of another store fails.
 */
@Injectable()
export class WorkflowOperationsActions implements WorkflowActionGroup {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly adjustments: InventoryAdjustmentsService,
    private readonly transfers: StockTransfersService,
    private readonly invoicing: InvoicingService,
    private readonly creditNotes: CreditNotesService,
    private readonly invoiceDelivery: InvoiceDeliveryService,
    private readonly orderFlow: OrderFlowService,
  ) {}

  readonly handlers: WorkflowActionHandlerMap = {
    'vendix.inventory.adjust': (ctx) => this.adjustInventory(ctx),
    'vendix.inventory.transfer': (ctx) => this.createTransfer(ctx),
    'vendix.invoice.create_from_order': (ctx) => this.invoiceFromOrder(ctx),
    'vendix.credit_note.create': (ctx) => this.createCreditNote(ctx),
    'vendix.invoice.send_email': (ctx) => this.sendInvoiceEmail(ctx),
    'vendix.order.register_payment': (ctx) => this.registerPayment(ctx),
    'vendix.order.change_status': (ctx) => this.changeOrderStatus(ctx),
  };

  private async adjustInventory(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.inventory.adjust', ctx.map);
    const dto = {
      product_id: must(input.id('product_id'), 'product_id'),
      location_id: must(input.id('location_id'), 'location_id'),
      quantity_after: must(input.int('quantity_after'), 'quantity_after'),
      type: must(input.enum<AdjustmentType>('adjustment_type'), 'adjustment_type'),
      description: input.text('reason', 500),
    };
    const adjustment = await ctx.asPublisher(() =>
      this.adjustments.createAdjustment(dto),
    );
    return { record_id: returnedId(adjustment, 'Inventory adjustment') };
  }

  /** Creates the transfer as the UI form does; it is never completed here. */
  private async createTransfer(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.inventory.transfer', ctx.map);
    const dto = {
      from_location_id: must(input.id('from_location_id'), 'from_location_id'),
      to_location_id: must(input.id('to_location_id'), 'to_location_id'),
      notes: input.text('notes'),
      items: [
        {
          product_id: must(input.id('product_id'), 'product_id'),
          quantity: must(input.int('quantity'), 'quantity'),
        },
      ],
    };
    const transfer = await ctx.asPublisher(() => this.transfers.create(dto));
    return { record_id: returnedId(transfer, 'Stock transfer') };
  }

  private async invoiceFromOrder(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.invoice.create_from_order', ctx.map);
    const orderId = must(input.id('order_id'), 'order_id');
    const invoice = await ctx.asPublisher(() =>
      this.invoicing.createFromOrder(orderId),
    );
    return { record_id: returnedId(invoice, 'Invoice') };
  }

  /** Without `items` the service builds a TOTAL note from the invoice lines. */
  private async createCreditNote(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.credit_note.create', ctx.map);
    const dto = {
      related_invoice_id: must(input.id('invoice_id'), 'invoice_id'),
      reason: must(input.text('reason', 500), 'reason'),
    };
    const note = await ctx.asPublisher(() =>
      this.creditNotes.createCreditNote(dto),
    );
    return { record_id: returnedId(note, 'Credit note') };
  }

  private async sendInvoiceEmail(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.invoice.send_email', ctx.map);
    const invoiceId = must(input.id('invoice_id'), 'invoice_id');
    const explicit = input.text('email', 320);
    const result = await ctx.asPublisher(async () => {
      const email = explicit ?? (await this.defaultRecipient(invoiceId));
      return this.invoiceDelivery.deliver(invoiceId, { email });
    });
    return { record_id: returnedId({ id: result.invoice_id }, 'Invoice email') };
  }

  /** The email the invoice was issued with (store-scoped read). */
  private async defaultRecipient(invoiceId: number): Promise<string> {
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: invoiceId },
      select: { customer_email: true },
    });
    if (!invoice) {
      throw new WorkflowActionInputError(`Invoice ${invoiceId} was not found`);
    }
    const email = invoice.customer_email?.trim();
    if (!email) {
      throw new WorkflowActionInputError(
        `Invoice ${invoiceId} has no customer email and the action gave none`,
      );
    }
    return email;
  }

  private async registerPayment(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.order.register_payment', ctx.map);
    const orderId = must(input.id('order_id'), 'order_id');
    const dto = {
      store_payment_method_id: must(
        input.id('store_payment_method_id'),
        'store_payment_method_id',
      ),
      payment_type: PaymentType.DIRECT,
      amount: must(input.money('amount'), 'amount'),
      payment_reference: input.text('reference', 200),
    };
    const paid = await ctx.asPublisher(() =>
      this.orderFlow.payOrder(orderId, dto),
    );
    return { record_id: returnedId(paid.order, 'Order payment') };
  }

  private async changeOrderStatus(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const input = actionInputs('vendix.order.change_status', ctx.map);
    const orderId = must(input.id('order_id'), 'order_id');
    const toState = must(input.enum<OrderTargetState>('to_state'), 'to_state');
    const reason = input.text('reason', 500);
    if (
      toState === 'cancelled' &&
      (reason?.length ?? 0) < MIN_CANCEL_REASON_LENGTH
    ) {
      throw new WorkflowActionInputError(
        `"reason" is required (min ${MIN_CANCEL_REASON_LENGTH} characters) to cancel an order`,
      );
    }
    const order = await ctx.asPublisher(() => {
      switch (toState) {
        case 'shipped':
          return this.orderFlow.shipOrder(orderId, {});
        case 'delivered':
          return this.orderFlow.deliverOrder(orderId, {});
        case 'cancelled':
          return this.orderFlow.cancelOrder(orderId, { reason: must(reason, 'reason') });
      }
    });
    return { record_id: returnedId(order, 'Order') };
  }
}
