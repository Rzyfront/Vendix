import { BadRequestException, Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { OrganizationPrismaService } from '../../prisma/services/organization-prisma.service';
import { RequestContextService } from '../context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../errors';
import {
  FiscalScopeService,
  OrganizationFiscalScope,
} from './fiscal-scope.service';
import {
  PayrollMinimalSettings,
  PayrollMinimalSettingsResponse,
  UpdatePayrollSettingsDto,
} from '../dto/payroll-settings.dto';

export type PayrollSettingsScope = 'store' | 'organization';

/**
 * Razonable default for tenants that haven't gone through the wizard
 * yet. Matches Colombian SMB norm: monthly pay, full parafiscales on,
 * withholding enabled, no PILA operator picked yet.
 */
const DEFAULT_MINIMAL_SETTINGS: PayrollMinimalSettings = {
  payment_frequency: 'MENSUAL',
  withholding_enabled: true,
  parafiscales: {
    sena: true,
    icbf: true,
    caja_compensacion: true,
    eps: true,
    arl: true,
    pension: true,
  },
};

/**
 * Cross-scope service for the "minimal" payroll configuration block
 * (period + parafiscales + PILA operator). Persists under
 * `{store_settings|organization_settings}.settings.payroll.minimal`.
 *
 * The per-year rule matrix (rates, ARL levels, severance) is owned by
 * `PayrollRulesService` and lives under `payroll.rules[YYYY]` — this
 * service intentionally does NOT touch that block.
 */
@Injectable()
export class PayrollSettingsService {
  constructor(
    private readonly storePrisma: StorePrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  async getSettings(
    scope: PayrollSettingsScope,
    store_id?: number,
  ): Promise<PayrollMinimalSettingsResponse> {
    const minimal = await this.readMinimal(scope, store_id);
    if (!minimal) {
      return { ...DEFAULT_MINIMAL_SETTINGS, is_default: true };
    }
    return {
      ...DEFAULT_MINIMAL_SETTINGS,
      ...minimal,
      parafiscales: {
        ...DEFAULT_MINIMAL_SETTINGS.parafiscales,
        ...(minimal.parafiscales ?? {}),
      },
      is_default: false,
    };
  }

  async updateSettings(
    scope: PayrollSettingsScope,
    dto: UpdatePayrollSettingsDto,
    store_id?: number,
  ): Promise<PayrollMinimalSettingsResponse> {
    const next: PayrollMinimalSettings = {
      payment_frequency: dto.payment_frequency as PayrollMinimalSettings['payment_frequency'],
      withholding_enabled: dto.withholding_enabled,
      parafiscales: {
        sena: dto.parafiscales.sena,
        icbf: dto.parafiscales.icbf,
        caja_compensacion: dto.parafiscales.caja_compensacion,
        eps: dto.parafiscales.eps,
        arl: dto.parafiscales.arl,
        pension: dto.parafiscales.pension,
      },
      ...(dto.pila_operator ? { pila_operator: dto.pila_operator } : {}),
    };

    await this.writeMinimal(scope, next, store_id ?? dto.store_id);
    return { ...next, is_default: false };
  }

  // ──────────────────────────────────────────────────────────────────
  // Internal: read/write the `payroll.minimal` JSON block per scope.
  // ──────────────────────────────────────────────────────────────────

  private async readMinimal(
    scope: PayrollSettingsScope,
    store_id?: number,
  ): Promise<PayrollMinimalSettings | null> {
    if (scope === 'store') {
      const target = await this.resolveStoreTarget(store_id);
      if (target.fiscal_scope === 'ORGANIZATION') {
        return this.readOrgMinimal(target.organization_id);
      }
      return this.readStoreMinimal(target.store_id);
    }

    if (store_id) {
      return this.readMinimal('store', store_id);
    }

    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }
    return this.readOrgMinimal(orgId);
  }

  private async writeMinimal(
    scope: PayrollSettingsScope,
    minimal: PayrollMinimalSettings,
    store_id?: number,
  ): Promise<void> {
    if (scope === 'store') {
      const target = await this.resolveStoreTarget(store_id);
      if (target.fiscal_scope === 'ORGANIZATION') {
        throw new BadRequestException(
          'Payroll settings are managed at organization level for this organization.',
        );
      }
      const existing = await this.storePrisma.withoutScope().store_settings.findUnique({
        where: { store_id: target.store_id },
      });
      const currentSettings = (existing?.settings ?? {}) as Record<string, any>;
      const currentPayroll = (currentSettings.payroll ?? {}) as Record<string, any>;
      const nextSettings = {
        ...currentSettings,
        payroll: {
          ...currentPayroll,
          minimal,
        },
      };
      await this.storePrisma.withoutScope().store_settings.upsert({
        where: { store_id: target.store_id },
        create: { store_id: target.store_id, settings: nextSettings as any },
        update: { settings: nextSettings as any, updated_at: new Date() },
      });
      return;
    }

    if (store_id) {
      return this.writeMinimal('store', minimal, store_id);
    }

    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const existing =
      await this.orgPrisma.withoutScope().organization_settings.findFirst({
        where: { organization_id: orgId },
      });
    const currentSettings = (existing?.settings ?? {}) as Record<string, any>;
    const currentPayroll = (currentSettings.payroll ?? {}) as Record<string, any>;
    const nextSettings = {
      ...currentSettings,
      payroll: {
        ...currentPayroll,
        minimal,
      },
    };

    if (existing) {
      await this.orgPrisma.withoutScope().organization_settings.update({
        where: { id: existing.id },
        data: { settings: nextSettings as any, updated_at: new Date() },
      });
      return;
    }

    await this.orgPrisma.withoutScope().organization_settings.create({
      data: {
        organization_id: orgId,
        settings: nextSettings as any,
      },
    });
  }

  private async readStoreMinimal(
    store_id: number,
  ): Promise<PayrollMinimalSettings | null> {
    const row = await this.storePrisma.withoutScope().store_settings.findUnique({
      where: { store_id },
    });
    const settings = (row?.settings ?? {}) as Record<string, any>;
    return (settings?.payroll?.minimal ?? null) as PayrollMinimalSettings | null;
  }

  private async readOrgMinimal(
    organization_id: number,
  ): Promise<PayrollMinimalSettings | null> {
    const orgRow =
      await this.orgPrisma.withoutScope().organization_settings.findFirst({
        where: { organization_id },
      });
    const orgSettings = (orgRow?.settings ?? {}) as Record<string, any>;
    return (orgSettings?.payroll?.minimal ??
      null) as PayrollMinimalSettings | null;
  }

  private async resolveStoreTarget(store_id?: number): Promise<{
    organization_id: number;
    store_id: number;
    fiscal_scope: OrganizationFiscalScope;
  }> {
    const context = RequestContextService.getContext();
    const requestedStoreId = store_id ?? context?.store_id ?? null;
    let organization_id = context?.organization_id;
    let resolvedStoreId = requestedStoreId ?? undefined;

    if (resolvedStoreId) {
      const store = await this.storePrisma.withoutScope().stores.findFirst({
        where: {
          id: resolvedStoreId,
          ...(organization_id ? { organization_id } : {}),
          is_active: true,
        },
        select: { id: true, organization_id: true },
      });
      if (!store) {
        throw new BadRequestException(
          'Store does not belong to the current organization',
        );
      }
      resolvedStoreId = store.id;
      organization_id = store.organization_id;
    }

    if (!organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const fiscal_scope =
      await this.fiscalScope.requireFiscalScope(organization_id);

    if (!resolvedStoreId) {
      const stores = await this.storePrisma.withoutScope().stores.findMany({
        where: { organization_id, is_active: true },
        select: { id: true },
        take: 2,
      });
      if (stores.length === 1) {
        resolvedStoreId = stores[0].id;
      } else {
        throw new BadRequestException(
          'store_id is required when fiscal_scope is STORE',
        );
      }
    }

    return { organization_id, store_id: resolvedStoreId, fiscal_scope };
  }
}
