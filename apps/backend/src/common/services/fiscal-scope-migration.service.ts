import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ErrorCodes,
  FiscalScopeBlockerCode,
  FiscalScopeBlockerCodes,
  VendixHttpException,
} from '../errors';
import {
  FiscalScopeService,
  OrganizationFiscalScope,
} from './fiscal-scope.service';
import { FiscalStatusResolverService } from './fiscal-status-resolver.service';
import type { OrganizationOperatingScope } from './operating-scope.service';

export interface FiscalScopeMigrationPreview {
  organization_id: number;
  current_fiscal_scope: OrganizationFiscalScope;
  target_fiscal_scope: OrganizationFiscalScope;
  current_operating_scope: OrganizationOperatingScope;
  direction: 'NOOP' | 'UP' | 'DOWN';
  can_apply: boolean;
  warnings: string[];
  blockers: Array<{
    code: FiscalScopeBlockerCode;
    message: string;
    details?: any;
  }>;
}

export interface FiscalScopeMigrationResult {
  organization_id: number;
  previous_fiscal_scope: OrganizationFiscalScope;
  new_fiscal_scope: OrganizationFiscalScope;
  audit_log_id: number;
  applied_at: Date;
}

@Injectable()
export class FiscalScopeMigrationService {
  private readonly logger = new Logger(FiscalScopeMigrationService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly audit: AuditService,
    @Optional()
    private readonly eventEmitter?: EventEmitter2,
    @Optional()
    private readonly fiscalStatusResolver?: FiscalStatusResolverService,
  ) {}

