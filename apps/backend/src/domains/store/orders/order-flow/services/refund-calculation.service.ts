import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';

export interface RefundItemRequest {
  order_item_id: number;
  quantity: number;
  inventory_action: 'restock' | 'write_off' | 'no_return';
  location_id?: number;
  reason?: string;
}

export interface RefundItemCalculation {
  order_item_id: number;
  product_name: string;
  variant_sku?: string;
  variant_attributes?: string;
  image_url?: string;
  quantity: number;
  unit_price: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  tax_amount: number;
  refund_amount: number;
  inventory_action: string;
  location_id?: number;
  reason?: string;
}

export interface RefundCalculationResult {
  items: RefundItemCalculation[];
  subtotal_refund: number;
  tax_refund: number;
  shipping_refund: number;
  total_refund: number;
  is_full_refund: boolean;
  already_refunded: number;
  max_refundable: number;
}

export interface CalculateRefundParams {
  order_id: number;
  items: RefundItemRequest[];
  include_shipping: boolean;
}

@Injectable()
export class RefundCalculationService {
  constructor(private readonly prisma: StorePrismaService) {}

  async calculate(params: CalculateRefundParams): Promise<RefundCalculationResult> {
    const { order_id, items, include_shipping } = params;

    // Load order with items, taxes, and previous refunds
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      include: {
        order_items: {
          include: {
            order_item_taxes: true,
            products: {
              select: {
                id: true,
                track_inventory: true,
                product_images: {
                  where: { is_main: true },
                  select: { image_url: true },
                  take: 1,
                },
              },
            },
          },
        },
        refunds: {
          where: { state: 'completed' },
          include: { refund_items: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${order_id} not found`);
    }

    // Build map of already-refunded quantities per order_item
    const refundedQtyMap = new Map<number, number>();
    for (const refund of order.refunds) {
      for (const ri of refund.refund_items) {
        const current = refundedQtyMap.get(ri.order_item_id) || 0;
        refundedQtyMap.set(ri.order_item_id, current + ri.quantity);
      }
    }

    // Already refunded total amount
    const already_refunded = order.refunds.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );

    const grand_total = Number(order.grand_total);
    const max_refundable = grand_total - already_refunded;
    const subtotal_amount = Number(order.subtotal_amount) || 0;
    const discount_amount = Number(order.discount_amount) || 0;
    const discount_ratio = subtotal_amount > 0 ? discount_amount / subtotal_amount : 0;

    const calculatedItems: RefundItemCalculation[] = [];

    for (const reqItem of items) {
      const orderItem = order.order_items.find((oi) => oi.id === reqItem.order_item_id);
      if (!orderItem) {
        throw new BadRequestException(
          `Order item #${reqItem.order_item_id} does not belong to order #${order_id}`,
        );
      }

      const alreadyRefundedQty = refundedQtyMap.get(orderItem.id) || 0;
      const maxRefundableQty = orderItem.quantity - alreadyRefundedQty;

      if (reqItem.quantity > maxRefundableQty) {
        throw new BadRequestException(
          `Cannot refund ${reqItem.quantity} units of "${orderItem.product_name}". ` +
          `Max refundable: ${maxRefundableQty} (original: ${orderItem.quantity}, already refunded: ${alreadyRefundedQty})`,
        );
      }

      if (reqItem.inventory_action === 'restock' && !reqItem.location_id) {
        throw new BadRequestException(
          `Location is required for restock action on "${orderItem.product_name}"`,
        );
      }

      const unit_price = Number(orderItem.unit_price);
      const gross_amount = reqItem.quantity * unit_price;
      const item_discount = gross_amount * discount_ratio;
      const net_amount = gross_amount - item_discount;

      // Calculate tax from order_item_taxes
      let tax_rate = 0;
      if (orderItem.order_item_taxes && orderItem.order_item_taxes.length > 0) {
        tax_rate = orderItem.order_item_taxes.reduce(
          (sum, t) => sum + Number(t.tax_rate),
          0,
        );
      } else if (orderItem.tax_rate) {
        tax_rate = Number(orderItem.tax_rate);
      }

      const tax_amount = net_amount * tax_rate;
      const refund_amount = net_amount + tax_amount;

      calculatedItems.push({
        order_item_id: orderItem.id,
        product_name: orderItem.product_name,
        variant_sku: orderItem.variant_sku || undefined,
        variant_attributes: orderItem.variant_attributes || undefined,
        image_url: orderItem.products?.product_images?.[0]?.image_url || undefined,
        quantity: reqItem.quantity,
        unit_price,
        gross_amount,
        discount_amount: item_discount,
        net_amount,
        tax_amount,
        refund_amount,
        inventory_action: reqItem.inventory_action,
        location_id: reqItem.location_id,
        reason: reqItem.reason,
      });
    }

    const subtotal_refund = calculatedItems.reduce((sum, i) => sum + i.net_amount, 0);
    const tax_refund = calculatedItems.reduce((sum, i) => sum + i.tax_amount, 0);

    // Proportional shipping refund
    let shipping_refund = 0;
    if (include_shipping && subtotal_amount > 0) {
      const shipping_cost = Number(order.shipping_cost) || 0;
      shipping_refund = shipping_cost * (subtotal_refund / subtotal_amount);
    }

    const total_refund = subtotal_refund + tax_refund + shipping_refund;

    if (total_refund > max_refundable + 0.01) {
      throw new BadRequestException(
        `Total refund (${total_refund.toFixed(2)}) exceeds max refundable amount (${max_refundable.toFixed(2)})`,
      );
    }

    // Check if this is a full refund (all items, all quantities)
    const totalOrderQty = order.order_items.reduce((sum, oi) => sum + oi.quantity, 0);
    const totalRefundedQty = Array.from(refundedQtyMap.values()).reduce((sum, q) => sum + q, 0);
    const thisRefundQty = items.reduce((sum, i) => sum + i.quantity, 0);
    const is_full_refund = (totalRefundedQty + thisRefundQty) >= totalOrderQty;

    return {
      items: calculatedItems,
      subtotal_refund: Math.round(subtotal_refund * 100) / 100,
      tax_refund: Math.round(tax_refund * 100) / 100,
      shipping_refund: Math.round(shipping_refund * 100) / 100,
      total_refund: Math.round(total_refund * 100) / 100,
      is_full_refund,
      already_refunded,
      max_refundable: Math.round(max_refundable * 100) / 100,
    };
  }
}
