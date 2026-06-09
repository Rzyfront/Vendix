import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { WithholdingResolverService } from './withholding-resolver.service';
import { WithholdingCalculatorService } from './withholding-calculator.service';
import { deriveCounterpartyType } from './withholding-classification.util';
import type { TenantFiscalProfile } from './withholding-resolver.service';
import { WithholdingLine } from 'src/common/interfaces/withholding-breakdown.interface';

/**
 * Shape returned by both resolve* methods so the FLOW layer (invoice-flow /
 * payments) gets everything it needs to persist + emit the accounting event in
 * one pass: the resolved lines, the UVT used (for the calculation record), and
 * the derived counterparty type (for the calculation record / reporting).
 */
export interface WithholdingResolution {
  lines: WithholdingLine[];
  uvt_value_used: number;
  counterparty_type: string | null;
}

/**
 * Persisted-context for a batch of withholding lines. `supplier_id` is only
 * written for role='practiced' (Caso 1, we withhold a supplier); `customer_id`
 * is only written for role='suffered' (Caso 2, a customer withholds us).
 */
export interface PersistWithholdingContext {
  organization_id: number;
  store_id?: number | null;
  accounting_entity_id?: number | null;
  invoice_id?: number | null;
  supplier_id?: number | null;
  customer_id?: number | null;
  role: 'practiced' | 'suffered';
  counterparty_type?: string | null;
  uvt_value_used: number;
  year?: number;
  lines: WithholdingLine[];
}

/**
 * FLOW-layer orchestrator for Colombian withholdings (Block C).
 *
 * The deterministic legal core lives in {@link WithholdingResolverService}; this
 * service is the thin shared adapter the invoice/payment flow consumes to:
 *   1. assemble the fiscal profiles (tenant + counterparty),
 *   2. delegate resolution to the resolver,
 *   3. persist the resulting `withholding_calculations` rows.
 *
 * Zero-regression contract: when the tenant is NOT a withholding agent (default
 * `is_withholding_agent=false`) or there is no counterparty, every resolve*
 * method returns `lines: []` and never throws — the sale/purchase flow proceeds
 * unchanged. A missing UVT for the year is swallowed (lines:[], uvt 0) for the
 * same reason: withholding is an add-on, never a blocker.
 */
@Injectable()
export class WithholdingFlowService {
  private readonly logger = new Logger(WithholdingFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly resolver: WithholdingResolverService,
    private readonly calculator: WithholdingCalculatorService,
  ) {}

