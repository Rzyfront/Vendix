import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AuditAction, AuditService } from '@common/audit/audit.service';

import { InventoryAdjustmentsService } from '../../../store/inventory/adjustments/inventory-adjustments.service';
import {
  CreateAdjustmentDto,
  InventoryAdjustment,
  AdjustmentType,
} from '../../../store/inventory/adjustments/interfaces/inventory-adjustment.interface';

import {
  CreateOrgAdjustmentBulkDto,
  CreateOrgAdjustmentDto,
  CreateOrgAdjustmentItemDto,
} from './dto/create-org-adjustment.dto';
import { QueryOrgAdjustmentDto } from './dto/query-org-adjustment.dto';

const ADJUSTMENT_INCLUDE = {
  products: { select: { id: true, name: true, sku: true } },
  product_variants: { select: { id: true, sku: true, name: true } },
  inventory_locations: {
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      store_id: true,
      is_central_warehouse: true,
    },
  },
  inventory_batches: {
    select: {
      id: true,
      batch_number: true,
      expiration_date: true,
      quantity: true,
      quantity_used: true,
    },
  },
  organizations: { select: { id: true, name: true } },
  users_inventory_adjustments_created_by_user_idTousers: {
    select: { id: true, username: true, email: true },
  },
  users_inventory_adjustments_approved_by_user_idTousers: {
    select: { id: true, username: true, email: true },
  },
} as const;

const AUDIT_RESOURCE = 'inventory_adjustments';

/**
 * Org-level inventory adjustments.
 *
 * - **Reads** use {@link OrganizationPrismaService} (auto-scoped by
 *   `organization_id`). Optional `store_id` performs the per-store breakdown
 *   filter via `inventory_locations.store_id` (adjustments themselves carry no
 *   `store_id` column — see schema).
 * - **Writes** delegate to the store-side {@link InventoryAdjustmentsService}
 *   so the proven stock-mutation flow (StockLevelManager + costing snapshots
 *   + `inventory.adjusted` accounting event) is reused unchanged. The store
 *   context is pinned transiently via `RequestContextService.setDomainContext`
 *   for the duration of the inner call. Central-warehouse locations
 *   (`store_id = null`) are allowed via `enforceLocationAccess({ allowCentral: true })`.
 * - Every mutation (`create`, `approve`, `cancel`/`delete`) is recorded in
 *   `audit_logs` via the global {@link AuditService}.
 */
@Injectable()
export class OrgAdjustmentsService {
  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
    private readonly storeAdjustments: InventoryAdjustmentsService,
    private readonly audit: AuditService,
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

