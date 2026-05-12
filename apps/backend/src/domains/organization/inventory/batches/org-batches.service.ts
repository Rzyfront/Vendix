import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';

import { ListOrgBatchesDto } from './dto/list-org-batches.dto';

const BATCH_INCLUDE = {
  products: { select: { id: true, name: true, sku: true } },
  product_variants: { select: { id: true, name: true, sku: true } },
  inventory_locations: {
    select: {
      id: true,
      name: true,
      code: true,
      store_id: true,
      stores: { select: { id: true, name: true } },
    },
  },
  _count: { select: { inventory_serial_numbers: true } },
} as const;

/**
 * Org-level READ-ONLY consolidated view of `inventory_batches`.
 *
 * `inventory_batches` has no direct `organization_id` column, so tenancy is
 * enforced via a relation filter on `products.stores.organization_id` (the
 * `products` table has no direct `organization_id` either — its parent
 * `stores` row is the single source of truth). Optional `store_id` breakdown
 * is applied via `inventory_locations.store_id`.
 *
 * `has_stock=true` (`quantity > quantity_used`) cannot be expressed as a
 * column-vs-column filter in Prisma; we resolve eligible IDs via raw SQL
 * first and then fetch full rows with includes.
 */
@Injectable()
export class OrgBatchesService {
  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
  ) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    return orgId;
  }

  async list(query: ListOrgBatchesDto) {
    const organization_id = this.requireOrgId();
    await this.operatingScope.requireOperatingScope(organization_id);
    const scoped = await this.orgPrisma.getScopedWhere({
      organization_id,
      store_id_filter: query.store_id ?? null,
    });

    const hasStock = this.parseBool(query.has_stock);

    const where = this.buildWhere(scoped, query);

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 200) : 25;
    const skip = (page - 1) * limit;

    if (hasStock === true) {
      // Prisma cannot compare two columns in `where`. Resolve matching IDs
      // via raw SQL then fetch full rows with relations.
      const idRows = await this.findIdsWithStockFilter(where, organization_id, scoped, query, {
        skip,
        limit,
      });
      const total = await this.countWithStockFilter(where, organization_id, scoped, query);

      const data = idRows.length
        ? await this.orgPrisma.inventory_batches.findMany({
            where: { id: { in: idRows } },
            include: BATCH_INCLUDE,
            orderBy: [{ expiration_date: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          })
        : [];

      return {
        data: data.map((r: any) => this.toRow(r)),
        meta: this.meta(total, page, limit),
      };
    }

    const [rows, total] = await Promise.all([
      this.orgPrisma.inventory_batches.findMany({
        where,
        include: BATCH_INCLUDE,
        orderBy: [{ expiration_date: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.orgPrisma.inventory_batches.count({ where }),
    ]);

    return {
      data: rows.map((r: any) => this.toRow(r)),
      meta: this.meta(total, page, limit),
    };
  }

  async findOne(id: number) {
    const organization_id = this.requireOrgId();
    const row = await this.orgPrisma.inventory_batches.findFirst({
      where: {
        id,
        products: { is: { stores: { is: { organization_id } } } },
      },
      include: BATCH_INCLUDE,
    });
    if (!row) throw new NotFoundException('Lote no encontrado');
    return this.toRow(row);
  }

  async expiringSoon(query: ListOrgBatchesDto) {
    const days = 30;
    const expires_before = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      .toISOString();
    return this.list({
      ...query,
      expires_before: query.expires_before ?? expires_before,
      has_stock: query.has_stock ?? 'true',
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private buildWhere(
    scoped: { organization_id: number; store_id?: number },
    query: ListOrgBatchesDto,
  ): Prisma.inventory_batchesWhereInput {
    const where: Prisma.inventory_batchesWhereInput = {
      products: {
        is: { stores: { is: { organization_id: scoped.organization_id } } },
      },
    };

    if (query.product_id != null) where.product_id = query.product_id;
    if (query.location_id != null) where.location_id = query.location_id;

    if (query.batch_number) {
      where.batch_number = { contains: query.batch_number, mode: 'insensitive' };
    }

    const expiresBefore = query.expires_before
      ? new Date(query.expires_before)
      : null;
    const expiresAfter = query.expires_after
      ? new Date(query.expires_after)
      : null;
    if (expiresBefore || expiresAfter) {
      where.expiration_date = {};
      if (expiresAfter) (where.expiration_date as any).gte = expiresAfter;
      if (expiresBefore) (where.expiration_date as any).lte = expiresBefore;
    }

    if (scoped.store_id != null) {
      where.inventory_locations = {
        is: {
          store_id: scoped.store_id,
          organization_id: scoped.organization_id,
        },
      };
    }

    return where;
  }

  private async findIdsWithStockFilter(
    _where: Prisma.inventory_batchesWhereInput,
    organization_id: number,
    scoped: { organization_id: number; store_id?: number },
    query: ListOrgBatchesDto,
    paging: { skip: number; limit: number },
  ): Promise<number[]> {
    const conditions: string[] = [
      'b.quantity > b.quantity_used',
      's.organization_id = $1',
    ];
    const params: any[] = [organization_id];

    if (query.product_id != null) {
      params.push(query.product_id);
      conditions.push(`b.product_id = $${params.length}`);
    }
    if (query.location_id != null) {
      params.push(query.location_id);
      conditions.push(`b.location_id = $${params.length}`);
    }
    if (query.batch_number) {
      params.push(`%${query.batch_number}%`);
      conditions.push(`b.batch_number ILIKE $${params.length}`);
    }
    if (query.expires_before) {
      params.push(new Date(query.expires_before));
      conditions.push(`b.expiration_date <= $${params.length}`);
    }
    if (query.expires_after) {
      params.push(new Date(query.expires_after));
      conditions.push(`b.expiration_date >= $${params.length}`);
    }
    if (scoped.store_id != null) {
      params.push(scoped.store_id);
      conditions.push(
        `EXISTS (SELECT 1 FROM inventory_locations il WHERE il.id = b.location_id AND il.store_id = $${params.length} AND il.organization_id = $1)`,
      );
    }

    params.push(paging.limit);
    const limitParam = params.length;
    params.push(paging.skip);
    const offsetParam = params.length;

    const sql = `
      SELECT b.id
      FROM inventory_batches b
      INNER JOIN products p ON p.id = b.product_id
      INNER JOIN stores s ON s.id = p.store_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.expiration_date ASC NULLS LAST, b.id ASC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const rows = await this.orgPrisma.$queryRawUnsafe<{ id: number }[]>(sql, ...params);
    return rows.map((r) => Number(r.id));
  }

  private async countWithStockFilter(
    _where: Prisma.inventory_batchesWhereInput,
    organization_id: number,
    scoped: { organization_id: number; store_id?: number },
    query: ListOrgBatchesDto,
  ): Promise<number> {
    const conditions: string[] = [
      'b.quantity > b.quantity_used',
      's.organization_id = $1',
    ];
    const params: any[] = [organization_id];

    if (query.product_id != null) {
      params.push(query.product_id);
      conditions.push(`b.product_id = $${params.length}`);
    }
    if (query.location_id != null) {
      params.push(query.location_id);
      conditions.push(`b.location_id = $${params.length}`);
    }
    if (query.batch_number) {
      params.push(`%${query.batch_number}%`);
      conditions.push(`b.batch_number ILIKE $${params.length}`);
    }
    if (query.expires_before) {
      params.push(new Date(query.expires_before));
      conditions.push(`b.expiration_date <= $${params.length}`);
    }
    if (query.expires_after) {
      params.push(new Date(query.expires_after));
      conditions.push(`b.expiration_date >= $${params.length}`);
    }
    if (scoped.store_id != null) {
      params.push(scoped.store_id);
      conditions.push(
        `EXISTS (SELECT 1 FROM inventory_locations il WHERE il.id = b.location_id AND il.store_id = $${params.length} AND il.organization_id = $1)`,
      );
    }

    const sql = `
      SELECT COUNT(*)::int AS count
      FROM inventory_batches b
      INNER JOIN products p ON p.id = b.product_id
      INNER JOIN stores s ON s.id = p.store_id
      WHERE ${conditions.join(' AND ')}
    `;

    const rows = await this.orgPrisma.$queryRawUnsafe<{ count: number }[]>(sql, ...params);
    return rows[0]?.count ?? 0;
  }

  private parseBool(value?: string): boolean | null {
    if (value === undefined || value === null || value === '') return null;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return null;
  }

  private meta(total: number, page: number, limit: number) {
    return {
      total,
      page,
      limit,
      total_pages: Math.ceil(total / Math.max(limit, 1)),
    };
  }

  private toRow(row: any) {
    const quantity = Number(row.quantity ?? 0);
    const quantity_used = Number(row.quantity_used ?? 0);
    return {
      id: row.id,
      batch_number: row.batch_number,
      quantity,
      quantity_used,
      available_quantity: Math.max(quantity - quantity_used, 0),
      manufacturing_date: row.manufacturing_date
        ? row.manufacturing_date.toISOString()
        : null,
      expiration_date: row.expiration_date
        ? row.expiration_date.toISOString()
        : null,
      created_at: row.created_at ? row.created_at.toISOString() : null,
      updated_at: row.updated_at ? row.updated_at.toISOString() : null,
      product_id: row.product_id,
      product_name: row.products?.name ?? null,
      product_sku: row.products?.sku ?? null,
      product_variant_id: row.product_variant_id ?? null,
      variant_name: row.product_variants?.name ?? null,
      variant_sku: row.product_variants?.sku ?? null,
      location_id: row.location_id ?? null,
      location_name: row.inventory_locations?.name ?? null,
      store_id: row.inventory_locations?.store_id ?? null,
      store_name: row.inventory_locations?.stores?.name ?? null,
      serial_numbers_count: row._count?.inventory_serial_numbers ?? 0,
    };
  }
}
