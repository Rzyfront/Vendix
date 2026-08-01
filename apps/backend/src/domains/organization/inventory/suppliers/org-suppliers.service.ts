import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { supplier_state_enum } from '@prisma/client';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  TERMINAL_PURCHASE_ORDER_STATUS,
  TERMINAL_DISPATCH_NOTE_STATUS,
} from '@common/constants/supplier-lifecycle.constants';

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
 *   - `remove` archiva (`state='archived'`). No es un borrado: las FKs
 *     `onDelete: Restrict` de `purchase_orders`, `invoices`,
 *     `withholding_calculations` y `accounts_payable` siguen resolviendo
 *     porque la fila persiste. A diferencia del viejo soft-delete
 *     (`is_active=false`), archivar además lo oculta de listados y selectores,
 *     que es lo que ese soft-delete pretendía sin lograrlo. Se bloquea con 409
 *     si el proveedor tiene documentos abiertos.
 *   - `setState` cubre la transición activo ↔ inactivo: un proveedor inactivo
 *     sigue visible en el listado pero deja de ofrecerse en flujos nuevos.
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
      // Los archivados quedan fuera salvo que se pidan explícitamente.
      state: query.state ?? { not: supplier_state_enum.archived },
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
    state: supplier_state_enum;
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
      state: row.state,
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
   * Cuenta los documentos del proveedor que siguen abiertos, a nivel
   * organización (el proveedor pertenece a la org, no a una tienda).
   */
  private async countOpenDocuments(supplierId: number, organizationId: number) {
    const client = this.globalPrisma.withoutScope();

    const [open_purchase_orders, unpaid_payables, open_dispatch_notes] =
      await Promise.all([
        client.purchase_orders.count({
          where: {
            supplier_id: supplierId,
            organization_id: organizationId,
            status: { notIn: [...TERMINAL_PURCHASE_ORDER_STATUS] },
          },
        }),
        client.accounts_payable.count({
          where: {
            supplier_id: supplierId,
            organization_id: organizationId,
            balance: { gt: 0 },
          },
        }),
        client.dispatch_notes.count({
          where: {
            supplier_id: supplierId,
            // La relación se llama `store` (singular) en dispatch_notes.
            store: { organization_id: organizationId },
            status: { notIn: [...TERMINAL_DISPATCH_NOTE_STATUS] },
          },
        }),
      ]);

    return {
      open_purchase_orders,
      unpaid_payables,
      open_dispatch_notes,
      total: open_purchase_orders + unpaid_payables + open_dispatch_notes,
    };
  }

  /**
   * Archiva el proveedor (`state='archived'`).
   *
   * No borra la fila: `purchase_orders`, `invoices`, `withholding_calculations`
   * y `accounts_payable` la referencian con `onDelete: Restrict` y siguen
   * resolviendo. A diferencia del viejo soft-delete, archivar además lo saca de
   * listados y selectores. Se rechaza con 409 si tiene documentos abiertos:
   * volverlo invisible mientras una OC sigue en curso esconde trabajo vivo.
   */
  async remove(id: number) {
    const organization_id = this.requireOrgId();

    const existing = await this.orgPrisma.suppliers.findFirst({
      where: { id, organization_id },
      select: { id: true, state: true },
    });

    if (!existing) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }

    if (existing.state === supplier_state_enum.archived) {
      return existing;
    }

    const open = await this.countOpenDocuments(id, organization_id);

    if (open.total > 0) {
      throw new VendixHttpException(
        ErrorCodes.SUPPLIER_ARCHIVE_HAS_OPEN_DOCUMENTS,
        undefined,
        {
          open_purchase_orders: open.open_purchase_orders,
          unpaid_payables: open.unpaid_payables,
          open_dispatch_notes: open.open_dispatch_notes,
        },
      );
    }

    // Desvincula al proveedor como carrier por defecto para que ningún flujo
    // nuevo lo resuelva. Todo por el `tx` del callback, nunca por otro cliente.
    return this.globalPrisma.$transaction(async (tx: any) => {
      await tx.shipping_methods.updateMany({
        where: { default_carrier_supplier_id: id },
        data: { default_carrier_supplier_id: null },
      });

      await tx.dispatch_routes.updateMany({
        where: { external_carrier_supplier_id: id },
        data: { external_carrier_supplier_id: null },
      });

      return tx.suppliers.update({
        where: { id },
        data: { state: supplier_state_enum.archived },
      });
    });
  }

  /**
   * Transición activo ↔ inactivo. `archived` no es destino válido aquí:
   * archivar tiene un único camino auditado (DELETE) que valida documentos.
   */
  async setState(id: number, state: supplier_state_enum) {
    if (state === supplier_state_enum.archived) {
      throw new VendixHttpException(
        ErrorCodes.SUPPLIER_STATE_INVALID_TRANSITION,
        'Use DELETE /organization/inventory/suppliers/:id to archive a supplier',
      );
    }

    const organization_id = this.requireOrgId();

    const existing = await this.orgPrisma.suppliers.findFirst({
      where: { id, organization_id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }

    const updated = await this.orgPrisma.suppliers.update({
      where: { id },
      data: { state },
      include: {
        store: { select: { id: true, name: true, slug: true } },
      },
    });

    return this.toFlatRow(updated);
  }
}