  async proposeChange(
    organization_id: number,
    new_scope: OrganizationFiscalScope,
    _userId: number,
    _reason?: string,
  ): Promise<FiscalScopeMigrationPreview> {
    this.assertScopeValue(new_scope);

    const baseClient = this.globalPrisma.withoutScope();
    const organization = await baseClient.organizations.findUnique({
      where: { id: organization_id },
      select: {
        id: true,
        fiscal_scope: true,
        operating_scope: true,
        account_type: true,
      },
    });
    if (!organization) {
      throw new NotFoundException(`Organization ${organization_id} not found`);
    }

    const current_fiscal_scope: OrganizationFiscalScope =
      (organization.fiscal_scope as OrganizationFiscalScope) ??
      ((organization.operating_scope as OrganizationFiscalScope | null) ||
        (organization.account_type === 'MULTI_STORE_ORG'
          ? 'ORGANIZATION'
          : 'STORE'));
    const current_operating_scope: OrganizationOperatingScope =
      (organization.operating_scope as OrganizationOperatingScope) ??
      (organization.account_type === 'MULTI_STORE_ORG'
        ? 'ORGANIZATION'
        : 'STORE');

    const preview: FiscalScopeMigrationPreview = {
      organization_id,
      current_fiscal_scope,
      target_fiscal_scope: new_scope,
      current_operating_scope,
      direction:
        current_fiscal_scope === new_scope
          ? 'NOOP'
          : new_scope === 'ORGANIZATION'
            ? 'UP'
            : 'DOWN',
      can_apply: true,
      warnings: [],
      blockers: [],
    };

    await this.collectCommonBlockers(preview);

    if (preview.direction === 'NOOP') {
      preview.warnings.push('Target fiscal scope equals current scope (no-op).');
      preview.can_apply = preview.blockers.length === 0;
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

  async applyChange(
    organization_id: number,
    new_scope: OrganizationFiscalScope,
    userId: number,
    reason?: string,
    force = false,
  ): Promise<FiscalScopeMigrationResult & { forced: boolean }> {
    this.assertScopeValue(new_scope);
    if (!userId || !Number.isFinite(userId)) {
      throw new BadRequestException('userId is required to apply a fiscal scope change');
    }

    if (force === true && (!reason || reason.trim().length < 10)) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_SCOPE_FORCE_REASON_REQUIRED,
        'Force fiscal scope change requires a reason (minimum 10 characters)',
      );
    }

    const result = await this.globalPrisma.$transaction(async (tx: any) => {
      const lockedRows = (await tx.$queryRawUnsafe(
        `SELECT id,
                fiscal_scope::text AS fiscal_scope,
                operating_scope::text AS operating_scope,
                account_type::text AS account_type
           FROM organizations
          WHERE id = $1
          FOR UPDATE`,
        organization_id,
      )) as Array<{
        id: number;
        fiscal_scope: string;
        operating_scope: string;
        account_type: string;
      }>;
      if (!lockedRows?.length) {
        throw new NotFoundException(`Organization ${organization_id} not found`);
      }

      const locked = lockedRows[0];
      const previous_fiscal_scope: OrganizationFiscalScope =
        (locked.fiscal_scope as OrganizationFiscalScope) ??
        ((locked.operating_scope as OrganizationFiscalScope | null) ||
          (locked.account_type === 'MULTI_STORE_ORG'
            ? 'ORGANIZATION'
            : 'STORE'));
      const current_operating_scope: OrganizationOperatingScope =
        (locked.operating_scope as OrganizationOperatingScope) ??
        (locked.account_type === 'MULTI_STORE_ORG' ? 'ORGANIZATION' : 'STORE');

      if (previous_fiscal_scope === new_scope) {
        return {
          organization_id,
          previous_fiscal_scope,
          new_fiscal_scope: new_scope,
          audit_log_id: 0,
          applied_at: new Date(),
          noop: true,
          forced: false,
          forcedBlockerSnapshot: null as any,
        };
      }

      const inTxPreview: FiscalScopeMigrationPreview = {
        organization_id,
        current_fiscal_scope: previous_fiscal_scope,
        target_fiscal_scope: new_scope,
        current_operating_scope,
        direction: new_scope === 'ORGANIZATION' ? 'UP' : 'DOWN',
        can_apply: true,
        warnings: [],
        blockers: [],
      };

      await this.collectCommonBlockers(inTxPreview);
      if (inTxPreview.direction === 'UP') {
        await this.collectUpBlockers(organization_id, tx, inTxPreview);
      } else {
        await this.collectDownBlockers(organization_id, tx, inTxPreview);
      }

      const invalidCombination = inTxPreview.blockers.some(
        (b) => b.code === FiscalScopeBlockerCodes.INVALID_COMBINATION,
      );
      if (invalidCombination) {
        throw new ConflictException({
          error_code: ErrorCodes.FISCAL_SCOPE_INVALID_COMBINATION.code,
          message: 'Fiscal scope change blocked by invalid scope combination',
          code: ErrorCodes.FISCAL_SCOPE_INVALID_COMBINATION.code,
          blockers: inTxPreview.blockers,
        });
      }

      const hadBlockers = inTxPreview.blockers.length > 0;
      const canForce = inTxPreview.direction === 'DOWN' && force === true;

      if (hadBlockers && !canForce) {
        throw new ConflictException({
          error_code: ErrorCodes.FISCAL_SCOPE_CHANGE_BLOCKED.code,
          message: 'Fiscal scope change blocked by pre-conditions',
          code: ErrorCodes.FISCAL_SCOPE_CHANGE_BLOCKED.code,
          blockers: inTxPreview.blockers,
        });
      }

      const forcedBlockerSnapshot = hadBlockers && canForce
        ? inTxPreview.blockers.map((b) => ({
            code: b.code,
            message: b.message,
            details: b.details ?? null,
          }))
        : null;

      if (inTxPreview.direction === 'UP') {
        await this.applyUpMutations(organization_id, tx);
        await this.fiscalStatusResolver?.consolidateFiscalStatusToOrganization(
          organization_id,
          tx,
        );
      } else {
        await this.applyDownMutations(organization_id, tx);
        await this.fiscalStatusResolver?.splitFiscalStatusToStores(
          organization_id,
          tx,
        );
      }

      await tx.organizations.update({
        where: { id: organization_id },
        data: { fiscal_scope: new_scope as any, updated_at: new Date() },
      });

      const audit = await tx.fiscal_scope_audit_log.create({
        data: {
          organization_id,
          previous_value: previous_fiscal_scope as any,
          new_value: new_scope as any,
          changed_by_user_id: userId,
          reason: reason?.trim() || null,
          blocker_snapshot: forcedBlockerSnapshot as any,
        },
        select: { id: true, changed_at: true },
      });

      return {
        organization_id,
        previous_fiscal_scope,
        new_fiscal_scope: new_scope,
        audit_log_id: audit.id,
        applied_at: audit.changed_at as Date,
        noop: false,
        forced: canForce && hadBlockers,
        forcedBlockerSnapshot,
      };
    });

    this.fiscalScope.invalidateFiscalScopeCache(organization_id);

    if (!result.noop) {
      this.eventEmitter?.emit('organization.fiscal_scope_changed', {
        organization_id,
        previous_fiscal_scope: result.previous_fiscal_scope,
        new_fiscal_scope: result.new_fiscal_scope,
        changed_by_user_id: userId,
        audit_log_id: result.audit_log_id,
        forced: result.forced,
        applied_at: result.applied_at,
      });

      try {
        await this.audit.log({
          userId,
          organizationId: organization_id,
          action: result.forced
            ? 'FISCAL_SCOPE_CHANGE_FORCED'
            : 'FISCAL_SCOPE_CHANGED',
          resource: 'organizations',
          resourceId: organization_id,
          oldValues: { fiscal_scope: result.previous_fiscal_scope },
          newValues: { fiscal_scope: result.new_fiscal_scope },
          metadata: {
            audit_log_id: result.audit_log_id,
            reason: reason ?? null,
            forced: result.forced,
            overridden_blockers: result.forcedBlockerSnapshot ?? undefined,
          },
        });
      } catch (err: any) {
        this.logger.warn(
          `fiscal_scope audit_logs entry failed for org=${organization_id}: ${err?.message ?? err}`,
        );
      }
    }

    this.logger.log(
      result.noop
        ? `fiscal_scope unchanged for org=${organization_id} (noop ${new_scope})`
        : `fiscal_scope migrated org=${organization_id} ${result.previous_fiscal_scope} -> ${result.new_fiscal_scope} by user=${userId}`,
    );

    return {
      organization_id: result.organization_id,
      previous_fiscal_scope: result.previous_fiscal_scope,
      new_fiscal_scope: result.new_fiscal_scope,
      audit_log_id: result.audit_log_id,
      applied_at: result.applied_at,
      forced: result.forced,
    };
  }

