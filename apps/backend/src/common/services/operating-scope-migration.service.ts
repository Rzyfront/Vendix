import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  OperatingScopeService,
  OrganizationOperatingScope,
} from './operating-scope.service';
import { FiscalScopeService } from './fiscal-scope.service';
import { OrgLocationsService } from '../../domains/organization/inventory/locations/org-locations.service';

/**
 * Result returned by {@link OperatingScopeMigrationService.proposeChange}
 * (a.k.a. "preview"). Reports validation findings *without* mutating data so
 * the frontend wizard can render the readiness checklist before the user
 * confirms. `can_apply === false` means there is at least one blocker.
 */
export interface OperatingScopeMigrationPreview {
  organization_id: number;
  current_scope: OrganizationOperatingScope;
  target_scope: OrganizationOperatingScope;
  is_partner: boolean;
  direction: 'NOOP' | 'UP' | 'DOWN';
  can_apply: boolean;
  warnings: string[];
  blockers: Array<{
    code: string;
    message: string;
    details?: any;
  }>;
}

export interface OperatingScopeMigrationResult {
  organization_id: number;
  previous_scope: OrganizationOperatingScope;
  new_scope: OrganizationOperatingScope;
  audit_log_id: number;
  applied_at: Date;
}

/**
 * Phase 4 — Operating Scope Migration Wizard service.
 *
 * Owns the bidirectional STORE ↔ ORGANIZATION migration of an organization,
 * enforcing the rules captured in the consolidated plan:
 *   - UP (STORE → ORGANIZATION): require ≥2 active stores; ensure each store
 *     has its own STORE-scoped accounting_entity; create the consolidated
 *     ORGANIZATION-scoped entity if missing. Historical entries stay put.
 *   - DOWN (ORGANIZATION → STORE): forbidden for partners; reject when
 *     consolidated POs (PENDING/APPROVED) or cross-store transfers
 *     (PENDING / draft / in_transit) are open; ensure each store has its own
 *     STORE-scoped accounting_entity; flag historical ORGANIZATION-scoped
 *     entries as immutable consolidated history (TODO — schema flag pending).
 *
 * Every applied change is recorded in `operating_scope_audit_log` and the
 * in-process scope cache is invalidated so subsequent requests resolve the
 * fresh value.
 *
 * Partner guard: `organizations.is_partner = true` ⇒ scope is locked to
 * `STORE`. Any attempt to move a partner away from `STORE` raises 403 and is
 * logged as a security-relevant event.
 */
