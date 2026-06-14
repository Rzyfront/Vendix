/**
 * Stage 01 — Foundation
 *
 * Creates the Roku org + store, the chart of accounts, account mappings,
 * 7 fiscal periods (Dec-2025 .. Jun-2026), users (admin, employees, cashier,
 * bookkeeping, customers), accounting entity, DIAN test config, and the
 * first invoice resolution. Idempotent.
 *
 * Depends on the system-level seed data being present:
 *   - permissions-roles (default roles exist)
 *   - default-templates (notifications, branding)
 *   - system-payment-methods (cash, card, transfer, ...)
 *   - default-puc, default-account-mappings
 *   - withholding-tax (UVT, concepts)
 *   - ica-municipal-rates
 *   - payroll-system-defaults
 *   - fiscal-rule-sets
 *
 * The script will INVOKE those seeds if their functions are exported. We
 * just import and call them in the right order.
 */

import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Stage, StageContext } from './context';
import { ROKU_IDENTIFIERS } from '../lib/guards';
import { BOGOTA, CURRENCY } from '../lib/fiscal-co';
import { monthlyPeriods } from '../lib/dates';

const DEFAULT_PASSWORD = 'RokuDemo2026!';
const DEMO_EMAIL_DOMAIN = 'roku-demo.vendix.local';

