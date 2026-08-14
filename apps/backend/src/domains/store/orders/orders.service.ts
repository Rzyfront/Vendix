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
import { resolveTierSnapshotsForItems } from '../products/services/tier-snapshot.util';
import { resolvePackSize } from '../products/services/packaging.util';
import {
  normalizePriceUnitLines,
  roundMoney,
} from '../products/services/price-unit.util';
import {
  assertCanChargeVat,
  isVatResponsible,
} from '@common/helpers/vat-responsibility.helper';
import { OrderFlowService } from './order-flow/order-flow.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  /**
   * F4 — Gate "no responsable de IVA" (escritura de venta POS/manual).
   *
   * Un comercio no responsable de IVA no puede COBRAR IVA en una venta. Las
   * líneas de orden no cargan `tax_type`, así que el IVA se detecta vía las
   * asignaciones de impuesto del producto (`tax_categories.tax_type='iva'`).
   *
   * Solo verifica cuando hay líneas con impuesto (>0) — ventas sin impuesto no
   * requieren chequeo. Además, resuelve `fiscal_data` una sola vez y corta
   * temprano si el comercio SÍ es responsable (camino feliz mayoritario).
   * Indeterminado ⇒ responsable (no bloquea).
   */
  private async assertSaleVatAllowed(
    items: Array<{ product_id?: number | null; tax_amount_item?: number | null }>,
  ): Promise<void> {
    const taxedProductIds = Array.from(
      new Set(
        items
          .filter(
            (it) => it.product_id && Number(it.tax_amount_item ?? 0) > 0,
          )
          .map((it) => it.product_id as number),
      ),
    );
    if (taxedProductIds.length === 0) return;

    let fiscalData: any = null;
    try {
      fiscalData = await this.settingsService.getFiscalData();
    } catch {
      // fiscal_data no resoluble ⇒ indeterminado ⇒ responsable.
      return;
    }
    if (isVatResponsible(fiscalData)) return;

    // Comercio no responsable: rechazar si algún producto vendido tiene una
    // categoría de impuesto tipo `iva` asignada. Se evalúa en JS (no en un
    // filtro de relación to-one) para evitar ambigüedad de sintaxis Prisma.
    const soldProducts = await this.prisma.products.findMany({
      where: { id: { in: taxedProductIds } },
      select: {
        id: true,
        product_tax_assignments: {
          select: { tax_categories: { select: { tax_type: true } } },
        },
      },
    });
    const chargesVat = soldProducts.some((p) =>
      (p.product_tax_assignments ?? []).some(
        (a) => (a.tax_categories?.tax_type ?? '').toLowerCase() === 'iva',
      ),
    );
    if (chargesVat) {
      assertCanChargeVat(fiscalData, 'sale');
    }
  }

  constructor(
    private prisma: StorePrismaService,
    private s3Service: S3Service,
    private eventEmitter: EventEmitter2,
    private settingsService: SettingsService,
    private scheduleValidationService: ScheduleValidationService,
    private stockLevelManager: StockLevelManager,
    private shippingCalculatorService: ShippingCalculatorService,
    private orderFlowService: OrderFlowService,
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
    const tierSnapshots = await resolveTierSnapshotsForItems(
      this.prisma,
      createOrderDto.items,
      context,
    );

    // Precio por N unidades de stock: el producto publica "$5.000 por metro" y
    // la línea llega en milímetros. El total lo recalcula el servidor porque la
    // escala es del producto y el cliente puede traer la aritmética vieja.
    const priceUnits = await normalizePriceUnitLines(
      this.prisma as any,
      createOrderDto.items,
      {
        // Excluir solo las PRESENTACIONES (packSize > 1), no toda línea con
        // tarifa: una tarifa de cliente cambia el precio pero lo sigue
        // expresando por unidad de precio, así que la escala del producto sí
        // aplica. Excluir por "tiene tarifa" persistía 2 m de un cable a
        // $4.500 el metro como $9.000.000 cuando el cliente mandaba la
        // aritmética cruda.
        isPresentationAtIndex: (index) =>
          resolvePackSize(
            tierSnapshots[index]?.units_per_package,
            tierSnapshots[index]?.override_units_per_package,
          ) > 1,
      },
    );
    if (priceUnits.adjusted > 0) {
      if (createOrderDto.subtotal != null) {
        createOrderDto.subtotal = roundMoney(
          Number(createOrderDto.subtotal) + priceUnits.subtotalDelta,
        );
      }
      if (createOrderDto.tax_amount != null) {
        createOrderDto.tax_amount = roundMoney(
          Number(createOrderDto.tax_amount) + priceUnits.taxDelta,
        );
      }
      if (createOrderDto.total_amount != null) {
        createOrderDto.total_amount = roundMoney(
          Number(createOrderDto.total_amount) +
            priceUnits.subtotalDelta +
            priceUnits.taxDelta,
        );
      }
    }

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

    // F4 — comercio no responsable de IVA no puede cobrar IVA en la venta.
    await this.assertSaleVatAllowed(createOrderDto.items);

    let retries = 3;
    while (retries > 0) {
      try {
        if (!createOrderDto.order_number) {
          createOrderDto.order_number =
            await this.generateOrderNumber(store_id);
        }

        // Bug 7: si la orden tiene envío a domicilio Y contiene al menos un
        // producto tipo `prepared` (plato), la orden NO se auto-finaliza.
        // Queda en `pending_delivery` para que el operador la despache,
        // entregue y finalice manualmente. El default sigue siendo `created`.
        const orderState = await this.resolveInitialOrderState(
          createOrderDto,
        );

        // Use scoped client (creates are not scoped by extension but using correct service is good style)
        const order = await this.prisma.orders.create({
          data: {
            customer_id: createOrderDto.customer_id ?? null,
            store_id: store_id, // Force strict store_id
            order_number: createOrderDto.order_number,
            state: orderState,
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
                    // Escala del precio al momento de vender: sin este
                    // snapshot el total deja de ser reproducible en cuanto el
                    // producto cambie de "por metro" a "por rollo".
                    price_unit_quantity:
                      priceUnits.priceUnitByIndex[index] ?? null,
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
              // QUI-557: el POS sobrevende a propósito, así que aquí SÍ se
              // autoriza el disponible negativo. Es la única forma de que el
              // piso duro de `reserveStock` proteja al resto de flujos sin
              // romper esta decisión de producto.
              true,
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
      // state ∈ {processing, pending_payment} + delivery_type ∉ {direct_delivery,
      // dine_in} (incluye home_delivery, pickup y other). direct_delivery
      // (entrega en mostrador) y dine_in (comer en mesa) se consumen/entregan en
      // sitio → nunca generan remisión de despacho. pending_payment cubre el
      // contraentrega (COD): se despacha antes de cobrar. Coincide con el
      // dashboard de tienda y el filtro "Por enviar" del frontend.
      //
      // Plan Despacho Economía — FASE 6 paso 19: ahora se excluyen también
      // las órdenes totalmente remitidas (`dispatch_fulfillment != 'full'`).
      // Las parciales siguen apareciendo con `remaining_units` calculado
      // por el cliente o por el listener.
      ...(query.dispatchable && {
        state: { in: ['processing', 'pending_payment'] as order_state_enum[] },
        delivery_type: { notIn: ['direct_delivery', 'dine_in'] as order_delivery_type_enum[] },
        dispatch_fulfillment: { not: 'full' } as any,
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
          // Cliente para la columna "Cliente" de los listados (wizard de
          // remisiones, lista de órdenes). findAll ya FILTRA por users en la
          // búsqueda pero no los devolvía → "No data" en la lista. Select
          // ligero: solo lo que renderiza el transform (nombre); guests
          // (customer_id null) traen users=null y caen al fallback.
          users: {
            select: { id: true, first_name: true, last_name: true },
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
        // Solo la factura ACEPTADA por la DIAN, y solo la última (QUI-604).
        //
        // El tiquete que se imprime desde el detalle de orden la necesita para
        // saber si es el documento fiscal o una copia informativa: sin esta fila
        // `OrderTicketService.toTicketData` deja `electronicInvoice` vacío,
        // `PosTicketService.shouldShowTaxes` cae a `printsVatBreakdown()`, y una
        // orden YA facturada sale con desglose de IVA y el pie "Este documento
        // no es una factura electrónica". Mismo criterio que
        // `OrdersBulkService.bulkPrint`.
        //
        // `accepted` y no `pending`: el pie afirma literalmente "validada por la
        // DIAN", así que la AUSENCIA de fila es la señal correcta para no
        // afirmarlo.
        invoices: {
          where: { dian_status: 'accepted' },
          select: { invoice_number: true, cufe: true },
          orderBy: { id: 'desc' },
          take: 1,
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

    /**
     * QUI-557 — NINGÚN estado puede escribirse en crudo sobre `orders.state`.
     *
     * `UpdateOrderDto extends PartialType(CreateOrderDto)`, y `CreateOrderDto`
     * declara `state`, así que `PartialType` lo reexpone y el `whitelist` del
     * ValidationPipe no puede filtrarlo — el propio JSDoc del DTO dice que las
     * transiciones van por `OrderFlowService`, pero la clase base derrota esa
     * regla. Un `PATCH /store/orders/:id {"state":"cancelled"}` marcaba la
     * orden cancelada sin liberar sus `stock_reservations`, y esas reservas
     * huérfanas siguen restando de `quantity_available`: el siguiente intento
     * de remisión reporta "sin stock" con las existencias intactas. Con
     * `{"state":"shipped"}` el daño era el simétrico: nunca se emitía
     * `order.shipped`, así que el OrderAutoFulfillmentListener jamás consumía
     * la reserva original de una orden de alcance ORGANIZATION y las unidades
     * quedaban apartadas para siempre pese a haber salido físicamente.
     *
     * No se rechaza el campo con 400 porque hay cuatro acciones de UI vivas
     * que pegan a este endpoint (cancelar desde la lista, marcar enviado,
     * marcar entregado y la transición manual de "listo para recoger");
     * devolver 400 trasladaría el problema a la UI en vez de resolverlo.
     *
     * Se delega TODO cambio de estado en `forceOrderState`, el carril forzado
     * del seam: mantiene la capacidad de saltarse la máquina de estados —que es
     * la razón de existir de estos botones, p. ej. marcar enviada una orden de
     * retiro en tienda sin `shipping_method_id`— pero ejecuta la cadena de
     * efectos completa (liberar o consumir reservas, emitir eventos) y deja la
     * forzada auditada en `internal_notes._flow_metadata.forced_transition`.
     */
    const targetState = updateOrderDto.state;

    // Se quita siempre, incluso cuando coincide con el estado actual: el
    // `prisma.orders.update` de abajo no debe recibir `state` bajo ninguna
    // circunstancia, o el seam deja de ser el único escritor.
    delete updateOrderDto.state;

    const mustForceState = !!targetState && targetState !== order.state;
    if (Object.keys(updateOrderDto).length === 0) {
      if (mustForceState) {
        await this.orderFlowService.forceOrderState(id, targetState!, {
          reason: 'Transición manual desde la gestión de órdenes',
        });
      }
      return this.findOne(id);
    }

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

    const updatedOrder = await this.prisma.orders.update({
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

    /**
     * El estado va DESPUÉS de la metadata, y el orden NO es cosmético.
     *
     * `forceOrderState` persiste su traza (`forced_transition`, `delivered_at`,
     * `cancelled_at`, `previous_state`) dentro de `internal_notes` como JSON,
     * porque `orders` no tiene columnas para eso. Si el PATCH trae `state` E
     * `internal_notes` a la vez y se fuerza primero, el update de arriba
     * sobrescribe ese JSON con el texto plano del operador y la traza se pierde
     * —incluido el `previous_state` que `reactivateOrder` necesita para
     * restaurar una orden cancelada—.
     *
     * Aplicando la nota primero, `appendFlowMetadata` la encuentra como texto
     * plano y la conserva en el campo `notes` del sobre. Sobreviven las dos.
     */
    if (mustForceState) {
      await this.orderFlowService.forceOrderState(id, targetState!, {
        reason: 'Transición manual desde la gestión de órdenes',
      });
      // El row devuelto arriba quedó obsoleto: se leyó antes de la transición.
      return this.findOne(id);
    }

    return updatedOrder;
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
    const tierSnapshots = await resolveTierSnapshotsForItems(
      this.prisma,
      dto.items,
      ctx,
    );

    // F4 — comercio no responsable de IVA no puede cobrar IVA en la venta.
    await this.assertSaleVatAllowed(dto.items);

    // Precio por N unidades: misma corrección que en el create, antes de que
    // los totales de abajo lean `item.total_price`.
    const priceUnits = await normalizePriceUnitLines(
      this.prisma as any,
      dto.items,
      {
        // Excluir solo las PRESENTACIONES (packSize > 1), no toda línea con
        // tarifa: una tarifa de cliente cambia el precio pero lo sigue
        // expresando por unidad de precio, así que la escala del producto sí
        // aplica. Excluir por "tiene tarifa" persistía 2 m de un cable a
        // $4.500 el metro como $9.000.000 cuando el cliente mandaba la
        // aritmética cruda.
        isPresentationAtIndex: (index) =>
          resolvePackSize(
            tierSnapshots[index]?.units_per_package,
            tierSnapshots[index]?.override_units_per_package,
          ) > 1,
      },
    );
    if (priceUnits.adjusted > 0) {
      if (dto.subtotal != null) {
        dto.subtotal = roundMoney(
          Number(dto.subtotal) + priceUnits.subtotalDelta,
        );
      }
      if (dto.tax_amount != null) {
        dto.tax_amount = roundMoney(
          Number(dto.tax_amount) + priceUnits.taxDelta,
        );
      }
      if (dto.total_amount != null) {
        dto.total_amount = roundMoney(
          Number(dto.total_amount) +
            priceUnits.subtotalDelta +
            priceUnits.taxDelta,
        );
      }
    }

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
        // Se liberan las reservas POR REFERENCIA, no adivinando la bodega.
        // Antes se resolvía `getDefaultLocationForProduct` —la bodega con más
        // disponible HOY— y se liberaba ahí; pero el POS reserva repartido en
        // varias bodegas (slices del asignador), así que la porción de la otra
        // bodega quedaba huérfana: 14 unidades bloqueadas para una orden de 10,
        // sin nada que las liberara. `releaseReservationsByReference` lee las
        // filas reales de `stock_reservations`, cubre todas las bodegas y corre
        // DENTRO de la transacción, así que un fallo revierte el update completo
        // en vez de dejarlo a medias con un warn.
        await this.stockLevelManager.releaseReservationsByReference(
          'order',
          id,
          'cancelled',
          tx,
        );
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
            price_unit_quantity: priceUnits.priceUnitByIndex[index] ?? null,
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
              true, // QUI-557: oversell deliberado, disponible negativo autorizado.
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

  /**
   * Bug 7 — Resuelve el estado inicial de la orden al crearla.
   *
   * Reglas:
   *  - Si el caller pasó `state` explícito, se respeta.
   *  - Si `delivery_type === 'home_delivery'` Y al menos un item es
   *    `product_type='prepared'` (plato), retorna `pending_delivery` para
   *    que la orden quede esperando Despachar → Entregar → Finalizar.
   *  - En cualquier otro caso, retorna `created` (default histórico).
   *
   * La detección de "prepared" usa los items del DTO. Si el item NO trae
   * `product_type` (caso de productos nuevos o líneas sin expandir), se
   * considera NO-prepared y la orden sigue el flujo normal. Esto evita
   * falsos positivos en líneas sin expandir.
   */
  private async resolveInitialOrderState(
    dto: CreateOrderDto,
  ): Promise<order_state_enum> {
    if (dto.state) {
      return dto.state as order_state_enum;
    }
    const deliveryType = (dto as any).delivery_type;
    if (deliveryType !== 'home_delivery') {
      return order_state_enum.created;
    }
    const items = dto.items || [];
    const hasPreparedItem = items.some(
      (it: any) => it.product_type === 'prepared',
    );
    if (hasPreparedItem) {
      return 'pending_delivery' as order_state_enum;
    }
    return order_state_enum.created;
  }
}
