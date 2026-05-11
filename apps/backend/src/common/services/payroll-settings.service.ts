import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { OrganizationPrismaService } from '../../prisma/services/organization-prisma.service';
import { RequestContextService } from '../context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../errors';
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
  ) {}

  async getSettings(
    scope: PayrollSettingsScope,
  ): Promise<PayrollMinimalSettingsResponse> {
    const minimal = await this.readMinimal(scope);
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

    await this.writeMinimal(scope, next);
    return { ...next, is_default: false };
  }

  // ──────────────────────────────────────────────────────────────────
  // Internal: read/write the `payroll.minimal` JSON block per scope.
  // ──────────────────────────────────────────────────────────────────

  private async readMinimal(
    scope: PayrollSettingsScope,
  ): Promise<PayrollMinimalSettings | null> {
    if (scope === 'store') {
      const storeId = RequestContextService.getStoreId();
      if (!storeId) {
        throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
      }
      const row = await this.storePrisma.store_settings.findUnique({
        where: { store_id: storeId },
      });
      const settings = (row?.settings ?? {}) as Record<string, any>;
      return (settings?.payroll?.minimal ?? null) as PayrollMinimalSettings | null;
    }

    const orgRow = await this.orgPrisma.organization_settings.findFirst();
    const orgSettings = (orgRow?.settings ?? {}) as Record<string, any>;
    return (orgSettings?.payroll?.minimal ?? null) as PayrollMinimalSettings | null;
  }

  private async writeMinimal(
    scope: PayrollSettingsScope,
    minimal: PayrollMinimalSettings,
  ): Promise<void> {
    if (scope === 'store') {
      const storeId = RequestContextService.getStoreId();
      if (!storeId) {
        throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
      }
      const existing = await this.storePrisma.store_settings.findUnique({
        where: { store_id: storeId },
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
      await this.storePrisma.store_settings.upsert({
        where: { store_id: storeId },
        create: { store_id: storeId, settings: nextSettings as any },
        update: { settings: nextSettings as any, updated_at: new Date() },
      });
      return;
    }

    const existing = await this.orgPrisma.organization_settings.findFirst();
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
      await this.orgPrisma.organization_settings.update({
        where: { id: existing.id },
        data: { settings: nextSettings as any, updated_at: new Date() },
      });
      return;
    }

    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }
    await this.orgPrisma.organization_settings.create({
      data: {
        organization_id: orgId,
        settings: nextSettings as any,
      },
    });
  }
}