export const stage01Foundation: Stage = {
  id: '01',
  name: 'Foundation',
  description: 'Org, store, users, fiscal config, PUC, mappings, fiscal periods',
  run: async (ctx: StageContext) => {
    const { prisma, today, log, data } = ctx;
    const counts: Record<string, number> = {};

    // === 1. System-level seed invocations (idempotent) ===
    log('  · Running system-level seeds (templates, permissions, payment methods, PUC, mappings)');
    const sysFns: Array<[string, () => Promise<any>]> = [
      ['Default Templates', () => import('../../../prisma/seeds/default-templates.seed').then(m => m.seedDefaultTemplates(prisma))],
      ['Permissions & Roles', () => import('../../../prisma/seeds/permissions-roles.seed').then(m => m.seedPermissionsAndRoles(prisma))],
      ['System Payment Methods', () => import('../../../prisma/seeds/system-payment-methods.seed').then(m => m.seedSystemPaymentMethods(prisma))],
      ['Default Payroll Rules', () => import('../../../prisma/seeds/default-payroll-rules.seed').then(m => m.seedDefaultPayrollRules(prisma))],
      ['ICA Municipal Rates', () => import('../../../prisma/seeds/ica-municipal-rates.seed').then(m => m.seedIcaMunicipalRates(prisma))],
      ['Withholding Tax', () => import('../../../prisma/seeds/withholding-tax.seed').then(m => m.seedWithholdingTax(prisma))],
      ['Fiscal Rule Sets', () => import('../../../prisma/seeds/fiscal-rule-sets.seed').then(m => m.seedFiscalRuleSets(prisma))],
      ['AI Engine Apps', () => import('../../../prisma/seeds/ai-engine-apps.seed').then(m => m.seedAIEngineApps(prisma))],
      ['Payroll System Defaults', () => import('../../../prisma/seeds/payroll-system-defaults.seed').then(m => m.seedPayrollSystemDefaults(prisma))],
      ['Default Trial Plan', () => import('../../../prisma/seeds/subscription-plans.seed').then(m => m.seedSubscriptionPlans(prisma))],
      ['Production Plans', () => import('../../../prisma/seeds/subscription-plans-production.seed').then(m => m.seedSubscriptionPlansProduction(prisma))],
      ['Legal Documents', () => import('../../../prisma/seeds/legal-documents.seed').then(m => m.seedLegalDocuments(prisma))],
    ];
    for (const [name, fn] of sysFns) {
      try {
        await fn();
        log(`    ✓ ${name}`);
      } catch (e: any) {
        log(`    ! ${name} skipped: ${e?.message ?? e}`);
      }
    }

    // === 2. Organization ===
    log('  · Creating Roku organization');
    // update: {} — the real org 6 already exists; never mutate its state.
    const org = await prisma.organizations.upsert({
      where: { slug: ROKU_IDENTIFIERS.orgSlug },
      update: {},
      create: {
        name: ROKU_IDENTIFIERS.orgName,
        slug: ROKU_IDENTIFIERS.orgSlug,
        legal_name: 'Roku Colombia S.A.S.',
        tax_id: ROKU_IDENTIFIERS.orgTaxId,
        email: 'admin@roku-demo.vendix.local',
        phone: '+57-1-5550100',
        website: 'https://roku-demo.vendix.local',
        description: 'Tienda demo Roku — Tecnología y electrodomésticos. Datos sintéticos generados por el script de demo.',
        logo_url: null,
        state: 'active',
        account_type: 'SINGLE_STORE',
        operating_scope: 'STORE',
        fiscal_scope: 'STORE',
        mode: 'demo',
        onboarding: true,
      },
    });
    data.organization = org;
    counts.organizations = 1;

    // === 3. Organization onboarding state ===
    await prisma.organization_onboarding_state.upsert({
      where: { organization_id: org.id },
      update: {},
      create: {
        organization_id: org.id,
        current_step: 99,
        step_data: { completed: ['fiscal_setup', 'catalog', 'sales', 'fiscal_close'] } as any,
      },
    });

    // === 4. Organization settings (fiscal data) ===
    await prisma.organization_settings.upsert({
      where: { organization_id: org.id },
      update: {},
      create: {
        organization_id: org.id,
        settings: {
          fiscal_data: {
            tax_responsibilities: ['O-13', 'O-15', 'O-23', 'O-48'],
            vat_periodicity: 'BIMONTHLY',
            withholding_periodicity: 'MONTHLY',
            ica_periodicity: 'BIMONTHLY',
            exogenous_resolution: '1001',
          },
          branding: {
            primary_color: '#0EA5E9',
            secondary_color: '#1E293B',
            theme: 'modern',
          },
          locale: {
            country_code: 'CO',
            language: 'es',
            currency: 'COP',
            timezone: 'America/Bogota',
          },
        } as any,
      },
    });

    // === 5. Address for the org (Bogotá HQ) ===
    const orgAddr = await prisma.addresses.findFirst({
      where: { organization_id: org.id, type: 'headquarters' as any },
    });
    if (!orgAddr) {
      await prisma.addresses.create({
        data: {
          organization_id: org.id,
          type: 'headquarters' as any,
          address_line1: 'Avenida El Dorado #68-51',
          address_line2: 'Torre Empresarial Davivienda Piso 7',
          city: BOGOTA.city,
          state_province: BOGOTA.state_province,
          country_code: BOGOTA.country_code,
          postal_code: BOGOTA.postal_code,
          municipality_code: BOGOTA.municipality_code,
          phone_number: '+57-1-5550100',
          is_primary: true,
          latitude: BOGOTA.lat,
          longitude: BOGOTA.lng,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    }

    // === 6. Store ===
    log('  · Creating Roku store');
    const store = await prisma.stores.upsert({
      where: {
        organization_id_slug: {
          organization_id: org.id,
          slug: ROKU_IDENTIFIERS.storeSlug,
        },
      },
      update: {},
      create: {
        name: ROKU_IDENTIFIERS.storeName,
        slug: ROKU_IDENTIFIERS.storeSlug,
        legal_name: 'Roku Colombia S.A.S.',
        tax_id: ROKU_IDENTIFIERS.orgTaxId,
        tax_id_dv: '8',
        nit_type: 'NIT',
        organization_id: org.id,
        store_code: ROKU_IDENTIFIERS.storeCode,
        store_type: ROKU_IDENTIFIERS.storeType as any,
        timezone: BOGOTA.timezone,
        is_active: true,
        onboarding: true,
        operating_hours: {
          monday: { open: '09:00', close: '20:00' },
          tuesday: { open: '09:00', close: '20:00' },
          wednesday: { open: '09:00', close: '20:00' },
          thursday: { open: '09:00', close: '20:00' },
          friday: { open: '09:00', close: '21:00' },
          saturday: { open: '10:00', close: '21:00' },
          sunday: { open: '11:00', close: '18:00' },
        },
      },
    });
    data.store = store;
    counts.stores = 1;

    // === 7. Store address (physical location) ===
    const storeAddr = await prisma.addresses.findFirst({
      where: { store_id: store.id, type: 'store_physical' as any },
    });
    if (!storeAddr) await prisma.addresses.create({
      data: {
        store_id: store.id,
        type: 'store_physical',
        address_line1: 'Calle 93 #11-27',
        address_line2: 'Local 201, Centro Comercial El Retiro',
        city: BOGOTA.city,
        state_province: BOGOTA.state_province,
        country_code: BOGOTA.country_code,
        postal_code: '110221',
        municipality_code: BOGOTA.municipality_code,
        phone_number: '+57-1-5550101',
        is_primary: true,
      },
    }).catch((e) => {
      // Best-effort: address may already exist
      log(`    (store address: ${e?.code ?? 'duplicate'})`);
    });

    // === 8. Store settings ===
    // Use the SAME canonical shape the backend writes for real stores
    // (sidebar/module visibility, migrator and settings endpoints expect it).
    const { getDefaultStoreSettings } = await import(
      '../../../src/domains/store/settings/defaults/default-store-settings'
    );
    const rokuStoreSettings: any = getDefaultStoreSettings();
    rokuStoreSettings.branding = {
      ...rokuStoreSettings.branding,
      name: ROKU_IDENTIFIERS.storeName,
    };
    rokuStoreSettings.general = {
      ...rokuStoreSettings.general,
      timezone: BOGOTA.timezone,
      currency: CURRENCY,
      language: 'es',
    };
    rokuStoreSettings.publication = {
      ...rokuStoreSettings.publication,
      store_published: true,
      ecommerce_enabled: true,
      landing_enabled: true,
      allow_public_access: true,
    };
    // update: {} — store 10 already has real settings (branding, panel_ui);
    // the canonical default shape is only used when no row exists yet.
    await prisma.store_settings.upsert({
      where: { store_id: store.id },
      update: {},
      create: {
        store_id: store.id,
        settings: rokuStoreSettings,
      },
    });

    // === 8b. Store subscription (trial) ===
    // Without a store_subscriptions row the subscription gate treats the
    // store as blocked and the panel shows nothing usable.
    log('  · Creating trial store subscription');
    const trialPlan = await prisma.subscription_plans.findFirst({
      where: { OR: [{ is_default: true }, { code: { contains: 'trial', mode: 'insensitive' } }] },
      orderBy: { id: 'asc' },
    });
    if (trialPlan) {
      const existingSub = await prisma.store_subscriptions.findFirst({
        where: { store_id: store.id },
      });
      if (!existingSub) {
        const periodEnd = new Date(today.getTime() + 30 * 24 * 3600 * 1000);
        const featuresSnapshot = {
          ...((trialPlan.feature_matrix as any) ?? {}),
          ...((trialPlan.ai_feature_flags as any) ?? {}),
        };
        await prisma.store_subscriptions.create({
          data: {
            store_id: store.id,
            plan_id: trialPlan.id,
            state: 'trial' as any,
            started_at: today,
            trial_ends_at: periodEnd,
            current_period_start: today,
            current_period_end: periodEnd,
            next_billing_at: periodEnd,
            currency: CURRENCY,
            auto_renew: true,
            effective_price: trialPlan.base_price,
            vendix_base_price: trialPlan.base_price,
            partner_margin_amount: 0,
            resolved_features: featuresSnapshot as any,
            resolved_at: today,
            metadata: { source: 'roku-demo' } as any,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        counts.storeSubscriptions = 1;
      }
    } else {
      log('    ! No trial plan found; skipping store subscription');
    }

    // === 9. Default location (warehouse) for the store ===
    log('  · Creating default location (warehouse)');
    // Note: central warehouses cannot belong to a store (per inventory_locations_central_no_store_chk).
    // We keep the warehouse at org level (store_id=null) and use the showroom as store-level default.
    let warehouse = await prisma.inventory_locations.findFirst({
      where: { organization_id: org.id, code: 'ROKU-BOD-01' },
    });
    if (!warehouse) {
      try {
        warehouse = await prisma.inventory_locations.create({
          data: {
            organization_id: org.id,
            store_id: null,
            name: 'Bodega Central',
            code: 'ROKU-BOD-01',
            type: 'warehouse' as any,
            is_active: true,
            is_default: true,
            is_central_warehouse: true,
          } as any,
        });
      } catch (e: any) {
        log(`    ! warehouse create failed: ${e?.message?.slice(0, 200) ?? e}`);
      }
    }
    if (warehouse) data.defaultLocation = warehouse;

    let showroom = await prisma.inventory_locations.findFirst({
      where: { organization_id: org.id, store_id: store.id, code: 'ROKU-SHO-01' },
    });
    if (!showroom) {
      showroom = await prisma.inventory_locations.create({
        data: {
          organization_id: org.id,
          store_id: store.id,
          name: 'Showroom Norte',
          code: 'ROKU-SHO-01',
          type: 'store' as any,
          is_active: true,
          is_default: true,
          is_central_warehouse: false,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; }) as any;
    }
    if (showroom) data.showroomLocation = showroom;

    // The store's default_location is the showroom (since the central warehouse
    // cannot belong to a store per the inventory_locations_central_no_store_chk
    // constraint). The warehouse is org-level.
    if (showroom) {
      await prisma.stores.update({
        where: { id: store.id },
        data: { default_location_id: showroom.id },
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    }

    counts.inventoryLocations = showroom ? 2 : 1;

    // === 10. PUC chart of accounts (reuses default-puc.seed for this org) ===
    log('  · Seeding PUC chart of accounts');
    try {
      const pucSeed = await import('../../../prisma/seeds/default-puc.seed');
      const pucResult = await pucSeed.seedDefaultPuc(org.id, prisma);
      counts.chartOfAccounts = pucResult.accounts_created;
    } catch (e: any) {
      log(`    ! PUC seed failed (${e?.message ?? e}); falling back to direct import`);
      const pucDataMod = await import('../../../src/common/services/data/colombia-puc.data');
      const accounts = pucDataMod.getColombiaPucAccounts();
      let n = 0;
      for (const a of accounts) {
        const parent = a.parent_code
          ? await prisma.chart_of_accounts.findFirst({
              where: { organization_id: org.id, accounting_entity_id: null, code: a.parent_code },
              select: { id: true },
            })
          : null;
        await prisma.chart_of_accounts.upsert({
          where: { id: -1 } as any,
          update: {},
          create: {
            organization_id: org.id,
            code: a.code,
            name: a.name,
            account_type: a.account_type as any,
            nature: a.nature as any,
            parent_id: parent?.id ?? null,
            level: a.level,
            is_active: true,
            accepts_entries: a.accepts_entries,
          } as any,
        }).catch(async () => {
          await prisma.chart_of_accounts.updateMany({
            where: { organization_id: org.id, code: a.code, accounting_entity_id: null } as any,
            data: {
              name: a.name,
              account_type: a.account_type as any,
              nature: a.nature as any,
              parent_id: parent?.id ?? null,
              level: a.level,
              is_active: true,
              accepts_entries: a.accepts_entries,
            },
          });
        });
        n++;
      }
      counts.chartOfAccounts = n;
    }

    // === 11. Accounting entity ===
    log('  · Creating accounting entity');
    let entity = await prisma.accounting_entities.findFirst({
      where: { organization_id: org.id, store_id: store.id, scope: 'STORE' as any },
    });
    if (!entity) {
      entity = await prisma.accounting_entities.create({
        data: {
          organization_id: org.id,
          store_id: store.id,
          scope: 'STORE' as any,
          fiscal_scope: 'STORE' as any,
          name: 'Roku Colombia',
          legal_name: 'Roku Colombia S.A.S.',
          tax_id: ROKU_IDENTIFIERS.orgTaxId,
          is_active: true,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; }) as any;
    }
    if (entity) {
      data.accountingEntity = entity;
    }

    // === 12. Account mappings (default) ===
    log('  · Seeding account mappings');
    try {
      const amSeed = await import('../../../prisma/seeds/default-account-mappings.seed');
      await amSeed.seedDefaultAccountMappings(prisma);
      counts.accountMappings = (await prisma.accounting_account_mappings.count({
        where: { organization_id: org.id },
      }));
    } catch (e: any) {
      log(`    ! Account mappings seed failed: ${e?.message ?? e}`);
    }

    // === 13. Fiscal periods (Dec-2025 .. Jun-2026) ===
    log('  · Creating 7 fiscal periods');
    const periods = monthlyPeriods(7);
    const fiscalPeriods: any[] = [];
    for (const p of periods) {
      const status = p.end < today ? 'closed' : p.label === '2026-06' ? 'open' : 'open';
      const existing = await prisma.fiscal_periods.findFirst({
        where: { organization_id: org.id, name: p.label },
      });
      let period;
      if (existing) {
        period = await prisma.fiscal_periods.update({
          where: { id: existing.id },
          data: {
            start_date: p.start,
            end_date: p.end,
            status: status as any,
            closed_at: status === 'closed' ? p.end : null,
          },
        });
      } else {
        period = await prisma.fiscal_periods.create({
          data: {
            organization_id: org.id,
            accounting_entity_id: entity.id,
            name: p.label,
            start_date: p.start,
            end_date: p.end,
            status: status as any,
            closed_at: status === 'closed' ? p.end : null,
          },
        });
      }
      fiscalPeriods.push(period);
    }
    data.fiscalPeriods = fiscalPeriods;
    data.fiscalPeriodByLabel = new Map(fiscalPeriods.map((p: any) => [p.name, p]));
    counts.fiscalPeriods = fiscalPeriods.length;

    // === 14. Users (admin, employees, cashier, bookkeeping, customers) ===
    log('  · Creating users (admin, employees, cashier, bookkeeping, customers)');
    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const [ownerRole, adminRole, managerRole, employeeRole, cashierRole, customerRole] = await Promise.all([
      prisma.roles.findUnique({ where: { name: 'owner' } }),
      prisma.roles.findUnique({ where: { name: 'admin' } }),
      prisma.roles.findUnique({ where: { name: 'manager' } }),
      prisma.roles.findUnique({ where: { name: 'employee' } }),
      prisma.roles.findUnique({ where: { name: 'cashier' } }),
      prisma.roles.findUnique({ where: { name: 'customer' } }),
    ]);

    const usersToCreate = [
      // Owner / Admin
      { email: 'owner@roku-demo.vendix.local', first_name: 'Andrés', last_name: 'Roku Owner', username: 'roku_owner', role: ownerRole, app: 'VENDIX_ADMIN', code: 'OWN' },
      { email: 'admin@roku-demo.vendix.local', first_name: 'María', last_name: 'García', username: 'roku_admin', role: adminRole, app: 'STORE_ADMIN', code: 'ADM' },
      { email: 'manager@roku-demo.vendix.local', first_name: 'Juan', last_name: 'Pérez', username: 'roku_manager', role: managerRole, app: 'STORE_ADMIN', code: 'MGR' },
      { email: 'cashier@roku-demo.vendix.local', first_name: 'Laura', last_name: 'Martínez', username: 'roku_cashier', role: cashierRole, app: 'STORE_ADMIN', code: 'CSH' },
      { email: 'bookkeeping@roku-demo.vendix.local', first_name: 'Carlos', last_name: 'Rodríguez', username: 'roku_book', role: employeeRole, app: 'STORE_ADMIN', code: 'BKP' },
    ];

    const createdUsers: any[] = [];
    for (const u of usersToCreate) {
      if (!u.role) continue;
      // Look up by username (which is @unique)
      let user = await prisma.users.findUnique({ where: { username: u.username } });
      if (!user) {
        user = await prisma.users.create({
          data: {
            email: u.email,
            password: hashedPassword,
            first_name: u.first_name,
            last_name: u.last_name,
            username: u.username,
            email_verified: true,
            state: 'active',
            organization_id: org.id,
            main_store_id: store.id,
            document_type: 'CC',
            document_number: `1000000${Math.floor(Math.random() * 9999)}`,
            phone: `+57-3${Math.floor(1000000 + Math.random() * 8999999)}`,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      }
      if (!user) continue;
      // Assign role (idempotent via createMany skipDuplicates)
      await prisma.user_roles.createMany({
        data: { user_id: user.id, role_id: u.role!.id },
        skipDuplicates: true,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });

      // Assign to store (idempotent via compound unique store_id+user_id)
      await prisma.store_users.upsert({
        where: { store_id_user_id: { store_id: store.id, user_id: user.id } },
        update: {},
        create: { user_id: user.id, store_id: store.id },
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });

      // User settings
      await prisma.user_settings.upsert({
        where: { user_id: user.id },
        update: {},
        create: {
          user_id: user.id,
          app_type: u.app as any,
          config: {
            panel_ui: {
              [u.app]: { dashboard: true },
            },
            preferences: { language: 'es', theme: 'default' },
          } as any,
        },
      });

      createdUsers.push({ ...user, _code: u.code });
    }
    data.adminUser = createdUsers[0];
    data.posCashier = createdUsers.find((u) => u._code === 'CSH');
    data.bookkeepingUser = createdUsers.find((u) => u._code === 'BKP');
    counts.usersInternal = createdUsers.length;

    // === 15. DIAN configuration (test environment) ===
    log('  · Creating DIAN configuration (test)');
    let dianConfig = await prisma.dian_configurations.findFirst({
      where: { organization_id: org.id, store_id: store.id, name: 'DIAN Roku - Test' },
    });
    if (!dianConfig) {
      dianConfig = await prisma.dian_configurations.create({
        data: {
          organization_id: org.id,
          store_id: store.id,
          accounting_entity_id: entity!.id,
          name: 'DIAN Roku - Test',
          nit: ROKU_IDENTIFIERS.orgTaxId,
          nit_dv: '8',
          nit_type: 'NIT' as any,
          is_default: true,
          configuration_type: 'invoicing' as any,
          operation_mode: 'own_software' as any,
          software_id: 'ROKU-DEMO-SOFTWARE-ID',
          software_pin_encrypted: 'demo-pin-encrypted',
          certificate_source: 'manual_upload_validated' as any,
          certificate_uploaded_at: new Date('2025-11-01T00:00:00Z'),
          certificate_expiry: new Date('2027-11-01T00:00:00Z'),
          certificate_fingerprint: 'DEMO-FINGERPRINT-ROKU',
          certificate_subject: 'CN=Roku Colombia S.A.S., O=Roku Colombia, C=CO',
          certificate_issuer: 'CN=AC Demo, O=AC Root, C=CO',
          certificate_serial_number: 'DEMO-SERIAL-12345',
          certificate_nit: ROKU_IDENTIFIERS.orgTaxId,
          environment: 'test' as any,
          enablement_status: 'enabled' as any,
          test_set_id: 'ROKU-DEMO-TESTSET-001',
          enabled_at: new Date('2025-11-15T00:00:00Z'),
          last_test_result: {
            test_set: 'passed',
            date: '2025-11-15T00:00:00Z',
            details: 'All test cases passed (demo)',
          } as any,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; }) as any;
    }
    if (dianConfig) {
      data.dianConfig = dianConfig;
      counts.dianConfigurations = 1;
    }

    // === 16. Invoice resolution (numbering range) ===
    log('  · Creating invoice resolution');
    let resolution = await prisma.invoice_resolutions.findFirst({
      where: { organization_id: org.id, resolution_number: 'ROKU-RES-2025-001' },
    });
    if (!resolution) {
      resolution = await prisma.invoice_resolutions.create({
        data: {
          organization_id: org.id,
          store_id: store.id,
          accounting_entity_id: entity!.id,
          document_type: 'sales_invoice' as any,
          resolution_number: 'ROKU-RES-2025-001',
          resolution_date: new Date('2025-11-15T00:00:00Z'),
          prefix: 'ROKU',
          range_from: 1,
          range_to: 5000,
          current_number: 1,
          valid_from: new Date('2025-12-01T00:00:00Z'),
          valid_to: new Date('2027-12-01T00:00:00Z'),
          is_active: true,
          technical_key: 'demo-technical-key-roku',
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; }) as any;
    }
    if (resolution) {
      data.invoiceResolution = resolution;
      counts.invoiceResolutions = 1;
    }

    log(`  ✓ Stage 01 counts: ${JSON.stringify(counts)}`);
    return counts;
  },
};