  async getRecentAuditLog(organization_id: number, take = 10) {
    const baseClient = this.globalPrisma.withoutScope() as any;
    return baseClient.fiscal_scope_audit_log.findMany({
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
        blocker_snapshot: true,
      },
    });
  }

  private async collectCommonBlockers(preview: FiscalScopeMigrationPreview) {
    if (
      preview.current_operating_scope === 'STORE' &&
      preview.target_fiscal_scope === 'ORGANIZATION'
    ) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.INVALID_COMBINATION,
        message:
          'No se permite fiscal_scope=ORGANIZATION cuando operating_scope=STORE. Cambia primero el modo operativo a ORGANIZATION.',
        details: {
          operating_scope: preview.current_operating_scope,
          target_fiscal_scope: preview.target_fiscal_scope,
          remediation_link: '/admin/settings/operating-scope',
        },
      });
    }
  }

  private async collectUpBlockers(
    organization_id: number,
    client: any,
    preview: FiscalScopeMigrationPreview,
  ) {
    const dianConfigCount = await client.dian_configurations.count({
      where: { organization_id, configuration_type: 'invoicing' },
    });
    if (dianConfigCount > 1) {
      preview.warnings.push(
        `${dianConfigCount} configuraciones DIAN de facturación existen en la organización; al consolidar fiscalmente se usará la entidad fiscal consolidada.`,
      );
    }

    await this.collectPendingPayrollBlockers(organization_id, client, preview);
    await this.collectPendingWithholdingBlockers(organization_id, client, preview);
  }

  private async collectDownBlockers(
    organization_id: number,
    client: any,
    preview: FiscalScopeMigrationPreview,
  ) {
    const pendingInvoices = await client.invoices.count({
      where: {
        organization_id,
        send_status: { in: ['pending', 'sending', 'sent_error'] },
      },
    });
    if (pendingInvoices > 0) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.PENDING_INVOICES,
        message: `${pendingInvoices} facturas tienen envío DIAN pendiente o fallido.`,
        details: { count: pendingInvoices, remediation_link: '/admin/invoicing' },
      });
    }

    const pendingDianResponses = await client.invoices.count({
      where: {
        organization_id,
        send_status: 'sent_ok',
        accepted_at: null,
      },
    });
    if (pendingDianResponses > 0) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.PENDING_DIAN_RESPONSE,
        message: `${pendingDianResponses} facturas enviadas no tienen aceptación DIAN registrada.`,
        details: {
          count: pendingDianResponses,
          remediation_link: '/admin/invoicing',
        },
      });
    }

    const openPeriods = await client.fiscal_periods.count({
      where: {
        organization_id,
        status: { in: ['open', 'closing'] },
        accounting_entity: { store_id: null },
      },
    });
    if (openPeriods > 0) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.OPEN_PERIODS,
        message: `${openPeriods} periodos fiscales consolidados están abiertos o en cierre.`,
        details: {
          count: openPeriods,
          remediation_link: '/admin/accounting/fiscal-periods',
        },
      });
    }

    const activeStores = await client.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true, name: true, tax_id: true },
    });

    if (activeStores.length === 0) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.NO_ACTIVE_STORES,
        message: 'No hay tiendas activas para separar fiscalmente.',
      });
      return;
    }

    const configs = await client.dian_configurations.findMany({
      where: {
        organization_id,
        configuration_type: 'invoicing',
        store_id: { in: activeStores.map((s: any) => s.id) },
      },
      select: { store_id: true },
    });
    const configStoreIds = new Set(configs.map((c: any) => c.store_id));
    const missingDianStores = activeStores.filter(
      (store: any) => !configStoreIds.has(store.id),
    );
    if (missingDianStores.length > 0) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.MISSING_DIAN_CONFIG,
        message: `${missingDianStores.length} tiendas activas no tienen configuración DIAN de facturación.`,
        details: {
          count: missingDianStores.length,
          store_ids: missingDianStores.map((s: any) => s.id),
          remediation_link: '/admin/invoicing/dian-config',
        },
      });
    }

    const missingTaxStores = activeStores.filter(
      (store: any) => !String(store.tax_id ?? '').trim(),
    );
    if (missingTaxStores.length > 0) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.MISSING_TAX_ID,
        message: `${missingTaxStores.length} tiendas activas no tienen tax_id/NIT propio.`,
        details: {
          count: missingTaxStores.length,
          store_ids: missingTaxStores.map((s: any) => s.id),
          remediation_link: '/admin/settings/fiscal-activation',
        },
      });
    }

    const openConsolidations = await client.consolidation_sessions.count({
      where: {
        organization_id,
        status: { in: ['draft', 'in_progress'] },
      },
    });
    const openIntercompany = await client.intercompany_transactions.count({
      where: {
        organization_id,
        OR: [{ status: 'open' }, { eliminated: false }],
      },
    });
    if (openConsolidations > 0 || openIntercompany > 0) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.OPEN_INTERCOMPANY,
        message:
          'Hay sesiones de consolidación o transacciones intercompany abiertas antes del cambio fiscal.',
        details: {
          open_consolidation_sessions: openConsolidations,
          open_intercompany_transactions: openIntercompany,
          remediation_link: '/admin/accounting/consolidation',
        },
      });
    }

    await this.collectPendingPayrollBlockers(organization_id, client, preview);
    await this.collectPendingWithholdingBlockers(organization_id, client, preview);
  }

  private async applyUpMutations(organization_id: number, tx: any) {
    await this.fiscalScope.ensureOrganizationFiscalAccountingEntity(
      organization_id,
      tx,
    );
  }

  private async applyDownMutations(organization_id: number, tx: any) {
    const stores = await tx.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true, name: true, legal_name: true, tax_id: true },
    });
    const storeIds = stores.map((store: any) => store.id);

    if (storeIds.length === 0) return;

    const existingEntities = await tx.accounting_entities.findMany({
      where: {
        organization_id,
        scope: 'STORE',
        fiscal_scope: 'STORE',
        store_id: { in: storeIds },
        is_active: true,
      },
      select: { id: true, store_id: true },
    });
    const entityStoreIds = new Set(
      existingEntities.map((entity: any) => entity.store_id),
    );
    const missingStores = stores.filter(
      (store: any) => !entityStoreIds.has(store.id),
    );

    if (missingStores.length > 0) {
      await tx.accounting_entities.createMany({
        data: missingStores.map((store: any) => ({
          organization_id,
          store_id: store.id,
          scope: 'STORE',
          fiscal_scope: 'STORE',
          name: store.name,
          legal_name: store.legal_name || store.name,
          tax_id: store.tax_id || null,
        })),
        skipDuplicates: true,
      });
    }
  }

  private async collectPendingPayrollBlockers(
    organization_id: number,
    client: any,
    preview: FiscalScopeMigrationPreview,
  ) {
    const pendingPayrollRuns = await client.payroll_runs.count({
      where: {
        organization_id,
        status: { notIn: ['paid', 'cancelled'] },
      },
    });
    if (pendingPayrollRuns > 0) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.PENDING_PAYROLL_RUNS,
        message: `${pendingPayrollRuns} corridas de nómina están pendientes de cierre o pago.`,
        details: {
          count: pendingPayrollRuns,
          remediation_link: '/admin/payroll/runs',
        },
      });
    }

    const pendingPayrollSettlements = await client.payroll_settlements.count({
      where: {
        organization_id,
        status: { notIn: ['paid', 'cancelled'] },
      },
    });
    if (pendingPayrollSettlements > 0) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.PENDING_PAYROLL_SETTLEMENTS,
        message: `${pendingPayrollSettlements} liquidaciones de nómina están pendientes de cierre o pago.`,
        details: {
          count: pendingPayrollSettlements,
          remediation_link: '/admin/payroll/settlements',
        },
      });
    }
  }

  private async collectPendingWithholdingBlockers(
    organization_id: number,
    client: any,
    preview: FiscalScopeMigrationPreview,
  ) {
    const rows = await client.$queryRawUnsafe(
      `
        SELECT COUNT(*)::int AS count
        FROM withholding_calculations wc
        WHERE wc.organization_id = $1
          AND (
            wc.accounting_entity_id IS NULL
            OR wc.invoice_id IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM accounting_entries ae
              WHERE ae.organization_id = wc.organization_id
                AND ae.source_type = 'withholding.applied'
                AND ae.source_id = wc.invoice_id
            )
          )
      `,
      organization_id,
    );
    const pendingWithholdings = Number(rows?.[0]?.count ?? 0);

    if (pendingWithholdings > 0) {
      preview.blockers.push({
        code: FiscalScopeBlockerCodes.PENDING_WITHHOLDINGS,
        message: `${pendingWithholdings} cálculos de retención están pendientes de aplicar contablemente.`,
        details: {
          count: pendingWithholdings,
          remediation_link: '/admin/accounting/withholding-tax',
        },
      });
    }
  }

  private assertScopeValue(scope: OrganizationFiscalScope) {
    if (scope !== 'STORE' && scope !== 'ORGANIZATION') {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_SCOPE_INVALID_VALUE,
        `fiscal_scope must be 'STORE' or 'ORGANIZATION' (received: ${scope})`,
      );
    }
  }
}
