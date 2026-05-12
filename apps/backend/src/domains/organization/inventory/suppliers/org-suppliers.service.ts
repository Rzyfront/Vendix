import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';

import { OrgSupplierQueryDto } from './dto/org-supplier-query.dto';
import { CreateOrgSupplierDto } from './dto/create-org-supplier.dto';
import { UpdateOrgSupplierDto } from './dto/update-org-supplier.dto';

/**
 * Org-native supplier service (read + write).
 *
 * Suppliers carry both `organization_id` and an optional `store_id`. The org
 * write API is the canonical entry point — `/store/inventory/suppliers` mutations
 * are being migrated out (Plan §6.3.2). Stores keep READ access only.
 *
 * Read flow respects `operating_scope`:
 *   - ORGANIZATION → all suppliers of the org (store_id null = shared, plus
 *     per-store suppliers); the optional `store_id` narrows to that store +
 *     shared.
 *   - STORE → only suppliers belonging to the requested store_id (or shared
 *     ones owned by the org with store_id=null).
 *
 * Write flow:
 *   - `create` derives `organization_id` from RequestContext; optional
 *     `store_id` is validated to belong to the caller's organization.
 *   - `update` validates store_id transitions (must stay inside the org).
 *   - `remove` is a soft-delete (sets `is_active=false`). Suppliers have
 *     `onDelete: Restrict` from `purchase_orders`, `invoices`,
 *     `withholding_calculations`, and `accounts_payable`, so a hard delete
 *     would fail on any active business record. Soft-delete keeps history.
 */
