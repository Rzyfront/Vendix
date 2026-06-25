import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import {
  CreateOrderDto,
  UpdateOrderDto,
  OrderQueryDto,
  UpdateOrderItemsDto,
  AssignShippingMethodDto,
} from './dto';
import {
  Prisma,
  order_state_enum,
  order_delivery_type_enum,
} from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { OrderStatsDto } from './dto/order-stats.dto';
import { S3Service } from '@common/services/s3.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { resolveCostPrice } from './utils/resolve-cost-price';
import { SettingsService } from '../settings/settings.service';
import { ScheduleValidationService } from '../settings/schedule-validation.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { ShippingCalculatorService } from '../shipping/shipping-calculator.service';
import { resolveStockUnitsConsumed } from '../products/services/packaging.util';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: StorePrismaService,
    private s3Service: S3Service,
    private eventEmitter: EventEmitter2,
    private settingsService: SettingsService,
    private scheduleValidationService: ScheduleValidationService,
    private stockLevelManager: StockLevelManager,
    private shippingCalculatorService: ShippingCalculatorService,
  ) {}

  async create(createOrderDto: CreateOrderDto, creatingUser: any) {
    // Enforce store context
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Backward-compat: if the client sent store_id in body, it must match context.
    // If absent, derive it from context (authoritative source).
    if (
      createOrderDto.store_id !== undefined &&
      createOrderDto.store_id !== null &&
      createOrderDto.store_id !== store_id
    ) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'store_id in body does not match the authenticated context',
      );
    }
    createOrderDto.store_id = store_id;

    // Multi-tarifa: si alguna línea trae applied_price_tier_id, validar
    // permiso server-side ANTES de crear la orden. UI no es fuente de verdad.
    const tierSnapshots = await this.resolveTierSnapshotsForItems(
      createOrderDto.items,
      context,
    );

    // Validar horario de atención antes de crear la orden
    if (!createOrderDto.skip_schedule_validation) {
      await this.scheduleValidationService.validateOrThrow(store_id, true);
    }

    // `customer_id` is optional (POS counter / table-less flows may omit
    // it for an anonymous "Consumidor Final" sale). Only validate the
    // foreign key when the caller actually provided one.
    if (createOrderDto.customer_id != null) {
      const user = await this.prisma.users.findUnique({
        where: { id: createOrderDto.customer_id },
      });
      if (!user) {
        throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
      }
    }

    // Validate weight product coherence
    for (const item of createOrderDto.items) {
      if (item.weight !== undefined && item.weight !== null) {
        if (item.weight <= 0) {
          throw new VendixHttpException(ErrorCodes.ORD_VALIDATE_001);
        }
        if (!item.weight_unit) {
          throw new VendixHttpException(ErrorCodes.ORD_VALIDATE_001);
        }
      }
    }

    let retries = 3;
    while (retries > 0) {
      try {
        if (!createOrderDto.order_number) {
          createOrderDto.order_number =
            await this.generateOrderNumber(store_id);
        }

        // Use scoped client (creates are not scoped by extension but using correct service is good style)
        const order = await this.prisma.orders.create({
          data: {
            customer_id: createOrderDto.customer_id ?? null,
            store_id: store_id, // Force strict store_id
            order_number: createOrderDto.order_number,
            state: createOrderDto.state || order_state_enum.created,
            subtotal_amount: createOrderDto.subtotal,
            tax_amount: createOrderDto.tax_amount || 0,
            shipping_cost: createOrderDto.shipping_cost || 0,
            discount_amount: createOrderDto.discount_amount || 0,
            grand_total: createOrderDto.total_amount,
            currency:
              createOrderDto.currency ||
              (await this.settingsService.getStoreCurrency()),
            billing_address_id: createOrderDto.billing_address_id,
            shipping_address_id: createOrderDto.shipping_address_id,
            internal_notes: createOrderDto.internal_notes,
            notes: createOrderDto.notes,
            updated_at: new Date(),
            order_items: {
              create: await Promise.all(
                createOrderDto.items.map(async (item, index) => {
                  // Resolve product type for snapshot
                  const product = item.product_id
                    ? await this.prisma.products.findUnique({
                        where: { id: item.product_id },
                        select: { product_type: true },
                      })
                    : null;
                  const itemType =
                    item.item_type === 'product'
                      ? product?.product_type || 'physical'
                      : item.item_type || product?.product_type || 'custom';
                  const tierSnap = tierSnapshots[index];
                  // Snapshot variant image S3 key (never signed URL)
                  let variant_image_url: string | null = null;
                  if (item.product_id && item.product_variant_id) {
                    const variant =
                      await this.prisma.product_variants.findUnique({
                        where: { id: item.product_variant_id },
                        include: { product_images: true },
                      });
                    variant_image_url =
                      variant?.product_images?.image_url ?? null;
                  }
                  return {
                    product_id: item.product_id || null,
                    product_variant_id: item.product_id
                      ? item.product_variant_id
                      : null,
                    product_name: item.product_name,
                    description: item.description,
                    variant_sku: item.variant_sku,
                    variant_attributes: item.variant_attributes,
                    variant_image_url,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    total_price: item.total_price,
                    tax_rate: item.tax_rate,
                    tax_amount_item: item.tax_amount_item,
                    catalog_unit_price: item.catalog_unit_price,
                    catalog_final_price: item.catalog_final_price,
                    final_unit_price: item.final_unit_price ?? item.unit_price,
                    is_price_overridden:
                      item.is_price_overridden ??
                      Boolean(item.price_override_reason),
                    price_override_reason: item.price_override_reason,
                    weight: item.weight,
                    weight_unit: item.weight_unit,
                    item_type: itemType,
                    cost_price: item.product_id
                      ? await resolveCostPrice(
                          this.prisma,
                          item.product_id,
                          item.product_variant_id,
                        )
                      : null,
                    // Multi-tarifa snapshot (Phase 2)
                    applied_price_tier_id: tierSnap?.tier_id ?? null,
                    applied_price_tier_name_snapshot:
                      tierSnap?.tier_name ?? null,
                    stock_units_consumed:
                      tierSnap?.stock_units_consumed ?? null,
                    updated_at: new Date(),
                  };
                }),
              ),
            },
          },
          include: {
            stores: { select: { id: true, name: true, store_code: true } },
            order_items: {
              include: { products: true, product_variants: true },
            },
          },
        });

        // Reserve stock for each item with track_inventory
        for (const item of order.order_items) {
          if (!item.products?.track_inventory) continue;
          try {
            const location_id =
              await this.stockLevelManager.getDefaultLocationForProduct(
                item.product_id,
                item.product_variant_id || undefined,
              );
            // Multi-tarifa: si el item persistió stock_units_consumed (>0),
            // pasarlo como override al reservador.
            const stockUnitsConsumed =
              typeof item.stock_units_consumed === 'number' &&
              item.stock_units_consumed > 0
                ? item.stock_units_consumed
                : undefined;
            await this.stockLevelManager.reserveStock(
              item.product_id,
              item.product_variant_id || undefined,
              location_id,
              item.quantity,
              'order',
              order.id,
              creatingUser?.id,
              false, // POS: don't validate availability (non-restrictive UX)
              undefined,
              undefined,
              false,
              stockUnitsConsumed,
            );
          } catch (error) {
            this.logger.warn(
              `Stock reservation failed for product ${item.product_id}: ${error.message}`,
            );
          }
        }

        this.eventEmitter.emit('order.created', {
          store_id: order.store_id,
          order_id: order.id,
          order_number: order.order_number,
          grand_total: order.grand_total,
          currency: order.currency,
        });

        return order;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // Check if the unique constraint failure is indeed on order_number
          const target = error.meta?.target as string[];
          if (Array.isArray(target) && target.includes('order_number')) {
            retries--;
            if (retries === 0) {
              throw new ConflictException(
                'Failed to generate unique order number after multiple attempts',
              );
            }
            // Reset order_number to null so it gets regenerated in the next iteration
            createOrderDto.order_number = undefined;
            continue;
          }
        }
        throw error;
      }
    }
  }

  async findAll(query: OrderQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      customer_id,
      // store_id removed: StorePrismaService auto-scopes /store/* queries.
      sort_by,
      sort_order,
      date_from,
      date_to,
      channel,
    } = query;
    const skip = (page - 1) * limit;

    // Context validation handled by StorePrismaService auto-scoping

    // Auto-scoped query
    const where: Prisma.ordersWhereInput = {
      ...(search && {
        // Search by order number OR by customer (first_name, last_name, email).
        // Customer is reached via orders.users (customer_id). Guest orders
        // (customer_id null) are not matched by this branch — their name lives
        // in shipping_address_snapshot JSON (search fragile, out of scope).
        OR: [
          { order_number: { contains: search, mode: 'insensitive' } },
          { users: { first_name: { contains: search, mode: 'insensitive' } } },
          { users: { last_name: { contains: search, mode: 'insensitive' } } },
          { users: { email: { contains: search, mode: 'insensitive' } } },
        ],
      }),
      ...(status && { state: status }),
      ...(customer_id && { customer_id }),
      ...(channel && { channel }),
      ...(query.missing_shipping_method && {
        shipping_method_id: null,
        delivery_type: { not: 'direct_delivery' },
        state: { notIn: ['finished', 'cancelled', 'refunded'] },
      }),
      // "Despachable" — ref 2026-06-25, plan wizard remisión order-first.
      // Single source of truth compartido con stores.service.ts dispatchWhere:
      // state=processing + delivery_type ≠ direct_delivery (incluye
      // home_delivery, pickup y other). Coincide con el dashboard de
      // tienda y el filtro "Por enviar" del frontend.
      // NOTA: NO excluye órdenes parcialmente remisionadas; el frontend
      // descuenta cantidades ya despachadas vía getByOrder(orderId).
      ...(query.dispatchable && {
        state: 'processing',
        delivery_type: { not: 'direct_delivery' },
      }),
      ...(date_from &&
        date_to && {
          created_at: {
            gte: new Date(date_from),
            lte: new Date(date_to),
          },
        }),
    };

    const orderBy: Prisma.ordersOrderByWithRelationInput = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [orders, total] = await Promise.all([
      this.prisma.orders.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: {
            select: { id: true, product_name: true, quantity: true },
          },
        },
      }),
      this.prisma.orders.count({ where }),
    ]);

    return {
      data: orders,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    // Auto-scoped by StorePrismaService
    const order = await this.prisma.orders.findFirst({
      where: {
        id,
      },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: {
          include: {
            products: {
              include: {
                product_images: {
                  where: { is_main: true },
                  take: 1,
                },
              },
            },
            product_variants: true,
            // Restaurant Suite — Fase K Gap 2: surface the KDS state
            // for every order_item so the order detail can show
            // "Cocina: <estado>" badges per dish. We order by id desc
            // so the most recent ticket-item wins; the controller
            // post-filters to the non-terminal (or newest terminal)
            // row in the response shape.
            kitchen_ticket_items: {
              orderBy: { id: 'desc' },
              select: {
                id: true,
                status: true,
                kitchen_ticket_id: true,
                kitchen_ticket: {
                  select: {
                    id: true,
                    status: true,
                    daily_number: true,
                    fired_at: true,
                  },
                },
              },
            },
          },
        },
        addresses_orders_billing_address_idToaddresses: true,
        addresses_orders_shipping_address_idToaddresses: true,
        payments: {
          include: {
            store_payment_method: {
              include: { system_payment_method: true },
            },
          },
          orderBy: { created_at: 'asc' },
        },
        shipping_method: {
          select: {
            id: true,
            name: true,
            type: true,
            provider_name: true,
            min_days: true,
            max_days: true,
            logo_url: true,
          },
        },
        shipping_rate: {
          include: {
            shipping_zone: {
              select: { id: true, name: true, display_name: true },
            },
          },
        },
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
            avatar_url: true,
          },
        },
        order_installments: {
          orderBy: { installment_number: 'asc' },
        },
        // Persisted discount snapshots — read what was actually charged,
        // never recalculate against current promotions/coupons.
        order_promotions: {
          select: {
            id: true,
            promotion_id: true,
            customer_id: true,
            discount_amount: true,
            created_at: true,
            promotions: {
              select: {
                id: true,
                name: true,
                code: true,
                type: true,
                scope: true,
                value: true,
              },
            },
          },
          orderBy: { created_at: 'asc' },
        },
        coupon_uses: {
          select: {
            id: true,
            coupon_id: true,
            customer_id: true,
            discount_applied: true,
            used_at: true,
            coupon: {
              select: {
                id: true,
                code: true,
                name: true,
                discount_type: true,
                discount_value: true,
              },
            },
          },
          orderBy: { used_at: 'asc' },
        },
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
    }

    // Sign S3 image URLs for order items products
    await this.signOrderItemImages(order);

    return order;
  }

  /**
   * Signs S3 image URLs for all products in order items.
   * Mutates the order object in-place for performance.
   */
  private async signOrderItemImages(order: any): Promise<void> {
    if (!order.order_items?.length) return;

    await Promise.all(
      order.order_items.map(async (item: any) => {
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

  async getPaymentReceiptUrl(
    orderId: number,
    paymentId: number,
  ): Promise<{ url: string; expires_at: string; content_type?: string }> {
    const payment = await this.prisma.payments.findFirst({
      where: { id: paymentId, order_id: orderId },
      select: {
        id: true,
        order_id: true,
        receipt_s3_key: true,
        receipt_uploaded_at: true,
      },
    });

    if (!payment) {
      throw new VendixHttpException(ErrorCodes.PAY_FIND_001);
    }

    if (!payment.receipt_s3_key) {
      throw new VendixHttpException(ErrorCodes.PAY_RECEIPT_NOT_FOUND_001);
    }

    const TTL_SECONDS = 300;
    const url = await this.s3Service.getPresignedUrl(
      payment.receipt_s3_key,
      TTL_SECONDS,
    );
    const expires_at = new Date(
      Date.now() + TTL_SECONDS * 1000,
    ).toISOString();

    return { url, expires_at };
  }

  async update(id: number, updateOrderDto: UpdateOrderDto) {
    const order = await this.findOne(id);

    // Derive delivery_type from shipping method if not explicitly provided
    if (updateOrderDto.shipping_method_id && !updateOrderDto.delivery_type) {
      const method = await this.prisma.shipping_methods.findUnique({
        where: { id: updateOrderDto.shipping_method_id },
        select: { type: true },
      });
      if (!method) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_001);
      }
      updateOrderDto.delivery_type =
        method.type === 'pickup'
          ? order_delivery_type_enum.pickup
          : order_delivery_type_enum.home_delivery;
    }

    // Recalculate grand_total if shipping_cost changes
    if (updateOrderDto.shipping_cost !== undefined) {
      const subtotal = Number(order.subtotal_amount);
      const tax = Number(order.tax_amount);
      const discount = Number(order.discount_amount);
      const shipping = Number(updateOrderDto.shipping_cost);
      (updateOrderDto as any).grand_total =
        subtotal + tax - discount + shipping;
    }

    return this.prisma.orders.update({
      where: { id },
      data: { ...updateOrderDto, updated_at: new Date() },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: {
          include: {
            products: {
              include: {
                product_images: {
                  where: { is_main: true },
                  take: 1,
                },
              },
            },
            product_variants: true,
          },
        },
        addresses_orders_billing_address_idToaddresses: true,
        addresses_orders_shipping_address_idToaddresses: true,
        payments: true,
        shipping_method: {
          select: {
            id: true,
            name: true,
            type: true,
            provider_name: true,
            min_days: true,
            max_days: true,
            logo_url: true,
          },
        },
        shipping_rate: {
          include: {
            shipping_zone: {
              select: { id: true, name: true, display_name: true },
            },
          },
        },
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
            avatar_url: true,
          },
        },
      },
    });
  }

  async updateOrderItems(id: number, dto: UpdateOrderItemsDto) {
    const order = await this.findOne(id);

    if (order.state !== 'created' && order.state !== 'draft') {
      throw new VendixHttpException(ErrorCodes.ORD_STATUS_001);
    }

    // Las órdenes de mesa nacen en 'draft' SIN reservar stock (se reserva al
    // pagar vía promoteDraftToCreated). Al editar un draft NO liberamos ni
    // re-reservamos: no hay reservas que liberar y re-reservar duplicaría el
    // descuento con inventory_consumed_at_fire. Para 'created' sí (flujo actual).
    const isDraft = order.state === 'draft';

    // Multi-tarifa: revalida permission + recalcula snapshots si las nuevas
    // líneas traen applied_price_tier_id.
    const ctx = RequestContextService.getContext();
    const tierSnapshots = await this.resolveTierSnapshotsForItems(
      dto.items,
      ctx,
    );

    // Calculate totals from items
    const subtotal =
      dto.subtotal ??
      dto.items.reduce((sum, item) => sum + item.total_price, 0);
    const taxAmount =
      dto.tax_amount ??
      dto.items.reduce((sum, item) => sum + (item.tax_amount_item || 0), 0);
    const discountAmount = dto.discount_amount ?? 0;
    const grandTotal =
      dto.total_amount ?? subtotal + taxAmount - discountAmount;

    return this.prisma.$transaction(async (tx) => {
      // Release old reservations before deleting items
      const existingOrder = await tx.orders.findUnique({
        where: { id },
        include: {
          order_items: {
            include: {
              products: { select: { id: true, track_inventory: true } },
            },
          },
        },
      });

      if (!isDraft) {
        for (const item of existingOrder?.order_items || []) {
          if (!item.products?.track_inventory) continue;
          try {
            const location_id =
              await this.stockLevelManager.getDefaultLocationForProduct(
                item.product_id,
                item.product_variant_id || undefined,
              );
            await this.stockLevelManager.releaseReservation(
              item.product_id,
              item.product_variant_id || undefined,
              location_id,
              'order',
              id,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to release reservation for product ${item.product_id}: ${error.message}`,
            );
          }
        }
      }

      // Delete existing items
      await tx.order_items.deleteMany({
        where: { order_id: id },
      });

      // Pre-resolve variant image S3 keys for items that have a variant
      const variantIds = dto.items
        .map((it) => (it.product_id ? it.product_variant_id : null))
        .filter((v): v is number => typeof v === 'number');
      const variantImageById = new Map<number, string | null>();
      if (variantIds.length) {
        const variants = await tx.product_variants.findMany({
          where: { id: { in: Array.from(new Set(variantIds)) } },
          include: { product_images: true },
        });
        for (const v of variants) {
          variantImageById.set(v.id, v.product_images?.image_url ?? null);
        }
      }

      // Create new items
      await tx.order_items.createMany({
        data: dto.items.map((item, index) => {
          const tierSnap = tierSnapshots[index];
          const variant_image_url =
            item.product_id && item.product_variant_id
              ? variantImageById.get(item.product_variant_id) ?? null
              : null;
          return {
            order_id: id,
            product_id: item.product_id || null,
            product_variant_id: item.product_id
              ? item.product_variant_id
              : null,
            product_name: item.product_name,
            description: item.description,
            variant_sku: item.variant_sku,
            variant_attributes: item.variant_attributes,
            variant_image_url,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.total_price,
            tax_rate: item.tax_rate,
            tax_amount_item: item.tax_amount_item,
            catalog_unit_price: item.catalog_unit_price,
            catalog_final_price: item.catalog_final_price,
            final_unit_price: item.final_unit_price ?? item.unit_price,
            is_price_overridden:
              item.is_price_overridden ??
              Boolean(item.price_override_reason),
            price_override_reason: item.price_override_reason,
            weight: item.weight,
            weight_unit: item.weight_unit,
            item_type:
              item.item_type === 'product'
                ? 'physical'
                : item.item_type || (item.product_id ? 'physical' : 'custom'),
            // Multi-tarifa snapshot
            applied_price_tier_id: tierSnap?.tier_id ?? null,
            applied_price_tier_name_snapshot: tierSnap?.tier_name ?? null,
            stock_units_consumed: tierSnap?.stock_units_consumed ?? null,
            updated_at: new Date(),
          };
        }),
      });

      // Update order totals
      await tx.orders.update({
        where: { id },
        data: {
          subtotal_amount: subtotal,
          tax_amount: taxAmount,
          discount_amount: discountAmount,
          grand_total: grandTotal,
          updated_at: new Date(),
        },
      });

      // Reserve stock for new items
      const updatedOrder = await tx.orders.findUnique({
        where: { id },
        include: {
          order_items: {
            include: {
              products: { select: { id: true, track_inventory: true } },
            },
          },
        },
      });

      if (!isDraft) {
        for (const item of updatedOrder?.order_items || []) {
          if (!item.products?.track_inventory) continue;
          try {
            const location_id =
              await this.stockLevelManager.getDefaultLocationForProduct(
                item.product_id,
                item.product_variant_id || undefined,
              );
            const stockUnitsConsumed =
              typeof item.stock_units_consumed === 'number' &&
              item.stock_units_consumed > 0
                ? item.stock_units_consumed
                : undefined;
            await this.stockLevelManager.reserveStock(
              item.product_id,
              item.product_variant_id || undefined,
              location_id,
              item.quantity,
              'order',
              id,
              undefined,
              false, // Don't validate availability (non-restrictive UX)
              undefined,
              undefined,
              false,
              stockUnitsConsumed,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to reserve stock for product ${item.product_id}: ${error.message}`,
            );
          }
        }
      }

      // Return updated order with all includes
      return tx.orders.findFirst({
        where: { id },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: {
            include: {
              products: {
                include: {
                  product_images: {
                    where: { is_main: true },
                    take: 1,
                  },
                },
              },
              product_variants: true,
            },
          },
          addresses_orders_billing_address_idToaddresses: true,
          addresses_orders_shipping_address_idToaddresses: true,
          payments: true,
          users: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
              avatar_url: true,
            },
          },
        },
      });
    });
  }

  async assignShipping(orderId: number, dto: AssignShippingMethodDto) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const order = await this.prisma.orders.findFirst({
      where: { id: orderId, store_id: storeId },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
    }

    const lockedStates: string[] = [
      'shipped',
      'delivered',
      'finished',
      'cancelled',
      'refunded',
    ];
    if (lockedStates.includes(order.state)) {
      throw new VendixHttpException(ErrorCodes.ORD_SHIP_LOCKED_001);
    }

    const method = await this.prisma.shipping_methods.findFirst({
      where: { id: dto.shipping_method_id, store_id: storeId, is_active: true },
    });

    if (!method) {
      throw new VendixHttpException(ErrorCodes.ORD_SHIP_INVALID_METHOD_001);
    }

    let shippingCost = dto.shipping_cost ?? 0;
    let resolvedRateId: number | null = dto.shipping_rate_id ?? null;

    // Auto-calculate: resolve rate + cost from customer's shipping address
    if (dto.auto_calculate && !dto.shipping_rate_id) {
      const orderForCalc = await this.prisma.orders.findFirst({
        where: { id: orderId },
        include: {
          addresses_orders_shipping_address_idToaddresses: true,
          order_items: {
            include: {
              products: {
                select: { id: true, weight: true, product_type: true },
              },
            },
          },
        },
      });

      const address =
        orderForCalc?.addresses_orders_shipping_address_idToaddresses;
      if (!address || !address.country_code) {
        throw new VendixHttpException(
          ErrorCodes.ORD_SHIP_NO_RATE_FOR_ADDRESS_001,
        );
      }

      const items = (orderForCalc?.order_items ?? []).map((it) => ({
        product_id: it.product_id,
        quantity: Number(it.quantity),
        price: Number(it.total_price),
        weight: it.weight
          ? Number(it.weight)
          : it.products?.weight
            ? Number(it.products.weight) * Number(it.quantity)
            : undefined,
        product_type: it.products?.product_type || undefined,
      }));

      const options = await this.shippingCalculatorService.calculateRates(
        storeId,
        items,
        {
          country_code: address.country_code,
          state_province: address.state_province || undefined,
          city: address.city || undefined,
          postal_code: address.postal_code || undefined,
        },
      );

      const match = options.find((o) => o.method_id === method.id);
      if (!match) {
        throw new VendixHttpException(
          ErrorCodes.ORD_SHIP_NO_RATE_FOR_ADDRESS_001,
        );
      }

      resolvedRateId = match.rate_id;
      if (dto.shipping_cost === undefined) {
        shippingCost = Number(match.cost);
      }
    } else if (dto.shipping_rate_id) {
      const rate = await this.prisma.shipping_rates.findFirst({
        where: { id: dto.shipping_rate_id, is_active: true },
      });

      if (!rate || rate.shipping_method_id !== method.id) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_RATE_MISMATCH_001);
      }

      if (dto.shipping_cost === undefined) {
        shippingCost = Number(rate.base_cost);
      }
    }

    const { deriveDeliveryType } =
      await import('../shipping/shipping-derivation.util');
    const deliveryType = deriveDeliveryType(method.type);

    const newGrandTotal =
      Number(order.subtotal_amount) +
      Number(order.tax_amount) -
      Number(order.discount_amount) +
      shippingCost;

    const updated = await this.prisma.orders.update({
      where: { id: orderId },
      data: {
        shipping_method_id: method.id,
        shipping_rate_id: resolvedRateId,
        delivery_type: deliveryType,
        shipping_cost: shippingCost,
        grand_total: newGrandTotal,
        updated_at: new Date(),
      },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: {
          include: {
            products: {
              include: {
                product_images: { where: { is_main: true }, take: 1 },
              },
            },
            product_variants: true,
          },
        },
        addresses_orders_billing_address_idToaddresses: true,
        addresses_orders_shipping_address_idToaddresses: true,
        payments: {
          include: {
            store_payment_method: {
              include: { system_payment_method: true },
            },
          },
          orderBy: { created_at: 'asc' },
        },
        shipping_method: {
          select: {
            id: true,
            name: true,
            type: true,
            provider_name: true,
            min_days: true,
            max_days: true,
            logo_url: true,
          },
        },
        shipping_rate: {
          include: {
            shipping_zone: {
              select: { id: true, name: true, display_name: true },
            },
          },
        },
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
            avatar_url: true,
          },
        },
      },
    });

    this.eventEmitter.emit('order.shipping_assigned', {
      store_id: order.store_id,
      order_id: orderId,
      shipping_method_id: method.id,
      delivery_type: deliveryType,
    });

    return updated;
  }

  async remove(id: number) {
    await this.findOne(id);
    // Use scoped client (implicit via this.prisma)
    return this.prisma.orders.delete({ where: { id } });
  }

  /**
   * Multi-tarifa: resuelve snapshots por línea (id, nombre, stock_units_consumed).
   *
   * - Si NINGUNA línea trae `applied_price_tier_id`, retorna `[]` (sin overhead).
   * - Si AL MENOS UNA línea lo trae, valida que el usuario tenga el permission
   *   `store:products:apply_pricing_tier`. Si no, lanza
   *   `VendixHttpException(PRICING_TIER_PERMISSION_DENIED)` (403).
   * - Carga tarifas (auto-scoped por store) y el override de empaque por
   *   producto (para resolver `quantity × packSize` cuando aplica empaque real).
   *
   * El packSize sigue la cascada `override ?? tier ?? 1` resuelta por
   * `resolveStockUnitsConsumed` (helper puro en products/services/packaging.util).
   *
   * Devuelve un array alineado por índice con `items` para que el caller
   * mapee la línea ↔ snapshot sin re-buscar.
   */
  private async resolveTierSnapshotsForItems(
    items: Array<{
      product_id?: number;
      product_variant_id?: number;
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
      select: {
        id: true,
        name: true,
        units_per_package: true,
      },
    });
    type TierRow = (typeof tiers)[number];
    const tierById = new Map<number, TierRow>(
      tiers.map((t): [number, TierRow] => [t.id, t]),
    );

    const productIds = Array.from(
      new Set(items.map((i) => i.product_id).filter((id): id is number => !!id)),
    );

    // Per-product packaging overrides keyed by (product_id, variant_id|null,
    // price_tier_id). Auto-scoped relacionalmente por product.store_id.
    const overrides = productIds.length
      ? await this.prisma.product_price_tier_overrides.findMany({
          where: {
            product_id: { in: productIds },
            price_tier_id: { in: Array.from(tierIdsInUse) },
          },
          select: {
            product_id: true,
            variant_id: true,
            price_tier_id: true,
            override_units_per_package: true,
          },
        })
      : [];
    const overrideKey = (
      productId: number,
      variantId: number | null,
      tierId: number,
    ): string => `${productId}:${variantId ?? 'null'}:${tierId}`;
    const overrideUnitsByKey = new Map<string, number | null>(
      overrides.map((o): [string, number | null] => [
        overrideKey(o.product_id, o.variant_id ?? null, o.price_tier_id),
        o.override_units_per_package ?? null,
      ]),
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
      const variantId = item.product_variant_id ?? null;
      const overrideUnits =
        overrideUnitsByKey.get(
          overrideKey(productId, variantId, Number(tierId)),
        ) ?? null;
      // packSize = override ?? tier ?? 1 (collapses to 1 when <= 1).
      const stock_units_consumed = resolveStockUnitsConsumed(
        Number(item.quantity),
        tier.units_per_package,
        overrideUnits,
      );
      return {
        tier_id: tier.id,
        tier_name: tier.name,
        stock_units_consumed,
      };
    });
  }

  private async generateOrderNumber(storeId: number): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const prefix = `ORD${year}${month}${day}`;

    // Filter by store_id for per-store unique order numbers
    const lastOrder = await this.prisma.orders.findFirst({
      where: {
        store_id: storeId,
        order_number: { startsWith: prefix },
      },
      orderBy: { order_number: 'desc' },
    });

    let sequence = 1;
    if (lastOrder) {
      const lastSequence = parseInt(lastOrder.order_number.slice(-4));
      sequence = lastSequence + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  async getStats(): Promise<OrderStatsDto> {
    // Auto-scoped
    const where: Prisma.ordersWhereInput = {};

    const [totalOrders, totalRevenue, pendingOrders, completedOrders] =
      await Promise.all([
        this.prisma.orders.count({ where }),
        this.prisma.orders.aggregate({
          where: {
            ...where,
            state: {
              in: ['shipped', 'delivered', 'finished'] as order_state_enum[],
            },
          },
          _sum: { grand_total: true },
        }),
        this.prisma.orders.count({
          where: {
            ...where,
            state: {
              in: [
                'created',
                'pending_payment',
                'processing',
              ] as order_state_enum[],
            },
          },
        }),
        this.prisma.orders.count({
          where: {
            ...where,
            state: {
              in: ['delivered', 'finished'] as order_state_enum[],
            },
          },
        }),
      ]);

    const averageOrderValue =
      totalOrders > 0 ? (totalRevenue._sum.grand_total || 0) / totalOrders : 0;

    return {
      total_orders: totalOrders,
      total_revenue: totalRevenue._sum.grand_total || 0,
      pending_orders: pendingOrders,
      completed_orders: completedOrders,
      average_order_value: averageOrderValue,
    };
  }

  async getTimeline(orderId: number) {
    // Ensure order exists and belongs to store (handled by findOne/scoped prisma)
    await this.findOne(orderId);

    // Fetch audit logs for this order
    // Note: StorePrismaService might scope this, but audit_logs are usually queried via findMany
    // We explicitly filter by resource and resourceId
    const logs = await this.prisma.audit_logs.findMany({
      where: {
        resource: 'orders',
        resource_id: orderId,
        action: {
          notIn: ['VIEW', 'SEARCH', 'view', 'search'],
        },
      },
      include: {
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            avatar_url: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    return logs;
  }
}
