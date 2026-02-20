import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrderQueryDto } from './dto/sales-order-query.dto';
import { sales_order_status_enum } from '@prisma/client';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { LocationsService } from '../../inventory/locations/locations.service';
import { InventoryIntegrationService } from '../../inventory/shared/services/inventory-integration.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { resolveCostPrice } from '../utils/resolve-cost-price';

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly inventoryService: InventoryIntegrationService,
    private readonly inventoryLocationsService: LocationsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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

      // Generate order number
      const orderNumber = await this.generateOrderNumber();

      // Create sales order
      const salesOrder = await tx.sales_orders.create({
        data: {
          ...createSalesOrderDto,
          order_number: orderNumber,
          subtotal,
          total_amount: totalAmount,
          order_date: createSalesOrderDto.order_date
            ? new Date(createSalesOrderDto.order_date)
            : new Date(),
          status: sales_order_status_enum.draft,
          created_at: new Date(),
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

      // Create order items and reserve stock immediately
      for (const item of createSalesOrderDto.items) {
        const cost_price = await resolveCostPrice(tx, item.product_id, item.product_variant_id);

        const orderItem = await tx.sales_order_items.create({
          data: {
            sales_order_id: salesOrder.id,
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            location_id: item.location_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.quantity * item.unit_price,
            cost_price,
            created_at: new Date(),
          },
        });

        // Reserve stock immediately
        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id || undefined,
          item.location_id || 1, // Use default location if not provided
          item.quantity,
          'order',
          salesOrder.id,
          1, // Use default user ID as fallback
        );
      }

      // Return the complete order with items
      return await tx.sales_orders.findUnique({
        where: { id: salesOrder.id },
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

  async confirm(id: number, confirmedByUserId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const salesOrder = await tx.sales_orders.findUnique({
        where: { id },
        include: { sales_order_items: true },
      });

      if (!salesOrder) {
        throw new NotFoundException('Sales order not found');
      }

      if (salesOrder.status !== sales_order_status_enum.draft) {
        throw new BadRequestException('Only draft orders can be confirmed');
      }

      // Stock is already reserved at creation time, so we just need to update status
      return tx.sales_orders.update({
        where: { id },
        data: {
          status: sales_order_status_enum.confirmed,
          approved_by_user_id: confirmedByUserId,
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
    shippedByUserId?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const salesOrder = await tx.sales_orders.findUnique({
        where: { id },
        include: {
          sales_order_items: true,
        },
      });

      if (!salesOrder) {
        throw new NotFoundException('Sales order not found');
      }

      if (salesOrder.status !== sales_order_status_enum.confirmed) {
        throw new BadRequestException('Only confirmed orders can be shipped');
      }

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

      // Process inventory for shipped items
      for (const item of salesOrder.sales_order_items) {
        const shippedItem = items.find((i) => i.id === item.id);
        if (shippedItem && shippedItem.quantity_shipped > 0) {
          // Consume stock using StockLevelManager
          await this.stockLevelManager.updateStock({
            product_id: item.product_id,
            variant_id: item.product_variant_id,
            location_id: item.location_id,
            quantity_change: -shippedItem.quantity_shipped,
            movement_type: 'sale',
            reason: `Sales order ${salesOrder.order_number} shipment`,
            user_id: shippedByUserId,
            order_item_id: item.id,
            create_movement: true,
            validate_availability: true,
          });

          // Release reserved stock
          await this.stockLevelManager.releaseReservation(
            item.product_id,
            item.product_variant_id,
            item.location_id,
            'order',
            id,
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

  async cancel(id: number, cancelledByUserId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const salesOrder = await tx.sales_orders.findUnique({
        where: { id },
        include: { sales_order_items: true },
      });

      if (!salesOrder) {
        throw new NotFoundException('Sales order not found');
      }

      if (salesOrder.status === sales_order_status_enum.cancelled) {
        throw new BadRequestException('Order is already cancelled');
      }

      if (salesOrder.status === sales_order_status_enum.shipped) {
        throw new BadRequestException('Cannot cancel shipped order');
      }

      // Release all reserved stock
      for (const item of salesOrder.sales_order_items) {
        await this.stockLevelManager.releaseReservation(
          item.product_id,
          item.product_variant_id,
          item.location_id,
          'order',
          id,
        );
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

  /**
   * Genera un número de orden único
   */
  private async generateOrderNumber(): Promise<string> {
    const prefix = 'SO';
    const date = new Date();
    const dateStr =
      date.getFullYear().toString() +
      (date.getMonth() + 1).toString().padStart(2, '0') +
      date.getDate().toString().padStart(2, '0');

    // Find the last order number for today
    const lastOrder = await this.prisma.sales_orders.findFirst({
      where: {
        order_number: {
          startsWith: `${prefix}${dateStr}`,
        },
      },
      orderBy: {
        order_number: 'desc',
      },
    });

    let sequence = 1;
    if (lastOrder) {
      const lastSequence = parseInt(lastOrder.order_number.slice(-4));
      sequence = lastSequence + 1;
    }

    return `${prefix}${dateStr}${sequence.toString().padStart(4, '0')}`;
  }
}
