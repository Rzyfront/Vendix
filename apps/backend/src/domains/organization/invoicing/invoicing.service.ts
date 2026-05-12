import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { FiscalScopeService, OrganizationFiscalScope } from '@common/services/fiscal-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { QueryOrgInvoiceDto } from './dto/query-org-invoice.dto';

const ORG_INVOICE_INCLUDE = {
  store: { select: { id: true, name: true, slug: true } },
  resolution: {
    select: {
      id: true,
      prefix: true,
      resolution_number: true,
      valid_from: true,
      valid_to: true,
      is_active: true,
    },
  },
  customer: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
  supplier: { select: { id: true, name: true } },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

@Injectable()
export class OrgInvoicingService {
  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  async findAll(query: QueryOrgInvoiceDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      status,
      invoice_type,
      date_from,
      date_to,
      customer_id,
    } = query;

    const scope = await this.resolveFiscalReadScope(query.store_id);
    const skip = (page - 1) * limit;
    const where = this.buildInvoiceWhere({
      store_id: scope.store_id,
      search,
      status,
      invoice_type,
      date_from,
      date_to,
      customer_id,
    });

    const [data, total] = await Promise.all([
      this.orgPrisma.invoices.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: ORG_INVOICE_INCLUDE,
      }),
      this.orgPrisma.invoices.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
      scope,
    };
  }

  async findOne(id: number, store_id?: number) {
    const scope = await this.resolveFiscalReadScope(store_id);
    const invoice = await this.orgPrisma.invoices.findFirst({
      where: {
        id,
        ...(scope.store_id != null ? { store_id: scope.store_id } : {}),
      },
      include: {
        ...ORG_INVOICE_INCLUDE,
        invoice_items: true,
        invoice_taxes: true,
      },
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    }

    return invoice;
  }

  async getSummary(query: QueryOrgInvoiceDto) {
    const scope = await this.resolveFiscalReadScope(query.store_id);
    const where = this.buildInvoiceWhere({
      store_id: scope.store_id,
      search: query.search,
      status: query.status,
      invoice_type: query.invoice_type,
      date_from: query.date_from,
      date_to: query.date_to,
      customer_id: query.customer_id,
    });

    const [totals, byStatus, byStore] = await Promise.all([
      this.orgPrisma.invoices.aggregate({
        where,
        _count: { id: true },
        _sum: {
          subtotal_amount: true,
          tax_amount: true,
          withholding_amount: true,
          total_amount: true,
        },
      }),
      this.orgPrisma.invoices.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
        _sum: { total_amount: true },
      }),
      this.orgPrisma.invoices.groupBy({
        by: ['store_id'],
        where,
        _count: { id: true },
        _sum: { total_amount: true },
      }),
    ]);

    const storeIds = byStore.map((row) => row.store_id).filter(Boolean) as number[];
    const stores = storeIds.length
      ? await this.orgPrisma.stores.findMany({
          where: { id: { in: storeIds } },
          select: { id: true, name: true },
        })
      : [];
    const storeMap = new Map(stores.map((store) => [store.id, store.name]));

    return {
      fiscal_scope: scope.fiscal_scope,
      store_id: scope.store_id,
      invoice_count: totals._count.id,
      subtotal_amount: Number(totals._sum.subtotal_amount || 0),
      tax_amount: Number(totals._sum.tax_amount || 0),
      withholding_amount: Number(totals._sum.withholding_amount || 0),
      total_amount: Number(totals._sum.total_amount || 0),
      by_status: byStatus.map((row) => ({
        status: row.status,
        count: row._count.id,
        total_amount: Number(row._sum.total_amount || 0),
      })),
      by_store: byStore.map((row) => ({
        store_id: row.store_id,
        store_name: row.store_id ? storeMap.get(row.store_id) || null : null,
        count: row._count.id,
        total_amount: Number(row._sum.total_amount || 0),
      })),
    };
  }

  async getResolutions(store_id?: number) {
    const scope = await this.resolveFiscalReadScope(store_id);
    return this.orgPrisma.invoice_resolutions.findMany({
      where: {
        ...(scope.store_id != null ? { store_id: scope.store_id } : {}),
      },
      orderBy: [{ is_active: 'desc' }, { valid_to: 'desc' }],
      include: {
        store: { select: { id: true, name: true, slug: true } },
        _count: { select: { invoices: true } },
      },
    });
  }

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }
    return orgId;
  }

  private async resolveFiscalReadScope(store_id?: number | null): Promise<{
    organization_id: number;
    fiscal_scope: OrganizationFiscalScope;
    store_id: number | null;
  }> {
    const organization_id = this.requireOrgId();
    const fiscal_scope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );
    const requestedStoreId = store_id ?? null;

    if (requestedStoreId != null) {
      await this.assertStoreInOrg(requestedStoreId);
      return { organization_id, fiscal_scope, store_id: requestedStoreId };
    }

    if (fiscal_scope === 'STORE') {
      throw new BadRequestException(
        'store_id is required when fiscal_scope is STORE',
      );
    }

    return { organization_id, fiscal_scope, store_id: null };
  }

  private async assertStoreInOrg(store_id: number) {
    const organization_id = this.requireOrgId();
    const store = await this.orgPrisma.stores.findFirst({
      where: { id: store_id, organization_id },
      select: { id: true },
    });
    if (!store) {
      throw new ForbiddenException(
        'Store does not belong to the current organization',
      );
    }
  }

  private buildInvoiceWhere(params: {
    store_id?: number | null;
    search?: string;
    status?: string;
    invoice_type?: string;
    date_from?: string;
    date_to?: string;
    customer_id?: number;
  }): Prisma.invoicesWhereInput {
    return {
      ...(params.store_id != null && { store_id: params.store_id }),
      ...(params.search && {
        OR: [
          {
            invoice_number: {
              contains: params.search,
              mode: 'insensitive' as const,
            },
          },
          { customer_name: { contains: params.search, mode: 'insensitive' as const } },
          {
            customer_tax_id: {
              contains: params.search,
              mode: 'insensitive' as const,
            },
          },
          { notes: { contains: params.search, mode: 'insensitive' as const } },
        ],
      }),
      ...(params.status && { status: params.status as any }),
      ...(params.invoice_type && { invoice_type: params.invoice_type as any }),
      ...(params.customer_id && { customer_id: params.customer_id }),
      ...((params.date_from || params.date_to) && {
        issue_date: {
          ...(params.date_from && { gte: new Date(params.date_from) }),
          ...(params.date_to && { lte: new Date(params.date_to) }),
        },
      }),
    };
  }
}
