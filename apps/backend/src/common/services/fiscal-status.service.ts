import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { ErrorCodes, VendixHttpException } from '../errors';
import {
  FiscalArea,
  FiscalDetectorSignals,
  FiscalStatusBlock,
  FiscalStatusReadResult,
  FiscalStatusSource,
  FiscalStatusState,
  FiscalWizardPrefill,
  FiscalWizardStepId,
  isFiscalArea,
  isFiscalWizardStep,
  normalizeFiscalStatusBlock,
} from '../interfaces/fiscal-status.interface';
import { FiscalStatusResolverService } from './fiscal-status-resolver.service';
import {
  buildFiscalWizardSequence,
  FISCAL_STATUS_STEP_ORDER,
  REQUIRED_STEPS_BY_FISCAL_AREA,
} from './fiscal-status.wizard-config';

/**
 * Wizard steps that are not data-backed (UI-only gates), excluded when
 * verifying real-data completeness for an area.
 */
const NON_DATA_STEPS: ReadonlySet<FiscalWizardStepId> = new Set<
  FiscalWizardStepId
>(['validation', 'area_selection']);

const FISCAL_AREAS: FiscalArea[] = ['invoicing', 'accounting', 'payroll'];

@Injectable()
export class FiscalStatusService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly resolver: FiscalStatusResolverService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async read(
    organization_id: number,
    store_id?: number | null,
  ): Promise<FiscalStatusReadResult> {
    const client = this.globalPrisma.withoutScope();
    const organization = await client.organizations.findUnique({
      where: { id: organization_id },
      select: { fiscal_scope: true },
    });

    if ((organization?.fiscal_scope ?? 'STORE') === 'STORE' && !store_id) {
      const stores = await client.stores.findMany({
        where: { organization_id, is_active: true },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      });
      const store_statuses: FiscalStatusReadResult['store_statuses'] = [];
      for (const store of stores) {
        const status = await this.resolver.getStatusBlock(
          organization_id,
          store.id,
        );
        store_statuses.push({
          store_id: store.id,
          store_name: store.name,
          fiscal_status: status.fiscal_status,
        });
      }
      return {
        organization_id,
        store_id: null,
        fiscal_scope: 'STORE',
        fiscal_status: normalizeFiscalStatusBlock(null),
        store_statuses,
      };
    }

    const resolved = await this.resolver.getStatusBlock(
      organization_id,
      store_id,
    );

    return {
      organization_id,
      store_id: resolved.store_id,
      fiscal_scope: resolved.fiscal_scope,
      fiscal_status: resolved.fiscal_status,
    };
  }

  /**
   * Reads the invoicing fiscal state for a single store directly from
   * `store_settings.settings.fiscal_status.invoicing.state`.
   *
   * Intended for lightweight public/guest paths (ecommerce checkout eligibility)
   * where only `store_id` is known and resolving the organization scope is not
   * required. Bypasses the resolver cache and does not require organization_id.
   *
   * Returns `INACTIVE` when no settings row exists yet.
   */
  async getStoreInvoicingState(
    store_id: number,
  ): Promise<FiscalStatusState> {
    const client = this.globalPrisma.withoutScope();
    const row = await client.store_settings.findUnique({
      where: { store_id },
      select: { settings: true },
    });
    const raw = (row?.settings as any) || {};
    const block = normalizeFiscalStatusBlock(raw.fiscal_status);
    return block.invoicing.state;
  }

  /**
   * Aggregates, in a single read-only pass, all tenant data that the fiscal
   * activation wizard would otherwise ask the user to re-enter. Every source is
   * read defensively: a missing/unresolvable source yields `null` for that
   * field (and the corresponding step is omitted from `satisfied_steps`) so the
   * endpoint tolerates half-configured tenants.
   *
   * Reads are performed directly via the unscoped global client with explicit
   * `organization_id`/`store_id` filters (the same pattern used by
   * {@link checkIrreversibility}) to avoid cross-module coupling and circular
   * dependencies with the scoped domain services.
   */
  async buildWizardPrefill(params: {
    organization_id: number;
    store_id?: number | null;
    selected_areas?: FiscalArea[];
  }): Promise<FiscalWizardPrefill> {
    const client = this.globalPrisma.withoutScope();

    // Resolve scope (fiscal_scope decides whether data is org- or store-bound).
    const resolved = await this.resolver.getStatusBlock(
      params.organization_id,
      params.store_id,
    );
    const organization_id = params.organization_id;
    const store_id = resolved.store_id;
    const fiscal_scope = resolved.fiscal_scope;

    const sources = await this.readWizardSources(
      client,
      organization_id,
      store_id,
      fiscal_scope,
    );
    const satisfied = this.deriveSatisfiedSteps(sources);

    return {
      organization_id,
      store_id,
      fiscal_scope,
      legal_data: sources.legal_data,
      dian_config: sources.dian_config,
      puc: sources.puc,
      accounting_period: sources.accounting_period,
      default_taxes: sources.default_taxes,
      accounting_mappings: sources.accounting_mappings,
      initial_inventory: sources.initial_inventory,
      payroll_config: sources.payroll_config,
      satisfied_steps: FISCAL_STATUS_STEP_ORDER.filter((step) =>
        satisfied.has(step),
      ),
    };
  }

  /**
   * Reads every wizard data source in one read-only pass. Each source is read
   * defensively (a missing/unresolvable source yields `null`), mirroring the
   * tolerance documented on {@link buildWizardPrefill}.
   */
  private async readWizardSources(
    client: any,
    organization_id: number,
    store_id: number | null,
    fiscal_scope: 'STORE' | 'ORGANIZATION',
  ): Promise<{
    legal_data: FiscalWizardPrefill['legal_data'];
    dian_config: FiscalWizardPrefill['dian_config'];
    puc: FiscalWizardPrefill['puc'];
    accounting_period: FiscalWizardPrefill['accounting_period'];
    default_taxes: FiscalWizardPrefill['default_taxes'];
    accounting_mappings: FiscalWizardPrefill['accounting_mappings'];
    initial_inventory: FiscalWizardPrefill['initial_inventory'];
    payroll_config: FiscalWizardPrefill['payroll_config'];
  }> {
    const legal_data = await this.readLegalData(
      client,
      organization_id,
      store_id,
      fiscal_scope,
    );
    const dian_config = await this.readDianConfig(
      client,
      organization_id,
      store_id,
    );
    const puc = await this.readPuc(client, organization_id);
    const accounting_period = await this.readAccountingPeriod(
      client,
      organization_id,
    );
    const default_taxes = await this.readDefaultTaxes(
      client,
      organization_id,
      store_id,
    );
    const accounting_mappings = await this.readAccountingMappings(
      client,
      organization_id,
      store_id,
    );
    const initial_inventory = await this.readInitialInventory(
      client,
      organization_id,
      store_id,
      fiscal_scope,
    );
    const payroll_config = await this.readPayrollConfig(
      client,
      organization_id,
      store_id,
      fiscal_scope,
    );

    return {
      legal_data,
      dian_config,
      puc,
      accounting_period,
      default_taxes,
      accounting_mappings,
      initial_inventory,
      payroll_config,
    };
  }

  /**
   * Pure rule that decides which wizard steps count as *satisfied* (i.e. have
   * real, complete backing data — not merely present). Single source of truth
   * for both {@link buildWizardPrefill} and {@link computeSatisfiedSteps} so the
   * completeness contract cannot diverge between the prefill endpoint and the
   * activation guard.
   */
  private deriveSatisfiedSteps(sources: {
    legal_data: FiscalWizardPrefill['legal_data'];
    dian_config: FiscalWizardPrefill['dian_config'];
    puc: FiscalWizardPrefill['puc'];
    accounting_period: FiscalWizardPrefill['accounting_period'];
    default_taxes: FiscalWizardPrefill['default_taxes'];
    accounting_mappings: FiscalWizardPrefill['accounting_mappings'];
    initial_inventory: FiscalWizardPrefill['initial_inventory'];
    payroll_config: FiscalWizardPrefill['payroll_config'];
  }): Set<FiscalWizardStepId> {
    const satisfied = new Set<FiscalWizardStepId>();

    // legal_data: requires the fiscal NIT, its verification digit (DV) and the
    // tax regime. Without a tax regime the legal/tax identity is incomplete for
    // DIAN purposes, so legal_data is NOT satisfied.
    if (
      sources.legal_data &&
      sources.legal_data.nit &&
      sources.legal_data.nit_dv &&
      sources.legal_data.fiscal_regime
    ) {
      satisfied.add('legal_data');
    }

    // dian_config: requires an uploaded certificate that is still valid (not
    // expired). `has_certificate` is derived from `certificate_s3_key`.
    if (
      sources.dian_config &&
      sources.dian_config.has_certificate &&
      sources.dian_config.certificate_expiry &&
      new Date(sources.dian_config.certificate_expiry).getTime() > Date.now()
    ) {
      satisfied.add('dian_config');
    }

    if (sources.puc && sources.puc.exists) {
      satisfied.add('puc');
    }

    if (sources.accounting_period) {
      satisfied.add('accounting_period');
    }

    if (sources.default_taxes && sources.default_taxes.total_categories > 0) {
      satisfied.add('default_taxes');
    }

    if (sources.accounting_mappings && sources.accounting_mappings.total > 0) {
      satisfied.add('accounting_mappings');
    }

    // initial_inventory: prefer `costing_configured` (what the wizard step
    // actually persists) and fall back to the legacy `configured` flag
    // (initial_transactions > 0) for tenants that walked the older
    // activation path. Either signal means the step is done.
    if (sources.initial_inventory) {
      if (
        sources.initial_inventory.costing_configured === true ||
        sources.initial_inventory.configured === true
      ) {
        satisfied.add('initial_inventory');
      }
    }

    // payroll_config: prefer `has_minimal` (the payroll.minimal block the
    // wizard's payroll step persists) and fall back to the legacy
    // `enabled` flag for tenants that explicitly set it. Either signal
    // means the step is done.
    if (sources.payroll_config) {
      if (
        sources.payroll_config.has_minimal === true ||
        sources.payroll_config.enabled === true
      ) {
        satisfied.add('payroll_config');
      }
    }

    return satisfied;
  }

  /**
   * Computes the set of *satisfied* (data-complete) wizard steps for a tenant.
   * Resolves the same scope/sources as {@link buildWizardPrefill} and applies
   * the shared {@link deriveSatisfiedSteps} rule. Used by
   * {@link finalizeActivation} to reject activating areas with incomplete data.
   */
  private async computeSatisfiedSteps(
    client: any,
    organization_id: number,
    store_id: number | null,
    fiscal_scope: 'STORE' | 'ORGANIZATION',
  ): Promise<Set<FiscalWizardStepId>> {
    const sources = await this.readWizardSources(
      client,
      organization_id,
      store_id,
      fiscal_scope,
    );
    return this.deriveSatisfiedSteps(sources);
  }

  private async readLegalData(
    client: any,
    organization_id: number,
    store_id: number | null,
    fiscal_scope: 'STORE' | 'ORGANIZATION',
  ): Promise<FiscalWizardPrefill['legal_data']> {
    const organization = await client.organizations.findUnique({
      where: { id: organization_id },
      select: { id: true, legal_name: true, tax_id: true },
    });
    if (!organization) return null;

    // Fiscal data (regime, CIIU, responsibilities, person type) lives in the
    // settings JSON, scope-aware: organization_settings when fiscal_scope is
    // ORGANIZATION, store_settings (by store_id) when STORE. Mirrors the
    // pattern used by `readPayrollConfig`.
    const settingsRow =
      fiscal_scope === 'ORGANIZATION'
        ? await client.organization_settings.findUnique({
            where: { organization_id },
            select: { settings: true },
          })
        : store_id
          ? await client.store_settings.findUnique({
              where: { store_id },
              select: { settings: true },
            })
          : null;

    const settings = (settingsRow?.settings as any) || {};
    const fiscalData =
      settings.fiscal_data && typeof settings.fiscal_data === 'object'
        ? (settings.fiscal_data as Record<string, unknown>)
        : null;

    const fiscal_regime =
      typeof fiscalData?.tax_regime === 'string' ? fiscalData.tax_regime : null;
    const ciiu =
      typeof fiscalData?.ciiu === 'string' ? fiscalData.ciiu : null;
    const tax_responsibilities =
      Array.isArray(fiscalData?.tax_responsibilities) &&
      fiscalData.tax_responsibilities.every(
        (item: unknown) => typeof item === 'string',
      )
        ? (fiscalData.tax_responsibilities as string[])
        : null;
    // tax_scheme is the DIAN issuer code (O-13/O-15/R-99-PN…), distinct from
    // person_type (NATURAL/JURIDICA). Read it directly; null until the
    // provider-wiring follow-up captures/consumes it.
    const tax_scheme =
      typeof fiscalData?.tax_scheme === 'string' ? fiscalData.tax_scheme : null;

    // Fiscal NIT/DV are owned by DIAN configuration (per accounting entity).
    const dian = await client.dian_configurations.findFirst({
      where: this.tenantWhere(organization_id, store_id),
      orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
      select: { nit: true, nit_dv: true, nit_type: true },
    });

    // Fiscal address: prefer a store address when scoped to a store, else org.
    const address = await client.addresses.findFirst({
      where: store_id
        ? { store_id }
        : { organization_id, store_id: null },
      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
      select: {
        address_line1: true,
        address_line2: true,
        city: true,
        state_province: true,
        country_code: true,
        postal_code: true,
      },
    });

    // Identity fields prefer the scope-aware fiscal_data JSON the dashboard
    // writes, falling back to DIAN config (NIT/DV/type) and the organization
    // record. DIAN owns the canonical NIT once a config exists.
    const legal_name =
      (typeof fiscalData?.legal_name === 'string'
        ? fiscalData.legal_name
        : null) ??
      organization.legal_name ??
      null;
    const tax_id =
      (typeof fiscalData?.tax_id === 'string' ? fiscalData.tax_id : null) ??
      (typeof fiscalData?.nit === 'string' ? fiscalData.nit : null) ??
      organization.tax_id ??
      null;
    const nit =
      dian?.nit ??
      (typeof fiscalData?.nit === 'string' ? fiscalData.nit : null) ??
      (typeof fiscalData?.tax_id === 'string' ? fiscalData.tax_id : null) ??
      organization.tax_id ??
      null;
    const nit_dv =
      dian?.nit_dv ??
      (typeof fiscalData?.nit_dv === 'string' ? fiscalData.nit_dv : null) ??
      (typeof fiscalData?.tax_id_dv === 'string'
        ? fiscalData.tax_id_dv
        : null) ??
      null;
    const nit_type =
      (dian?.nit_type ? String(dian.nit_type) : null) ??
      (typeof fiscalData?.nit_type === 'string' ? fiscalData.nit_type : null) ??
      null;
    const person_type =
      typeof fiscalData?.person_type === 'string'
        ? fiscalData.person_type
        : null;

    return {
      organization_id,
      legal_name,
      tax_id,
      nit,
      nit_dv,
      nit_type,
      person_type,
      fiscal_address: address
        ? {
            address_line1: address.address_line1 ?? null,
            address_line2: address.address_line2 ?? null,
            city: address.city ?? null,
            state: address.state_province ?? null,
            country: address.country_code ?? null,
            postal_code: address.postal_code ?? null,
          }
        : null,
      fiscal_regime,
      ciiu,
      tax_responsibilities,
      tax_scheme,
    };
  }

  private async readDianConfig(
    client: any,
    organization_id: number,
    store_id: number | null,
  ): Promise<FiscalWizardPrefill['dian_config']> {
    const config = await client.dian_configurations.findFirst({
      where: this.tenantWhere(organization_id, store_id),
      orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        nit: true,
        nit_type: true,
        nit_dv: true,
        environment: true,
        operation_mode: true,
        enablement_status: true,
        configuration_type: true,
        is_default: true,
        certificate_s3_key: true,
        certificate_expiry: true,
      },
    });
    if (!config) return null;

    return {
      id: config.id,
      name: config.name,
      nit: config.nit,
      nit_type: String(config.nit_type),
      nit_dv: config.nit_dv ?? null,
      environment: String(config.environment),
      operation_mode: String(config.operation_mode),
      enablement_status: String(config.enablement_status),
      configuration_type: String(config.configuration_type),
      is_default: config.is_default,
      has_certificate: Boolean(config.certificate_s3_key),
      certificate_expiry: config.certificate_expiry
        ? config.certificate_expiry.toISOString()
        : null,
    };
  }

  private async readPuc(
    client: any,
    organization_id: number,
  ): Promise<FiscalWizardPrefill['puc']> {
    const [total_accounts, postable_accounts] = await Promise.all([
      client.chart_of_accounts.count({ where: { organization_id } }),
      client.chart_of_accounts.count({
        where: { organization_id, accepts_entries: true },
      }),
    ]);
    return {
      exists: total_accounts > 0,
      total_accounts,
      postable_accounts,
    };
  }

  private async readAccountingPeriod(
    client: any,
    organization_id: number,
  ): Promise<FiscalWizardPrefill['accounting_period']> {
    const period = await client.fiscal_periods.findFirst({
      where: { organization_id, status: 'open' },
      orderBy: { start_date: 'desc' },
      select: {
        id: true,
        name: true,
        start_date: true,
        end_date: true,
        status: true,
      },
    });
    if (!period) return null;
    return {
      id: period.id,
      name: period.name,
      start_date: period.start_date.toISOString(),
      end_date: period.end_date.toISOString(),
      status: String(period.status),
    };
  }

  private async readDefaultTaxes(
    client: any,
    organization_id: number,
    store_id: number | null,
  ): Promise<FiscalWizardPrefill['default_taxes']> {
    const categories = await client.tax_categories.findMany({
      where: store_id
        ? { store_id }
        : { organization_id, store_id: null },
      select: {
        id: true,
        name: true,
        _count: { select: { tax_rates: true } },
      },
    });

    const mapped = categories.map(
      (category: {
        id: number;
        name: string;
        _count: { tax_rates: number };
      }) => ({
        id: category.id,
        name: category.name,
        rates: category._count.tax_rates,
      }),
    );
    return {
      total_categories: mapped.length,
      total_rates: mapped.reduce(
        (sum: number, category: { rates: number }) => sum + category.rates,
        0,
      ),
      categories: mapped,
    };
  }

  private async readAccountingMappings(
    client: any,
    organization_id: number,
    store_id: number | null,
  ): Promise<FiscalWizardPrefill['accounting_mappings']> {
    const mappings = await client.accounting_account_mappings.findMany({
      where: {
        organization_id,
        store_id: store_id ?? null,
        is_active: true,
      },
      select: { mapping_key: true },
    });
    return {
      total: mappings.length,
      mapped_keys: mappings.map(
        (mapping: { mapping_key: string }) => mapping.mapping_key,
      ),
    };
  }

  private async readInitialInventory(
    client: any,
    organization_id: number,
    store_id: number | null,
    fiscal_scope: 'STORE' | 'ORGANIZATION',
  ): Promise<FiscalWizardPrefill['initial_inventory']> {
    const initial_transactions = await client.inventory_transactions.count({
      where: { organization_id, type: 'initial' },
    });

    // Costing method lives in the settings JSON, scope-aware:
    // organization_settings when fiscal_scope is ORGANIZATION, store_settings
    // (by store_id) when STORE. Mirrors the pattern used by
    // `readPayrollConfig`. Returns the raw settings value
    // (`weighted_average`/`cpp`/`fifo`) so the frontend maps it to its enum.
    const settingsRow =
      fiscal_scope === 'ORGANIZATION'
        ? await client.organization_settings.findUnique({
            where: { organization_id },
            select: { settings: true },
          })
        : store_id
          ? await client.store_settings.findUnique({
              where: { store_id },
              select: { settings: true },
            })
          : null;

    const settings = (settingsRow?.settings as any) || {};
    const inventory =
      settings.inventory && typeof settings.inventory === 'object'
        ? (settings.inventory as Record<string, unknown>)
        : null;
    const costing_method =
      typeof inventory?.costing_method === 'string'
        ? inventory.costing_method
        : null;

    // The wizard's initial-inventory step only persists the costing method
    // — it does not create `inventory_transactions` rows (that requires at
    // least one product, which is a separate flow). The activation guard
    // must therefore consider the step complete when the costing method is
    // set, otherwise the wizard would reject the activation forever.
    const costing_configured = costing_method !== null;

    return {
      configured: initial_transactions > 0,
      initial_transactions,
      costing_method,
      costing_configured,
    };
  }

  private async readPayrollConfig(
    client: any,
    organization_id: number,
    store_id: number | null,
    fiscal_scope: 'STORE' | 'ORGANIZATION',
  ): Promise<FiscalWizardPrefill['payroll_config']> {
    const row =
      fiscal_scope === 'ORGANIZATION'
        ? await client.organization_settings.findUnique({
            where: { organization_id },
            select: { settings: true },
          })
        : store_id
          ? await client.store_settings.findUnique({
              where: { store_id },
              select: { settings: true },
            })
          : null;

    const settings = (row?.settings as any) || {};
    const payroll = settings.payroll;
    if (!payroll || typeof payroll !== 'object') {
      return null;
    }

    const defaults = await client.payroll_system_defaults.findFirst({
      where: { is_published: true },
      orderBy: { year: 'desc' },
      select: { year: true },
    });

    // The wizard's payroll step persists `settings.payroll.minimal` (payment
    // frequency + parafiscales) via PUT /payroll/settings — NOT `enabled`.
    // The activation guard must therefore trust `has_minimal` (a `minimal`
    // block with a real `payment_frequency`) instead of the legacy
    // `enabled` flag, or the wizard will reject the activation even after
    // the user picked every required value.
    const minimal =
      payroll.minimal && typeof payroll.minimal === 'object'
        ? (payroll.minimal as Record<string, unknown>)
        : null;
    const minimalFrequency =
      typeof minimal?.payment_frequency === 'string'
        ? minimal.payment_frequency
        : null;
    const has_minimal = minimalFrequency !== null;

    return {
      enabled: payroll.enabled === true,
      config: payroll as Record<string, unknown>,
      defaults_year: defaults?.year ?? null,
      has_minimal,
    };
  }

  private tenantWhere(
    organization_id: number,
    store_id: number | null,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { organization_id };
    if (store_id) {
      where.store_id = store_id;
    }
    return where;
  }

  async startWizard(params: {
    organization_id: number;
    store_id?: number | null;
    selected_areas: FiscalArea[];
    changed_by_user_id?: number | null;
  }) {
    const selectedAreas = this.normalizeAreas(params.selected_areas);
    if (selectedAreas.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_STATUS_WIZARD_STEP_INVALID,
        'At least one fiscal area is required',
      );
    }
    const sequence = buildFiscalWizardSequence(selectedAreas);
    const now = new Date().toISOString();

    return this.mutate(
      params.organization_id,
      params.store_id,
      'manual',
      params.changed_by_user_id,
      async (block) => {
        for (const area of selectedAreas) {
          if (block[area].state === 'LOCKED') {
            throw new VendixHttpException(
              ErrorCodes.FISCAL_STATUS_LOCKED,
              `Fiscal area ${area} is locked`,
            );
          }
          block[area] = {
            ...block[area],
            state: 'WIP',
            wizard: {
              selected_areas: selectedAreas,
              step_sequence: sequence,
              current_step: sequence[1] ?? sequence[0] ?? null,
              completed_steps: ['area_selection'],
              step_refs: {
                area_selection: {
                  selected_areas: selectedAreas,
                  completed_at: now,
                },
              },
              step_data: {},
              started_at: block[area].wizard.started_at ?? now,
              updated_at: now,
            },
            updated_at: now,
          };
        }
        return block;
      },
    );
  }

  async markStepCompleted(params: {
    organization_id: number;
    store_id?: number | null;
    step: FiscalWizardStepId;
    ref?: Record<string, unknown>;
    changed_by_user_id?: number | null;
  }) {
    if (!isFiscalWizardStep(params.step)) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_STATUS_WIZARD_STEP_INVALID,
        `Invalid fiscal wizard step: ${String(params.step)}`,
      );
    }
    const now = new Date().toISOString();

    return this.mutate(
      params.organization_id,
      params.store_id,
      'wizard',
      params.changed_by_user_id,
      async (block) => {
        const areas = this.getWizardAreas(block);
        if (areas.length === 0) {
          throw new VendixHttpException(
            ErrorCodes.FISCAL_STATUS_INVALID_TRANSITION,
            'No fiscal wizard is in progress',
          );
        }

        for (const area of areas) {
          const wizard = block[area].wizard;
          if (!wizard.step_sequence.includes(params.step)) {
            throw new VendixHttpException(
              ErrorCodes.FISCAL_STATUS_WIZARD_STEP_INVALID,
              `Step ${params.step} is not part of this wizard`,
            );
          }

          const completed = new Set(wizard.completed_steps);
          completed.add(params.step);
          const completed_steps = wizard.step_sequence.filter((step) =>
            completed.has(step),
          );
          const current_step =
            wizard.step_sequence.find((step) => !completed.has(step)) ?? null;

          block[area] = {
            ...block[area],
            wizard: {
              ...wizard,
              completed_steps,
              current_step,
              step_refs: {
                ...wizard.step_refs,
                [params.step]: {
                  ...(params.ref ?? {}),
                  completed_at: now,
                },
              },
              updated_at: now,
            },
            updated_at: now,
          };
        }
        return block;
      },
    );
  }

  async finalizeActivation(params: {
    organization_id: number;
    store_id?: number | null;
    selected_areas?: FiscalArea[];
    changed_by_user_id?: number | null;
  }) {
    const now = new Date().toISOString();

    // Resolve scope + areas BEFORE mutating so we can verify real-data
    // completeness and reject the activation with a structured error listing the
    // missing steps. LOCKED areas are skipped (legacy continuity, see below).
    const client = this.globalPrisma.withoutScope();
    const resolved = await this.resolver.getStatusBlock(
      params.organization_id,
      params.store_id,
    );
    const targetAreas = params.selected_areas?.length
      ? this.normalizeAreas(params.selected_areas)
      : this.getWizardAreas(resolved.fiscal_status);
    if (targetAreas.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_STATUS_INVALID_TRANSITION,
        'No fiscal areas selected for activation',
      );
    }

    const satisfied = await this.computeSatisfiedSteps(
      client,
      params.organization_id,
      resolved.store_id,
      resolved.fiscal_scope,
    );

    const missing_steps: Record<string, string[]> = {};
    for (const area of targetAreas) {
      // LOCKED areas keep legacy continuity: not validated, not re-activated.
      if (resolved.fiscal_status[area].state === 'LOCKED') continue;
      const required = REQUIRED_STEPS_BY_FISCAL_AREA[area].filter(
        (step) => !NON_DATA_STEPS.has(step),
      );
      const missing = required.filter((step) => !satisfied.has(step));
      if (missing.length > 0) {
        missing_steps[area] = missing;
      }
    }

    if (Object.keys(missing_steps).length > 0) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_STATUS_INCOMPLETE,
        'Cannot activate fiscal area(s) with incomplete required steps',
        { missing_steps },
      );
    }

    return this.mutate(
      params.organization_id,
      params.store_id,
      'manual',
      params.changed_by_user_id,
      async (block) => {
        const areas = params.selected_areas?.length
          ? this.normalizeAreas(params.selected_areas)
          : this.getWizardAreas(block);
        if (areas.length === 0) {
          throw new VendixHttpException(
            ErrorCodes.FISCAL_STATUS_INVALID_TRANSITION,
            'No fiscal areas selected for activation',
          );
        }

        for (const area of areas) {
          if (block[area].state === 'LOCKED') continue;
          if (block[area].state !== 'WIP' && block[area].state !== 'INACTIVE') {
            throw new VendixHttpException(
              ErrorCodes.FISCAL_STATUS_INVALID_TRANSITION,
              `Fiscal area ${area} cannot be finalized from ${block[area].state}`,
            );
          }
          block[area] = {
            ...block[area],
            state: 'ACTIVE',
            activated_at: block[area].activated_at ?? now,
            updated_at: now,
            wizard: {
              ...block[area].wizard,
              current_step: null,
              completed_steps: block[area].wizard.step_sequence,
              updated_at: now,
            },
          };
        }
        return block;
      },
    );
  }

  async attemptDeactivation(params: {
    organization_id: number;
    store_id?: number | null;
    area: FiscalArea;
    changed_by_user_id?: number | null;
  }) {
    if (!isFiscalArea(params.area)) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_STATUS_INVALID_TRANSITION,
        'Invalid fiscal area',
      );
    }

    const irreversibility = await this.checkIrreversibility(params);
    if (irreversibility.locked) {
      await this.lock({
        ...params,
        reasons: irreversibility.reasons,
        source: 'event',
      });
      throw new VendixHttpException(
        ErrorCodes.FISCAL_STATUS_DEACTIVATION_BLOCKED,
        'Fiscal status cannot be deactivated because fiscal records already exist',
        irreversibility,
      );
    }

    const now = new Date().toISOString();
    return this.mutate(
      params.organization_id,
      params.store_id,
      'manual',
      params.changed_by_user_id,
      async (block) => {
        if (block[params.area].state === 'LOCKED') {
          throw new VendixHttpException(
            ErrorCodes.FISCAL_STATUS_LOCKED,
            'Fiscal status is locked',
          );
        }
        block[params.area] = {
          ...block[params.area],
          state: 'INACTIVE',
          updated_at: now,
          wizard: {
            ...block[params.area].wizard,
            current_step: null,
            updated_at: now,
          },
        };
        return block;
      },
    );
  }

  async checkIrreversibility(params: {
    organization_id: number;
    store_id?: number | null;
    area?: FiscalArea;
  }): Promise<{ locked: boolean; reasons: string[] }> {
    const areas = params.area ? [params.area] : FISCAL_AREAS;
    const client = this.globalPrisma.withoutScope();
    const whereTenant: Record<string, unknown> = {
      organization_id: params.organization_id,
    };
    if (params.store_id) {
      whereTenant.store_id = params.store_id;
    }
    const reasons: string[] = [];

    if (areas.includes('invoicing')) {
      const acceptedInvoices = await client.invoices.count({
        where: {
          ...whereTenant,
          OR: [
            { status: 'accepted' },
            { accepted_at: { not: null } },
            { cufe: { not: null } },
          ],
        } as any,
      });
      if (acceptedInvoices > 0) {
        reasons.push('accepted_invoice_with_cufe');
      }
    }

    if (areas.includes('accounting')) {
      const postedEntries = await client.accounting_entries.count({
        where: { ...whereTenant, status: 'posted' } as any,
      });
      if (postedEntries > 0) {
        reasons.push('posted_accounting_entry');
      }
    }

    if (areas.includes('payroll')) {
      const settledPayroll = await client.payroll_runs.count({
        where: {
          ...whereTenant,
          status: { in: ['accepted', 'paid'] },
        } as any,
      });
      if (settledPayroll > 0) {
        reasons.push('settled_payroll_run');
      }
    }

    return { locked: reasons.length > 0, reasons };
  }

  async lock(params: {
    organization_id: number;
    store_id?: number | null;
    area: FiscalArea;
    reasons: string[];
    source?: FiscalStatusSource;
    changed_by_user_id?: number | null;
  }) {
    const now = new Date().toISOString();
    return this.mutate(
      params.organization_id,
      params.store_id,
      params.source ?? 'event',
      params.changed_by_user_id,
      async (block) => {
        block[params.area] = {
          ...block[params.area],
          state: 'LOCKED',
          locked_reasons: Array.from(
            new Set([...block[params.area].locked_reasons, ...params.reasons]),
          ),
          locked_at: block[params.area].locked_at ?? now,
          updated_at: now,
        };
        return block;
      },
    );
  }

  async applyDetectorSignals(params: {
    organization_id: number;
    store_id?: number | null;
    signals: FiscalDetectorSignals;
  }) {
    const now = new Date().toISOString();
    return this.mutate(
      params.organization_id,
      params.store_id,
      'detector',
      null,
      async (block) => {
        const score = this.scoreSignals(params.signals);
        const signals = {
          ...params.signals,
          score,
          evaluated_at: now,
        };

        for (const area of FISCAL_AREAS) {
          block[area] = {
            ...block[area],
            detector_signals: signals,
            updated_at: now,
          };
        }
        return block;
      },
    );
  }

  private async mutate(
    organization_id: number,
    store_id: number | null | undefined,
    source: FiscalStatusSource,
    changed_by_user_id: number | null | undefined,
    mutator: (block: FiscalStatusBlock) => Promise<FiscalStatusBlock>,
  ) {
    let before: FiscalStatusBlock | null = null;
    let after: FiscalStatusBlock | null = null;
    const result = await this.resolver.writeStatusBlock(
      organization_id,
      store_id,
      async (block) => {
        before = this.cloneBlock(block);
        after = normalizeFiscalStatusBlock(await mutator(block));
        return after;
      },
    );

    if (before && after) {
      await this.writeAuditRows({
        organization_id,
        store_id: result.store_id,
        source,
        changed_by_user_id: changed_by_user_id ?? null,
        before,
        after,
      });
      this.eventEmitter.emit('fiscal_status.changed', {
        organization_id,
        store_id: result.store_id,
        source,
        before,
        after,
      });
    }

    return result;
  }

  private async writeAuditRows(params: {
    organization_id: number;
    store_id: number | null;
    source: FiscalStatusSource;
    changed_by_user_id: number | null;
    before: FiscalStatusBlock;
    after: FiscalStatusBlock;
  }): Promise<void> {
    const client = this.globalPrisma.withoutScope() as any;
    for (const area of FISCAL_AREAS) {
      if (
        JSON.stringify(params.before[area]) ===
        JSON.stringify(params.after[area])
      ) {
        continue;
      }
      await client.fiscal_status_audit_log.create({
        data: {
          organization_id: params.organization_id,
          store_id: params.store_id,
          feature: area,
          from_state: params.before[area].state,
          to_state: params.after[area].state,
          source: params.source,
          before_json: params.before[area] as any,
          after_json: params.after[area] as any,
          changed_by_user_id: params.changed_by_user_id,
        },
      });
    }
  }

  private getWizardAreas(block: FiscalStatusBlock): FiscalArea[] {
    const areas = new Set<FiscalArea>();
    for (const area of FISCAL_AREAS) {
      if (block[area].state === 'WIP') {
        const selected = block[area].wizard.selected_areas.filter(isFiscalArea);
        if (selected.length > 0) {
          selected.forEach((selectedArea) => areas.add(selectedArea));
        } else {
          areas.add(area);
        }
      }
    }
    return Array.from(areas);
  }

  private normalizeAreas(areas: FiscalArea[]): FiscalArea[] {
    return Array.from(new Set(areas.filter(isFiscalArea)));
  }

  private scoreSignals(signals: FiscalDetectorSignals): number {
    return [
      signals.revenue_over_uvt,
      signals.transaction_volume,
      signals.b2b_invoices,
      signals.legal_person,
      signals.active_employees,
    ].filter(Boolean).length;
  }

  private cloneBlock(block: FiscalStatusBlock): FiscalStatusBlock {
    return JSON.parse(JSON.stringify(block));
  }
}