@Injectable()
export class OrgSuppliersService {
  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly operatingScope: OperatingScopeService,
  ) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    return orgId;
  }

  /**
   * Validate that `store_id` belongs to the caller's organization.
   *
   * The base prisma client is used (no auto-scoping) and we filter explicitly
   * by `organization_id`. Throws `ForbiddenException` on mismatch so callers
   * cannot probe other tenants' store ids.
   */
  private async assertStoreInOrg(
    organization_id: number,
    store_id: number,
  ): Promise<void> {
    const store = await this.globalPrisma.stores.findFirst({
      where: { id: store_id, organization_id, is_active: true },
      select: { id: true },
    });

    if (!store) {
      throw new ForbiddenException(
        `Store ${store_id} does not belong to the current organization`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // READ
  // ──────────────────────────────────────────────────────────────────────────

  async findAll(query: OrgSupplierQueryDto) {
    const organization_id = this.requireOrgId();
    const scope = await this.operatingScope.requireOperatingScope(
      organization_id,
    );

    // Build the org/store filter: in ORGANIZATION scope without breakdown we
    // include both shared suppliers (store_id null) and per-store suppliers.
    // With breakdown or in STORE scope we restrict to that store + shared.
    const breakdownStoreId = query.store_id ?? null;
    if (scope === 'STORE' && breakdownStoreId == null) {
      throw new BadRequestException(
        'store_id is required when operating_scope is STORE',
      );
    }

    const where: any = {
      // organization_id is auto-injected by the scoped client.
      ...(query.is_active != null ? { is_active: query.is_active } : {}),
      ...(query.email ? { email: query.email } : {}),
      ...(query.phone ? { phone: query.phone } : {}),
    };

    if (breakdownStoreId != null) {
      // Validate breakdown store belongs to org and narrow.
      await this.assertStoreInOrg(organization_id, breakdownStoreId);
      where.OR = [{ store_id: breakdownStoreId }, { store_id: null }];
    }

    if (query.search) {
      const searchOr = [
        { name: { contains: query.search } },
        { contact_person: { contains: query.search } },
        { email: { contains: query.search } },
        { phone: { contains: query.search } },
        { mobile: { contains: query.search } },
        { website: { contains: query.search } },
        { tax_id: { contains: query.search } },
        { notes: { contains: query.search } },
      ];
      where.AND = [
        ...(where.OR ? [{ OR: where.OR }] : []),
        { OR: searchOr },
      ];
      delete where.OR;
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 25;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.orgPrisma.suppliers.findMany({
        where,
        include: {
          store: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.orgPrisma.suppliers.count({ where }),
    ]);

    return {
      data: data.map((row) => this.toFlatRow(row)),
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
    const supplier = await this.orgPrisma.suppliers.findFirst({
      where: { id, organization_id },
      include: {
        store: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }

    return this.toFlatRow(supplier);
  }

  /**
   * Flattens Prisma nested `store` relation into the contract expected by the
   * frontend (see `OrgSupplierRow` in
   * `apps/frontend/.../inventory/services/org-inventory.service.ts`).
   *
   * The schema has no `document_number` column — the form modal aliases
   * `tax_id` for that label, so it's intentionally not exposed here.
   */
  private toFlatRow(row: {
    id: number;
    name: string;
    code: string;
    contact_person: string | null;
    tax_id: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    website: string | null;
    payment_terms: string | null;
    currency: string | null;
    lead_time_days: number | null;
    notes: string | null;
    is_active: boolean;
    store_id: number | null;
    store?: { id: number; name: string | null; slug: string | null } | null;
  }) {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      contact_person: row.contact_person ?? null,
      tax_id: row.tax_id ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      mobile: row.mobile ?? null,
      website: row.website ?? null,
      payment_terms: row.payment_terms ?? null,
      currency: row.currency ?? null,
      lead_time_days: row.lead_time_days ?? null,
      notes: row.notes ?? null,
      is_active: row.is_active,
      store_id: row.store_id ?? null,
      store_name: row.store?.name ?? null,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WRITE
  // ──────────────────────────────────────────────────────────────────────────

  async create(dto: CreateOrgSupplierDto) {
    const organization_id = this.requireOrgId();

    if (dto.store_id != null) {
      await this.assertStoreInOrg(organization_id, dto.store_id);
    }

    // Strip undefined/empty store_id so Prisma stores `null` (org-shared).
    const { store_id, ...rest } = dto;

    const created = await this.orgPrisma.suppliers.create({
      data: {
        ...rest,
        organization_id,
        store_id: store_id ?? null,
      },
      include: {
        store: { select: { id: true, name: true, slug: true } },
      },
    });

    return this.toFlatRow(created);
  }

  async update(id: number, dto: UpdateOrgSupplierDto) {
    const organization_id = this.requireOrgId();

    const existing = await this.orgPrisma.suppliers.findFirst({
      where: { id, organization_id },
      select: { id: true, store_id: true },
    });

    if (!existing) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }

    // Validate store_id transition. `null` is allowed (re-classify as shared).
    if (
      dto.store_id !== undefined &&
      dto.store_id !== null &&
      dto.store_id !== existing.store_id
    ) {
      await this.assertStoreInOrg(organization_id, dto.store_id);
    }

    const updated = await this.orgPrisma.suppliers.update({
      where: { id },
      data: dto,
      include: {
        store: { select: { id: true, name: true, slug: true } },
      },
    });

    return this.toFlatRow(updated);
  }

  /**
   * Soft-delete: set `is_active = false`.
   *
   * Hard delete is unsafe — `purchase_orders`, `invoices`,
   * `withholding_calculations` and `accounts_payable` all reference suppliers
   * with `onDelete: Restrict`, so any historical document would block the
   * deletion. Soft-delete keeps history while removing the supplier from
   * pickers and active flows.
   */
  async remove(id: number) {
    const organization_id = this.requireOrgId();

    const existing = await this.orgPrisma.suppliers.findFirst({
      where: { id, organization_id },
      select: { id: true, is_active: true },
    });

    if (!existing) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }

    if (existing.is_active === false) {
      throw new ConflictException(`Supplier ${id} is already inactive`);
    }

    return this.orgPrisma.suppliers.update({
      where: { id },
      data: { is_active: false },
    });
  }
}