  /**
   * Reads the tenant fiscal snapshot (withholding role flags + tax_regime) for a
   * given organization/store.
   *
   * Implementation note: we deliberately do NOT call
   * `SettingsService.getFiscalData()` here. That method reads the request's
   * AsyncLocalStorage context (no parameters) and throws `STORE_CONTEXT_001`
   * when no `store_id` is present — which would break the zero-regression
   * contract for purchase/POP flows that legitimately run org-scoped. There is
   * also no module cycle to avoid (SettingsModule does not import
   * withholding-tax), so the choice is driven by the parameterized,
   * never-throw requirement rather than by a circular dependency.
   *
   * Instead we read the `fiscal_data` JSON directly via the scoped Prisma
   * service for the *passed* organization/store, honoring fiscal scope:
   *   - fiscal_scope=ORGANIZATION → read `organization_settings`.
   *   - fiscal_scope=STORE        → read `store_settings` (falling back to the
   *     organization's fiscal_data when the store has not captured its own).
   * Any failure degrades gracefully to an empty (non-agent) profile.
   */
  private async getTenantFiscalProfile(
    organization_id: number,
    store_id?: number | null,
  ): Promise<TenantFiscalProfile> {
    const empty: TenantFiscalProfile = {
      is_withholding_agent: false,
      is_self_withholder: false,
      tax_regime: null,
    };

    try {
      let fiscalScope: string | null = null;
      try {
        fiscalScope = await this.fiscalScope.requireFiscalScope(organization_id);
      } catch {
        // Org not resolvable / no fiscal scope → treat as STORE-style read.
        fiscalScope = null;
      }

      // Org-consolidated identity lives on organization_settings.
      if (fiscalScope === 'ORGANIZATION' || !store_id) {
        const orgFiscal = await this.readOrgFiscalData(organization_id);
        if (orgFiscal) return this.mapTenantProfile(orgFiscal);
        // No store_id and no org fiscal_data → empty profile.
        if (!store_id) return empty;
      }

      // Store-level identity lives on store_settings; fall back to org-level
      // fiscal_data when the store has not captured its own flags.
      const storeFiscal = await this.readStoreFiscalData(store_id!);
      if (storeFiscal && this.hasWithholdingFlags(storeFiscal)) {
        return this.mapTenantProfile(storeFiscal);
      }

      const orgFiscal = await this.readOrgFiscalData(organization_id);
      if (orgFiscal) return this.mapTenantProfile(orgFiscal);

      return storeFiscal ? this.mapTenantProfile(storeFiscal) : empty;
    } catch (error) {
      this.logger.warn(
        `getTenantFiscalProfile failed (org=${organization_id}, store=${store_id ?? 'null'}); defaulting to non-agent: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return empty;
    }
  }

  /** True when the fiscal_data carries at least one withholding role flag. */
  private hasWithholdingFlags(fiscal: Record<string, unknown>): boolean {
    return (
      fiscal.is_withholding_agent !== undefined ||
      fiscal.is_self_withholder !== undefined
    );
  }

  /** Maps a raw `fiscal_data` JSON blob to the resolver tenant profile shape. */
  private mapTenantProfile(
    fiscal: Record<string, unknown>,
  ): TenantFiscalProfile {
    return {
      is_withholding_agent: fiscal.is_withholding_agent === true,
      is_self_withholder: fiscal.is_self_withholder === true,
      tax_regime:
        typeof fiscal.tax_regime === 'string' ? fiscal.tax_regime : null,
    };
  }

  /** Scope-safe read of `store_settings.settings.fiscal_data`. */
  private async readStoreFiscalData(
    store_id: number,
  ): Promise<Record<string, unknown> | null> {
    // findFirst (not findUnique) so the scoped extension can merge the store_id
    // tenant filter without producing an invalid `{ AND: [...] }` WhereUnique.
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    return this.extractFiscalData(row?.settings);
  }

  /** Scope-safe read of `organization_settings.settings.fiscal_data`. */
  private async readOrgFiscalData(
    organization_id: number,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.organization_settings.findFirst({
      where: { organization_id },
      select: { settings: true },
    });
    return this.extractFiscalData(row?.settings);
  }

  /** Pulls the `fiscal_data` object out of a settings JSON column. */
  private extractFiscalData(
    settings: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> | null {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return null;
    }
    const fiscal = (settings as Record<string, unknown>).fiscal_data;
    if (!fiscal || typeof fiscal !== 'object' || Array.isArray(fiscal)) {
      return null;
    }
    return fiscal as Record<string, unknown>;
  }

  /** Resolves the UVT for the year, swallowing WHT_UVT_NOT_FOUND → 0. */
  private async safeUvtValue(
    organization_id: number,
    year: number,
  ): Promise<number> {
    try {
      return await this.calculator.getUvtValue(organization_id, year);
    } catch {
      // No UVT configured for the year → withholding cannot be computed, but the
      // flow must not break. Resolver lines already came back []; uvt 0 is fine.
      return 0;
    }
  }

  /**
   * CASO 1 — practiced. The tenant buys from a supplier and may withhold them.
   * Resolves the applicable withholding lines (liabilities, 2365/2367/2368).
   *
   * Returns `lines: []` when there is no supplier (no counterparty → nothing to
   * withhold) or the supplier cannot be found.
   */
  async resolvePracticed(params: {
    organization_id: number;
    store_id?: number | null;
    supplier_id?: number | null;
    base: number;
    ivaAmount?: number;
    appliesTo?: string | string[];
    year?: number;
  }): Promise<WithholdingResolution> {
    const year = params.year ?? new Date().getFullYear();

    if (!params.supplier_id) {
      // No counterparty → we never withhold.
      return { lines: [], uvt_value_used: 0, counterparty_type: null };
    }

    // Scoped read; explicit organization_id keeps the query tenant-safe even if
    // the scope context is not fully populated.
    const supplier = await this.prisma.suppliers.findFirst({
      where: { id: params.supplier_id, organization_id: params.organization_id },
      select: {
        tax_regime: true,
        person_type: true,
        is_self_withholder: true,
      },
    });

    if (!supplier) {
      return { lines: [], uvt_value_used: 0, counterparty_type: null };
    }

    const tenant = await this.getTenantFiscalProfile(
      params.organization_id,
      params.store_id ?? null,
    );

    const counterparty_type = deriveCounterpartyType(
      supplier.tax_regime,
      supplier.person_type,
    );

    const lines = await this.resolver.resolve({
      role: 'practiced',
      organization_id: params.organization_id,
      base: params.base,
      ivaAmount: params.ivaAmount,
      year,
      appliesTo: params.appliesTo,
      tenant,
      supplier: {
        tax_regime: supplier.tax_regime,
        person_type: supplier.person_type,
        is_self_withholder: supplier.is_self_withholder,
      },
    });

    const uvt_value_used = await this.safeUvtValue(params.organization_id, year);

    return { lines, uvt_value_used, counterparty_type };
  }

  /**
   * CASO 2 — suffered. The tenant sells to a customer who, if a withholding
   * agent, withholds the tenant. Resolves the applicable withholding lines
   * (assets, 1355xx).
   *
   * Returns `lines: []` when there is no customer (counter-anonymous B2C sale →
   * never suffered) or the customer cannot be found.
   */
  async resolveSuffered(params: {
    organization_id: number;
    store_id?: number | null;
    customer_id?: number | null;
    base: number;
    ivaAmount?: number;
    appliesTo?: string | string[];
    year?: number;
  }): Promise<WithholdingResolution> {
    const year = params.year ?? new Date().getFullYear();

    if (!params.customer_id) {
      // Anonymous / counter B2C sale → a customer can never withhold us.
      return { lines: [], uvt_value_used: 0, counterparty_type: null };
    }

    // `users` getter returns the unscoped base client, so filter explicitly by
    // organization to keep the lookup tenant-safe.
    const customer = await this.prisma.users.findFirst({
      where: { id: params.customer_id, organization_id: params.organization_id },
      select: {
        is_withholding_agent: true,
        tax_regime: true,
        person_type: true,
      },
    });

    if (!customer) {
      return { lines: [], uvt_value_used: 0, counterparty_type: null };
    }

    const tenant = await this.getTenantFiscalProfile(
      params.organization_id,
      params.store_id ?? null,
    );

    const counterparty_type = deriveCounterpartyType(
      customer.tax_regime,
      customer.person_type,
    );

    const lines = await this.resolver.resolve({
      role: 'suffered',
      organization_id: params.organization_id,
      base: params.base,
      ivaAmount: params.ivaAmount,
      year,
      appliesTo: params.appliesTo,
      tenant,
      customer: {
        is_withholding_agent: customer.is_withholding_agent,
        tax_regime: customer.tax_regime,
        person_type: customer.person_type,
      },
    });

    const uvt_value_used = await this.safeUvtValue(params.organization_id, year);

    return { lines, uvt_value_used, counterparty_type };
  }

  /**
   * Persists one `withholding_calculations` row per resolved line that carries a
   * `concept_id` and a positive `amount`. Lines without a `concept_id` (pure
   * `evaluate()` outputs) or with a zero amount are skipped — they cannot be
   * persisted (FK to `withholding_concepts`) and carry no fiscal value.
   *
   * `supplier_id` is only written for role='practiced'; `customer_id` only for
   * role='suffered'. Idempotency is the caller's responsibility (called once per
   * operation).
   */
  async persistWithholdingLines(ctx: PersistWithholdingContext): Promise<void> {
    const year = ctx.year ?? new Date().getFullYear();

    const rows = ctx.lines
      .filter(
        (line): line is WithholdingLine & { concept_id: number } =>
          typeof line.concept_id === 'number' && line.amount > 0,
      )
      .map((line) => ({
        organization_id: ctx.organization_id,
        store_id: ctx.store_id ?? null,
        accounting_entity_id: ctx.accounting_entity_id ?? null,
        invoice_id: ctx.invoice_id ?? null,
        supplier_id: ctx.role === 'practiced' ? (ctx.supplier_id ?? null) : null,
        customer_id: ctx.role === 'suffered' ? (ctx.customer_id ?? null) : null,
        concept_id: line.concept_id,
        role: ctx.role,
        counterparty_type: ctx.counterparty_type ?? null,
        withholding_type: line.withholding_type,
        base_amount: new Prisma.Decimal(line.base),
        withholding_rate: new Prisma.Decimal(line.rate),
        withholding_amount: new Prisma.Decimal(line.amount),
        uvt_value_used: new Prisma.Decimal(ctx.uvt_value_used),
        year,
      }));

    if (rows.length === 0) {
      return;
    }

    await this.prisma.withholding_calculations.createMany({ data: rows });
  }
}
