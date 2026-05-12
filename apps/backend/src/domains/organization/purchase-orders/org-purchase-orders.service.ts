import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';

import { PurchaseOrdersService } from '../../store/orders/purchase-orders/purchase-orders.service';
import { CreatePurchaseOrderDto } from '../../store/orders/purchase-orders/dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from '../../store/orders/purchase-orders/dto/receive-purchase-order.dto';

import { OrgPurchaseOrderQueryDto } from './dto/org-purchase-order-query.dto';
import { CreateOrgPurchaseOrderDto } from './dto/create-org-purchase-order.dto';

/**
 * Org-native purchase orders service.
 *
 * Lecturas: usan `OrganizationPrismaService` (filtra automáticamente por
 * `organization_id`). Cuando `operating_scope=ORGANIZATION` el listado es
 * consolidado y acepta `?store_id=X` como breakdown opcional. Cuando
 * `operating_scope=STORE` se exige `store_id` en el query, validado contra
 * la org del contexto.
 *
 * Mutaciones: el modelo `purchase_orders` tiene un único `location_id` (FK a
 * `inventory_locations`). Plan §6.4.1 — el destino es UNO solo, fijado a
 * nivel cabecera (`destination_location_id` en el DTO, mapea a `location_id`
 * en DB). Los items heredan; NO se admite destino por item.
 *
 * Para preservar audit/eventos/costing/stock-level-manager, las mutaciones se
 * delegan al `PurchaseOrdersService` store-side dentro de
 * `runWithStoreContext(anchor_store_id)`:
 *  - Ubicaciones store-anchored → ancla = la tienda dueña.
 *  - Ubicaciones centrales (`is_central_warehouse=true`, sin `store_id`)
 *    → ancla = primera tienda activa de la org. El destino real (la
 *    bodega central) NO cambia; el ancla solo provee contexto store-side.
 */
