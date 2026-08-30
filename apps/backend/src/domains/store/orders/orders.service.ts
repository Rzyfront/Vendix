import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import {
  CreateOrderDto,
  CreateOrderItemDto,
  UpdateOrderDto,
  OrderQueryDto,
  UpdateOrderItemsDto,
  AssignShippingMethodDto,
  UpdateOrderEditorDto,
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
import { assertVariantRequiredForPrepared } from './utils/variant-required.validator';
import { SettingsService } from '../settings/settings.service';
import { ScheduleValidationService } from '../settings/schedule-validation.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { SellableStockAllocator } from '../inventory/shared/services/sellable-stock-allocator.service';
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
import { PromotionEngineService } from '../promotions/promotion-engine/promotion-engine.service';
import { CouponsService } from '../coupons/coupons.service';
import { AuditService, AuditAction, AuditResource } from '@common/audit/audit.service';

/**
 * Mejor `tax_rate` de un producto con impuesto, resuelto en batch desde
 * `product_tax_assignments → tax_categories → tax_rates`. El DTO del POS
 * llega con el snapshot agregado por línea (`tax_amount_item`, `tax_rate`),
 * así que estos campos se derivan aquí para poder construir las filas de
 * `order_item_taxes` (el resto de flows — checkout y payments POS — ya
 * reciben el desglose resuelto desde el llamador).
 */
type ResolvedLineTax = {
  id: number;
  name: string;
  rate: Prisma.Decimal | number | string;
  is_compound: boolean | null;
  tax_type: string | null;
};

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
    private sellableStockAllocator: SellableStockAllocator,
    private shippingCalculatorService: ShippingCalculatorService,
    private orderFlowService: OrderFlowService,
    private promotionEngine: PromotionEngineService,
    private couponsService: CouponsService,
    private auditService: AuditService,
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

    // ERR-07 / DB-14 — invariante "prepared + variantes exige variante".
    // Resuelve los productos una sola vez (batch) y aplica el check. El
    // mapa devuelto se reutiliza abajo para snapshots de `name` /
    // `product_type` sin una segunda consulta por línea.
    const variantCheckProductById = await assertVariantRequiredForPrepared(
      this.prisma,
      createOrderDto.items,
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

    // Persistir desglose de impuestos por línea. checkout y payments POS ya
    // lo hacen; aquí faltaba, así que los tiquetes de órdenes POS salían
    // sin desglose de IVA aunque la cabecera trajera `tax_amount`. Espeja
    // el patrón de checkout.service.ts (createOrderAndCheckout, ~1422) y
    // payments.service.ts (buildPosOrderItem, ~2791): una fila por
    // impuesto aplicado a la línea, con `tax_rate` como fracción
    // (`Decimal(6,5)` → 0.19 para 19%). El DTO del POS solo trae el
    // snapshot agregado por línea (`tax_amount_item`); los nombres, tipos y
    // FKs se derivan server-side desde `product_tax_assignments`. Se hace
    // UN batch lookup (no N+1) y se reusan los mismos `productIds` que ya
    // pasaron por `assertSaleVatAllowed` arriba.
    const taxedProductIds = Array.from(
      new Set(
        createOrderDto.items
          .filter(
            (it) => it.product_id && Number(it.tax_amount_item ?? 0) > 0,
          )
          .map((it) => it.product_id as number),
      ),
    );
    const lineTaxByProductId =
      taxedProductIds.length > 0
        ? await this.resolveLineTaxesForOrder(taxedProductIds)
        : new Map<number, ResolvedLineTax>();

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
            // QUI-727 (B.4) / ADR-9 — alias↔cliente mutuamente excluyentes
            // (CHECK orders_customer_xor_alias). Replica el guard de
            // updateOrderFromEditor/assignCustomer: si vino `customer_id`
            // explícito, el alias se fuerza a null; si no, se persiste
            // `customer_alias` (o null). Así una venta "Mesa 5" sin cliente
            // queda grabada sin romper el CHECK.
            customer_alias:
              createOrderDto.customer_id != null
                ? null
                : (createOrderDto.customer_alias ?? null),
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
                  // El invariant ERR-07 ya fue enforced por
                  // `assertVariantRequiredForPrepared` arriba; aquí solo
                  // reusamos el mapa resuelto para snapshots de `name` /
                  // `product_type` (evita una segunda consulta por línea).
                  const product = item.product_id
                    ? variantCheckProductById.get(item.product_id) ?? null
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
                    // CP-POLLO-ARABE-727 C.4 — ERR-15: la variante declarada debe
                    // pertenecer al producto de la línea. Reusa la MISMA consulta
                    // (no añade roundtrip, solo valida lo que ya se trajo).
                    if (!variant || variant.product_id !== item.product_id) {
                      throw new VendixHttpException(
                        ErrorCodes.PRODUCT_VARIANT_MISMATCH,
                        `La variante #${item.product_variant_id} no pertenece al producto #${item.product_id}`,
                      );
                    }
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
                    // Desglose por línea (espejo de checkout/payments):
                    // una fila en `order_item_taxes` por impuesto aplicado
                    // a la línea, con `tax_rate` como fracción. Si la
                    // línea no trae impuesto (`tax_amount_item <= 0`), no
                    // se emite la fila — coincide con checkout y payments.
                    order_item_taxes:
                      Number(item.tax_amount_item ?? 0) > 0
                        ? this.buildOrderItemTaxesCreate(
                            item,
                            item.product_id
                              ? lineTaxByProductId.get(item.product_id) ??
                                null
                              : null,
                          )
                        : undefined,
                    catalog_unit_price: item.catalog_unit_price,
                    catalog_final_price: item.catalog_final_price,
                    final_unit_price: item.final_unit_price ?? item.unit_price,
                    is_price_overridden:
                      item.is_price_overridden ??
                      Boolean(item.price_override_reason),
                    price_override_reason: item.price_override_reason,
                    weight: item.weight,
                    weight_unit: item.weight_unit,
                    // Bug 12: persistir UoM de venta al cobro. El ticket y
                    // los reportes históricos mostrarán "1 × 250 g" en vez
                    // de "1 × und".
                    sale_unit_code_snapshot: (item as any).sale_unit_code ?? null,
                    sale_quantity_snapshot:
                      (item as any).sale_quantity != null
                        ? new Prisma.Decimal((item as any).sale_quantity)
                        : null,
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
                    notes: item.notes ?? null,
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
    //
    // Round 2 MAJOR · defense-in-depth: pin the WHERE with `store_id` from
    // the request context so a missing/bypassed scope filter on
    // `orders.findFirst` never crosses a tenant boundary. The scoped
    // Prisma service already filters by `store_id` for STORE-scoped
    // callers, but this anchor makes the isolation explicit at the read
    // site — and survives a future refactor that drops the auto-scope.
    const context = RequestContextService.getContext();
    const order = await this.prisma.orders.findFirst({
      where: {
        id,
        ...(context?.store_id ? { store_id: context.store_id } : {}),
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
            // Desglose por línea: el `pos_sale_ticket` y el detalle de
            // orden necesitan las filas de `order_item_taxes` para
            // pintar el IVA. Sin esto, la cabecera trae `tax_amount` pero
            // el render sale en blanco — el mismo síntoma que reportaba
            // el fix del `create`. Espeja el patrón de
            // `refund-calculation.service.ts:66`.
            order_item_taxes: true,
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
            // QUI-728 (E.2) — cuenta de destino de la transferencia, para que
            // el detalle de orden responda "¿a qué cuenta entró este dinero?"
            // sin ir a conciliación. Proyección MÍNIMA a propósito: nunca
            // `current_balance` / `opening_balance` / `chart_account_id` /
            // `column_mapping` — el saldo bancario no tiene por qué viajar a
            // una pantalla cuyo único propósito es identificar la cuenta.
            // Misma proyección que el selector de cobro del payment-collector.
            bank_account: {
              select: {
                id: true,
                name: true,
                bank_name: true,
                account_number: true,
              },
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
        // CP-POS-SVC-PERF-001 / C.5 — order detail page renders the
        // service staff + booking date/time for orders that contain a
        // scheduled service. We expose `bookings` with provider →
        // employee → user so the cashier can see who is assigned.
        //
        // CP-POS-SVC-PERF-001 / Bugfix — `employees` has no
        // `avatar_url` column (avatar lives on `users` via the
        // `user_id` FK). Selecting avatar_url here crashes findOne
        // for EVERY order that has bookings, leaving the order detail
        // page with "Orden #undefined" and $0 totals. Removed.
        bookings: {
          include: {
            provider: {
              include: {
                employee: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  },
                },
              },
            },
            product: {
              select: { id: true, name: true },
            },
            product_variants: {
              select: { id: true, name: true },
            },
          },
          orderBy: { date: 'asc' },
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
  ): Promise<{ url: string; expires_at: string; content_type: string | null }> {
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
    const [url, head] = await Promise.all([
      this.s3Service.getPresignedUrl(payment.receipt_s3_key, TTL_SECONDS),
      this.s3Service.headObject(payment.receipt_s3_key),
    ]);
    const expires_at = new Date(
      Date.now() + TTL_SECONDS * 1000,
    ).toISOString();

    // El frontend usa `content_type` para decidir si previsualiza como imagen
    // (`<img>`) o incrusta como PDF (`<iframe>`/`<embed>`). Se obtiene del HEAD
    // del objeto S3 — no se persiste en BD para no añadir migración. Si el HEAD
    // falla (objeto borrado, red) devolvemos `null` y el frontend cae al PDF.
    return { url, expires_at, content_type: head?.contentType ?? null };
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
      // ERR-07 / DB-14 — invariante "prepared + variantes exige variante".
      // Único enforcement centralizado (mismo helper que `create` y
      // `updateOrderFromEditor`); si queda duplicado en dos sitios,
      // vuelve a divergir como ya pasó (Round 3 minor #15).
      await assertVariantRequiredForPrepared(tx, dto.items);

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

  /**
   * CP-POS-CREAR-EDITAR-COBRAR-001 — C.1/C.2/C.3 · updateOrderFromEditor
   *
   * Editor atómico de negocio. Reemplaza items, cliente, notas, dirección,
   * método/rate/costo de envío, promoción y cupón en UNA transacción.
   *
   * NO edita: state, payment_status, payment_form, credit_type, installments,
   * serial_numbers, inventory_committed_at_fire, skip_kds, table_session_id,
   * table_id, cash_register_session_id, store_id, allow_oversell.
   *
   * El cobro siempre va por `OrderFlowService.payOrder` (POST /flow/pay),
   * que es la máquina de estados canónica existente. El editor deja la orden
   * en `created` (o `draft` si ya estaba en draft) y devuelve la fila
   * hidratada completa para que la UI dispare Cobrar sin navegar a detalle.
   *
   * Invariantes:
   *  1. Customer del store: 403 `ORD_EDIT_CUSTOMER_STORE_MISMATCH_001` si
   *     `customer_id` no pertenece a `store_users` del store del contexto.
   *  2. Claim atómico: `updateMany({ where: { id, store_id, state IN ('created','draft') } })`
   *     con count=0 → 409 `ORD_EDIT_INVALID_STATE_001`. Evita lost updates
   *     si dos operadores editan la misma orden a la vez.
   *  3. Pricing server-owned: subtotal/tax/discount/total se recalculan con
   *     `PromotionEngineService.quoteDiscounts` + `CouponsService.validate`
   *     + recálculo de envío. El cliente nunca es fuente de verdad.
   *  4. Shipping válido: dirección/método/rate pertenecen al store y la
   *     combinación es legal para `delivery_type`. Costo enviado vs calculado
   *     con tolerancia 0.01.
   *  5. Stock para `created`: `SellableStockAllocator.allocateForLine` cubre
   *     cada línea. Shortfall → 409 `POS_STOCK_INSUFFICIENT_001`.
   *  6. Reservas: para `created` libera las reservas activas por referencia
   *     antes de validar el nuevo stock y reserva de nuevo. Para `draft` no
   *     crea reservas (la promoción a `created` ocurre en `flow/pay`).
   *  7. Cupón: `coupons.current_uses` se ajusta UNA vez si el código
   *     cambió, sólo si la orden ya era `created`. Para `draft` la snapshot
   *     queda pendiente y el cobro se encarga de consumir.
   *  8. Promociones: se borran y reinsertan las filas `order_promotions`
   *     dentro de la transacción, después de recotizar el motor.
   *  9. Audit: `order.editor.updated` se emite DESPUÉS del commit.
   *     `order.editor.pricing_failed` y `order.stock_reservation_failed`
   *     se emiten con snapshot seguro (sin secrets ni datos sensibles).
   */
  async updateOrderFromEditor(orderId: number, dto: UpdateOrderEditorDto) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const userId: number = context?.user_id ?? 0;
    const requestId = context?.request_id;

    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // 1) Scoped lookup: si la orden no pertenece al store del contexto, el
    //    findFirst scoped por StorePrismaService devuelve null y respondemos
    //    404 sin filtrar IDs.
    const existingOrder = await this.prisma.orders.findFirst({
      where: { id: orderId, store_id: storeId },
    });

    if (!existingOrder) {
      throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
    }

    // 2) State gate ANTES del claim atómico. Una orden cancelada/refunded/
    //    shipped nunca debe mutar metadata vía el editor.
    if (
      existingOrder.state !== 'created' &&
      existingOrder.state !== 'draft'
    ) {
      throw new VendixHttpException(ErrorCodes.ORD_EDIT_NOT_ALLOWED_001);
    }

    const isDraft = existingOrder.state === 'draft';

    // 2.5) CP-POS-CREAR-EDITAR-COBRAR-001 — Round 3.5 · idempotency short-circuit.
    //
    // If the caller passed an `idempotency_key` (web POS, mobile POS, batch
    // job), look up the most recent `audit_logs` row carrying the same key
    // for `action='order.editor.updated'`. If found, return the persisted
    // full Order without touching the claim / pricing / stock / coupon
    // pipeline. This is the defense-in-depth against double-clicks and
    // network retries: the FIRST call wins, the SECOND call returns the
    // cached response.
    //
    // The audit row is written AFTER commit (step 16), so by construction
    // the cache lookup only fires for an edit that has already committed.
    // A failed/rolled-back edit never produces an audit row, so a retry
    // that arrives AFTER the rollback correctly re-enters the pipeline.
    if (dto.idempotency_key) {
      const cached = await this.prisma.audit_logs.findFirst({
        where: {
          resource: 'orders',
          resource_id: orderId,
          action: 'order.editor.updated',
          metadata: {
            path: ['idempotency_key'],
            equals: dto.idempotency_key,
          } as any,
        },
        orderBy: { created_at: 'desc' },
        select: { id: true, created_at: true },
      });
      if (cached) {
        this.logger.log(
          `[editor] idempotency hit for key=${dto.idempotency_key} order=${orderId}; short-circuiting to cached response`,
        );
        return await this.findOne(orderId);
      }
    }

    // 3) Customer del store. Backend es autoritativo: si el frontend manda un
    //    customer_id que no pertenece a este store, falla ANTES del claim
    //    atómico para no contaminar la fila.
    //
    // CP-POS-MODAL-SCOPE-001 / Phase C.3 — escape hatch:
    //   `pos.allow_anonymous_sales=true` permite que `customer_id` llegue como
    //   `null` y la edición se guarde como venta anónima. La política de
    //   ecommerce (`checkout.require_customer_data`) sigue activa para el
    //   storefront; este atajo es POS-only.
    if (dto.customer_id == null) {
      const settings = await this.prisma.store_settings.findFirst({
        where: { store_id: storeId },
        select: { settings: true },
      });
      const pos = (settings?.settings as any)?.pos ?? {};
      const allowAnonymous = pos?.allow_anonymous_sales === true;
      // QUI-737 (B.4) — el modo alias es otra salida legítima de "sin cliente":
      // falta que `customer_alias` viaje en el PATCH. Sin esto, un editor con
      // `{customer_id:null, customer_alias:'Mesa 5'}` seguiría lanzando
      // POS_CUSTOMER_REQUIRED_001 aunque la tienda tenga `allow_alias_sales`.
      const allowAlias = pos?.allow_alias_sales === true;
      const hasAlias = !!dto.customer_alias;
      if (!allowAnonymous && !(allowAlias && hasAlias)) {
        throw new VendixHttpException(
          ErrorCodes.POS_CUSTOMER_REQUIRED_001,
        );
      }
    }

    const storeMembership =
      dto.customer_id != null
        ? await this.prisma.store_users.findFirst({
            where: { store_id: storeId, user_id: dto.customer_id },
            select: { id: true },
          })
        : null;
    if (dto.customer_id != null && !storeMembership) {
      throw new VendixHttpException(
        ErrorCodes.ORD_EDIT_CUSTOMER_STORE_MISMATCH_001,
      );
    }

    // 4) Validar items: cada item debe tener un producto/variante que exista
    //    en el store. La búsqueda es scoped por `store_id` vía StorePrismaService
    //    para que un id de OTRA tienda no satisfaga la validación.
    const productIds = Array.from(
      new Set(
        dto.items
          .map((item) => item.product_id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    );
    if (productIds.length > 0) {
      const productRows = await this.prisma.products.findMany({
        where: { id: { in: productIds }, store_id: storeId },
        select: { id: true },
      });
      const found = new Set(productRows.map((p) => p.id));
      const missing = productIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.PROD_FIND_001,
          undefined,
          { missing_product_ids: missing },
        );
      }
    }

    // 5) Multi-tarifa: revalida permission + recalcula snapshots si las nuevas
    //    líneas traen applied_price_tier_id.
    const tierSnapshots = await resolveTierSnapshotsForItems(
      this.prisma,
      dto.items,
      context,
    );

    // 6) F4 — comercio no responsable de IVA no puede cobrar IVA en la venta.
    await this.assertSaleVatAllowed(dto.items);

    // 7) Precio por N unidades de stock: misma corrección que create/update.
    const priceUnits = await normalizePriceUnitLines(
      this.prisma as any,
      dto.items,
      {
        isPresentationAtIndex: (index) =>
          resolvePackSize(
            tierSnapshots[index]?.units_per_package,
            tierSnapshots[index]?.override_units_per_package,
          ) > 1,
      },
    );

    // 8) Shipping validation (precio, método, rate, dirección). El servidor
    //    calcula el costo a partir de la dirección + método + items, y el
    //    cliente puede traer un `shipping_cost` para mostrar UI; si difiere
    //    en más de 0.01, rechaza con `ORD_EDIT_INVALID_SHIPPING_001`.
    let shippingCost = 0;
    let resolvedShippingRateId: number | null = null;
    let resolvedDeliveryType: order_delivery_type_enum | null = null;

    if (dto.shipping_method_id) {
      const method = await this.prisma.shipping_methods.findFirst({
        where: { id: dto.shipping_method_id, store_id: storeId, is_active: true },
      });
      if (!method) {
        throw new VendixHttpException(ErrorCodes.ORD_EDIT_INVALID_SHIPPING_001);
      }

      resolvedDeliveryType =
        method.type === 'pickup'
          ? order_delivery_type_enum.pickup
          : order_delivery_type_enum.home_delivery;

      if (
        (resolvedDeliveryType === order_delivery_type_enum.home_delivery ||
          dto.delivery_type === 'home_delivery' ||
          dto.delivery_type === 'direct_delivery') &&
        !dto.shipping_address_id
      ) {
        throw new VendixHttpException(
          ErrorCodes.ORD_EDIT_INVALID_SHIPPING_001,
          'Delivery requires a shipping_address_id',
        );
      }

      if (dto.shipping_rate_id) {
        const rate = await this.prisma.shipping_rates.findFirst({
          where: {
            id: dto.shipping_rate_id,
            shipping_method_id: method.id,
            is_active: true,
          },
        });
        if (!rate) {
          throw new VendixHttpException(
            ErrorCodes.ORD_EDIT_INVALID_SHIPPING_001,
            'Shipping rate does not belong to the selected method',
          );
        }
        resolvedShippingRateId = rate.id;
        shippingCost = Number(rate.base_cost);
      } else {
        // Auto-calcular si no hay rate explícito.
        if (dto.shipping_address_id) {
          // La dirección debe pertenecer al customer_id del editor — sin esto
          // un operador con acceso al store podría leer o grabar la dirección
          // de cualquier cliente que comparta tienda (Round 1, blocker 8).
          const address = await this.prisma.addresses.findFirst({
            where: {
              id: dto.shipping_address_id,
              user_id: dto.customer_id,
            },
            select: {
              country_code: true,
              state_province: true,
              city: true,
              postal_code: true,
            },
          });
          if (address?.country_code) {
            const itemsForCalc = dto.items
              .filter((it): it is typeof it & { product_id: number } =>
                typeof it.product_id === 'number',
              )
              .map((it) => ({
                product_id: it.product_id,
                quantity: Number(it.quantity || 0),
                // Round 3 MAJOR #7 — server-owned price. Trusting the client
                // `total_price` (or anything the operator typed in the editor)
                // lets a manipulated row bias the shipping calculator; here we
                // derive the price the shipping calculator needs from
                // `final_unit_price × quantity` so the rate the server picks
                // never depends on a client-supplied total. The original
                // `total_price` is still accepted by the rest of the editor
                // (recomputed server-side in step 11).
                price:
                  Number(it.final_unit_price ?? it.unit_price ?? 0) *
                  Number(it.quantity || 0),
                weight: it.weight ? Number(it.weight) : undefined,
                product_type: (it as any).product_type,
              }));
            const options = await this.shippingCalculatorService.calculateRates(
              storeId,
              itemsForCalc,
              {
                country_code: address.country_code,
                state_province: address.state_province || undefined,
                city: address.city || undefined,
                postal_code: address.postal_code || undefined,
              },
            );
            const match = options.find((o) => o.method_id === method.id);
            if (match) {
              resolvedShippingRateId = match.rate_id;
              shippingCost = Number(match.cost);
            }
          }
        }
      }
    }

    // MAJOR (Round 1, #8): `billing_address_id` debe pertenecer al
    // `customer_id` del editor. Sin esto, un operador podría cambiar la
    // dirección de facturación a una dirección de OTRO cliente del store y
    // terminar facturando a nombre equivocado.
    if (dto.billing_address_id) {
      const billingOwner = await this.prisma.addresses.findFirst({
        where: {
          id: dto.billing_address_id,
          user_id: dto.customer_id,
        },
        select: { id: true },
      });
      if (!billingOwner) {
        throw new VendixHttpException(
          ErrorCodes.ORD_EDIT_INVALID_SHIPPING_001,
          'billing_address_id does not belong to the selected customer',
        );
      }
    }

    if (
      dto.shipping_cost !== undefined &&
      Math.abs(dto.shipping_cost - shippingCost) > 0.01
    ) {
      throw new VendixHttpException(
        ErrorCodes.ORD_EDIT_INVALID_SHIPPING_001,
        'Client shipping_cost differs from server-calculated cost',
        {
          client_shipping_cost: dto.shipping_cost,
          server_shipping_cost: shippingCost,
          tolerance: 0.01,
        },
      );
    }

    // 9) Promotion quote: recotizamos server-side, NUNCA confiamos en
    //    `promotion_ids` como verdad. El motor decide qué aplica.
    let promotionDiscount = 0;
    let promotionSnapshots: { promotion_id: number; discount_amount: number }[] =
      [];
    try {
      const promotionInput = {
        customer_id: dto.customer_id,
        manual_promotion_ids: Array.isArray(dto.promotion_ids)
          ? dto.promotion_ids
          : [],
        items: dto.items
          .filter((item) => item.product_id)
          .map((item, index) => ({
            line_id: index,
            product_id: item.product_id as number,
            variant_id: item.product_variant_id ?? null,
            category_id: null,
            category_ids: null,
            unit_price: Number(item.final_unit_price ?? item.unit_price ?? 0),
            quantity: Number(item.quantity || 0),
            applied_price_tier_id: item.applied_price_tier_id ?? null,
            stock_units_consumed: null,
          })),
      };
      const promotionQuote =
        await this.promotionEngine.quoteDiscounts(promotionInput);
      promotionDiscount = promotionQuote.total_discount || 0;
      promotionSnapshots = (promotionQuote.order_promotions_snapshot || []).map(
        (s) => ({
          promotion_id: s.promotion_id,
          discount_amount: Number(s.discount_amount || 0),
        }),
      );
    } catch (err) {
      this.logger.warn(
        `[editor] quoteDiscounts failed: ${(err as Error).message}`,
      );
      // El editor nunca devuelve éxito falso: si la cotización falla y el
      // cliente envió `promotion_ids`, emitimos auditoría y rechazamos.
      if (Array.isArray(dto.promotion_ids) && dto.promotion_ids.length > 0) {
        await this.auditService.logCustom(
          userId,
          'order.editor.pricing_failed',
          AuditResource.ORDERS,
          {
            order_id: orderId,
            store_id: storeId,
            request_id: requestId,
            stage: 'promotion_quote',
            error: (err as Error).message,
            // NO logueamos ids de cupón, customer_id, ni secretos.
            item_count: dto.items.length,
          },
          orderId,
        );
        throw new VendixHttpException(ErrorCodes.ORD_EDIT_PROMOTION_INVALID_001);
      }
    }

    // 10) Coupon validation. Draft no consume `current_uses`; `created` lo
    //     ajusta una vez si el código cambió.
    let couponId: number | null = existingOrder.coupon_id ?? null;
    let couponDiscount = 0;
    const requestedCode = (dto.coupon_code || '').trim();
    const currentCode = (existingOrder.coupon_code || '').trim();
    const couponChanged = requestedCode !== currentCode;

    if (requestedCode) {
      try {
        const remainingSubtotal = Math.max(
          0,
          Number(existingOrder.subtotal_amount) - promotionDiscount,
        );
        const cartItems = dto.items
          .filter((item) => item.product_id)
          .map((item) => ({
            product_id: item.product_id as number,
            category_id: null,
            category_ids: null,
            line_total: roundMoney(
              Number(item.final_unit_price ?? item.unit_price ?? 0) *
                Number(item.quantity || 0),
            ),
          }));
        const validation = await this.couponsService.validate({
          code: requestedCode,
          cart_subtotal: remainingSubtotal,
          customer_id: dto.customer_id,
          items: cartItems,
          store_id: storeId,
        } as any);
        couponId = validation.coupon_id;
        couponDiscount = roundMoney(
          Math.min(validation.discount_amount || 0, remainingSubtotal),
        );
      } catch (err) {
        this.logger.warn(
          `[editor] coupon validation failed: ${(err as Error).message}`,
        );
        await this.auditService.logCustom(
          userId,
          'order.editor.pricing_failed',
          AuditResource.ORDERS,
          {
            order_id: orderId,
            store_id: storeId,
            request_id: requestId,
            stage: 'coupon_validation',
            // No logueamos el código del cupón — sólo su longitud.
            coupon_code_length: requestedCode.length,
            error: (err as Error).message,
          },
          orderId,
        );
        // Round 1 MAJOR #9: el error ya no se silencia — se traduce al código
        // de promoción/cupón inválido. La causa original viaja en `details`
        // para depuración sin filtrar PII.
        throw new VendixHttpException(
          ErrorCodes.ORD_EDIT_PROMOTION_INVALID_001,
          undefined,
          { stage: 'coupon_validation', cause: (err as Error).message },
        );
      }
    } else if (couponChanged && currentCode) {
      // El cliente quitó el cupón. Limpiamos la referencia sin ajustar el
      // contador: el consumo se hizo en `flow/pay`, no en el editor.
      couponId = null;
      couponDiscount = 0;
    }

    // 11) Totales server-owned. Subtotal = Σ items.final_unit_price × qty;
    //     tax_amount se respeta del DTO recalculado por `normalizePriceUnitLines`;
    //     discount = promotionDiscount + couponDiscount.
    let recalculatedSubtotal = 0;
    let recalculatedTax = 0;
    for (let i = 0; i < dto.items.length; i++) {
      const item = dto.items[i];
      const unitBase = Number(item.final_unit_price ?? item.unit_price ?? 0);
      const quantity = Number(item.quantity || 0);
      // Multi-tarifa + packSize: si la línea tenía scale (price_units),
      // `normalizePriceUnitLines` ya aplicó el delta. Usamos el `total_price`
      // del DTO cuando viene, o recalculamos desde `final_unit_price × priceUnits`.
      const priceUnitsQty =
        priceUnits.priceUnitByIndex[i] ?? quantity;
      const lineTotal = roundMoney(unitBase * priceUnitsQty);
      recalculatedSubtotal = roundMoney(recalculatedSubtotal + lineTotal);
      // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 BLOCKER F16.
      // `tax_amount_item` is a PER-UNIT snapshot. The previous version
      // summed it directly into `recalculatedTax`, which silently
      // under-counted the tax for any line with `quantity > 1` — an
      // editor that just bumped quantities would persist a tax_amount
      // that didn't match the order_item rows the same editor just
      // wrote. Match the POS pattern (`pos-payment.service.ts:148-151`)
      // and multiply by `quantity` so the totals reconcile.
      recalculatedTax = roundMoney(
        recalculatedTax +
          Number(item.tax_amount_item || 0) * quantity,
      );
    }
    if (priceUnits.adjusted > 0) {
      recalculatedSubtotal = roundMoney(
        recalculatedSubtotal + priceUnits.subtotalDelta,
      );
      recalculatedTax = roundMoney(recalculatedTax + priceUnits.taxDelta);
    }
    const discountAmount = roundMoney(promotionDiscount + couponDiscount);
    const grandTotal = roundMoney(
      recalculatedSubtotal +
        recalculatedTax -
        discountAmount +
        (dto.shipping_cost ?? shippingCost),
    );

    // 12) Stock validation se ejecuta DENTRO de la transacción. Para
    //     cada línea con `track_inventory`, el asignador cubre la cantidad
    //     repartiendo entre bodegas. Shortfall → 409 + audit + throw.
    //
    //     La validación pre-flight sigue siendo importante para fallar ANTES
    //     de tocar la fila: la diferencia es que `tx` se inyecta al asignador
    //     para que la lectura del stock y la reserva vivan en la MISMA
    //     transacción (Round 1 MAJOR #12). El chequeo pre-flight conserva la
    //     verificación temprana de shortfall pero deja la reserva definitiva
    //     al camino `13d` dentro de la transacción.
    if (!isDraft) {
      // Round 3 MAJOR #10 — pre-flight used to issue one `products.findUnique`
      // per item (N+1) before the stock allocator even ran. A 30-line cart
      // became 30 round-trips for the products alone. We collapse the lookup
      // into a single batched query: pull `id` + `track_inventory` for every
      // distinct product id, then resolve each item from a Map.
      const productIds = Array.from(
        new Set(
          dto.items
            .map((it) => (typeof it.product_id === 'number' ? it.product_id : null))
            .filter((id): id is number => id !== null),
        ),
      );
      const productRows =
        productIds.length > 0
          ? await this.prisma.products.findMany({
              where: { id: { in: productIds }, store_id: storeId },
              select: { id: true, track_inventory: true },
            })
          : [];
      const trackInventoryByProduct = new Map<number, boolean>();
      for (const row of productRows) {
        trackInventoryByProduct.set(row.id, !!row.track_inventory);
      }

      for (const item of dto.items) {
        if (!item.product_id) continue;
        if (!trackInventoryByProduct.get(item.product_id)) continue;
        const allocation = await this.sellableStockAllocator.allocateForLine(
          storeId,
          item.product_id,
          item.product_variant_id,
          Number(item.quantity || 0),
        );
        if (allocation.shortfall > 0) {
          await this.auditService.logCustom(
            userId,
            'order.stock_reservation_failed',
            AuditResource.ORDERS,
            {
              order_id: orderId,
              store_id: storeId,
              request_id: requestId,
              stage: 'pre_flight',
              product_id: item.product_id,
              product_variant_id: item.product_variant_id ?? null,
              requested_quantity: Number(item.quantity || 0),
              shortfall: allocation.shortfall,
            },
            orderId,
          );
          throw new VendixHttpException(
            ErrorCodes.POS_STOCK_INSUFFICIENT_001,
            undefined,
            {
              product_id: item.product_id,
              variant_id: item.product_variant_id,
              requested: Number(item.quantity || 0),
              shortfall: allocation.shortfall,
            },
          );
        }
      }
    }

    const beforeTotals = {
      subtotal: Number(existingOrder.subtotal_amount),
      tax_amount: Number(existingOrder.tax_amount),
      discount_amount: Number(existingOrder.discount_amount),
      shipping_cost: Number(existingOrder.shipping_cost),
      grand_total: Number(existingOrder.grand_total),
      coupon_id: existingOrder.coupon_id,
      coupon_code: existingOrder.coupon_code,
      // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 MAJOR #15.
      // Customer swaps were invisible in the audit timeline because
      // before/after totals only carried the money fields. Persist
      // `customer_id` on both sides so a re-enactment query can pin
      // the moment the order changed hands (legal & tax-relevant).
      customer_id: existingOrder.customer_id ?? null,
    };

    // 13) Transacción atómica: claim + replace items + order_promotions +
    //     cupón + reservas de stock + commit.
    const result = await this.prisma.$transaction(async (tx) => {
      // 13-pre) ERR-07 / DB-14 — invariante "prepared + variantes exige
      //        variante". Mismo helper que `create` y `updateOrderItems`:
      //        una sola definición para que no vuelva a divergir.
      await assertVariantRequiredForPrepared(tx, dto.items);

      // 13a) Claim atómico del estado. Si otro operador cambió la orden
      //      entre el findFirst y acá, count=0 → 409.
      //
      //      Round 1 MAJOR #6: el error genérico `ORD_EDIT_INVALID_STATE_001`
      //      perdía la distinción entre tres casos reales. Ahora leemos el
      //      estado real de la orden tras el fallo del claim y mapeamos:
      //        - pending / pending_payment / processing / shipped /
      //          delivered / finished / cancelled / refunded
      //            → `ORD_EDIT_NOT_ALLOWED_001` (la orden ya no es editable)
      //        - created / draft (race por microsegundos)
      //            → `ORD_EDIT_STATE_CHANGED_001` (otro operador ganó la
      //              carrera; pedirle al cliente que recargue)
      //        - cualquier otro estado inesperado
      //            → `ORD_EDIT_INVALID_STATE_001` (catch-all)
      const claim = await tx.orders.updateMany({
        where: {
          id: orderId,
          store_id: storeId,
          state: { in: ['created', 'draft'] as order_state_enum[] },
        },
        data: { updated_at: new Date() },
      });
      if (claim.count === 0) {
        const currentRow = await tx.orders.findFirst({
          where: { id: orderId, store_id: storeId },
          select: { state: true },
        });
        const currentState = currentRow?.state as order_state_enum | undefined;
        const lockedStates: order_state_enum[] = [
          'pending_payment',
          'processing',
          'shipped',
          'delivered',
          'finished',
          'cancelled',
          'refunded',
          'pending_delivery',
        ];
        if (currentState && lockedStates.includes(currentState)) {
          throw new VendixHttpException(
            ErrorCodes.ORD_EDIT_NOT_ALLOWED_001,
            undefined,
            { state: currentState },
          );
        }
        if (currentState === 'created' || currentState === 'draft') {
          // El claim falló pero el estado sigue siendo editable: race pura
          // (otro editor ganó por microsegundos). Distinguido para que la
          // UI pueda mostrar "recargue" en vez de un error permanente.
          throw new VendixHttpException(
            ErrorCodes.ORD_EDIT_STATE_CHANGED_001,
          );
        }
        // Catch-all: la orden no existe, o el estado no está en el enum
        // conocido. Devolvemos el código genérico como red de seguridad.
        throw new VendixHttpException(
          ErrorCodes.ORD_EDIT_INVALID_STATE_001,
          undefined,
          { state: currentState ?? null },
        );
      }

      // 13b) Reservas de stock (sólo si NO es draft). Se liberan las
      //      activas ANTES de reservar las nuevas.
      if (!isDraft) {
        await this.stockLevelManager.releaseReservationsByReference(
          'order',
          orderId,
          'cancelled',
          tx,
        );
      }

      // Round 3 MINOR #15 — `orders.currency` is intentionally NOT mutated
      // by the editor. The currency is fixed at order creation:
      //   `createOrderDto.currency || (await this.settingsService.getStoreCurrency())`
      // (see `createOrder` above), and the order_items that carry
      // monetary values all inherit that scale. Changing it mid-edit
      // would mean re-scaling every line total, tax, discount and
      // shipping cost to a different unit — that's a separate decision
      // (re-create the order, or migrate manually), not a side effect
      // of editing items. We document the choice rather than to over-write
      // it: a re-render of an existing order keeps the currency it was
      // created with.

      // 13c) Replace items. Antes del `deleteMany + createMany`, capturamos
      //      las filas existentes para MERGAR los campos que el DTO NO
      //      expone: KDS (`skip_kds`), seriales (`serial_numbers`,
      //      `serial_ids`) y `inventory_commumed_at_fire`. Sin esta
      //      preservación, una edición de una orden ya disparada a cocina
      //      borraba esos flags y el listener de KDS veía "skip_kds=true"
      //      — platos que ya estaban en cocina aparecían como no
      //      enviados.
      //
      //      Round 1 BLOCKER #5.
      const previousItems = await tx.order_items.findMany({
        where: { order_id: orderId },
      });
      const previousByKey = new Map<
        string,
        {
          skip_kds?: boolean | null;
          serial_numbers?: unknown;
          serial_ids?: number[] | null;
          inventory_committed_at_fire?: boolean | null;
          inventory_consumed_at_fire?: boolean | null;
          cost_price?: Prisma.Decimal | number | null;
          sale_unit_code_snapshot?: string | null;
          sale_quantity_snapshot?: Prisma.Decimal | number | null;
          catalog_unit_price?: Prisma.Decimal | number | null;
          catalog_final_price?: Prisma.Decimal | number | null;
          kitchen_ticket_items?: unknown;
        }
      >();
      for (const prev of previousItems) {
        // Clave: producto + variante. Si el operador agrega la misma
        // variante dos veces, el segundo gana (mismo comportamiento que la
        // sustitución cruda anterior).
        const key = `${prev.product_id ?? 'null'}:${prev.product_variant_id ?? 'null'}`;
        previousByKey.set(key, prev as any);
      }

      await tx.order_items.deleteMany({ where: { order_id: orderId } });

      const variantIds = dto.items
        .map((it) => (it.product_id ? it.product_variant_id : null))
        .filter((v): v is number => typeof v === 'number');
      const variantImageById = new Map<number, string | null>();
      if (variantIds.length) {
        // Round 1 BLOCKER #3: el `tx.product_variants.findMany` corría
        // sobre el cliente no-scoped, así que un `product_variant_id` de OTRA
        // tienda satisfacía la búsqueda y la imagen (o la ausencia de ella)
        // terminaba mezclada en la fila de nuestra tienda. Filtro por el
        // `products.store_id` del contexto para que un id "huérfano" devuelva
        // `null` y conserve la invariante multi-tenant.
        const variants = await tx.product_variants.findMany({
          where: {
            id: { in: Array.from(new Set(variantIds)) },
            products: { store_id: storeId },
          },
          include: { product_images: true },
        });
        for (const v of variants) {
          variantImageById.set(v.id, v.product_images?.image_url ?? null);
        }
        // CP-POLLO-ARABE-727 C.4 — validación de pertenencia variante↔producto
        // (ERR-15). Un `product_variant_id` ajeno al `product_id` de la línea
        // dejaría el inventario descuadrado y el ticket de cocina mostrando algo
        // que no se vendió. Se valida en memoria sobre el MISMO batch (un solo
        // findMany, sin roundtrips por ítem).
        const variantProductById = new Map<number, number>(
          variants.map((v) => [v.id, v.product_id]),
        );
        for (const item of dto.items) {
          if (item.product_id && item.product_variant_id != null) {
            const variantProductId = variantProductById.get(item.product_variant_id);
            if (variantProductId === undefined || variantProductId !== item.product_id) {
              throw new VendixHttpException(
                ErrorCodes.PRODUCT_VARIANT_MISMATCH,
                `La variante #${item.product_variant_id} no pertenece al producto #${item.product_id}`,
              );
            }
          }
        }
      }

      await tx.order_items.createMany({
        data: dto.items.map((item, index) => {
          const tierSnap = tierSnapshots[index];
          const variant_image_url =
            item.product_id && item.product_variant_id
              ? variantImageById.get(item.product_variant_id) ?? null
              : null;
          // MERGE: si el editor no trae `skip_kds / inventory_committed_at_fire`,
          // preservamos el valor previo para que editar no "despida" platos ya
          // enviados a cocina.
          const key = `${item.product_id ?? 'null'}:${item.product_variant_id ?? 'null'}`;
          const previous = previousByKey.get(key);
          const mergedSkipKds =
            previous?.skip_kds !== undefined ? previous.skip_kds : false;
          const mergedInventoryCommitted =
            previous?.inventory_committed_at_fire !== undefined
              ? previous.inventory_committed_at_fire
              : null;
          const mergedInventoryConsumed =
            previous?.inventory_consumed_at_fire !== undefined
              ? previous.inventory_consumed_at_fire
              : null;
          const mergedSerialNumbers = previous?.serial_numbers ?? null;
          const mergedSerialIds = previous?.serial_ids ?? null;
          // El DTO no expone `cost_price` / `sale_unit_code_snapshot` /
          // `sale_quantity_snapshot` / `catalog_*`; se preservan desde la fila
          // previa para que la edición no destruya snapshots históricos
          // (costeo, UoM, ticket, reporte).
          const mergedCost =
            previous?.cost_price !== undefined ? previous.cost_price : null;
          const mergedSaleUnit =
            previous?.sale_unit_code_snapshot !== undefined
              ? previous.sale_unit_code_snapshot
              : null;
          const mergedSaleQty =
            previous?.sale_quantity_snapshot !== undefined
              ? previous.sale_quantity_snapshot
              : null;
          const mergedCatalogUnit =
            previous?.catalog_unit_price !== undefined
              ? previous.catalog_unit_price
              : null;
          const mergedCatalogFinal =
            previous?.catalog_final_price !== undefined
              ? previous.catalog_final_price
              : null;
          return {
            order_id: orderId,
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
            catalog_unit_price:
              mergedCatalogUnit !== null && mergedCatalogUnit !== undefined
                ? (mergedCatalogUnit as any)
                : item.unit_price,
            catalog_final_price:
              mergedCatalogFinal !== null && mergedCatalogFinal !== undefined
                ? (mergedCatalogFinal as any)
                : item.final_unit_price ?? item.unit_price,
            final_unit_price: item.final_unit_price ?? item.unit_price,
            is_price_overridden:
              item.is_price_overridden ??
              Boolean(item.price_override_reason),
            price_override_reason: item.price_override_reason,
            weight: item.weight,
            weight_unit: item.weight_unit,
            // UoM de venta snapshot (mismo comportamiento que `create`).
            sale_unit_code_snapshot: mergedSaleUnit as any,
            sale_quantity_snapshot: mergedSaleQty as any,
            // Campos fusionados — KDS, seriales, inventario consumido.
            skip_kds: mergedSkipKds as any,
            serial_numbers_snapshot: mergedSerialNumbers as any,
            // `serial_ids` e `inventory_committed_at_fire` no son columnas
            // en order_items — la asociación con `inventory_serial_numbers`
            // se hace por separado en `OrderSerialResolver`, y
            // `committed_at_fire` es una columna propuesta en planes
            // futuros pero no presente en el schema actual.
            inventory_consumed_at_fire: mergedInventoryConsumed as any,
            cost_price: mergedCost as any,
            item_type:
              item.item_type === 'product'
                ? 'physical'
                : item.item_type || (item.product_id ? 'physical' : 'custom'),
            applied_price_tier_id: tierSnap?.tier_id ?? null,
            applied_price_tier_name_snapshot: tierSnap?.tier_name ?? null,
            stock_units_consumed: tierSnap?.stock_units_consumed ?? null,
            price_unit_quantity: priceUnits.priceUnitByIndex[index] ?? null,
            updated_at: new Date(),
          };
        }),
      });

      // CP-POS-SVC-PERF-001 / C.4 — atomic booking creation. For every
      // submitted item that carries a `booking` block, create (or update)
      // a `bookings` row inside the SAME $transaction that persists the
      // order_item. If the editor fails for any reason afterwards, the
      // rollback discards the booking too — no orphan reservations.
      //
      // Hardening (post-C.4 audit): `bookings.customer_id` is NOT NULL in
      // the schema; an anonymous draft + booking would violate FK.
      // We reject up-front with 400 POS_BOOKING_REQUIRES_CUSTOMER so the
      // cashier sees an actionable error, not a 500 from Prisma.
      const itemsWithBooking = dto.items
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => item.booking);
      if (itemsWithBooking.length > 0 && !dto.customer_id) {
        throw new VendixHttpException(
          ErrorCodes.POS_BOOKING_REQUIRES_CUSTOMER,
          'Para agendar un servicio la orden requiere un cliente asignado.',
          { stage: 'booking_validation' },
        );
      }
      if (itemsWithBooking.length > 0) {
        // Re-read order_items to obtain the freshly minted IDs.
        const newItemsForBooking = await tx.order_items.findMany({
          where: { order_id: orderId },
          select: { id: true, product_id: true, product_variant_id: true },
        });
        const orderItemIdByKey = new Map<string, number>();
        for (const it of newItemsForBooking) {
          const k = `${it.product_id ?? 'null'}:${it.product_variant_id ?? 'null'}`;
          orderItemIdByKey.set(k, it.id);
        }
        for (const { item } of itemsWithBooking) {
          if (!item.booking) continue;
          const k = `${item.product_id ?? 'null'}:${item.product_variant_id ?? 'null'}`;
          const orderItemId = orderItemIdByKey.get(k);
          if (!orderItemId) {
            this.logger.warn(
              `[editor] booking block present but order_item not found for key=${k}`,
            );
            continue;
          }
          const b = item.booking;
          if (b.booking_id) {
            // Re-agendamiento: verify ownership (same order, same store)
            // so a cashier can't edit another tenant's booking by accident.
            const existing = await tx.bookings.findFirst({
              where: {
                id: b.booking_id,
                order_id: orderId,
                store_id: storeId,
              },
              select: { id: true },
            });
            if (!existing) {
              throw new VendixHttpException(
                ErrorCodes.POS_BOOKING_NOT_FOUND,
                `La reserva #${b.booking_id} no pertenece a esta orden.`,
                { stage: 'booking_update' },
              );
            }
            await tx.bookings.update({
              where: { id: b.booking_id },
              data: {
                provider_id: b.provider_id ?? null,
                date: b.date ? new Date(b.date) : undefined,
                start_time: b.start_time ?? undefined,
                end_time: b.end_time ?? undefined,
                notes: b.notes ?? undefined,
                service_location_type:
                  b.service_location_type ?? undefined,
                updated_at: new Date(),
              },
            });
          } else if (b.date && b.start_time && b.end_time) {
            // Fresh booking. Generate a stable per-day booking_number
            // so the cashier has a human-readable handle. Mirrors
            // reservations.service.ts:1559.
            const booking_number = await this.generateBookingNumberForEditor(
              tx,
              storeId,
              b.date,
            );
            await tx.bookings.create({
              data: {
                store_id: storeId,
                customer_id: dto.customer_id!,
                product_id: item.product_id!,
                product_variant_id:
                  item.product_id ? item.product_variant_id ?? null : null,
                order_id: orderId,
                cart_item_id: `oi-${orderItemId}`,
                provider_id: b.provider_id ?? null,
                date: new Date(b.date),
                start_time: b.start_time,
                end_time: b.end_time,
                notes: b.notes ?? null,
                service_location_type: b.service_location_type ?? 'shop',
                channel: 'pos',
                status: 'confirmed',
                booking_number,
              },
            });
          } else {
            // Booking block present but missing required fields. Reject
            // explicitly — silent skip would leave a service line
            // without a reservation, breaking the order detail
            // "Citas agendadas" section.
            throw new VendixHttpException(
              ErrorCodes.POS_BOOKING_INVALID,
              'El servicio requiere fecha, hora de inicio y hora de fin.',
              { stage: 'booking_create', product_id: item.product_id },
            );
          }
        }
      }

      // 13d) Reservas para los nuevos items (sólo si NO es draft).
      //
      //      Round 1 BLOCKER #2: el bloque anterior hacía `reserveStock` con
      //      `validate_availability=false` + `allow_negative_available=true`
      //      y SWALLOWEA el error con `logger.warn` — una reserva fallida se
      //      perdía silenciosamente y dejaba la orden en disco sin su
      //      reserva. La reserva ahora es ESTRICTA: si falla, auditamos
      //      ANTES del throw y abortamos la transacción para que el caller
      //      reciba un `POS_STOCK_INSUFFICIENT_001` (409 accionable, no un
      //      500 opaco).
      if (!isDraft) {
        const newItems = await tx.order_items.findMany({
          where: { order_id: orderId },
          include: {
            products: { select: { id: true, track_inventory: true } },
          },
        });

        // Round 3 MAJOR #11 — group reservation work by the (product, variant,
        // location) tuple so we issue ONE `reserveStock` per group instead of
        // one per row. The default-location lookup is cached inside
        // `getDefaultLocationForProduct` already, but batching the calls
        // themselves cuts DB round-trips from N (one per item) to the
        // cardinality of the groups. Quantities are summed across rows that
        // share the tuple (e.g. two lines of the same product+variant collapse
        // into a single reservation); `stockUnitsConsumed` falls back to the
        // first row's value when the group is homogeneous, otherwise it is
        // `undefined` and `reserveStock` re-resolves from quantity.
        const reservationGroups = new Map<
          string,
          {
            productId: number;
            variantId: number | null;
            locationId: number | null;
            quantity: number;
            stockUnitsConsumed: number | undefined;
          }
        >();
        for (const item of newItems) {
          if (!item.products?.track_inventory) continue;
          const variantId =
            item.product_variant_id == null ? null : Number(item.product_variant_id);
          // `getDefaultLocationForProduct` is awaited inline to keep ordering
          // deterministic; the call is idempotent and cheap (cached at the
          // stock level manager level).
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
          const key = `${item.product_id}::${variantId ?? 'null'}::${location_id ?? 'null'}`;
          const existing = reservationGroups.get(key);
          if (existing) {
            existing.quantity += Number(item.quantity || 0);
            // Only keep `stockUnitsConsumed` if every row in the group had
            // the same value (otherwise `reserveStock` falls back to qty).
            if (existing.stockUnitsConsumed !== stockUnitsConsumed) {
              existing.stockUnitsConsumed = undefined;
            }
          } else {
            reservationGroups.set(key, {
              productId: item.product_id,
              variantId,
              locationId: location_id,
              quantity: Number(item.quantity || 0),
              stockUnitsConsumed,
            });
          }
        }

        for (const group of reservationGroups.values()) {
          try {
            // `validate_availability=true` (defensa) +
            // `allow_negative_available=false` (Round 1 BLOCKER #2): si la
            // reserva no cabe, `reserveStock` lanza `INV_STOCK_001` y la
            // transacción aborta. Esto es coherente con la validación
            // pre-flight del paso 12: si el cliente superó ese gate, la
            // reserva debería entrar; si falla acá, hay una race con otro
            // consumidor concurrente que queremos reportar.
            //
            // Round 4 BLOCKER: `group.locationId` se construye arriba
            // desde `getDefaultLocationForProduct`, que devuelve
            // `number | null`. La key de agrupación ya codifica el caso
            // `null` con la literal `'null'`, así que si la bodega por
            // defecto del producto no está configurada, abortamos el
            // editor con `POS_STOCK_INSUFFICIENT_001` ANTES de pasar
            // `null` a `reserveStock` (que exige `number`). Este es el
            // mismo código de error que se devuelve cuando la reserva
            // falla por falta de stock: la falta de bodega operativa es
            // imposibilidad logística, no un error 500 opaco.
            if (group.locationId == null) {
              throw new VendixHttpException(
                ErrorCodes.POS_STOCK_INSUFFICIENT_001,
                undefined,
                {
                  reason: 'no default location for product',
                  product_id: group.productId,
                  variant_id: group.variantId,
                },
              );
            }
            await this.stockLevelManager.reserveStock(
              group.productId,
              group.variantId || undefined,
              group.locationId, // narrowed to `number` by the guard above
              group.quantity,
              'order',
              orderId,
              userId,
              true, // validate_availability (Round 1 #2)
              tx,
              undefined,
              false,
              group.stockUnitsConsumed,
              false, // allow_negative_available=false (Round 1 #2)
            );
          } catch (err) {
            const message = (err as Error)?.message ?? 'reserve failed';
            // Audit ANTES del throw: la timeline tiene que registrar la
            // intención de reserva fallida aunque la transacción aborte.
            try {
              await this.auditService.logCustom(
                userId,
                'order.stock_reservation_failed',
                AuditResource.ORDERS,
                {
                  order_id: orderId,
                  store_id: storeId,
                  request_id: requestId,
                  stage: 'commit_reserve',
                  product_id: group.productId,
                  product_variant_id: group.variantId,
                  requested_quantity: group.quantity,
                  error: message,
                },
                orderId,
              );
            } catch {
              // audit es observabilidad, no bloquea.
            }
            throw new VendixHttpException(
              ErrorCodes.POS_STOCK_INSUFFICIENT_001,
              message,
              {
                product_id: group.productId,
                variant_id: group.variantId,
                requested: group.quantity,
              },
            );
          }
        }

        // Round 3 MINOR #15 — `orders.currency` is intentionally NOT mutated
        // by the editor. The currency is fixed at order creation:
        //   `createOrderDto.currency || (await this.settingsService.getStoreCurrency())`
        // (see `createOrder` above), and the order_items that carry
        // monetary values all inherit that scale. Changing it mid-edit
        // would mean re-scaling every line total, tax, discount and
        // shipping cost to a different unit — that's a separate decision
        // (re-create the order, or migrate manually), not a side effect
        // of editing items. We document the choice rather than to over-write
        // it: a re-render of an existing order keeps the currency it was
        // created with.
      }

      // 13e) Reconciliar `order_promotions`: borrar existentes, reinsertar
      //      snapshots nuevas del motor.
      await tx.order_promotions.deleteMany({
        where: { order_id: orderId },
      });
      if (promotionSnapshots.length > 0) {
        await tx.order_promotions.createMany({
          data: promotionSnapshots.map((snap) => ({
            order_id: orderId,
            promotion_id: snap.promotion_id,
            customer_id: dto.customer_id,
            discount_amount: snap.discount_amount,
          })),
        });
      }

      // 13f) Cupón: ajustar `current_uses` UNA vez si cambió y la orden
      //      ya estaba creada. Draft no incrementa ni decrementa: la
      //      snapshot queda pendiente y `flow/pay` consume.
      //
      //      Round 1 MAJOR #10: `coupons.update` (cruzar el contador) se
      //      hace con `updateMany` idempotente y guarda `current_uses:
      //      { lt: max_uses }` + `state='active'`. count=0 ⇒ otro cargo
      //      consumió el cupón primero y lanzamos `ORD_EDIT_COUPON_COMMIT_001`.
      //      El `decrement` usa el mismo patrón para que un rollback que
      //      ya bajó el contador no se vuelva a bajar.
      //
      //      Round 1 BLOCKER #4: el `tx.coupons.update` corría sobre el
      //      cliente no-scoped; un cupón de OTRA tienda cuya id cayera en
      //      el filtro sería aceptado por la FK y mutaba su contador.
      //      Ahora el `where` exige `stores: { some: { id: storeId } }`
      //      para garantizar pertenencia.
      if (!isDraft && couponChanged) {
        if (currentCode && existingOrder.coupon_id) {
          const dec = await tx.coupons.updateMany({
            where: {
              id: existingOrder.coupon_id,
              stores: { some: { id: storeId } },
              current_uses: { gt: 0 },
            },
            data: { current_uses: { decrement: 1 } },
          });
          if (dec.count === 0) {
            throw new VendixHttpException(
              ErrorCodes.ORD_EDIT_COUPON_COMMIT_001,
              undefined,
              { stage: 'decrement', coupon_id: existingOrder.coupon_id },
            );
          }
        }
        if (couponId) {
          const inc = await tx.coupons.updateMany({
            where: {
              id: couponId,
              stores: { some: { id: storeId } },
              state: 'active',
            },
            data: { current_uses: { increment: 1 } },
          });
          if (inc.count === 0) {
            throw new VendixHttpException(
              ErrorCodes.ORD_EDIT_COUPON_COMMIT_001,
              undefined,
              { stage: 'increment', coupon_id: couponId },
            );
          }
        }
      }

      // 13g) Update orden: metadata, totales, shipping, cupón snapshot.
      await tx.orders.update({
        where: { id: orderId },
        data: {
          // ADR-9 (CP-POLLO-ARABE-727): alias↔cliente mutuamente excluyentes
          // (CHECK orders_customer_xor_alias). A.3 escribió este guard cuando el
          // DTO aún no exponía customer_alias; B.4 lo habilita, así que el guard
          // debe persistir el alias cuando se envía. El CHECK respondería 500 si
          // ambos se poblaran en la misma fila — este guard es la 1ª defensa.
          // Preserva el comportamiento previo: `undefined` (no enviado) no toca
          // customer_id; solo null/número lo modifican; el alias solo se escribe
          // cuando se envía (y fuerza customer_id null).
          ...(dto.customer_id != null
            ? { customer_id: dto.customer_id, customer_alias: null }
            : dto.customer_alias != null
              ? { customer_id: null, customer_alias: dto.customer_alias }
              : dto.customer_id === null
                ? { customer_id: null, customer_alias: null }
                : {}),
          notes: dto.notes ?? existingOrder.notes,
          internal_notes: dto.internal_notes ?? existingOrder.internal_notes,
          delivery_type: dto.delivery_type ?? existingOrder.delivery_type,
          billing_address_id: dto.billing_address_id ?? existingOrder.billing_address_id,
          shipping_address_id: dto.shipping_address_id ?? existingOrder.shipping_address_id,
          shipping_method_id: dto.shipping_method_id ?? existingOrder.shipping_method_id,
          shipping_rate_id: resolvedShippingRateId ?? existingOrder.shipping_rate_id,
          shipping_cost: dto.shipping_cost ?? shippingCost,
          subtotal_amount: recalculatedSubtotal,
          tax_amount: recalculatedTax,
          discount_amount: discountAmount,
          grand_total: grandTotal,
          coupon_id: couponId,
          coupon_code: requestedCode || null,
          updated_at: new Date(),
        },
      });

      // 13h) Hidratar respuesta completa dentro de la misma transacción.
      return tx.orders.findFirst({
        where: { id: orderId },
        include: {
          stores: {
            select: { id: true, name: true, store_code: true },
          },
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
              kitchen_ticket_items: {
                orderBy: { id: 'desc' },
                select: {
                  id: true,
                  status: true,
                  kitchen_ticket_id: true,
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
              // QUI-728 (E.2) — ver la nota de `findOne`: proyección mínima de
              // la cuenta de destino, sin saldos ni cuenta contable.
              bank_account: {
                select: {
                  id: true,
                  name: true,
                  bank_name: true,
                  account_number: true,
                },
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
          order_promotions: {
            select: {
              id: true,
              promotion_id: true,
              customer_id: true,
              discount_amount: true,
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
    });

    // 14) Coherencia: si la fila devuelta no coincide con la actualización,
    //     no devolver éxito falso. `ORD_EDIT_RESPONSE_MISMATCH_001` es 500
    //     porque es un fallo interno del servicio.
    //
    //     Round 1 MAJOR #7: el chequeo original sólo cubría subtotal y
    //     grand_total. Eso deja escapar divergencias en tax_amount,
    //     discount_amount, shipping_cost, coupon_id o coupon_code —
    //     exactamente los campos que el backend recalcula y que la UI
    //     muestra. Ampliamos la comparación y exponemos los deltas en
    //     `details` para que la timeline sea depurable sin abrir SQL.
    const expectedCouponCode = requestedCode || null;
    if (
      !result ||
      Number(result.subtotal_amount) !== recalculatedSubtotal ||
      Number(result.tax_amount) !== recalculatedTax ||
      Number(result.discount_amount) !== discountAmount ||
      Number(result.shipping_cost) !==
        (dto.shipping_cost ?? shippingCost) ||
      Number(result.grand_total) !== grandTotal ||
      (result.coupon_id ?? null) !== (couponId ?? null) ||
      (result.coupon_code ?? null) !== (expectedCouponCode ?? null)
    ) {
      throw new VendixHttpException(
        ErrorCodes.ORD_EDIT_RESPONSE_MISMATCH_001,
        undefined,
        {
          expected: {
            subtotal: recalculatedSubtotal,
            tax_amount: recalculatedTax,
            discount_amount: discountAmount,
            shipping_cost: dto.shipping_cost ?? shippingCost,
            grand_total: grandTotal,
            coupon_id: couponId ?? null,
            coupon_code: expectedCouponCode,
          },
          actual: result
            ? {
                subtotal: Number(result.subtotal_amount),
                tax_amount: Number(result.tax_amount),
                discount_amount: Number(result.discount_amount),
                shipping_cost: Number(result.shipping_cost),
                grand_total: Number(result.grand_total),
                coupon_id: result.coupon_id ?? null,
                coupon_code: result.coupon_code ?? null,
              }
            : null,
        },
      );
    }

    // 15) Firma las imágenes S3.
    await this.signOrderItemImages(result);

    // 16) Audit AFTER commit. Nunca antes: si falla el commit, no debe
    //     quedar una fila de auditoría que afirme lo contrario.
    try {
      await this.auditService.logCustom(
        userId,
        'order.editor.updated',
        AuditResource.ORDERS,
        {
          order_id: orderId,
          store_id: storeId,
          request_id: requestId,
          // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 MAJOR #14.
          // Surface `customer_id_before` so SIEM rules that grep for
          // "customer switched" can match without diffing the totals
          // block. The same id is also persisted in `before_totals` /
          // `after_totals` for re-enactment queries.
          customer_id: dto.customer_id,
          customer_id_before: existingOrder.customer_id ?? null,
          item_count: dto.items.length,
          before_totals: beforeTotals,
          after_totals: {
            subtotal: recalculatedSubtotal,
            tax_amount: recalculatedTax,
            discount_amount: discountAmount,
            shipping_cost: dto.shipping_cost ?? shippingCost,
            grand_total: grandTotal,
            coupon_id: couponId,
            coupon_code: requestedCode || null,
            // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 MAJOR #15.
            // Mirror `customer_id` on the after side so the row is
            // self-contained: a reader that only looks at `after_totals`
            // gets the new owner without having to JOIN against `orders`.
            customer_id: dto.customer_id ?? null,
          },
          is_draft: isDraft,
          // CP-POS-CREAR-EDITAR-COBRAR-001 — Round 3.5 MAJOR.
          // `coupon_changed` alone doesn't tell SIEM rules WHICH coupon
          // was removed/applied. Surface both `coupon_code_before` and
          // `coupon_code_after` so a rule like "operator removed
          // `WELCOME5` and applied `SUMMER20` on a draft > $X" can match
          // directly. `coupon_code_before` is null when no coupon was
          // previously applied; `coupon_code_after` is null when the
          // operator cleared the coupon. We log code lengths only when
          // the codes contain PII-style content; here we treat the code
          // as non-sensitive (it's already shown to the cashier and
          // printed on the ticket) so the literal value travels.
          coupon_changed: couponChanged,
          coupon_code_before: currentCode || null,
          coupon_code_after: requestedCode || null,
          // Carry the idempotency key into the audit row so future calls
          // with the same key short-circuit via step 2.5. Without this,
          // a retry would re-execute the whole pipeline.
          ...(dto.idempotency_key
            ? { idempotency_key: dto.idempotency_key }
            : {}),
        },
        orderId,
      );
    } catch (err) {
      // El audit es observabilidad, no bloquea el commit.
      this.logger.warn(
        `[editor] audit event failed: ${(err as Error).message}`,
      );
    }

    return result;
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
            // QUI-728 (E.2) — cuenta de destino de la transferencia, para que
            // el detalle de orden responda "¿a qué cuenta entró este dinero?"
            // sin ir a conciliación. Proyección MÍNIMA a propósito: nunca
            // `current_balance` / `opening_balance` / `chart_account_id` /
            // `column_mapping` — el saldo bancario no tiene por qué viajar a
            // una pantalla cuyo único propósito es identificar la cuenta.
            // Misma proyección que el selector de cobro del payment-collector.
            bank_account: {
              select: {
                id: true,
                name: true,
                bank_name: true,
                account_number: true,
              },
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

  /**
   * CP-POS-SVC-PERF-001 / C.4 — mirror of
   * `ReservationsService.generateBookingNumber` (same prefix scheme
   * `BKG-YYYYMMDD-NNNN`). Implemented locally so OrdersService does not
   * gain a circular dep on ReservationsService. Accepts a `tx` so the
   * findFirst runs inside the same transaction the booking is created
   * in, avoiding a race where two concurrent editor PUTs of the same
   * date see the same last sequence and produce duplicate numbers.
   */
  private async generateBookingNumberForEditor(
    tx: Prisma.TransactionClient,
    store_id: number,
    date: string,
  ): Promise<string> {
    const targetDate = new Date(date);
    const year = targetDate.getUTCFullYear().toString();
    const month = (targetDate.getUTCMonth() + 1)
      .toString()
      .padStart(2, '0');
    const day = targetDate.getUTCDate().toString().padStart(2, '0');
    const prefix = `BKG-${year}${month}${day}-`;

    const lastBooking = await tx.bookings.findFirst({
      where: {
        store_id,
        booking_number: { startsWith: prefix },
      },
      orderBy: { booking_number: 'desc' },
    });

    let sequence = 1;
    if (lastBooking) {
      const lastSequence = parseInt(lastBooking.booking_number.slice(-4));
      sequence = lastSequence + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  /**
   * Resuelve el mejor `tax_rate` por producto en UN batch lookup.
   *
   * El DTO del POS llega con un snapshot agregado por línea
   * (`tax_amount_item`, `tax_rate` como fracción) — sin `tax_rate_id`, sin
   * `tax_name`, sin `tax_type`. Para construir las filas de
   * `order_item_taxes` que respalden la cabecera del tiquete, consultamos
   * la mejor `tax_rate` activa del producto (ordenada por `priority` desc,
   * `take: 1`). Si el producto no tiene asignaciones, el `Map` queda sin
   * entrada y `buildOrderItemTaxesCreate` cae al fallback del snapshot del
   * DTO (tax_name='IVA', tax_type='iva', tax_rate_id=null).
   *
   * Misma forma de batch lookup que `assertSaleVatAllowed` arriba — sin
   * N+1 por línea. Las relaciones `product_tax_assignments`,
   * `tax_categories` y `tax_rates` no requieren scope explícito; el
   * `StorePrismaService` solo escopea las tablas registradas (products
   * hereda el filtro por tienda vía `id` que ya viene validado arriba).
   */
  private async resolveLineTaxesForOrder(
    productIds: number[],
  ): Promise<Map<number, ResolvedLineTax>> {
    const map = new Map<number, ResolvedLineTax>();
    if (productIds.length === 0) return map;

    const products = await this.prisma.products.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        product_tax_assignments: {
          select: {
            tax_categories: {
              select: {
                tax_type: true,
                tax_rates: {
                  select: {
                    id: true,
                    name: true,
                    rate: true,
                    is_compound: true,
                    priority: true,
                  },
                  orderBy: { priority: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    for (const p of products) {
      // Prisma ya devuelve `tax_rates` ordenadas por `priority` desc; el
      // primer match de cualquier asignación es la mejor tasa del producto.
      for (const assignment of p.product_tax_assignments ?? []) {
        const rate = assignment.tax_categories?.tax_rates?.[0];
        if (!rate) continue;
        map.set(p.id, {
          id: rate.id,
          name: rate.name,
          rate: rate.rate,
          is_compound: rate.is_compound ?? false,
          tax_type: assignment.tax_categories?.tax_type ?? null,
        });
        break;
      }
    }
    return map;
  }

  /**
   * Construye el payload `order_item_taxes: { create: [...] }` para anidar
   * dentro de `order_items.create`. Espeja checkout.service.ts (~1422,
   * ~2070) y payments.service.ts (~2791).
   *
   * Reglas:
   *  - `tax_rate` SIEMPRE como fracción (`0.19` para 19%). `Decimal(6,5)`.
   *  - `tax_amount` viene del snapshot del DTO (`tax_amount_item`); es la
   *    suma de impuestos de la línea, NO se recalcula — recalcular desde
   *    `base × tarifa` agrega un céntimo y descuadra la cabecera
   *    (orders.tax_amount ≠ Σ order_items.tax_amount).
   *  - Si el producto tiene `tax_rate` resuelto del catálogo, persistimos
   *    FK + nombre + tipo reales; si NO (producto sin asignaciones),
   *    fallback al snapshot del DTO con `tax_name='IVA'`, `tax_type='iva'`,
   *    `tax_rate_id=null` para que el tiquete al menos pinte la línea.
   */
  private buildOrderItemTaxesCreate(
    item: CreateOrderItemDto,
    resolved: ResolvedLineTax | null,
  ) {
    const taxAmount = Number(item.tax_amount_item ?? 0);
    if (taxAmount <= 0) return undefined;

    if (resolved) {
      return {
        create: [
          {
            tax_rate_id: resolved.id,
            tax_name: resolved.name,
            tax_rate: new Prisma.Decimal(resolved.rate as any),
            tax_amount: new Prisma.Decimal(item.tax_amount_item as any),
            tax_type: (resolved.tax_type ?? 'iva') as any,
            is_compound: resolved.is_compound ?? false,
          },
        ],
      };
    }

    // Fallback: producto sin `tax_rates` configuradas. Persistimos el
    // snapshot del DTO con defaults conservadores para que el tiquete
    // muestre la línea de IVA en vez de salir en blanco.
    return {
      create: [
        {
          tax_rate_id: null,
          tax_name: 'IVA',
          tax_rate: new Prisma.Decimal(
            item.tax_rate != null ? item.tax_rate : 0,
          ),
          tax_amount: new Prisma.Decimal(item.tax_amount_item as any),
          tax_type: 'iva' as const,
          is_compound: false,
        },
      ],
    };
  }
}
