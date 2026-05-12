import { BadRequestException, Injectable } from '@nestjs/common';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

import { ListOrgSerialNumbersDto } from './dto/list-org-serial-numbers.dto';

/**
 * Org-native read service for `inventory_serial_numbers`.
 *
 * `inventory_serial_numbers` is NOT registered in `OrganizationPrismaService`
 * (its tenancy is enforced relationally — there is no direct `organization_id`
 * column). To keep the multi-tenant guarantee strict we:
 *
 *   - Use `GlobalPrismaService` for raw client access, and
 *   - ALWAYS filter by `products.stores.organization_id = orgId`. The
 *     `products` table has no direct `organization_id` column, so the only
 *     way to scope by org is through its parent `stores` relation. Resolved
 *     through `OrganizationPrismaService.getScopedWhere`, which also handles
 *     the STORE scope where `store_id` is required.
 *
 * Optional `store_id` breakdown is applied via
 * `inventory_locations.store_id`. Listings are READ-ONLY: no create/update/
 * delete is exposed at org level.
 */
@Injectable()
export class OrgSerialNumbersService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
  ) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    return orgId;
  }

  async findAll(query: ListOrgSerialNumbersDto) {
    const organization_id = this.requireOrgId();
    const scoped = await this.orgPrisma.getScopedWhere({
      organization_id,
      store_id_filter: query.store_id ?? null,
    });

    // Tenancy: products has no organization_id column — scope is enforced
    // through the parent stores relation (products → stores → organization).
    // Do NOT remove.
    const where: any = {
      products: {
        is: { stores: { is: { organization_id: scoped.organization_id } } },
      },
      ...(query.product_id != null ? { product_id: query.product_id } : {}),
      ...(query.product_variant_id != null
        ? { product_variant_id: query.product_variant_id }
        : {}),
      ...(query.location_id != null ? { location_id: query.location_id } : {}),
      ...(query.batch_id != null ? { batch_id: query.batch_id } : {}),
      ...(query.status != null ? { status: query.status } : {}),
    };

    if (query.serial_number) {
      where.serial_number = { contains: query.serial_number };
    }

    // Optional store_id breakdown — attaches to the location relation.
    // When operating_scope=STORE this is mandatory and already resolved
    // by getScopedWhere().
    if (scoped.store_id != null) {
      where.inventory_locations = {
        is: {
          store_id: scoped.store_id,
          organization_id: scoped.organization_id,
        },
      };
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 25;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.inventory_serial_numbers.findMany({
        where,
        include: {
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
          inventory_batches: {
            select: {
              id: true,
              batch_number: true,
              expiration_date: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.inventory_serial_numbers.count({ where }),
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

  async findOne(id: number) {
    const organization_id = this.requireOrgId();
    const row = await this.prisma.inventory_serial_numbers.findFirst({
      where: {
        id,
        products: { is: { stores: { is: { organization_id } } } },
      },
      include: {
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
        inventory_batches: {
          select: {
            id: true,
            batch_number: true,
            expiration_date: true,
          },
        },
      },
    });
    return row ? this.toFlatRow(row) : null;
  }

  /**
   * Flattens nested Prisma relations into the contract consumed by the
   * frontend `OrgSerialNumberRow` interface.
   */
  private toFlatRow(row: {
    id: number;
    serial_number: string;
    status: string;
    product_id: number;
    product_variant_id: number | null;
    location_id: number | null;
    batch_id: number | null;
    cost: any;
    sold_date: Date | null;
    warranty_expiry: Date | null;
    notes: string | null;
    created_at: Date | null;
    products: { id: number; name: string | null; sku: string | null } | null;
    product_variants: {
      id: number;
      name: string | null;
      sku: string | null;
    } | null;
    inventory_locations: {
      id: number;
      name: string | null;
      code: string | null;
      store_id: number | null;
      stores: { id: number; name: string | null } | null;
    } | null;
    inventory_batches: {
      id: number;
      batch_number: string | null;
      expiration_date: Date | null;
    } | null;
  }) {
    return {
      id: row.id,
      serial_number: row.serial_number,
      status: row.status,
      product_id: row.product_id,
      product_name: row.products?.name ?? null,
      product_sku: row.products?.sku ?? null,
      variant_id: row.product_variant_id,
      variant_name: row.product_variants?.name ?? null,
      variant_sku: row.product_variants?.sku ?? null,
      location_id: row.location_id,
      location_name: row.inventory_locations?.name ?? null,
      store_id: row.inventory_locations?.store_id ?? null,
      store_name: row.inventory_locations?.stores?.name ?? null,
      batch_id: row.batch_id,
      batch_number: row.inventory_batches?.batch_number ?? null,
      batch_expiration_date: row.inventory_batches?.expiration_date
        ? row.inventory_batches.expiration_date.toISOString()
        : null,
      // Decimal serialised as string to preserve precision for the frontend
      // `CurrencyPipe` (Vendix money inputs accept Decimal-as-string).
      cost: row.cost != null ? row.cost.toString() : null,
      sold_date: row.sold_date ? row.sold_date.toISOString() : null,
      warranty_expiry: row.warranty_expiry
        ? row.warranty_expiry.toISOString()
        : null,
      notes: row.notes ?? null,
      created_at: row.created_at ? row.created_at.toISOString() : null,
    };
  }
}
