import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrderQueryDto } from './dto/sales-order-query.dto';
import { sales_order_status_enum } from '@prisma/client';

@Injectable()
export class SalesOrdersService {
  constructor(private prisma: PrismaService) {}

  async create(createSalesOrderDto: CreateSalesOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      // Calculate totals
      const subtotal = createSalesOrderDto.items.reduce(
        (sum, item) => sum + item.quantity * item.unit_price,
        0,
      );

      const totalAmount =
        subtotal -
        (createSalesOrderDto.discount_amount || 0) +
        (createSalesOrderDto.tax_amount || 0) +
        (createSalesOrderDto.shipping_cost || 0);

      // Create sales order
      const salesOrder = await tx.sales_orders.create({
        data: {
          ...createSalesOrderDto,
          subtotal,
          total_amount: totalAmount,
          order_date: createSalesOrderDto.order_date
            ? new Date(createSalesOrderDto.order_date)
            : new Date(),
        },
        include: {
          customers: true,
          shipping_addresses: true,
          billing_addresses: true,
          sales_order_items: {
            include: {
              products: true,
              product_variants: true,
              inventory_locations: true,
            },
          },
        },
      });

      return salesOrder;
    });
  }

  findAll(query: SalesOrderQueryDto) {
    const where: any = {
      customer_id: query.customer_id,
      status: query.status,
      payment_status: query.payment_status,
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
        { customer_reference: { contains: query.search } },
        { customer_email: { contains: query.search } },
        { customer_name: { contains: query.search } },
        { notes: { contains: query.search } },
        { customers: { name: { contains: query.search } } },
        { customers: { email: { contains: query.search } } },
      ];
    }

    return this.prisma.sales_orders.findMany({
      where,
      include: {
        customers: true,
        shipping_addresses: true,
        billing_addresses: true,
        sales_order_items: {
          include: {
            products: true,
            product_variants: true,
            inventory_locations: true,
          },
        },
      },
      orderBy: {
        order_date: 'desc',
      },
    });
  }

  findByStatus(status: sales_order_status_enum, query: SalesOrderQueryDto) {
    return this.findAll({
      ...query,
      status,
    });
  }

  findByCustomer(customerId: number, query: SalesOrderQueryDto) {
    return this.findAll({
      ...query,
      customer_id: customerId,
    });
  }

  findOne(id: number) {
    return this.prisma.sales_orders.findUnique({
      where: { id },
      include: {
        customers: true,
        shipping_addresses: true,
        billing_addresses: true,
        sales_order_items: {
          include: {
            products: true,
            product_variants: true,
            inventory_locations: true,
          },
        },
      },
    });
  }

  async update(id: number, updateSalesOrderDto: UpdateSalesOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      // If items are being updated, recalculate totals
      if (updateSalesOrderDto.items) {
        const subtotal = updateSalesOrderDto.items.reduce(
          (sum, item) => sum + item.quantity * item.unit_price,
          0,
        );

        const totalAmount =
          subtotal -
          (updateSalesOrderDto.discount_amount || 0) +
          (updateSalesOrderDto.tax_amount || 0) +
          (updateSalesOrderDto.shipping_cost || 0);

        (updateSalesOrderDto as any).subtotal = subtotal;
        (updateSalesOrderDto as any).total_amount = totalAmount;
      }

      return tx.sales_orders.update({
        where: { id },
        data: updateSalesOrderDto,
        include: {
          customers: true,
          shipping_addresses: true,
          billing_addresses: true,
          sales_order_items: {
            include: {
              products: true,
              product_variants: true,
              inventory_locations: true,
            },
          },
        },
      });
    });
  }

  async confirm(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const salesOrder = await tx.sales_orders.findUnique({
        where: { id },
        include: { sales_order_items: true },
      });

      // Reserve stock for each item
      for (const item of salesOrder.sales_order_items) {
        await this.reserveStock(
          tx,
          item.product_id,
          item.location_id,
          item.quantity,
          item.product_variant_id,
        );
      }

      return tx.sales_orders.update({
        where: { id },
        data: {
          status: sales_order_status_enum.confirmed,
          confirmed_date: new Date(),
        },
        include: {
          customers: true,
          shipping_addresses: true,
          billing_addresses: true,
          sales_order_items: {
            include: {
              products: true,
              product_variants: true,
              inventory_locations: true,
            },
          },
        },
      });
    });
  }

  async ship(
    id: number,
    items: Array<{ id: number; quantity_shipped: number }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Update sales order items with shipped quantities
      for (const item of items) {
        await tx.sales_order_items.update({
          where: { id: item.id },
          data: {
            quantity_shipped: item.quantity_shipped,
            shipped_date: new Date(),
          },
        });
      }

      // Create inventory movements for shipped items
      const salesOrder = await tx.sales_orders.findUnique({
        where: { id },
        include: {
          sales_order_items: true,
        },
      });

      for (const item of salesOrder.sales_order_items) {
        const shippedItem = items.find((i) => i.id === item.id);
        if (shippedItem && shippedItem.quantity_shipped > 0) {
          // Create inventory movement
          await tx.inventory_movements.create({
            data: {
              organization_id: salesOrder.organization_id,
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              from_location_id: item.location_id,
              quantity: shippedItem.quantity_shipped,
              movement_type: 'sale',
              source_order_type: 'sales_order',
              source_order_id: id,
              reason: 'Sales order shipment',
              created_at: new Date(),
            },
          });

          // Update stock levels
          await this.updateStockLevel(
            tx,
            item.product_id,
            item.location_id,
            -shippedItem.quantity_shipped,
            item.product_variant_id,
          );

          // Release reserved stock
          await this.releaseStock(
            tx,
            item.product_id,
            item.location_id,
            shippedItem.quantity_shipped,
            item.product_variant_id,
          );
        }
      }

      // Check if all items are shipped
      const allItemsShipped = salesOrder.sales_order_items.every((item) => {
        const shippedItem = items.find((i) => i.id === item.id);
        return shippedItem && shippedItem.quantity_shipped >= item.quantity;
      });

      // Update sales order status
      const newStatus = allItemsShipped
        ? sales_order_status_enum.shipped
        : sales_order_status_enum.confirmed;

      return tx.sales_orders.update({
        where: { id },
        data: {
          status: newStatus,
          shipped_date: allItemsShipped ? new Date() : null,
        },
        include: {
          customers: true,
          shipping_addresses: true,
          billing_addresses: true,
          sales_order_items: {
            include: {
              products: true,
              product_variants: true,
              inventory_locations: true,
            },
          },
        },
      });
    });
  }

  async invoice(id: number) {
    return this.prisma.sales_orders.update({
      where: { id },
      data: {
        status: sales_order_status_enum.invoiced,
        invoiced_date: new Date(),
      },
      include: {
        customers: true,
        shipping_addresses: true,
        billing_addresses: true,
        sales_order_items: {
          include: {
            products: true,
            product_variants: true,
            inventory_locations: true,
          },
        },
      },
    });
  }

  async cancel(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const salesOrder = await tx.sales_orders.findUnique({
        where: { id },
        include: { sales_order_items: true },
      });

      // Release any reserved stock
      for (const item of salesOrder.sales_order_items) {
        if (item.quantity_reserved > 0) {
          await this.releaseStock(
            tx,
            item.product_id,
            item.location_id,
            item.quantity_reserved,
            item.product_variant_id,
          );
        }
      }

      return tx.sales_orders.update({
        where: { id },
        data: {
          status: sales_order_status_enum.cancelled,
          cancelled_date: new Date(),
        },
        include: {
          customers: true,
          shipping_addresses: true,
          billing_addresses: true,
          sales_order_items: {
            include: {
              products: true,
              product_variants: true,
              inventory_locations: true,
            },
          },
        },
      });
    });
  }

  remove(id: number) {
    return this.prisma.sales_orders.delete({
      where: { id },
    });
  }

  private async reserveStock(
    tx: any,
    productId: number,
    locationId: number,
    quantity: number,
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
      const newQuantityReserved = existingStock.quantity_reserved + quantity;
      const newQuantityAvailable = existingStock.quantity_available - quantity;

      return tx.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
        },
        data: {
          quantity_reserved: Math.max(0, newQuantityReserved),
          quantity_available: Math.max(0, newQuantityAvailable),
          last_updated: new Date(),
        },
      });
    }
  }

  private async releaseStock(
    tx: any,
    productId: number,
    locationId: number,
    quantity: number,
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
      const newQuantityReserved = existingStock.quantity_reserved - quantity;
      const newQuantityAvailable = existingStock.quantity_available + quantity;

      return tx.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
        },
        data: {
          quantity_reserved: Math.max(0, newQuantityReserved),
          quantity_available: Math.max(0, newQuantityAvailable),
          last_updated: new Date(),
        },
      });
    }
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
          last_updated: new Date(),
        },
      });
    }
  }
}