@Injectable()
export class OperatingScopeMigrationService {
  private readonly logger = new Logger(OperatingScopeMigrationService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly operatingScope: OperatingScopeService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly audit: AuditService,
    private readonly orgLocationsService: OrgLocationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Validate a proposed scope change without mutating data. Returns the full
   * blockers/warnings checklist so the wizard can render readiness. Does not
   * touch the audit log.
   */
  async proposeChange(
    organization_id: number,
    new_scope: OrganizationOperatingScope,
    _userId: number,
    _reason?: string,
  ): Promise<OperatingScopeMigrationPreview> {
    this.assertScopeValue(new_scope);

    const baseClient = this.globalPrisma.withoutScope();

    const organization = await baseClient.organizations.findUnique({
      where: { id: organization_id },
      select: {
        id: true,
        operating_scope: true,
        is_partner: true,
        account_type: true,
      },
    });
    if (!organization) {
      throw new NotFoundException(
        `Organization ${organization_id} not found`,
      );
    }

    const current_scope: OrganizationOperatingScope =
      (organization.operating_scope as OrganizationOperatingScope) ??
      (organization.account_type === 'MULTI_STORE_ORG'
        ? 'ORGANIZATION'
        : 'STORE');

    const preview: OperatingScopeMigrationPreview = {
      organization_id,
      current_scope,
      target_scope: new_scope,
      is_partner: organization.is_partner === true,
      direction:
        current_scope === new_scope
          ? 'NOOP'
          : new_scope === 'ORGANIZATION'
            ? 'UP'
            : 'DOWN',
      can_apply: true,
      warnings: [],
      blockers: [],
    };

    // Partner guard: hard-stop unless target is STORE.
    if (preview.is_partner && new_scope !== 'STORE') {
      preview.can_apply = false;
      preview.blockers.push({
        code: 'PARTNER_LOCKED',
        message:
          'Partners are forced to operating_scope=STORE and cannot upgrade.',
      });
      return preview;
    }

    // Idempotent NOOP — nothing to validate.
    if (preview.direction === 'NOOP') {
      preview.warnings.push('Target scope equals current scope (no-op).');
      return preview;
    }

    if (preview.direction === 'UP') {
      await this.collectUpBlockers(organization_id, baseClient, preview);
    } else {
      await this.collectDownBlockers(organization_id, baseClient, preview);
    }

    preview.can_apply = preview.blockers.length === 0;
    return preview;
  }

  /**
   * Apply a scope change in a single atomic transaction. On any failure the
   * transaction rolls back and no audit row is written. The wizard MUST call
   * {@link proposeChange} first; this method re-validates inside the
   * transaction (defense-in-depth against race conditions).
   *
   * **Force-apply (Plan P4.5 §13 #3):** when downgrading and at least one
   * server-authoritative blocker is present, callers may opt-in with
   * `force=true` and a justification `reason` (≥10 chars). The override and
   * the blocker snapshot are written to the generic `audit_logs` table via
   * {@link AuditService} (action `OPERATING_SCOPE_DOWNGRADE_FORCED`); the
   * scope-specific row in `operating_scope_audit_log` carries the same reason.
   * `force` has no effect on UP migrations or on partner-locked attempts.
   */
  async applyChange(
    organization_id: number,
    new_scope: OrganizationOperatingScope,
    userId: number,
    reason?: string,
    force: boolean = false,
  ): Promise<OperatingScopeMigrationResult & { forced: boolean }> {
    this.assertScopeValue(new_scope);
    if (!userId || !Number.isFinite(userId)) {
      throw new BadRequestException('userId is required to apply a scope change');
    }

    if (force === true && (!reason || reason.trim().length < 10)) {
      throw new BadRequestException(
        'Force downgrade requires a reason (minimum 10 characters)',
      );
    }

    const result = await this.globalPrisma.$transaction(async (tx: any) => {
      // Optimistic lock: SELECT ... FOR UPDATE on the organizations row.
      // Prisma does not expose `for update` directly; emulate with raw SQL.
      // `$queryRawUnsafe` is untyped at the SDK level — cast the result.
      const lockedRows = (await tx.$queryRawUnsafe(
        `SELECT id, operating_scope::text AS operating_scope, is_partner, account_type::text AS account_type
         FROM organizations WHERE id = $1 FOR UPDATE`,
        organization_id,
      )) as Array<{
        id: number;
        operating_scope: string;
        is_partner: boolean;
        account_type: string;
      }>;
      if (!lockedRows || lockedRows.length === 0) {
        throw new NotFoundException(
          `Organization ${organization_id} not found`,
        );
      }
      const locked = lockedRows[0];

      const previous_scope: OrganizationOperatingScope =
        (locked.operating_scope as OrganizationOperatingScope) ??
        (locked.account_type === 'MULTI_STORE_ORG' ? 'ORGANIZATION' : 'STORE');

      // Partner guard inside the tx — fresh read. Force NEVER bypasses partner
      // lock (security rail).
      if (locked.is_partner === true && new_scope !== 'STORE') {
        throw new ForbiddenException(
          'Partners are forced to operating_scope=STORE',
        );
      }

      // Idempotent NOOP — nothing to do.
      if (previous_scope === new_scope) {
        return {
          organization_id,
          previous_scope,
          new_scope,
          audit_log_id: 0,
          applied_at: new Date(),
          noop: true,
          forced: false,
          forcedBlockerSnapshot: null as any,
        };
      }

      // Re-validate (defense-in-depth): rebuild the blockers list inside the tx.
      const inTxPreview: OperatingScopeMigrationPreview = {
        organization_id,
        current_scope: previous_scope,
        target_scope: new_scope,
        is_partner: locked.is_partner === true,
        direction: new_scope === 'ORGANIZATION' ? 'UP' : 'DOWN',
        can_apply: true,
        warnings: [],
        blockers: [],
      };

      if (inTxPreview.direction === 'UP') {
        await this.collectUpBlockers(organization_id, tx, inTxPreview);
      } else {
        await this.collectDownBlockers(organization_id, tx, inTxPreview);
      }

      const hadBlockers = inTxPreview.blockers.length > 0;

      // Force is only meaningful on DOWN migrations. UP path treats
      // `force=true` as a no-op (blockers there are not safe to bypass).
      const canForce = inTxPreview.direction === 'DOWN' && force === true;

      if (hadBlockers && !canForce) {
        throw new ConflictException({
          message: 'Operating scope change blocked by pre-conditions',
          code: 'DOWNGRADE_BLOCKED',
          blockers: inTxPreview.blockers,
        });
      }

      // Snapshot blockers BEFORE we mutate so the audit log captures what was
      // overridden.
      const forcedBlockerSnapshot = hadBlockers && canForce
        ? inTxPreview.blockers.map((b) => ({
            code: b.code,
            message: b.message,
            details: b.details ?? null,
          }))
        : null;

      // Mutations
      if (inTxPreview.direction === 'UP') {
        await this.applyUpMutations(organization_id, tx);
      } else {
        await this.applyDownMutations(organization_id, tx);
      }

      // Update organizations.operating_scope.
      await tx.organizations.update({
        where: { id: organization_id },
        data: { operating_scope: new_scope as any, updated_at: new Date() },
      });

      // Scope-specific audit row (already in place — preserves wizard
      // history). When forced, we also append the blocker snapshot to the
      // reason for human review.
      const reasonForLog = canForce && hadBlockers
        ? `[FORCED] ${reason} | overridden_blockers=${forcedBlockerSnapshot
            ?.map((b) => b.code)
            .join(',') ?? ''}`
        : (reason ?? null);

      const audit = await tx.operating_scope_audit_log.create({
        data: {
          organization_id,
          previous_value: previous_scope as any,
          new_value: new_scope as any,
          changed_by_user_id: userId,
          reason: reasonForLog,
        },
        select: { id: true, changed_at: true },
      });

      return {
        organization_id,
        previous_scope,
        new_scope,
        audit_log_id: audit.id,
        applied_at: audit.changed_at as Date,
        noop: false,
        forced: canForce && hadBlockers,
        forcedBlockerSnapshot,
      };
    });

    // Invalidate the in-process scope cache so subsequent requests in this
    // worker see the new value immediately. Other workers converge after the
    // 30s TTL.
    this.operatingScope.invalidateScopeCache(organization_id);

    // Generic audit_logs entry for normal AND forced cases (Plan P4.5 §13 #3).
    // Done outside the tx because AuditService swallows errors and we don't
    // want a logging hiccup to roll back the migration. The migration row in
    // operating_scope_audit_log is the source of truth for the change itself.
    if (!result.noop) {
      try {
        await this.audit.log({
          userId,
          organizationId: organization_id,
          action: result.forced
            ? 'OPERATING_SCOPE_DOWNGRADE_FORCED'
            : 'OPERATING_SCOPE_CHANGED',
          resource: 'organizations',
          resourceId: organization_id,
          oldValues: {
            operating_scope: result.previous_scope,
          },
          newValues: {
            operating_scope: result.new_scope,
          },
          metadata: {
            audit_log_id: result.audit_log_id,
            reason: reason ?? null,
            forced: result.forced,
            overridden_blockers: result.forcedBlockerSnapshot ?? undefined,
          },
        });
      } catch (err: any) {
        this.logger.warn(
          `operating_scope audit_logs entry failed for org=${organization_id}: ${err?.message ?? err}`,
        );
      }
    }

    if (result.noop) {
      this.logger.log(
        `operating_scope unchanged for org=${organization_id} (noop ${new_scope})`,
      );
    } else if (result.forced) {
      this.logger.warn(
        `operating_scope FORCE-DOWNGRADED org=${organization_id} ${result.previous_scope} → ${result.new_scope} by user=${userId} reason="${reason}" overridden_blockers=${result.forcedBlockerSnapshot
          ?.map((b: any) => b.code)
          .join(',') ?? ''}`,
      );
    } else {
      this.logger.log(
        `operating_scope migrated org=${organization_id} ${result.previous_scope} → ${result.new_scope} by user=${userId}`,
      );
    }

    return {
      organization_id: result.organization_id,
      previous_scope: result.previous_scope,
      new_scope: result.new_scope,
      audit_log_id: result.audit_log_id,
      applied_at: result.applied_at,
      forced: result.forced,
    };
  }

  /**
   * Convenience: list the most recent audit-log entries for the wizard UI.
   */
  async getRecentAuditLog(organization_id: number, take = 10) {
    const baseClient = this.globalPrisma.withoutScope() as any;
    return baseClient.operating_scope_audit_log.findMany({
      where: { organization_id },
      orderBy: { changed_at: 'desc' },
      take,
      select: {
        id: true,
        previous_value: true,
        new_value: true,
        changed_by_user_id: true,
        changed_at: true,
        reason: true,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // UP (STORE → ORGANIZATION)
  // ---------------------------------------------------------------------------

  private async collectUpBlockers(
    organization_id: number,
    client: any,
    preview: OperatingScopeMigrationPreview,
  ) {
    // 1. Need ≥2 active stores for the upgrade to make sense.
    const activeStores = await client.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true, name: true },
    });
    if (activeStores.length < 2) {
      preview.blockers.push({
        code: 'NOT_ENOUGH_STORES',
        message:
          'Upgrading to ORGANIZATION scope requires at least 2 active stores.',
        details: { active_store_count: activeStores.length },
      });
    }

    // 2. Each store should already have its own accounting_entity (will be
    //    auto-created if missing during applyUpMutations — this is just a
    //    soft warning, not a blocker).
    const missing = await this.findStoresMissingEntity(
      organization_id,
      client,
      activeStores.map((s: any) => s.id),
    );
    if (missing.length > 0) {
      preview.warnings.push(
        `${missing.length} store(s) lack a STORE accounting_entity; they will be auto-created on apply.`,
      );
    }
  }

  private async applyUpMutations(organization_id: number, tx: any) {
    // Ensure consolidated ORGANIZATION-scoped accounting_entity exists.
    await this.ensureOrganizationAccountingEntity(organization_id, tx);

    // Ensure each store has a STORE accounting_entity (so future per-store
    // breakdowns keep working).
    const stores = await tx.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
    });
    for (const store of stores) {
      await this.ensureStoreAccountingEntity(organization_id, store.id, tx);
    }

    // Provision the organizational central warehouse atomically inside the
    // same migration tx. Idempotent: reactivates if a previously-deactivated
    // central exists, no-ops if already active.
    await this.orgLocationsService.ensureCentralWarehouse(organization_id, tx);

    // Cross-store transfers become legal automatically: the rule lives in
    // OperatingScopeService.assertCrossStoreTransferAllowed and reads the
    // updated scope on the next request — no data migration required.
  }

