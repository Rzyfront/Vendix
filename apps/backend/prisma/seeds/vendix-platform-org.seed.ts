import { Prisma, PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';
import { seedDefaultPuc } from './default-puc.seed';
import {
  createDefaultFiscalStatusBlock,
  FiscalStatusBlock,
} from '../../src/common/interfaces/fiscal-status.interface';

export interface SeedVendixPlatformOrgResult {
  organization_id: number;
  organization_updated: boolean;
  accounting_entity_created: boolean;
  fiscal_period_created: boolean;
  puc_accounts: number;
  platform_settings_written: boolean;
  dian_config_created: boolean;
  organization_settings_written: boolean;
  invoice_resolutions_created: number;
  support_dian_config_created: boolean;
  vendor_support_setting_written: boolean;
}

/**
 * Bootstraps the Vendix platform organization so VENDIX_ADMIN can run its
 * own internal accounting.
 *
 * The "Vendix-org" is materialized as a regular `organizations` row with
 * `is_platform = TRUE`. It already exists (seeded by `seedOrganizationsAndStores`
 * as "Vendix Corp" with slug `vendix`) — this seed:
 *
 *   1. Sets `is_platform = TRUE` on the Vendix Corp org (idempotent — at most
 *      one org can have this flag thanks to the partial UNIQUE index created
 *      in migration 20260610100000_add_is_platform_to_organizations).
 *   2. Creates the consolidated `accounting_entity` (scope=ORGANIZATION,
 *      fiscal_scope=ORGANIZATION) used by every platform-side fiscal flow.
 *   3. Seeds the full Colombian PUC for that org via `seedDefaultPuc`.
 *   4. Creates the current-year `fiscal_period` (status=open).
 *   5. Writes/refreshes the `platform_settings` row keyed
 *      `vendix_platform_organization_id` so the existing SaaS listeners can
 *      resolve the platform org.
 *   6. Creates a `dian_configurations` row in test mode placeholder state so
 *      the SaaS subscription-invoice DIAN flow can be wired from UI; the
 *      actual certificate/PIN is configured by the super-admin via the
 *      `fiscal-billing` page in the super-admin module.
 *   7. Bootstraps `organization_settings` for org 1 with the canonical
 *      `fiscal_status` block (invoicing/accounting ACTIVE, payroll INACTIVE)
 *      and a baseline `fiscal_data` legal identity (deep-merged — never
 *      overwrites populated RUT fields).
 *   8. Seeds two platform-scoped `invoice_resolutions` (store_id=NULL): SETP
 *      for sales_invoice (SaaS), DSON for support_document (vendor inbound).
 *   9. Upserts `platform_settings['vendor_support_fiscal']` toggle (disabled
 *      by default) and stubs the support_document DIAN config so the toggle
 *      can be flipped from UI without breaking foreign-key validations.
 *
 * Idempotency: every step uses findFirst/create-or-update. Re-running the
 * seed converges to the same state. The 5 SaaS mapping keys are added
 * automatically by the global `seedDefaultAccountMappings` pass (which loops
 * over all orgs); we do not duplicate that work here.
 */
export async function seedVendixPlatformOrg(
  prisma?: PrismaClient,
): Promise<SeedVendixPlatformOrgResult> {
  const client = prisma || getPrismaClient();

  // 1. Resolve / claim the Vendix Corp row.
  const vendixOrg = await client.organizations.findUnique({
    where: { slug: 'vendix' },
    select: { id: true, is_platform: true, name: true, tax_id: true, legal_name: true },
  });
  if (!vendixOrg) {
    throw new Error(
      'Vendix Corp organization (slug="vendix") not found. ' +
        'Run seedOrganizationsAndStores first.',
    );
  }

  let organization_updated = false;
  if (!vendixOrg.is_platform) {
    await client.organizations.update({
      where: { id: vendixOrg.id },
      data: { is_platform: true },
    });
    organization_updated = true;
  }

  // 2. Ensure the org is configured as ORGANIZATION/ORGANIZATION scope
  //    (the SaaS fiscal entity is consolidated, not per-store).
  await client.organizations.update({
    where: { id: vendixOrg.id },
    data: {
      operating_scope: 'ORGANIZATION',
      fiscal_scope: 'ORGANIZATION',
    },
  });

  // 3. Ensure the consolidated accounting_entity exists.
  let accountingEntity = await client.accounting_entities.findFirst({
    where: { organization_id: vendixOrg.id, scope: 'ORGANIZATION' },
    select: { id: true },
  });
  let accounting_entity_created = false;
  if (!accountingEntity) {
    accountingEntity = await client.accounting_entities.create({
      data: {
        organization_id: vendixOrg.id,
        scope: 'ORGANIZATION',
        fiscal_scope: 'ORGANIZATION',
        name: 'Vendix S.A.S. (Consolidado)',
        legal_name: vendixOrg.legal_name ?? 'Vendix Corporation S.A.S.',
        tax_id: vendixOrg.tax_id ?? '900123456-7',
        is_active: true,
      },
      select: { id: true },
    });
    accounting_entity_created = true;
  }

  // 4. Seed the full Colombian PUC for the platform org.
  const pucResult = await seedDefaultPuc(vendixOrg.id, client);

  // 4.5 Ensure the platform org has the SaaS-fee subaccounts used by the
  //     inbound vendor-support-document flow (5295.01 Servicios SaaS —
  //     Comisiones Wompi, 1305.99 CxC SaaS). Idempotent: only writes if
  //     the code is missing under the platform accounting entity.
  const ensureSubaccount = async (
    code: string,
    parent_code: string,
    name: string,
    account_type: string,
    nature: string,
    level: number,
    accepts_entries: boolean,
  ) => {
    const existing = await client.chart_of_accounts.findFirst({
      where: {
        organization_id: vendixOrg.id,
        accounting_entity_id: accountingEntity.id,
        code,
      },
      select: { id: true },
    });
    if (existing) return;

    const parent = await client.chart_of_accounts.findFirst({
      where: {
        organization_id: vendixOrg.id,
        accounting_entity_id: accountingEntity.id,
        code: parent_code,
      },
      select: { id: true },
    });
    if (!parent) {
      console.warn(
        `[Platform Org] Skipping subaccount ${code}: parent ${parent_code} not found.`,
      );
      return;
    }
    await client.chart_of_accounts.create({
      data: {
        organization_id: vendixOrg.id,
        accounting_entity_id: accountingEntity.id,
        code,
        name,
        account_type: account_type as any,
        nature: nature as any,
        parent_id: parent.id,
        level,
        is_active: true,
        accepts_entries,
      },
    });
  };

  await ensureSubaccount(
    '5295.01',
    '5295',
    'Servicios SaaS — Comisiones Wompi',
    'expense',
    'debit',
    3,
    true,
  );
  await ensureSubaccount(
    '1305.99',
    '1305',
    'Cuentas por Cobrar SaaS',
    'asset',
    'debit',
    3,
    true,
  );

  // 5. Create the current-year fiscal period (open).
  const currentYear = new Date().getUTCFullYear();
  const periodStart = new Date(Date.UTC(currentYear, 0, 1));
  const periodEnd = new Date(Date.UTC(currentYear, 11, 31, 23, 59, 59));
  const periodName = `${currentYear}`;

  let fiscal_period_created = false;
  const existingPeriod = await client.fiscal_periods.findFirst({
    where: {
      organization_id: vendixOrg.id,
      name: periodName,
    },
    select: { id: true, status: true },
  });
  if (!existingPeriod) {
    await client.fiscal_periods.create({
      data: {
        organization_id: vendixOrg.id,
        accounting_entity_id: accountingEntity.id,
        name: periodName,
        start_date: periodStart,
        end_date: periodEnd,
        status: 'open',
      },
    });
    fiscal_period_created = true;
  } else if (existingPeriod.status === 'closed') {
    // Reopen so platform-side auto-entries can land.
    await client.fiscal_periods.update({
      where: { id: existingPeriod.id },
      data: { status: 'open' },
    });
  }

  // 6. Write/refresh platform_settings.vendix_platform_organization_id so
  //    the SaaS listeners that already query this setting find the id.
  let platform_settings_written = false;
  const existingSetting = await client.platform_settings.findFirst({
    where: { key: 'vendix_platform_organization_id' },
    select: { id: true, value: true },
  });
  const targetValue = { id: vendixOrg.id, slug: 'vendix' } as Prisma.InputJsonValue;
  if (!existingSetting) {
    await client.platform_settings.create({
      data: {
        key: 'vendix_platform_organization_id',
        value: targetValue,
        description: 'Organization id of the Vendix platform (is_platform=true).',
      },
    });
    platform_settings_written = true;
  } else {
    const current = existingSetting.value as { id?: number } | null;
    if (!current || current.id !== vendixOrg.id) {
      await client.platform_settings.update({
        where: { id: existingSetting.id },
        data: { value: targetValue },
      });
      platform_settings_written = true;
    }
  }

  // 7. Create a placeholder DIAN configuration for the platform org.
  //    Real certificate/PIN/software_id is configured by super-admin via UI;
  //    we only stub the row so foreign-key validations in the SaaS DIAN
  //    flow do not block the seed.
  let dian_config_created = false;
  const existingDian = await client.dian_configurations.findFirst({
    where: {
      organization_id: vendixOrg.id,
      accounting_entity_id: accountingEntity.id,
      configuration_type: 'invoicing',
    },
    select: { id: true },
  });
  if (!existingDian) {
    await client.dian_configurations.create({
      data: {
        organization_id: vendixOrg.id,
        accounting_entity_id: accountingEntity.id,
        name: 'Vendix S.A.S. — DIAN (pendiente configuración)',
        nit: vendixOrg.tax_id ?? '900123456-7',
        nit_type: 'NIT',
        is_default: true,
        configuration_type: 'invoicing',
        operation_mode: 'own_software',
        software_id: 'PENDING',
        software_pin_encrypted: 'PENDING',
        environment: 'test',
        enablement_status: 'not_started',
      },
    });
    dian_config_created = true;
  }

  // 8. Bootstrap fiscal `organization_settings` for org 1 (Vendix platform).
  //    Writes the canonical `fiscal_status` block (invoicing/accounting ACTIVE,
  //    payroll INACTIVE) and a baseline `fiscal_data` legal identity used by
  //    every platform-side fiscal flow (RNC, DIAN listeners, obligations).
  //    Idempotent: deep-merges into existing settings, never overwriting
  //    user-populated fiscal_data fields (RUT load preserved).
  const organization_settings_written = await ensurePlatformOrganizationSettings(
    client,
    vendixOrg.id,
    {
      legal_name: vendixOrg.legal_name ?? 'Vendix S.A.S.',
      tax_id: vendixOrg.tax_id ?? '900123456-7',
    },
  );

  // 9. Bootstrap platform invoice resolutions (DIAN test set).
  //    Two resolutions seeded under store_id=NULL (ORGANIZATION fiscal scope):
  //      - SETP: sales_invoice (range 990000000–990001000) for SaaS invoices.
  //      - DSON: support_document (range 1–100000) for inbound vendor docs.
  //    Idempotent: unique by (accounting_entity_id, prefix). Existing rows
  //    are preserved as-is (super-admin may have edited ranges/dates).
  const invoice_resolutions_created = await ensurePlatformInvoiceResolutions(
    client,
    vendixOrg.id,
    accountingEntity.id,
  );

  // 10. Platform vendor-support toggle (off by default).
  //     `platform_settings['vendor_support_fiscal']` gates the inbound vendor
  //     support-document flow. Stays disabled until super-admin flips it from
  //     the fiscal-billing UI (which also clones the invoicing DIAN config).
  const vendor_support_setting_written = await ensureVendorSupportFiscalSetting(
    client,
  );

  // 11. Stub `dian_configurations` row for support_document.
  //     Real certificate/PIN/software_id is cloned from the invoicing config
  //     when the toggle is flipped on. We just create the placeholder so the
  //     listener can resolve it; is_default stays false (invoicing is default).
  const support_dian_config_created =
    await ensurePlatformSupportDocumentDianConfig(
      client,
      vendixOrg.id,
      accountingEntity.id,
      vendixOrg.tax_id ?? '900123456-7',
    );

  console.log(
    `[Platform Org] Vendix Corp id=${vendixOrg.id} (is_platform=${true}) ` +
      `entity=${accountingEntity.id} puc_accounts=${pucResult.accounts_created} ` +
      `period=${periodName} settings_written=${platform_settings_written} ` +
      `org_settings=${organization_settings_written} ` +
      `resolutions+=${invoice_resolutions_created} ` +
      `support_dian=${support_dian_config_created} ` +
      `vendor_support_flag=${vendor_support_setting_written}`,
  );

  return {
    organization_id: vendixOrg.id,
    organization_updated,
    accounting_entity_created,
    fiscal_period_created,
    puc_accounts: pucResult.accounts_created,
    platform_settings_written,
    dian_config_created,
    organization_settings_written,
    invoice_resolutions_created,
    support_dian_config_created,
    vendor_support_setting_written,
  };
}

/**
 * Deep-merge platform `fiscal_status` + `fiscal_data` into the org's
 * organization_settings.settings JSON. Idempotent and non-destructive:
 *
 *   - `fiscal_status`: normalized to the canonical shape via
 *     `createDefaultFiscalStatusBlock`. Only writes the area states when the
 *     existing block is INACTIVE — if super-admin already promoted any area
 *     (WIP/ACTIVE/LOCKED) we preserve their state and wizard progress.
 *   - `fiscal_data`: deep-merged. Existing populated fields (e.g. real RUT
 *     uploaded by RUT-scan AI) are NEVER overwritten — only missing fields
 *     are filled with platform defaults.
 *
 * Returns true if any change was persisted, false if everything already
 * matched (re-run safe).
 */
async function ensurePlatformOrganizationSettings(
  client: PrismaClient,
  organizationId: number,
  identity: { legal_name: string; tax_id: string },
): Promise<boolean> {
  const existing = await client.organization_settings.findUnique({
    where: { organization_id: organizationId },
    select: { id: true, settings: true },
  });

  const currentSettings: Record<string, any> =
    (existing?.settings as Record<string, any> | null) ?? {};
  let dirty = !existing;

  // --- fiscal_status: invoicing + accounting ACTIVE, payroll INACTIVE ---
  const baseBlock = currentSettings.fiscal_status
    ? (currentSettings.fiscal_status as FiscalStatusBlock)
    : createDefaultFiscalStatusBlock();
  const nextBlock: FiscalStatusBlock = createDefaultFiscalStatusBlock();
  for (const area of ['invoicing', 'accounting', 'payroll'] as const) {
    const current = baseBlock?.[area] ?? nextBlock[area];
    nextBlock[area] = { ...nextBlock[area], ...current };
  }
  const now = new Date().toISOString();
  if (nextBlock.invoicing.state === 'INACTIVE') {
    nextBlock.invoicing.state = 'ACTIVE';
    nextBlock.invoicing.activated_at =
      nextBlock.invoicing.activated_at ?? now;
    nextBlock.invoicing.updated_at = now;
    dirty = true;
  }
  if (nextBlock.accounting.state === 'INACTIVE') {
    nextBlock.accounting.state = 'ACTIVE';
    nextBlock.accounting.activated_at =
      nextBlock.accounting.activated_at ?? now;
    nextBlock.accounting.updated_at = now;
    dirty = true;
  }
  if (!currentSettings.fiscal_status) dirty = true;
  // payroll left at INACTIVE — Vendix no liquida nómina propia aún.

  // --- fiscal_data: baseline platform identity (deep-merge non-destructive) ---
  const currentFiscalData: Record<string, any> =
    (currentSettings.fiscal_data as Record<string, any> | null) ?? {};
  const defaultFiscalData: Record<string, any> = {
    legal_name: identity.legal_name,
    nit: identity.tax_id,
    nit_type: 'NIT',
    person_type: 'JURIDICA',
    tax_regime: 'COMUN',
    tax_responsibilities: ['O-48'],
    tax_scheme: 'O-48',
    fiscal_address: {
      address_line1: 'Calle 100 # 11A-35',
      address_line2: null,
      city: 'Bogotá',
      state: 'Bogotá D.C.',
      country: 'CO',
      postal_code: '110111',
    },
  };
  const nextFiscalData: Record<string, any> = { ...currentFiscalData };
  // Fill only missing fields — existing values always win.
  for (const [key, defaultValue] of Object.entries(defaultFiscalData)) {
    const currentValue = currentFiscalData[key];
    if (key === 'fiscal_address') {
      const currentAddr =
        currentValue && typeof currentValue === 'object' ? currentValue : null;
      if (!currentAddr) {
        nextFiscalData.fiscal_address = defaultValue;
        dirty = true;
      } else {
        // Fill only missing keys; never overwrite or mark dirty for ordering.
        const mergedAddr: Record<string, any> = { ...(currentAddr as Record<string, any>) };
        let addrDirty = false;
        for (const [k, defaultAddrValue] of Object.entries(
          defaultValue as Record<string, any>,
        )) {
          const cur = mergedAddr[k];
          if (cur === undefined || cur === '' ) {
            mergedAddr[k] = defaultAddrValue;
            addrDirty = true;
          }
        }
        if (addrDirty) {
          nextFiscalData.fiscal_address = mergedAddr;
          dirty = true;
        }
      }
    } else if (key === 'tax_responsibilities') {
      if (!Array.isArray(currentValue) || currentValue.length === 0) {
        nextFiscalData.tax_responsibilities = defaultValue;
        dirty = true;
      }
    } else if (
      currentValue === undefined ||
      currentValue === null ||
      currentValue === ''
    ) {
      nextFiscalData[key] = defaultValue;
      dirty = true;
    }
  }

  if (!dirty) return false;

  const nextSettings = {
    ...currentSettings,
    fiscal_status: nextBlock,
    fiscal_data: nextFiscalData,
  };

  await client.organization_settings.upsert({
    where: { organization_id: organizationId },
    create: {
      organization_id: organizationId,
      settings: nextSettings as Prisma.InputJsonValue,
    },
    update: {
      settings: nextSettings as Prisma.InputJsonValue,
      updated_at: new Date(),
    },
  });
  return true;
}

/**
 * Bootstrap two platform-scoped `invoice_resolutions` rows under
 * (organization_id=Vendix, store_id=NULL, accounting_entity_id=consolidated):
 *
 *   - SETP / sales_invoice: SaaS subscription invoices.
 *   - DSON / support_document: inbound vendor support docs (RNC-31 leg).
 *
 * Uniqueness is enforced by partial unique idx on
 * `(accounting_entity_id, prefix)` — we check via findFirst before insert and
 * never modify existing rows (super-admin may have replaced ranges).
 *
 * `technical_key` is a stable placeholder so the DIAN test-set flow can be
 * wired without blocking on a real key (replaced by UI before going to prod).
 * `invoice_resolutions` itself has no `environment` column — environment
 * lives on the linked `dian_configurations` row (test by default).
 */
async function ensurePlatformInvoiceResolutions(
  client: PrismaClient,
  organizationId: number,
  accountingEntityId: number,
): Promise<number> {
  const today = new Date();
  const validFrom = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  // Valid for ~24 months — long enough for the SaaS DIAN test set.
  const validTo = new Date(
    Date.UTC(today.getUTCFullYear() + 2, today.getUTCMonth(), today.getUTCDate()),
  );

  const resolutions: Array<{
    prefix: string;
    document_type: 'sales_invoice' | 'support_document';
    resolution_number: string;
    range_from: number;
    range_to: number;
    technical_key: string;
  }> = [
    {
      prefix: 'SETP',
      document_type: 'sales_invoice',
      resolution_number: 'SETP-PLATFORM-2026',
      range_from: 990000000,
      range_to: 990001000,
      // Placeholder DIAN test-set technical_key; super-admin replaces via UI.
      technical_key:
        'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c52d76f64db8a2c0f7ee5d4f3',
    },
    {
      prefix: 'DSON',
      document_type: 'support_document',
      resolution_number: 'DSON-PLATFORM-2026',
      range_from: 1,
      range_to: 100000,
      technical_key:
        'a1c2e3d4b5f60798a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1',
    },
  ];

  let created = 0;
  for (const res of resolutions) {
    const existing = await client.invoice_resolutions.findFirst({
      where: {
        accounting_entity_id: accountingEntityId,
        prefix: res.prefix,
      },
      select: { id: true },
    });
    if (existing) continue;
    await client.invoice_resolutions.create({
      data: {
        organization_id: organizationId,
        store_id: null,
        accounting_entity_id: accountingEntityId,
        document_type: res.document_type,
        resolution_number: res.resolution_number,
        resolution_date: validFrom,
        prefix: res.prefix,
        range_from: res.range_from,
        range_to: res.range_to,
        current_number: 0,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        technical_key: res.technical_key,
      },
    });
    created++;
  }
  return created;
}

/**
 * Upsert the `vendor_support_fiscal` platform_settings entry. Toggle defaults
 * to disabled — super-admin must flip it from the fiscal-billing UI, which
 * also clones the invoicing DIAN config into the support_document one.
 *
 * Idempotent: if the row already exists we never overwrite (super-admin may
 * have flipped is_enabled=true already).
 */
async function ensureVendorSupportFiscalSetting(
  client: PrismaClient,
): Promise<boolean> {
  const existing = await client.platform_settings.findFirst({
    where: { key: 'vendor_support_fiscal' },
    select: { id: true },
  });
  if (existing) return false;
  await client.platform_settings.create({
    data: {
      key: 'vendor_support_fiscal',
      value: {
        is_enabled: false,
        auto_transmit: false,
        environment: 'test',
      } as Prisma.InputJsonValue,
      description:
        'Toggle for inbound vendor support-document fiscal transmission ' +
        '(RNC-31 leg). When enabled, the support_document DIAN config is ' +
        'cloned from the invoicing one and the listener starts transmitting.',
    },
  });
  return true;
}

/**
 * Stub the support_document DIAN configuration for the platform org. Sits
 * idle (`is_active=false` semantics via enablement_status=not_started) until
 * the super-admin flips the `vendor_support_fiscal` toggle, which copies the
 * cert/PIN/software_id from the invoicing config into this row.
 *
 * Idempotent and constraint-safe:
 *   - Keyed on (org, entity, configuration_type=support_document) for the
 *     "already created" check.
 *   - The partial unique idx `dian_configurations_org_scope_uq` enforces
 *     `(organization_id, nit) WHERE store_id IS NULL` — meaning org-scope
 *     can hold only ONE config per NIT. When the invoicing config already
 *     occupies that slot (same legal NIT), we skip creating a separate
 *     support_document row: the toggle UI will instead clone the invoicing
 *     row's certificate/PIN into a new row at activation time (after
 *     resolving the slot, e.g. by store_id once stores exist, or by an
 *     alternate NIT representation). Skipping here keeps the seed safe.
 */
async function ensurePlatformSupportDocumentDianConfig(
  client: PrismaClient,
  organizationId: number,
  accountingEntityId: number,
  nit: string,
): Promise<boolean> {
  const existing = await client.dian_configurations.findFirst({
    where: {
      organization_id: organizationId,
      accounting_entity_id: accountingEntityId,
      configuration_type: 'support_document',
    },
    select: { id: true },
  });
  if (existing) return false;

  // Partial unique idx blocks a second org-scope row with the same NIT.
  // If invoicing already claimed the slot, defer support_document creation
  // to the toggle activation flow (which clones from invoicing).
  const nitSlotTaken = await client.dian_configurations.findFirst({
    where: {
      organization_id: organizationId,
      store_id: null,
      nit,
    },
    select: { id: true },
  });
  if (nitSlotTaken) {
    console.log(
      `[Platform Org] Skipping support_document DIAN stub: org-scope NIT slot ` +
        `already taken by invoicing config (id=${nitSlotTaken.id}). The ` +
        `vendor-support toggle will clone from it at activation time.`,
    );
    return false;
  }

  await client.dian_configurations.create({
    data: {
      organization_id: organizationId,
      accounting_entity_id: accountingEntityId,
      name: 'Vendix S.A.S. — Documento Soporte (stub)',
      nit,
      nit_type: 'NIT',
      is_default: false,
      configuration_type: 'support_document',
      operation_mode: 'own_software',
      // Cloned from invoicing when toggle flips on; placeholder for now.
      software_id: 'PENDING',
      software_pin_encrypted: 'PENDING',
      environment: 'test',
      enablement_status: 'not_started',
    },
  });
  return true;
}