  private requireUserId(): number {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new ForbiddenException('Authenticated user context required');
    }
    return userId;
  }

  /**
   * Pins a `store_id` (or null for central warehouse) into the
   * RequestContext for the duration of the callback so that store-side
   * services that depend on it keep working unchanged. For central-warehouse
   * locations the previous `store_id` is cleared and the relational
   * `store_id: undefined` filter becomes a no-op (correct behavior — the
   * adjustment is org-scoped via `inventory_locations.organization_id`).
   */
  private async runWithLocationContext<T>(
    location_store_id: number | null,
    callback: () => Promise<T>,
  ): Promise<T> {
    const ctx = RequestContextService.getContext();
    if (!ctx) {
      throw new ForbiddenException('Request context not available');
    }
    const previousStoreId = ctx.store_id;
    try {
      if (location_store_id != null) {
        RequestContextService.setDomainContext(
          location_store_id,
          ctx.organization_id,
        );
      } else {
        // Central warehouse: clear any pinned store so the store-scoped
        // Prisma extension does not constrain queries to a wrong store.
        ctx.store_id = undefined;
      }
      return await callback();
    } finally {
      ctx.store_id = previousStoreId;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read flows
  // ──────────────────────────────────────────────────────────────────────────

  async findAll(query: QueryOrgAdjustmentDto) {
    const organization_id = this.requireOrgId();
    const scoped = await this.orgPrisma.getScopedWhere({
      organization_id,
      store_id_filter: query.store_id ?? null,
    });

    const where: any = {};

    if (query.location_id != null) where.location_id = query.location_id;
    if (query.product_id != null) where.product_id = query.product_id;
    if (query.product_variant_id != null)
      where.product_variant_id = query.product_variant_id;
    if (query.batch_id != null) where.batch_id = query.batch_id;
    if (query.type != null) where.adjustment_type = query.type;
    if (query.created_by_user_id != null)
      where.created_by_user_id = query.created_by_user_id;
    if (query.approved_by_user_id != null)
      where.approved_by_user_id = query.approved_by_user_id;

    if (query.status === 'pending') where.approved_by_user_id = null;
    if (query.status === 'approved')
      where.approved_by_user_id = { not: null };

    if (query.start_date || query.end_date) {
      where.created_at = {};
      if (query.start_date) where.created_at.gte = query.start_date;
      if (query.end_date) where.created_at.lte = query.end_date;
    }

    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { reason_code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    // Per-store breakdown: filter through the location relation.
    if (scoped.store_id != null) {
      where.inventory_locations = { store_id: scoped.store_id };
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 25;
    const skip =
      query.offset != null && query.offset >= 0
        ? query.offset
        : (page - 1) * limit;
    const sortBy = query.sort_by ?? 'created_at';
    const sortOrder = query.sort_order ?? 'desc';

    const [data, total] = await Promise.all([
      this.orgPrisma.inventory_adjustments.findMany({
        where,
        include: ADJUSTMENT_INCLUDE,
        orderBy: { [sortBy]: sortOrder } as any,
        skip,
        take: limit,
      }),
      this.orgPrisma.inventory_adjustments.count({ where }),
    ]);

    return {
      data: data.map((row) => this.mapAdjustment(row)),
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
    const adjustment = await this.orgPrisma.inventory_adjustments.findFirst({
      where: { id, organization_id },
      include: ADJUSTMENT_INCLUDE,
    });
    if (!adjustment) {
      throw new NotFoundException(
        `Inventory adjustment ${id} not found for the current organization`,
      );
    }
    return this.mapAdjustment(adjustment);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Write flows (audited)
  // ──────────────────────────────────────────────────────────────────────────

  async create(dto: CreateOrgAdjustmentDto) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    const location = await this.operatingScope.enforceLocationAccess(
      organization_id,
      dto.location_id,
      { allowCentral: true },
    );

    const adjustment = await this.runWithLocationContext(
      location.store_id,
      () =>
        this.storeAdjustments.createAdjustment(
          this.toStoreCreateDto(dto, organization_id, user_id),
        ),
    );

    await this.audit.log({
      userId: user_id,
      organizationId: organization_id,
      storeId: location.store_id ?? undefined,
      action: AuditAction.CREATE,
      resource: AUDIT_RESOURCE,
      resourceId: adjustment.id,
      newValues: this.snapshot(adjustment),
      metadata: {
        scope: 'organization',
        location_id: dto.location_id,
        is_central_warehouse: location.is_central_warehouse,
        type: dto.type,
        reason_code: dto.reason_code,
        description: dto.description,
        auto_approved: dto.auto_approve === true,
      },
    });

    return adjustment;
  }

  async createBulk(dto: CreateOrgAdjustmentBulkDto) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    const location = await this.operatingScope.enforceLocationAccess(
      organization_id,
      dto.location_id,
      { allowCentral: true },
    );

    const results = await this.runWithLocationContext(
      location.store_id,
      async () => {
        const created: InventoryAdjustment[] = [];
        for (const item of dto.items) {
          const row = await this.storeAdjustments.createAdjustment(
            this.toStoreCreateDto(
              { ...item, location_id: dto.location_id, auto_approve: dto.auto_approve },
              organization_id,
              user_id,
            ),
          );
          created.push(row);
        }
        return created;
      },
    );

    // One audit row per created adjustment to keep the audit trail granular.
    for (const adjustment of results) {
      await this.audit.log({
        userId: user_id,
        organizationId: organization_id,
        storeId: location.store_id ?? undefined,
        action: AuditAction.CREATE,
        resource: AUDIT_RESOURCE,
        resourceId: adjustment.id,
        newValues: this.snapshot(adjustment),
        metadata: {
          scope: 'organization',
          location_id: dto.location_id,
          is_central_warehouse: location.is_central_warehouse,
          bulk: true,
          bulk_size: dto.items.length,
          reason: dto.reason,
          auto_approved: dto.auto_approve === true,
        },
      });
    }

    return {
      data: results,
      meta: { total: results.length },
    };
  }

  async approve(id: number) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    const before = await this.orgPrisma.inventory_adjustments.findFirst({
      where: { id, organization_id },
      include: ADJUSTMENT_INCLUDE,
    });
    if (!before) {
      throw new NotFoundException(
        `Inventory adjustment ${id} not found for the current organization`,
      );
    }
    if (before.approved_by_user_id != null) {
      throw new ConflictException('Adjustment already approved');
    }

    // Resolve the location's store so the inner store-side service runs in
    // the right scope (audit + invariants only — stock was already mutated
    // at creation time on this codebase).
    const location = await this.operatingScope.enforceLocationAccess(
      organization_id,
      before.location_id,
      { allowCentral: true },
    );

    const updated = await this.runWithLocationContext(location.store_id, () =>
      this.storeAdjustments.approveAdjustment(id, user_id),
    );

    await this.audit.log({
      userId: user_id,
      organizationId: organization_id,
      storeId: location.store_id ?? undefined,
      action: AuditAction.UPDATE,
      resource: AUDIT_RESOURCE,
      resourceId: id,
      oldValues: this.snapshot(before),
      newValues: this.snapshot(updated),
      metadata: {
        scope: 'organization',
        action_kind: 'approve',
        location_id: before.location_id,
        is_central_warehouse: location.is_central_warehouse,
      },
    });

    return updated;
  }

  /**
   * Cancels (deletes) a still-pending adjustment. Aligns with the store-side
   * contract: only adjustments that have not been approved can be removed.
   * The `audit_logs` row is the durable record of the cancellation.
   */
  async cancel(id: number) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    const before = await this.orgPrisma.inventory_adjustments.findFirst({
      where: { id, organization_id },
      include: ADJUSTMENT_INCLUDE,
    });
    if (!before) {
      throw new NotFoundException(
        `Inventory adjustment ${id} not found for the current organization`,
      );
    }
    if (before.approved_by_user_id != null) {
      throw new ConflictException(
        'Cannot cancel adjustment: it has already been approved',
      );
    }

    const location = await this.operatingScope.enforceLocationAccess(
      organization_id,
      before.location_id,
      { allowCentral: true },
    );

    await this.runWithLocationContext(location.store_id, () =>
      this.storeAdjustments.deleteAdjustment(id),
    );

    await this.audit.log({
      userId: user_id,
      organizationId: organization_id,
      storeId: location.store_id ?? undefined,
      action: AuditAction.DELETE,
      resource: AUDIT_RESOURCE,
      resourceId: id,
      oldValues: this.snapshot(before),
      metadata: {
        scope: 'organization',
        action_kind: 'cancel',
        location_id: before.location_id,
        is_central_warehouse: location.is_central_warehouse,
      },
    });

    return { id, cancelled: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal mappers
  // ──────────────────────────────────────────────────────────────────────────

  private toStoreCreateDto(
    src: CreateOrgAdjustmentDto | (CreateOrgAdjustmentItemDto & {
      location_id: number;
      auto_approve?: boolean;
    }),
    organization_id: number,
    user_id: number,
  ): CreateAdjustmentDto {
    return {
      organization_id,
      created_by_user_id: user_id,
      product_id: src.product_id,
      product_variant_id: src.product_variant_id,
      location_id: src.location_id,
      batch_id: src.batch_id,
      type: src.type as AdjustmentType,
      quantity_after: src.quantity_after,
      reason_code: src.reason_code,
      description: src.description,
      approved_by_user_id: src.auto_approve ? user_id : undefined,
    };
  }

  /**
   * Compact snapshot for audit logs — keeps the row structure but drops
   * heavy nested relations to keep `audit_logs.new_values` reasonably sized.
   */
  private snapshot(adjustment: any): Record<string, any> {
    if (!adjustment) return {};
    return {
      id: adjustment.id,
      organization_id: adjustment.organization_id,
      product_id: adjustment.product_id,
      product_variant_id: adjustment.product_variant_id,
      location_id: adjustment.location_id,
      batch_id: adjustment.batch_id,
      adjustment_type: adjustment.adjustment_type,
      quantity_before: adjustment.quantity_before,
      quantity_after: adjustment.quantity_after,
      quantity_change: adjustment.quantity_change,
      reason_code: adjustment.reason_code,
      description: adjustment.description,
      created_by_user_id: adjustment.created_by_user_id,
      approved_by_user_id: adjustment.approved_by_user_id,
      approved_at: adjustment.approved_at,
      created_at: adjustment.created_at,
    };
  }

  private mapAdjustment(adjustment: any) {
    if (!adjustment) return adjustment;
    const createdBy =
      adjustment.users_inventory_adjustments_created_by_user_idTousers;
    const approvedBy =
      adjustment.users_inventory_adjustments_approved_by_user_idTousers;
    return {
      ...adjustment,
      status: adjustment.approved_by_user_id ? 'approved' : 'pending',
      created_by_user: createdBy
        ? {
            id: createdBy.id,
            user_name: createdBy.username,
            email: createdBy.email,
          }
        : null,
      approved_by_user: approvedBy
        ? {
            id: approvedBy.id,
            user_name: approvedBy.username,
            email: approvedBy.email,
          }
        : null,
    };
  }
}

// Re-export for any caller that wants to pin to the canonical resource label.
export const ORG_INVENTORY_ADJUSTMENTS_AUDIT_RESOURCE = AUDIT_RESOURCE;