  // ---------------------------------------------------------------------------
  // DOWN (ORGANIZATION → STORE)
  // ---------------------------------------------------------------------------

  private async collectDownBlockers(
    organization_id: number,
    client: any,
    preview: OperatingScopeMigrationPreview,
  ) {
    const fiscalScope = await this.fiscalScope.getFiscalScope(
      organization_id,
      client,
    );
    if (fiscalScope === 'ORGANIZATION') {
      preview.blockers.push({
        code: 'OPERATING_SCOPE_FISCAL_COMBINATION_INVALID',
        message:
          'No se puede bajar operating_scope a STORE mientras fiscal_scope sea ORGANIZATION. Cambia primero el modo fiscal a STORE.',
        details: {
          fiscal_scope: fiscalScope,
          remediation_link: '/admin/settings/fiscal-scope',
        },
      });
    }

    // 1. Partners cannot downgrade away from STORE — already handled above
    //    when target≠STORE; here partner→STORE is fine, no extra check.

    // ----- Plan P4.5 §6.5.4 — server-authoritative blockers --------------
    //
    // Blocker 1: Open POs whose destination is the central warehouse.
    // Even if a PO has store_id=null+is_central_warehouse=true location, going
    // STORE-scoped breaks it because central locations belong to the org and
    // STORE-scope cannot reach them.
    const openPosToCentral = await client.purchase_orders.findMany({
      where: {
        organization_id,
        status: { in: ['draft', 'approved', 'partial'] },
        location: { is_central_warehouse: true },
      },
      select: { id: true, order_number: true, status: true },
    });
    if (openPosToCentral.length > 0) {
      preview.blockers.push({
        code: 'OPEN_POS_TO_CENTRAL',
        message: `${openPosToCentral.length} órdenes de compra abiertas hacia bodega central. Recíbelas o cancélalas antes de bajar a scope STORE.`,
        details: {
          count: openPosToCentral.length,
          purchase_order_ids: openPosToCentral.map((p: any) => p.id),
          purchase_orders: openPosToCentral,
          remediation_link:
            '/organization/orders/purchase-orders?destination=central&status=open',
        },
      });
    }

    // Blocker 1b: Open consolidated POs in PENDING/APPROVED state must be
    // resolved (any PO, even non-central). Kept for backward compatibility
    // with existing wizard flow.
    const openPos = await client.purchase_orders.findMany({
      where: {
        organization_id,
        status: { in: ['draft', 'approved', 'partial'] },
        location: { is_central_warehouse: false },
      },
      select: { id: true, order_number: true, status: true },
    });
    if (openPos.length > 0) {
      preview.blockers.push({
        code: 'OPEN_PURCHASE_ORDERS',
        message:
          'Open consolidated purchase orders must be received or cancelled before downgrading.',
        details: {
          count: openPos.length,
          purchase_order_ids: openPos.map((p: any) => p.id),
          purchase_orders: openPos,
          remediation_link:
            '/organization/orders/purchase-orders?status=open',
        },
      });
    }

    // Blocker 2: Open cross-store transfers (active states, source≠dest store).
    // Use raw SQL to express the join+filter cleanly without relying on
    // Prisma's relation-filter limitations.
    const transferRows = await client.$queryRaw<
      Array<{
        id: number;
        transfer_number: string;
        status: string;
      }>
    >`
      SELECT st.id,
             st.transfer_number,
             st.status::text AS status
      FROM stock_transfers st
      INNER JOIN inventory_locations fl ON fl.id = st.from_location_id
      INNER JOIN inventory_locations tl ON tl.id = st.to_location_id
      WHERE st.organization_id = ${organization_id}
        AND st.status IN ('draft', 'in_transit')
        AND fl.store_id IS NOT NULL
        AND tl.store_id IS NOT NULL
        AND fl.store_id <> tl.store_id;
    `;
    if (transferRows.length > 0) {
      preview.blockers.push({
        code: 'OPEN_CROSS_STORE_TRANSFERS',
        message: `${transferRows.length} transferencias inter-tienda abiertas. Complétalas o cancélalas antes de bajar a scope STORE.`,
        details: {
          count: transferRows.length,
          transfer_ids: transferRows.map((t) => t.id),
          transfers: transferRows,
          remediation_link: '/organization/inventory/transfers?status=open',
        },
      });
    }

    // Blocker 3: Stock currently held at central warehouse. If any
    // qty_on_hand>0 sits at a central location, downgrading would orphan
    // that inventory (no STORE-scope endpoint can read it).
    const stockRows = await client.$queryRaw<
      Array<{ count: bigint; qty_sum: bigint | null }>
    >`
      SELECT COUNT(sl.id)::bigint AS count,
             COALESCE(SUM(sl.quantity_on_hand), 0)::bigint AS qty_sum
      FROM stock_levels sl
      INNER JOIN inventory_locations il ON il.id = sl.location_id
      WHERE il.organization_id = ${organization_id}
        AND il.is_central_warehouse = TRUE
        AND sl.quantity_on_hand > 0;
    `;
    const stockAtCentralCount = Number(stockRows[0]?.count ?? 0);
    const stockAtCentralQty = Number(stockRows[0]?.qty_sum ?? 0);
    if (stockAtCentralCount > 0) {
      preview.blockers.push({
        code: 'STOCK_AT_CENTRAL',
        message: `${stockAtCentralCount} líneas de stock en bodega central (${stockAtCentralQty} unidades). Transfiere o ajusta a una tienda antes de bajar a scope STORE.`,
        details: {
          count: stockAtCentralCount,
          quantity_on_hand_total: stockAtCentralQty,
          remediation_link:
            '/organization/inventory/stock?location=central&qty_gt=0',
        },
      });
    }

    // Blocker 4: Active stock reservations at central. Even if qty_on_hand=0,
    // an unfulfilled reservation pointing at central would dangle.
    const reservationsAtCentral = await client.stock_reservations.count({
      where: {
        organization_id,
        status: 'active',
        inventory_locations: { is_central_warehouse: true },
      },
    });
    if (reservationsAtCentral > 0) {
      preview.blockers.push({
        code: 'ACTIVE_RESERVATIONS_AT_CENTRAL',
        message: `${reservationsAtCentral} reservas activas en bodega central. Libéralas o consúmelas antes de bajar a scope STORE.`,
        details: {
          count: reservationsAtCentral,
          remediation_link:
            '/organization/inventory/reservations?location=central&status=active',
        },
      });
    }

    // ----- End P4.5 server-authoritative blockers ------------------------

    // 5. Each store should have its own STORE accounting_entity (auto-created
    //    on apply — warning only).
    const stores = await client.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
    });
    if (stores.length === 0) {
      preview.blockers.push({
        code: 'NO_ACTIVE_STORES',
        message:
          'Cannot downgrade to STORE scope when the organization has no active stores.',
      });
    } else {
      const missing = await this.findStoresMissingEntity(
        organization_id,
        client,
        stores.map((s: any) => s.id),
      );
      if (missing.length > 0) {
        preview.warnings.push(
          `${missing.length} store(s) lack a STORE accounting_entity; they will be auto-created on apply.`,
        );
      }
    }
  }

  private async applyDownMutations(organization_id: number, tx: any) {
    // Ensure each active store has its STORE accounting_entity.
    const stores = await tx.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
    });
    for (const store of stores) {
      await this.ensureStoreAccountingEntity(organization_id, store.id, tx);
    }

    // Deactivate the organizational central warehouse (preserves the row
    // for audit trails and FK integrity instead of deleting it). Idempotent:
    // no-op if no central warehouse exists or it's already inactive.
    await this.orgLocationsService.deactivateCentralWarehouse(
      organization_id,
      tx,
    );

    // Mark historical ORGANIZATION-scoped entries as immutable consolidated
    // history. Heuristic: entries whose store_id is NULL were written while
    // the org operated under ORGANIZATION scope (consolidated entity). Once
    // we downgrade to STORE scope, those rows become read-only historical
    // artifacts and must not be reassigned to a per-store entity.
    const flagged = await tx.accounting_entries.updateMany({
      where: {
        organization_id,
        store_id: null,
        is_historical_consolidated: false,
      },
      data: { is_historical_consolidated: true },
    });
    this.logger.log(
      `operating_scope DOWN org=${organization_id}: flagged ${flagged.count} accounting_entries as is_historical_consolidated=true`,
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertScopeValue(scope: OrganizationOperatingScope) {
    if (scope !== 'STORE' && scope !== 'ORGANIZATION') {
      throw new BadRequestException(
        `operating_scope must be 'STORE' or 'ORGANIZATION' (received: ${scope})`,
      );
    }
  }

  private async findStoresMissingEntity(
    organization_id: number,
    client: any,
    store_ids: number[],
  ): Promise<number[]> {
    if (store_ids.length === 0) return [];
    const existing = await client.accounting_entities.findMany({
      where: {
        organization_id,
        scope: 'STORE',
        is_active: true,
        store_id: { in: store_ids },
      },
      select: { store_id: true },
    });
    const haveSet = new Set(existing.map((e: any) => e.store_id));
    return store_ids.filter((id) => !haveSet.has(id));
  }

  private async ensureOrganizationAccountingEntity(
    organization_id: number,
    client: any,
  ) {
    const existing = await client.accounting_entities.findFirst({
      where: {
        organization_id,
        store_id: null,
        scope: 'ORGANIZATION',
        is_active: true,
      },
    });
    if (existing) return existing;

    const organization = await client.organizations.findUnique({
      where: { id: organization_id },
      select: { name: true, legal_name: true, tax_id: true },
    });
    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    return client.accounting_entities.create({
      data: {
        organization_id,
        store_id: null,
        scope: 'ORGANIZATION',
        name: organization.name,
        legal_name: organization.legal_name,
        tax_id: organization.tax_id,
      },
    });
  }

  private async ensureStoreAccountingEntity(
    organization_id: number,
    store_id: number,
    client: any,
  ) {
    const existing = await client.accounting_entities.findFirst({
      where: {
        organization_id,
        store_id,
        scope: 'STORE',
        is_active: true,
      },
    });
    if (existing) return existing;

    const store = await client.stores.findFirst({
      where: { id: store_id, organization_id },
      select: {
        id: true,
        name: true,
        organizations: { select: { legal_name: true, tax_id: true } },
      },
    });
    if (!store) {
      throw new BadRequestException('Store not found for accounting entity');
    }

    return client.accounting_entities.create({
      data: {
        organization_id,
        store_id: store.id,
        scope: 'STORE',
        name: store.name,
        legal_name: store.organizations?.legal_name || store.name,
        tax_id: store.organizations?.tax_id || null,
      },
    });
  }
}
