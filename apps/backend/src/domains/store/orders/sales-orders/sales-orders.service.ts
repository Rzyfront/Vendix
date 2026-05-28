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
import { S3Service } from '@common/services/s3.service';
import { resolveCostPrice } from '../utils/resolve-cost-price';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly inventoryService: InventoryIntegrationService,
    private readonly inventoryLocationsService: LocationsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly eventEmitter: EventEmitter2,
    private readonly s3Service: S3Service,
  ) {}

  async create(createSalesOrderDto: CreateSalesOrderDto) {
    // Multi-tarifa: si alguna línea trae applied_price_tier_id, validar
    // permission y resolver snapshot ANTES de abrir la transacción. UI no es
    // fuente de verdad — el gate vive en el backend.
    const context = RequestContextService.getContext();
    const tierSnapshots = await this.resolveTierSnapshotsForItems(
      createSalesOrderDto.items,
      context,
    );

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
              products: {
                include: {
                  product_images: { where: { is_main: true }, take: 1 },
                },
              },
              product_variants: true,
              inventory_locations: true,
            },
          },
        },
      });

      // Create order items and reserve stock immediately
      for (let index = 0; index < createSalesOrderDto.items.length; index++) {
        const item = createSalesOrderDto.items[index];
        const tierSnap = tierSnapshots[index];
        const cost_price = await resolveCostPrice(
          tx,
          item.product_id,
          item.product_variant_id,
        );

        // Snapshot variant image S3 key (never signed URL)
        let variant_image_url: string | null = null;
        if (item.product_variant_id) {
          const variant = await tx.product_variants.findUnique({
            where: { id: item.product_variant_id },
            include: { product_images: true },
          });
          variant_image_url = variant?.product_images?.image_url ?? null;
        }

        await tx.sales_order_items.create({
          data: {
            sales_order_id: salesOrder.id,
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            location_id: item.location_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.quantity * item.unit_price,
            cost_price,
            variant_image_url,
            // Multi-tarifa snapshot (Phase 1.5)
            applied_price_tier_id: tierSnap?.tier_id ?? null,
            applied_price_tier_name_snapshot: tierSnap?.tier_name ?? null,
            stock_units_consumed: tierSnap?.stock_units_consumed ?? null,
            created_at: new Date(),
          },
        });

        // Multi-tarifa: si el tier persistió stock_units_consumed (>0),
        // pasarlo como override al reservador.
        const stockUnitsConsumed =
          typeof tierSnap?.stock_units_consumed === 'number' &&
          tierSnap.stock_units_consumed > 0
            ? tierSnap.stock_units_consumed
            : undefined;

        // Reserve stock immediately
        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id || undefined,
          item.location_id || 1, // Use default location if not provided
          item.quantity,
          'order',
          salesOrder.id,
          1, // Use default user ID as fallback
          true,
          undefined,
          undefined,
          false,
          stockUnitsConsumed,
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
              products: {
                include: {
                  product_images: { where: { is_main: true }, take: 1 },
                },
              },
              product_variants: true,
              inventory_locations: true,
            },
          },
        },
      });
    });
  }

  async findAll(query: SalesOrderQueryDto) {
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

    const orders = await this.prisma.sales_orders.findMany({
      where,
      include: {
        customers: true,
        shipping_addresses: true,
        billing_addresses: true,
        sales_order_items: {
          include: {
            products: {
              include: {
                product_images: { where: { is_main: true }, take: 1 },
              },
            },
            product_variants: true,
            inventory_locations: true,
          },
        },
      },
      orderBy: {
        order_date: 'desc',
      },
    });

    await Promise.all(orders.map((order) => this.signOrderItemImages(order)));

    return orders;
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

  async findOne(id: number) {
    const order = await this.prisma.sales_orders.findUnique({
      where: { id },
      include: {
        customers: true,
        shipping_addresses: true,
        billing_addresses: true,
        sales_order_items: {
          include: {
            products: {
              include: {
                product_images: { where: { is_main: true }, take: 1 },
              },
            },
            product_variants: true,
            inventory_locations: true,
          },
        },
      },
    });

    if (order) {
      await this.signOrderItemImages(order);
    }

    return order;
  }

  async update(id: number, updateSalesOrderDto: UpdateSalesOrderDto) {
    // Multi-tarifa: si las líneas a actualizar traen applied_price_tier_id,
    // revalida el permission server-side. Esto es defensivo: aunque el shape
    // actual de update no recree las líneas, el gate evita que un caller
    // confíe en la UI y la rompa después.
    if (updateSalesOrderDto.items?.length) {
      const ctx = RequestContextService.getContext();
      await this.resolveTierSnapshotsForItems(updateSalesOrderDto.items, ctx);
    }

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
              products: {
                include: {
                  product_images: { where: { is_main: true }, take: 1 },
                },
              },
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
              products: {
                include: {
                  product_images: { where: { is_main: true }, take: 1 },
                },
              },
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
              products: {
                include: {
                  product_images: { where: { is_main: true }, take: 1 },
                },
              },
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
            products: {
              include: {
                product_images: { where: { is_main: true }, take: 1 },
              },
            },
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
              products: {
                include: {
                  product_images: { where: { is_main: true }, take: 1 },
                },
              },
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
   * Multi-tarifa: resuelve snapshots por línea (id, nombre, stock_units_consumed).
   *
   * Replica el patrón de `OrdersService.resolveTierSnapshotsForItems`:
   * - Si NINGUNA línea trae `applied_price_tier_id`, retorna un array de `null`
   *   alineado por índice (sin overhead).
   * - Si AL MENOS UNA línea lo trae, valida que el usuario tenga el permission
   *   `store:products:apply_pricing_tier`. Si no, lanza
   *   `VendixHttpException(PRICING_TIER_PERMISSION_DENIED)` (403).
   * - Carga tarifas (auto-scoped por store) y productos (para resolver
   *   `quantity × units_per_package` cuando aplica empaque real).
   */
  private async resolveTierSnapshotsForItems(
    items: Array<{
      product_id?: number;
      quantity: number;
      applied_price_tier_id?: number;
    }>,
    context: ReturnType<typeof RequestContextService.getContext>,
  ): Promise<
    Array<{
      tier_id: number;
      tier_name: string;
      stock_units_consumed: number | null;
    } | null>
  > {
    const tierIdsInUse = new Set<number>();
    for (const item of items) {
      if (
        item.applied_price_tier_id !== undefined &&
        item.applied_price_tier_id !== null
      ) {
        tierIdsInUse.add(Number(item.applied_price_tier_id));
      }
    }

    if (tierIdsInUse.size === 0) {
      return items.map(() => null);
    }

    // Permission gate (server-side; UI cannot bypass).
    const permissions = context?.permissions ?? [];
    const isSuperAdmin = !!context?.is_super_admin;
    const isOwner = !!context?.is_owner;
    if (
      !isSuperAdmin &&
      !isOwner &&
      !permissions.includes('store:products:apply_pricing_tier')
    ) {
      throw new VendixHttpException(ErrorCodes.PRICING_TIER_PERMISSION_DENIED);
    }

    const tiers = await this.prisma.price_tiers.findMany({
      where: { id: { in: Array.from(tierIdsInUse) }, is_active: true },
      select: { id: true, name: true, is_package_unit: true },
    });
    type TierRow = (typeof tiers)[number];
    const tierById = new Map<number, TierRow>(
      tiers.map((t): [number, TierRow] => [t.id, t]),
    );

    const productIds = Array.from(
      new Set(
        items.map((i) => i.product_id).filter((id): id is number => !!id),
      ),
    );
    const productsList = productIds.length
      ? await this.prisma.products.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            units_per_package: true,
            package_consumes_multiple_stock: true,
          },
        })
      : [];
    type ProductRow = (typeof productsList)[number];
    const productById = new Map<number, ProductRow>(
      productsList.map((p): [number, ProductRow] => [p.id, p]),
    );
    const assignments = productIds.length
      ? await this.prisma.product_price_tier_assignments.findMany({
          where: {
            product_id: { in: productIds },
            price_tier_id: { in: Array.from(tierIdsInUse) },
          },
          select: { product_id: true, price_tier_id: true },
        })
      : [];
    const allowedTierKeys = new Set(
      assignments.map((assignment) =>
        `${assignment.product_id}:${assignment.price_tier_id}`,
      ),
    );

    return items.map((item) => {
      const tierId = item.applied_price_tier_id;
      if (tierId === undefined || tierId === null) return null;
      const tier = tierById.get(Number(tierId));
      if (!tier) {
        throw new VendixHttpException(ErrorCodes.PRICE_TIER_NOT_ALLOWED);
      }
      const productId = item.product_id;
      if (!productId || !allowedTierKeys.has(`${productId}:${Number(tierId)}`)) {
        throw new VendixHttpException(ErrorCodes.PRICE_TIER_NOT_ALLOWED);
      }
      const product = item.product_id
        ? productById.get(item.product_id)
        : null;
      const isPackage =
        tier.is_package_unit &&
        product?.package_consumes_multiple_stock === true &&
        typeof product.units_per_package === 'number' &&
        (product.units_per_package ?? 0) > 0;
      const stock_units_consumed = isPackage
        ? Number(item.quantity) * Number(product!.units_per_package)
        : null;
      return {
        tier_id: tier.id,
        tier_name: tier.name,
        stock_units_consumed,
      };
    });
  }

  /**
   * Signs S3 image URLs for all products in sales order items.
   */
  private async signOrderItemImages(order: any): Promise<void> {
    if (!order.sales_order_items?.length) return;

    await Promise.all(
      order.sales_order_items.map(async (item: any) => {
        if (item.products?.product_images?.length) {
          const mainImage = item.products.product_images[0];
          mainImage.image_url = await this.s3Service.signUrl(
            mainImage.image_url,
          );
          item.products.image_url = mainImage.image_url;
        }
        if (item.variant_image_url) {
          item.variant_image_url = await this.s3Service.signUrl(
            item.variant_image_url,
          );
        }
      }),
    );
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