@Injectable()
export class OrgPurchaseOrdersService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
    private readonly storePurchaseOrders: PurchaseOrdersService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Context helpers
  // ──────────────────────────────────────────────────────────────────────────

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }
    return orgId;
  }

  /**
   * Carga la OC asegurando pertenencia a la org del contexto.
   *
   * El destino vive en `purchase_orders.location_id` (header). Si la
   * ubicación destino es central (sin `store_id`), `store_id` aquí queda
   * en `null` y los callers (approve/cancel/receive) deben anclar a una
   * tienda activa de la org para preservar el contexto store-side
   * (audit/eventos/costing).
   */
  private async loadPurchaseOrderForOrg(id: number): Promise<{
    id: number;
    organization_id: number;
    location_id: number | null;
    store_id: number | null;
    is_central_warehouse: boolean;
  }> {
    const orgId = this.requireOrgId();
    const po = await this.globalPrisma.purchase_orders.findFirst({
      where: { id, organization_id: orgId },
      select: {
        id: true,
        organization_id: true,
        location_id: true,
        location: {
          select: { store_id: true, is_central_warehouse: true },
        },
      },
    });
    if (!po) {
      throw new NotFoundException(
        `Purchase order ${id} not found for the current organization`,
      );
    }
    return {
      id: po.id,
      organization_id: po.organization_id,
      location_id: po.location_id,
      store_id: po.location?.store_id ?? null,
      is_central_warehouse: po.location?.is_central_warehouse ?? false,
    };
  }

  /**
   * Resuelve el `store_id` de anclaje para delegar al servicio store-side.
   * Para OCs con destino store-anchored devuelve la tienda dueña; para
   * central warehouse, devuelve la primera tienda activa de la org como
   * fallback de contexto (no muta el destino real de la OC).
   */
  private async resolveAnchorStoreForPO(po: {
    store_id: number | null;
  }): Promise<number> {
    if (po.store_id) return po.store_id;
    const orgId = this.requireOrgId();
    const fallback = await this.globalPrisma.stores.findFirst({
      where: { organization_id: orgId, is_active: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (!fallback) {
      throw new BadRequestException(
        'No active store found in the organization to anchor the purchase order context',
      );
    }
    return fallback.id;
  }

  /**
   * Pinea un store_id en el RequestContext de manera transitoria para que
   * los servicios store-side (que dependen de `store_id` en contexto)
   * funcionen sin tener que reescribirlos.
   */
  private async runWithStoreContext<T>(
    storeId: number,
    callback: () => Promise<T>,
  ): Promise<T> {
    const orgId = this.requireOrgId();
    const store = await this.globalPrisma.stores.findFirst({
      where: { id: storeId, organization_id: orgId },
      select: { id: true },
    });
    if (!store) {
      throw new ForbiddenException(
        'Store does not belong to the current organization',
      );
    }
    const ctx = RequestContextService.getContext();
    if (!ctx) {
      throw new ForbiddenException('Request context not available');
    }
    const previousStoreId = ctx.store_id;
    try {
      RequestContextService.setDomainContext(storeId, ctx.organization_id);
      return await callback();
    } finally {
      ctx.store_id = previousStoreId;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read flows
  // ──────────────────────────────────────────────────────────────────────────

  async findAll(query: OrgPurchaseOrderQueryDto) {
    const organization_id = this.requireOrgId();
    const scoped = await this.orgPrisma.getScopedWhere({
      organization_id,
      store_id_filter: query.store_id ?? null,
    });

    const where: any = {};

    if (query.supplier_id != null) where.supplier_id = query.supplier_id;
    if (query.location_id != null) where.location_id = query.location_id;
    if (query.status != null) where.status = query.status;

    if (query.start_date || query.end_date) {
      where.order_date = {};
      if (query.start_date) where.order_date.gte = new Date(query.start_date);
      if (query.end_date) where.order_date.lte = new Date(query.end_date);
    }

    if (query.min_total != null || query.max_total != null) {
      where.total_amount = {};
      if (query.min_total != null) where.total_amount.gte = query.min_total;
      if (query.max_total != null) where.total_amount.lte = query.max_total;
    }

    if (query.search) {
      where.OR = [
        { order_number: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
        {
          suppliers: {
            name: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    // Breakdown por tienda: la OC se considera de la tienda dueña de su
    // ubicación. Hoy `purchase_orders` no tiene `store_id` directo.
    if (scoped.store_id != null) {
      const storeFilter = { location: { store_id: scoped.store_id } };
      if (where.OR) {
        where.AND = [{ OR: where.OR }, storeFilter];
        delete where.OR;
      } else {
        Object.assign(where, storeFilter);
      }
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 25;
    const skip = (page - 1) * limit;
    const sortBy = query.sort_by ?? 'order_date';
    const sortOrder = query.sort_order ?? 'desc';

    const [data, total] = await Promise.all([
      this.orgPrisma.purchase_orders.findMany({
        where,
        include: {
          suppliers: { select: { id: true, name: true } },
          location: {
            select: {
              id: true,
              name: true,
              code: true,
              store_id: true,
              stores: { select: { id: true, name: true } },
            },
          },
          purchase_order_items: {
            include: {
              products: { select: { id: true, name: true, sku: true } },
              product_variants: {
                select: { id: true, name: true, sku: true },
              },
            },
          },
        },
        orderBy: { [sortBy]: sortOrder } as any,
        skip,
        take: limit,
      }),
      this.orgPrisma.purchase_orders.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / Math.max(limit, 1)),
      },
    };
  }

  async findOne(id: number) {
    const organization_id = this.requireOrgId();
    const po = await this.orgPrisma.purchase_orders.findFirst({
      where: { id, organization_id },
      include: {
        suppliers: true,
        location: {
          select: {
            id: true,
            name: true,
            code: true,
            store_id: true,
            stores: { select: { id: true, name: true } },
          },
        },
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
    if (!po) {
      throw new NotFoundException(
        `Purchase order ${id} not found for the current organization`,
      );
    }
    return po;
  }

  /**
   * Counters para el dashboard ORG.
   */
  async getStats() {
    this.requireOrgId();
    const [total, draft, pending, approved, received, cancelled] =
      await Promise.all([
        this.orgPrisma.purchase_orders.count(),
        this.orgPrisma.purchase_orders.count({ where: { status: 'draft' } }),
        this.orgPrisma.purchase_orders.count({
          where: { status: 'pending' },
        }),
        this.orgPrisma.purchase_orders.count({
          where: { status: 'approved' },
        }),
        this.orgPrisma.purchase_orders.count({
          where: { status: 'received' },
        }),
        this.orgPrisma.purchase_orders.count({
          where: { status: 'cancelled' },
        }),
      ]);
    return { total, draft, pending, approved, received, cancelled };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Write flows (delegan al servicio store-side via runWithStoreContext)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Crea una OC org-native con destino único a nivel cabecera
   * (`destination_location_id` → `purchase_orders.location_id`).
   *
   * Plan §6.4.1 — el destino es UNO solo, fijado en la cabecera. Los items
   * heredan; no se admite `destination_location_id` por item (validado vía
   * DTO + ValidationPipe `forbidNonWhitelisted`).
   *
   * Reglas:
   *  - La ubicación destino debe pertenecer a la org (validado por
   *    `OperatingScopeService.enforceLocationAccess`).
   *  - Permitimos `is_central_warehouse=true` (`allowCentral: true`): solo
   *    desde ORG scope se puede comprar contra la bodega central.
   *  - Si la ubicación tiene `store_id` (tienda-ancla) → delegamos al servicio
   *    store-side con `runWithStoreContext` para preservar audit, eventos,
   *    costing y stock-level-manager.
   *  - Si la ubicación es central sin `store_id` → la OC se crea en el
   *    servicio store-side anclando contextualmente a la primera tienda
   *    activa de la org (compat para audit/eventos/costing). El destino
   *    final permanece en la bodega central a nivel header — los items
   *    NO mutan store al recibirse.
   *  - En `operating_scope=STORE` se exige que la tienda destino coincida
   *    con la única tienda activa.
   */
  async create(dto: CreateOrgPurchaseOrderDto) {
    const organization_id = this.requireOrgId();

    // Validación de ubicación destino: pertenencia + central permitido.
    const location = await this.operatingScope.enforceLocationAccess(
      organization_id,
      dto.destination_location_id,
      { allowCentral: true },
    );

    // Validación de proveedor: pertenencia a la org.
    const supplier = await this.orgPrisma.suppliers.findFirst({
      where: { id: dto.supplier_id },
      select: { id: true },
    });
    if (!supplier) {
      throw new NotFoundException(
        `Supplier ${dto.supplier_id} not found for the current organization`,
      );
    }

    // Resolver tienda-ancla para delegar al servicio store-side. Para
    // ubicaciones store-anchored usamos su tienda; para central sin tienda,
    // anclamos a la primera tienda activa solo a efectos de contexto
    // (audit/eventos/costing). El destino real (location_id) NO cambia.
    let targetStoreId: number | null = location.store_id;
    if (!targetStoreId) {
      const fallback = await this.globalPrisma.stores.findFirst({
        where: { organization_id, is_active: true },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (!fallback) {
        throw new BadRequestException(
          'No active store found in the organization to anchor the purchase order context',
        );
      }
      targetStoreId = fallback.id;
    }

    // En operating_scope=STORE la org agrupa pero no consolida; la OC debe
    // pertenecer a la tienda activa. Cuando la ubicación es central (sin
    // store_id) en scope=STORE no tiene sentido permitirla.
    const scope =
      await this.operatingScope.requireOperatingScope(organization_id);
    if (scope === 'STORE') {
      if (location.is_central_warehouse) {
        throw new BadRequestException(
          'Central warehouse purchase orders are not allowed under operating_scope=STORE',
        );
      }
      const stores = await this.globalPrisma.stores.findMany({
        where: { organization_id, is_active: true },
        select: { id: true },
        take: 2,
      });
      if (stores.length === 1 && stores[0].id !== targetStoreId) {
        throw new BadRequestException(
          'Store-scoped organization can only create purchase orders for its own store',
        );
      }
    }

    // Mapear DTO org-native → DTO store-native (header location_id desde
    // destination_location_id). Items pasan SIN destination_location_id.
    const storeDto: CreatePurchaseOrderDto = {
      supplier_id: dto.supplier_id,
      location_id: dto.destination_location_id,
      status: dto.status,
      order_date: dto.order_date,
      expected_date: dto.expected_date,
      payment_terms: dto.payment_terms,
      shipping_method: dto.shipping_method,
      shipping_cost: dto.shipping_cost,
      tax_amount: dto.tax_amount,
      discount_amount: dto.discount_amount,
      notes: dto.notes,
      internal_notes: dto.internal_notes,
      items: dto.items.map((item) => ({
        // product_id may be 0 / missing when prebulk → store service
        // autocreates the catalog row from product_name + sku.
        product_id: item.product_id ?? 0,
        product_variant_id: item.product_variant_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percentage: item.discount_percentage,
        tax_rate: item.tax_rate,
        notes: item.notes,
        batch_number: item.batch_number,
        manufacturing_date: item.manufacturing_date,
        expiration_date: item.expiration_date,
        // Prebulk passthrough — store service consumes when product_id falsy.
        product_name: item.product_name,
        sku: item.sku,
        product_description: item.product_description,
        base_price: item.base_price,
      })),
    };

    return this.runWithStoreContext(targetStoreId, () =>
      this.storePurchaseOrders.create(storeDto),
    );
  }

  async approve(id: number) {
    const po = await this.loadPurchaseOrderForOrg(id);
    const anchorStoreId = await this.resolveAnchorStoreForPO(po);
    return this.runWithStoreContext(anchorStoreId, () =>
      this.storePurchaseOrders.approve(id),
    );
  }

  async cancel(id: number) {
    const po = await this.loadPurchaseOrderForOrg(id);
    const anchorStoreId = await this.resolveAnchorStoreForPO(po);
    return this.runWithStoreContext(anchorStoreId, () =>
      this.storePurchaseOrders.cancel(id),
    );
  }

  async receive(id: number, dto: ReceivePurchaseOrderDto) {
    const po = await this.loadPurchaseOrderForOrg(id);
    const anchorStoreId = await this.resolveAnchorStoreForPO(po);
    return this.runWithStoreContext(anchorStoreId, () =>
      this.storePurchaseOrders.receive(id, dto),
    );
  }
}
