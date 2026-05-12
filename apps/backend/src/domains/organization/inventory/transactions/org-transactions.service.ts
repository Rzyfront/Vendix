import { BadRequestException, Injectable } from '@nestjs/common';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

import { QueryOrgTransactionsDto } from './dto/query-org-transactions.dto';

/**
 * Org-native inventory transactions read service.
 *
 * `inventory_transactions` IS registered in `OrganizationPrismaService` so the
 * scoped client auto-filters by `organization_id`. Unlike `inventory_movements`,
 * this model has no location columns and no `store_id` column directly — store
 * breakdown is applied via the `products.store_id` relation.
 *
 * Read-only by design. Mutating writes continue to live under
 * `/store/inventory/transactions/*`.
 */
@Injectable()
export class OrgTransactionsService {
  constructor(private readonly orgPrisma: OrganizationPrismaService) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    return orgId;
  }

  async findAll(query: QueryOrgTransactionsDto) {
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
      ...(query.type != null ? { type: query.type } : {}),
      ...(query.user_id != null ? { user_id: query.user_id } : {}),
    };

    if (query.start_date || query.end_date) {
      where.created_at = {};
      if (query.start_date) where.created_at.gte = new Date(query.start_date);
      if (query.end_date) where.created_at.lte = new Date(query.end_date);
    }

    if (query.search) {
      where.OR = [
        { notes: { contains: query.search } },
        { products: { name: { contains: query.search } } },
        { products: { sku: { contains: query.search } } },
      ];
    }

    // Store breakdown applied via products.store_id (no direct column).
    if (scoped.store_id != null) {
      where.products = {
        ...(where.products ?? {}),
        store_id: scoped.store_id,
      };
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 25;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.orgPrisma.inventory_transactions.findMany({
        where,
        include: {
          products: {
            select: { id: true, name: true, sku: true, store_id: true },
          },
          product_variants: {
            select: { id: true, name: true, sku: true },
          },
          users: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.orgPrisma.inventory_transactions.count({ where }),
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

  async findByProduct(productId: number, query: QueryOrgTransactionsDto) {
    return this.findAll({ ...query, product_id: productId });
  }

  async findByUser(userId: number, query: QueryOrgTransactionsDto) {
    return this.findAll({ ...query, user_id: userId });
  }

  async findOne(id: number) {
    const organization_id = this.requireOrgId();
    return this.orgPrisma.inventory_transactions.findFirst({
      where: { id, organization_id },
      include: {
        products: {
          select: { id: true, name: true, sku: true, store_id: true },
        },
        product_variants: {
          select: { id: true, name: true, sku: true },
        },
        users: {
          select: { id: true, first_name: true, last_name: true },
        },
        order_items: {
          select: { id: true, quantity: true, unit_price: true },
        },
      },
    });
  }
}
