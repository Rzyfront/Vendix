import { BadRequestException, Injectable } from '@nestjs/common';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

import { OrgMovementQueryDto } from './dto/org-movement-query.dto';

/**
 * Org-native inventory movements read service.
 *
 * `inventory_movements` IS registered in `OrganizationPrismaService` so the
 * scoped client auto-filters by `organization_id`. The optional `store_id`
 * breakdown is applied via the from_location/to_location relations because
 * movements do not carry a direct `store_id` column.
 */
@Injectable()
export class OrgMovementsService {
  constructor(private readonly orgPrisma: OrganizationPrismaService) {}

  /**
   * Movement type sets — mirror the frontend classification at
   * `apps/frontend/.../inventory/movements/movements.component.ts`.
   * Used by `toFlatRow` to pick the operative location (to_location for
   * inbound, from_location for outbound) so the frontend can render a
   * single `location_name` / `store_name` per row.
   */
  private static readonly INBOUND_TYPES = new Set([
    'stock_in',
    'transfer_in',
    'purchase',
    'return',
    'returned',
  ]);
  private static readonly OUTBOUND_TYPES = new Set([
    'stock_out',
    'sale',
    'transfer_out',
  ]);

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    return orgId;
  }

  async findAll(query: OrgMovementQueryDto) {
    const organization_id = this.requireOrgId();
    const scoped = await this.orgPrisma.getScopedWhere({
      organization_id,
      store_id_filter: query.store_id ?? null,
    });

    const where: any = {
      ...(query.product_id != null ? { product_id: query.product_id } : {}),
      ...(query.product_variant_id != null
        ? { product_variant_id: query.product_variant_id }
        : {}),
      ...(query.from_location_id != null
        ? { from_location_id: query.from_location_id }
        : {}),
      ...(query.to_location_id != null
        ? { to_location_id: query.to_location_id }
        : {}),
      ...(query.movement_type != null
        ? { movement_type: query.movement_type }
        : {}),
      ...(query.user_id != null ? { user_id: query.user_id } : {}),
    };

    if (query.start_date || query.end_date) {
      where.created_at = {};
      if (query.start_date) where.created_at.gte = new Date(query.start_date);
      if (query.end_date) where.created_at.lte = new Date(query.end_date);
    }

    if (query.search) {
      where.OR = [
        { reason: { contains: query.search } },
        { notes: { contains: query.search } },
        { reference_number: { contains: query.search } },
        { batch_number: { contains: query.search } },
        { serial_number: { contains: query.search } },
      ];
    }

    // Store breakdown applied via either from_location or to_location belonging to that store.
    if (scoped.store_id != null) {
      where.OR = [
        ...(where.OR ?? []),
        { from_location: { store_id: scoped.store_id } },
        { to_location: { store_id: scoped.store_id } },
      ];
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 25;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.orgPrisma.inventory_movements.findMany({
        where,
        include: {
          products: { select: { id: true, name: true, sku: true } },
          product_variants: {
            select: { id: true, name: true, sku: true },
          },
          from_location: {
            select: {
              id: true,
              name: true,
              code: true,
              store_id: true,
              stores: { select: { id: true, name: true } },
            },
          },
          to_location: {
            select: {
              id: true,
              name: true,
              code: true,
              store_id: true,
              stores: { select: { id: true, name: true } },
            },
          },
          users: { select: { id: true, first_name: true, last_name: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.orgPrisma.inventory_movements.count({ where }),
    ]);

    return {
      data: data.map((r) => this.toFlatRow(r)),
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / Math.max(limit, 1)),
      },
    };
  }

  async findByProduct(productId: number, query: OrgMovementQueryDto) {
    return this.findAll({ ...query, product_id: productId });
  }

  async findByLocation(locationId: number, query: OrgMovementQueryDto) {
    // Either side of the movement may match — caller can pick one explicitly.
    return this.findAll({ ...query, from_location_id: locationId });
  }

  async findByUser(userId: number, query: OrgMovementQueryDto) {
    return this.findAll({ ...query, user_id: userId });
  }

  async findOne(id: number) {
    const organization_id = this.requireOrgId();
    const row = await this.orgPrisma.inventory_movements.findFirst({
      where: { id, organization_id },
      include: {
        products: { select: { id: true, name: true, sku: true } },
        product_variants: {
          select: { id: true, name: true, sku: true },
        },
        from_location: {
          select: {
            id: true,
            name: true,
            code: true,
            store_id: true,
            stores: { select: { id: true, name: true } },
          },
        },
        to_location: {
          select: {
            id: true,
            name: true,
            code: true,
            store_id: true,
            stores: { select: { id: true, name: true } },
          },
        },
        users: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    return row ? this.toFlatRow(row) : null;
  }

  /**
   * Flattens nested Prisma relations into the contract expected by the
   * frontend (see `OrgMovementRow` in
   * `apps/frontend/.../inventory/services/org-inventory.service.ts`).
   *
   * NOTE: The `inventory_movements` schema does NOT have a
   * `reference_number` column. The frontend `reference` field is mapped
   * from `reason` (free-text reference) — keeps the contract shape stable
   * without lying to the type system.
   *
   * The operative location follows the frontend INBOUND/OUTBOUND
   * classification: inbound types use `to_location`, outbound types use
   * `from_location`, and any other type falls back to whichever side is
   * present.
   */
  private toFlatRow(row: {
    id: number;
    created_at: Date | null;
    movement_type: string;
    quantity: number;
    product_id: number;
    user_id: number | null;
    reason: string | null;
    notes: string | null;
    products: { id: number; name: string | null; sku: string | null } | null;
    from_location: {
      id: number;
      name: string | null;
      code: string | null;
      store_id: number | null;
      stores: { id: number; name: string | null } | null;
    } | null;
    to_location: {
      id: number;
      name: string | null;
      code: string | null;
      store_id: number | null;
      stores: { id: number; name: string | null } | null;
    } | null;
    users?: {
      id: number;
      first_name: string | null;
      last_name: string | null;
    } | null;
  }) {
    const type = row.movement_type;
    const preferred = OrgMovementsService.INBOUND_TYPES.has(type)
      ? row.to_location
      : OrgMovementsService.OUTBOUND_TYPES.has(type)
        ? row.from_location
        : null;
    // Fallback: legacy/dirty rows may carry the location on the opposite side
    // (e.g. POS sales emitted with to_location_id instead of from_location_id).
    // Pick whichever side is populated so the UI always shows a location.
    const operative =
      preferred ?? row.from_location ?? row.to_location ?? null;
    return {
      id: row.id,
      created_at: row.created_at ? row.created_at.toISOString() : null,
      movement_type: row.movement_type,
      quantity: row.quantity,
      product_id: row.product_id,
      product_name: row.products?.name ?? null,
      location_id: operative?.id ?? null,
      location_name: operative?.name ?? null,
      store_id: operative?.store_id ?? null,
      store_name: operative?.stores?.name ?? null,
      reference: row.reason ?? null,
      notes: row.notes ?? null,
      user_id: row.user_id ?? null,
      user_name: row.users
        ? [row.users.first_name, row.users.last_name]
            .filter(Boolean)
            .join(' ')
            .trim() || null
        : null,
    };
  }
}
