import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { purchase_order_status_enum } from '@prisma/client';

@Injectable()
export class PurchaseOrdersService {
  constructor(private prisma: PrismaService) {}

  async create(createPurchaseOrderDto: CreatePurchaseOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      // Calculate totals
      const subtotal = createPurchaseOrderDto.items.reduce(
        (sum, item) => sum + item.quantity * item.unit_price,
        0,
      );

      const totalAmount =
        subtotal -
        (createPurchaseOrderDto.discount_amount || 0) +
        (createPurchaseOrderDto.tax_amount || 0) +
        (createPurchaseOrderDto.shipping_cost || 0);

      // Create purchase order
      const purchaseOrder = await tx.purchase_orders.create({
        data: {
          ...createPurchaseOrderDto,
          subtotal,
          total_amount: totalAmount,
          order_date: new Date(),
        },
        include: {
          suppliers: true,
          inventory_locations: true,
          purchase_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });

      return purchaseOrder;
    });
  }

  findAll(query: PurchaseOrderQueryDto) {
    const where: any = {
      supplier_id: query.supplier_id,
      location_id: query.location_id,
      status: query.status,
    };

    // Add date range filter
    if (query.start_date || query.end_date) {
      where.order_date = {};
      if (query.start_date) {
        where.order_date.gte = new Date(query.start_date);
      }
      if (query.end_date) {
        where.order_date.lte = new Date(query.end_date);
      }
    }

    // Add total amount range filter
    if (query.min_total || query.max_total) {
      where.total_amount = {};
      if (query.min_total) {
        where.total_amount.gte = query.min_total;
      }
      if (query.max_total) {
        where.total_amount.lte = query.max_total;
      }
    }

    // Add search filter
    if (query.search) {
      where.OR = [
        { internal_reference: { contains: query.search } },
        { supplier_reference: { contains: query.search } },
        { notes: { contains: query.search } },
        { suppliers: { name: { contains: query.search } } },
      ];
    }

    return this.prisma.purchase_orders.findMany({
      where,
      include: {
        suppliers: true,
        inventory_locations: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
      orderBy: {
        order_date: 'desc',
      },
    });
  }

  findByStatus(
    status: purchase_order_status_enum,
    query: PurchaseOrderQueryDto,
  ) {
    return this.findAll({
      ...query,
      status,
    });
  }

  findPending(query: PurchaseOrderQueryDto) {
    return this.findAll({
      ...query,
      status: purchase_order_status_enum.approved,
    });
  }

  findBySupplier(supplierId: number, query: PurchaseOrderQueryDto) {
    return this.findAll({
      ...query,
      supplier_id: supplierId,
    });
  }

  findOne(id: number) {
    return this.prisma.purchase_orders.findUnique({
      where: { id },
      include: {
        suppliers: true,
        inventory_locations: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async update(id: number, updatePurchaseOrderDto: UpdatePurchaseOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      // If items are being updated, recalculate totals
      if (updatePurchaseOrderDto.items) {
        const subtotal = updatePurchaseOrderDto.items.reduce(
          (sum, item) => sum + item.quantity * item.unit_price,
          0,
        );

        const totalAmount =
          subtotal -
          (updatePurchaseOrderDto.discount_amount || 0) +
          (updatePurchaseOrderDto.tax_amount || 0) +
          (updatePurchaseOrderDto.shipping_cost || 0);

        (updatePurchaseOrderDto as any).subtotal = subtotal;
        (updatePurchaseOrderDto as any).total_amount = totalAmount;
      }

      return tx.purchase_orders.update({
        where: { id },
        data: updatePurchaseOrderDto,
        include: {
          suppliers: true,
          inventory_locations: true,
          purchase_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });
    });
  }

  async approve(id: number) {
    return this.prisma.purchase_orders.update({
      where: { id },
      data: {
        status: purchase_order_status_enum.approved,
        approved_date: new Date(),
      },
      include: {
        suppliers: true,
        inventory_locations: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async cancel(id: number) {
    return this.prisma.purchase_orders.update({
      where: { id },
      data: {
        status: purchase_order_status_enum.cancelled,
        cancelled_date: new Date(),
      },
      include: {
        suppliers: true,
        inventory_locations: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async receive(
    id: number,
    items: Array<{ id: number; quantity_received: number }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Update purchase order items with received quantities
      for (const item of items) {
        await tx.purchase_order_items.update({
          where: { id: item.id },
          data: {
            quantity_received: item.quantity_received,
            received_date: new Date(),
          },
        });
      }

      // Create inventory movements for received items
      const purchaseOrder = await tx.purchase_orders.findUnique({
        where: { id },
        include: {
          purchase_order_items: true,
          inventory_locations: true,
        },
      });

      for (const item of purchaseOrder.purchase_order_items) {
        const receivedItem = items.find((i) => i.id === item.id);
        if (receivedItem && receivedItem.quantity_received > 0) {
          // Create inventory movement
          await tx.inventory_movements.create({
            data: {
              organization_id: purchaseOrder.organization_id,
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              to_location_id: purchaseOrder.location_id,
              quantity: receivedItem.quantity_received,
              movement_type: 'stock_in',
              source_order_type: 'purchase_order',
              source_order_id: id,
              reason: 'Purchase order receipt',
              created_at: new Date(),
            },
          });

          // Update stock levels
          await this.updateStockLevel(
            tx,
            item.product_id,
            purchaseOrder.location_id,
            receivedItem.quantity_received,
            item.product_variant_id,
          );
        }
      }

      // Check if all items are received
      const allItemsReceived = purchaseOrder.purchase_order_items.every(
        (item) => {
          const receivedItem = items.find((i) => i.id === item.id);
          return (
            receivedItem && receivedItem.quantity_received >= item.quantity
          );
        },
      );

      // Update purchase order status
      const newStatus = allItemsReceived
        ? purchase_order_status_enum.received
        : purchase_order_status_enum.approved;

      return tx.purchase_orders.update({
        where: { id },
        data: {
          status: newStatus,
          received_date: allItemsReceived ? new Date() : null,
        },
        include: {
          suppliers: true,
          inventory_locations: true,
          purchase_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });
    });
  }

  remove(id: number) {
    return this.prisma.purchase_orders.delete({
      where: { id },
    });
  }

  private async updateStockLevel(
    tx: any,
    productId: number,
    locationId: number,
    quantityChange: number,
    productVariantId?: number,
  ) {
    const existingStock = await tx.stock_levels.findUnique({
      where: {
        product_id_product_variant_id_location_id: {
          product_id: productId,
          product_variant_id: productVariantId || null,
          location_id: locationId,
        },
      },
    });

    if (existingStock) {
      const newQuantityOnHand = existingStock.quantity_on_hand + quantityChange;
      const newQuantityAvailable =
        existingStock.quantity_available + quantityChange;

      return tx.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
        },
        data: {
          quantity_on_hand: Math.max(0, newQuantityOnHand),
          quantity_available: Math.max(0, newQuantityAvailable),
          last_updated: new Date(),
        },
      });
    } else {
      return tx.stock_levels.create({
        data: {
          product_id: productId,
          product_variant_id: productVariantId,
          location_id: locationId,
          quantity_on_hand: Math.max(0, quantityChange),
          quantity_reserved: 0,
          quantity_available: Math.max(0, quantityChange),
          last_updated: new Date(),
        },
      });
    }
  }
}
