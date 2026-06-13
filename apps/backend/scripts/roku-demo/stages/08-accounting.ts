/**
 * Stage 08 — Accounting
 *
 * Creates 5 expense categories + 5 expenses, 1 bank account + 30 bank
 * transactions + 1 reconciliation, 2 fixed assets + 5 depreciation entries,
 * 1 budget, and a final pass that simulates the AccountingEventsListener
 * to materialize `accounting_entries` for the major events generated in
 * stages 5, 6, 7, 9.
 *
 * The accounting entries are produced by manually computing balanced
 * double-entry lines (debit = credit per entry) using the default
 * accounting_account_mappings.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { randomDateInWindow, monthlyPeriods, addDays, TODAY } from '../lib/dates';
import { transactionRef, assetNumber } from '../lib/ids';

interface AccountEntry {
  code: string; // PUC code
  debit?: number;
  credit?: number;
  description?: string;
}

export const stage08Accounting: Stage = {
  id: '08',
  name: 'Accounting',
  description: 'Expenses, bank, fixed_assets, depreciation, budgets, accounting_entries',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;
    const orgId = data.organization.id;
    const storeId = data.store.id;
    const user = data.adminUser;
    const entity = data.accountingEntity;
    const fiscalPeriodByLabel = data.fiscalPeriodByLabel;
    const counts: Record<string, number> = {
      expenseCategories: 0,
      expenses: 0,
      bankAccounts: 0,
      bankTransactions: 0,
      bankReconciliations: 0,
      bankReconciliationMatches: 0,
      fixedAssets: 0,
      depreciationEntries: 0,
      budgetLines: 0,
      accountingEntries: 0,
      accountingEntryLines: 0,
    };

    // === Expense categories (5) ===
    out('  · Creating 5 expense categories');
    const expCats: any[] = [];
    const expCatData = [
      { name: 'Servicios públicos', color: '#F59E0B' },
      { name: 'Arriendo', color: '#8B5CF6' },
      { name: 'Internet y comunicaciones', color: '#3B82F6' },
      { name: 'Marketing y publicidad', color: '#EC4899' },
      { name: 'Insumos de oficina', color: '#10B981' },
    ];
    for (const c of expCatData) {
      const cat = await prisma.expense_categories.upsert({
        where: { organization_id_name: { organization_id: orgId, name: c.name } },
        update: {},
        create: {
          organization_id: orgId,
          name: c.name,
          description: `Categoría ${c.name}`,
          color: c.color,
          is_active: true,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (cat) {
        expCats.push(cat);
        counts.expenseCategories++;
      }
    }

    // === Expenses (5+) ===
    out('  · Creating 6 expenses');
    const periods = monthlyPeriods(ctx.options.monthsBack).filter((p) => p.end < TODAY);
    for (let e = 0; e < 6; e++) {
      const period = periods[e % periods.length]!;
      const expDate = randomDateInWindow(rng, period.start, period.end);
      const expCat = expCats[e % expCats.length]!;
      const amount = rng.pesos(300000, 2500000);
      const isPaid = e < 4;
      const expense = await prisma.expenses.create({
        data: {
          store_id: storeId,
          organization_id: orgId,
          category_id: expCat.id,
          amount: new Prisma.Decimal(amount),
          currency: 'COP',
          description: `${expCat.name} - mes ${period.label}`,
          expense_date: expDate,
          state: isPaid ? 'paid' : 'approved' as any,
          notes: 'Gasto operativo demo',
          created_by_user_id: user?.id,
          approved_by_user_id: user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (expense) counts.expenses++;
    }

    // === Bank account ===
    out('  · Creating bank account + transactions + reconciliation');
    const chartBank = await prisma.chart_of_accounts.findFirst({
      where: { organization_id: orgId, code: '1110' }, // Bancos
    });
    const bank = await prisma.bank_accounts.upsert({
      where: { organization_id_account_number: { organization_id: orgId, account_number: '123-456789-00' } },
      update: {},
      create: {
        organization_id: orgId,
        store_id: storeId,
        name: 'Bancolombia Cuenta Corriente',
        account_number: '123-456789-00',
        bank_name: 'Bancolombia',
        bank_code: '007',
        currency: 'COP',
        opening_balance: new Prisma.Decimal(15000000),
        current_balance: new Prisma.Decimal(15000000),
        status: 'active' as any,
        chart_account_id: chartBank?.id,
      } as any,
    }).catch(async () => {
      const existing = await prisma.bank_accounts.findFirst({
        where: { organization_id: orgId, account_number: '123-456789-00' },
      });
      return existing;
    });
    if (bank) {
      counts.bankAccounts++;
      // 30 transactions spread over 6 months
      const createdTxs: any[] = [];
      for (let t = 0; t < 30; t++) {
        const txDate = randomDateInWindow(rng, addDays(TODAY, -180), TODAY);
        const isCredit = rng.chance(0.6);
        const amount = rng.pesos(500000, 5000000);
        const type: any = isCredit ? 'credit' : 'debit';
        const externalId = `BTX-${rng.int(100000, 999999)}`;
        const tx = await prisma.bank_transactions.upsert({
          where: { bank_account_id_external_id: { bank_account_id: bank.id, external_id: externalId } },
          update: {},
          create: {
            bank_account_id: bank.id,
            transaction_date: txDate,
            value_date: txDate,
            description: isCredit ? 'Recaudo de ventas' : 'Pago a proveedor',
            amount: new Prisma.Decimal(isCredit ? amount : -amount),
            type: type as any,
            reference: transactionRef(rng),
            external_id: externalId,
            counterparty: isCredit ? 'Clientes Roku' : 'Proveedores varios',
            is_reconciled: t < 20,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (tx) {
          createdTxs.push(tx);
          counts.bankTransactions++;
        }
      }
      // Reconciliation for last month
      const recon = await prisma.bank_reconciliations.create({
        data: {
          bank_account_id: bank.id,
          period_start: addDays(TODAY, -30),
          period_end: TODAY,
          opening_balance: new Prisma.Decimal(12000000),
          statement_balance: new Prisma.Decimal(15000000),
          reconciled_balance: new Prisma.Decimal(14980000),
          difference: new Prisma.Decimal(-2000),
          status: 'completed' as any,
          created_by_user_id: user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (recon) {
        counts.bankReconciliations++;
        // Match against transactions created/found in THIS run (real FKs)
        for (const tx of createdTxs.slice(0, 3)) {
          const match = await prisma.bank_reconciliation_matches.create({
            data: {
              reconciliation_id: recon.id,
              bank_transaction_id: tx.id,
              match_type: 'auto' as any,
              confidence_score: new Prisma.Decimal(0.95),
              notes: 'Match automático',
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (match) counts.bankReconciliationMatches++;
        }
      }
    }

    // === Fixed assets (2) ===
    out('  · Creating 2 fixed assets + depreciation entries');
    // fixed_asset_categories has no unique on (organization_id, name) → find-then-create
    let fixedAssetCat = await prisma.fixed_asset_categories.findFirst({
      where: { organization_id: orgId, name: 'Equipos de Cómputo' },
    });
    if (!fixedAssetCat) {
      fixedAssetCat = await prisma.fixed_asset_categories.create({
        data: {
          organization_id: orgId,
          name: 'Equipos de Cómputo',
          default_useful_life_months: 36,
          default_depreciation_method: 'straight_line' as any,
          default_salvage_percentage: new Prisma.Decimal(10),
          depreciation_account_code: '5160',
          expense_account_code: '5195',
          is_active: true,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    }
    const assets: any[] = [];
    for (let a = 0; a < 2; a++) {
      const acqDate = addDays(TODAY, -(180 - a * 60));
      const acqCost = a === 0 ? 4500000 : 3200000;
      const salvage = acqCost * 0.1;
      const assetNo = assetNumber(acqDate, a + 1);
      const asset = await prisma.fixed_assets.upsert({
        where: { organization_id_asset_number: { organization_id: orgId, asset_number: assetNo } },
        update: {},
        create: {
          organization_id: orgId,
          store_id: storeId,
          category_id: fixedAssetCat?.id,
          asset_number: assetNo,
          name: a === 0 ? 'Computador oficina administrativa' : 'Estantería showroom',
          description: 'Activo fijo demo',
          acquisition_date: acqDate,
          acquisition_cost: new Prisma.Decimal(acqCost),
          salvage_value: new Prisma.Decimal(salvage),
          useful_life_months: 36,
          depreciation_method: 'straight_line' as any,
          status: 'active' as any,
          accumulated_depreciation: new Prisma.Decimal(0),
          depreciation_start_date: acqDate,
          created_by_user_id: user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (asset) {
        assets.push(asset);
        counts.fixedAssets++;

        // Monthly depreciation entries (5 per asset)
        const monthlyDep = (acqCost - salvage) / 36;
        for (let d = 0; d < 5; d++) {
          const depDate = addDays(acqDate, 30 * (d + 1));
          // accounting_entries.fiscal_period_id is required → resolve from the dep date
          const depPeriod = fiscalPeriodByLabel?.get(`${depDate.getUTCFullYear()}-${String(depDate.getUTCMonth() + 1).padStart(2, '0')}`);
          if (!depPeriod) {
            out(`    ! No fiscal period for depreciation date ${depDate.toISOString().slice(0, 10)}; skipping entry`);
            continue;
          }
          // depreciation_entries row first: its id is the source of the
          // accounting entry (the DB enforces a unique on org+source_type+
          // source_id+entity, so asset.id can't be reused across months)
          const depRow = await prisma.depreciation_entries.upsert({
            where: { fixed_asset_id_period_date: { fixed_asset_id: asset.id, period_date: depDate } },
            update: {},
            create: {
              fixed_asset_id: asset.id,
              period_date: depDate,
              depreciation_amount: new Prisma.Decimal(monthlyDep),
              accumulated_total: new Prisma.Decimal(monthlyDep * (d + 1)),
              book_value: new Prisma.Decimal(acqCost - monthlyDep * (d + 1)),
              status: 'posted' as any,
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (!depRow) continue;
          counts.depreciationEntries++;
          const existingEntry = await prisma.accounting_entries.findFirst({
            where: { organization_id: orgId, source_type: 'depreciation_entry', source_id: depRow.id, accounting_entity_id: entity.id },
          });
          const entry = existingEntry ?? await prisma.accounting_entries.create({
            data: {
              organization_id: orgId,
              store_id: storeId,
              accounting_entity_id: entity.id,
              fiscal_period_id: depPeriod.id,
              entry_number: `DEP-${asset.asset_number}-${d + 1}`,
              entry_type: 'auto_depreciation' as any,
              status: 'posted' as any,
              entry_date: depDate,
              description: `Depreciación mensual ${asset.name} - mes ${d + 1}`,
              source_type: 'depreciation_entry',
              source_id: depRow.id,
              total_debit: new Prisma.Decimal(monthlyDep),
              total_credit: new Prisma.Decimal(monthlyDep),
              created_by_user_id: user?.id,
              posted_by_user_id: user?.id,
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (entry) {
            if (!existingEntry) counts.accountingEntries++;
            // 5160 (depreciation expense) → 1592 (accumulated depreciation)
            const chart5160 = await prisma.chart_of_accounts.findFirst({ where: { organization_id: orgId, code: '5160' } });
            const chart1592 = await prisma.chart_of_accounts.findFirst({ where: { organization_id: orgId, code: '1592' } });
            if (chart5160) {
              const line = await prisma.accounting_entry_lines.create({
                data: {
                  entry_id: entry.id,
                  account_id: chart5160.id,
                  description: 'Gasto depreciación',
                  debit_amount: new Prisma.Decimal(monthlyDep),
                  credit_amount: new Prisma.Decimal(0),
                } as any,
              }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
              if (line) counts.accountingEntryLines++;
            }
            if (chart1592) {
              const line = await prisma.accounting_entry_lines.create({
                data: {
                  entry_id: entry.id,
                  account_id: chart1592.id,
                  description: 'Depreciación acumulada',
                  debit_amount: new Prisma.Decimal(0),
                  credit_amount: new Prisma.Decimal(monthlyDep),
                } as any,
              }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
              if (line) counts.accountingEntryLines++;
            }
            await prisma.depreciation_entries.update({
              where: { id: depRow.id },
              data: { accounting_entry_id: entry.id },
            }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          }
        }
        await prisma.fixed_assets.update({
          where: { id: asset.id },
          data: { accumulated_depreciation: new Prisma.Decimal(monthlyDep * 5) },
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      }
    }

    // === Budget ===
    out('  · Creating 1 budget with 5 lines');
    // budgets.fiscal_period_id is required → resolve it before creating
    const budgetPeriodId = data.fiscalPeriods?.[data.fiscalPeriods.length - 1]?.id;
    if (!budgetPeriodId) out('    ! No fiscal period available for budget; skipping budget');
    const budget = budgetPeriodId ? await prisma.budgets.upsert({
      where: {
        organization_id_store_id_fiscal_period_id_name: {
          organization_id: orgId,
          store_id: storeId,
          fiscal_period_id: budgetPeriodId,
          name: 'Presupuesto 2026',
        },
      },
      update: {},
      create: {
        organization_id: orgId,
        store_id: storeId,
        fiscal_period_id: budgetPeriodId,
        name: 'Presupuesto 2026',
        description: 'Presupuesto operativo anual',
        status: 'approved' as any,
        variance_threshold: new Prisma.Decimal(10),
        approved_at: new Date('2026-01-05T00:00:00Z'),
        approved_by_user_id: user?.id,
        created_by_user_id: user?.id,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; }) : null;
    if (budget) {
      const budgetAccounts = [
        { code: '4135', name: 'Ingresos operacionales', amount: 800000000 },
        { code: '5105', name: 'Gastos de personal', amount: 180000000 },
        { code: '5195', name: 'Gastos administrativos', amount: 60000000 },
        { code: '6135', name: 'Costo de ventas', amount: 480000000 },
        { code: '5295', name: 'Otros gastos', amount: 12000000 },
      ];
      for (const ba of budgetAccounts) {
        const account = await prisma.chart_of_accounts.findFirst({
          where: { organization_id: orgId, code: ba.code },
        });
        if (account) {
          const budgetLine = await prisma.budget_lines.upsert({
            where: { budget_id_account_id: { budget_id: budget.id, account_id: account.id } },
            update: {},
            create: {
              budget_id: budget.id,
              account_id: account.id,
              month_01: new Prisma.Decimal(ba.amount / 12),
              month_02: new Prisma.Decimal(ba.amount / 12),
              month_03: new Prisma.Decimal(ba.amount / 12),
              month_04: new Prisma.Decimal(ba.amount / 12),
              month_05: new Prisma.Decimal(ba.amount / 12),
              month_06: new Prisma.Decimal(ba.amount / 12),
              month_07: new Prisma.Decimal(ba.amount / 12),
              month_08: new Prisma.Decimal(ba.amount / 12),
              month_09: new Prisma.Decimal(ba.amount / 12),
              month_10: new Prisma.Decimal(ba.amount / 12),
              month_11: new Prisma.Decimal(ba.amount / 12),
              month_12: new Prisma.Decimal(ba.amount / 12),
              total_budgeted: new Prisma.Decimal(ba.amount),
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (budgetLine) counts.budgetLines++;
        }
      }
    }

    // === Auto-generate accounting entries from sales events ===
    out('  · Generating auto-accounting entries from sales events');
    const completeOrders = (data.orders || []).filter((o: any) => o.status !== 'cancelled');
    for (const o of completeOrders) {
      const period = fiscalPeriodByLabel?.get(`${o.placed_at.getUTCFullYear()}-${String(o.placed_at.getUTCMonth() + 1).padStart(2, '0')}`);
      if (!period) continue;
      // Build a balanced entry: 1305 (CxC) Dr, 4135 (Ingreso) Cr, 2408 (IVA) Cr
      const sub = Number(o.subtotal_amount);
      const tax = Number(o.tax_amount);
      const total = Number(o.grand_total);
      const ch1305 = await prisma.chart_of_accounts.findFirst({ where: { organization_id: orgId, code: '1305' } });
      const ch4135 = await prisma.chart_of_accounts.findFirst({ where: { organization_id: orgId, code: '4135' } });
      const ch2408 = await prisma.chart_of_accounts.findFirst({ where: { organization_id: orgId, code: '2408' } });
      // re-run guard: the DB enforces a unique on (organization_id, entry_number)
      const existingSaleEntry = await prisma.accounting_entries.findFirst({
        where: { organization_id: orgId, entry_number: `JE-INV-${o.order_number}` },
      });
      if (existingSaleEntry) continue;
      const entry = await prisma.accounting_entries.create({
        data: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: entity.id,
          fiscal_period_id: period.id,
          entry_number: `JE-INV-${o.order_number}`,
          entry_type: 'auto_invoice' as any,
          status: 'posted' as any,
          entry_date: o.placed_at,
          description: `Asiento auto por venta ${o.order_number}`,
          source_type: 'order',
          source_id: o.id,
          total_debit: new Prisma.Decimal(total),
          total_credit: new Prisma.Decimal(total),
          created_by_user_id: user?.id,
          posted_by_user_id: user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (!entry) continue;
      counts.accountingEntries++;
      // Debit 1305
      if (ch1305) {
        const line = await prisma.accounting_entry_lines.create({
          data: { entry_id: entry.id, account_id: ch1305.id, description: 'CxC cliente', debit_amount: new Prisma.Decimal(total), credit_amount: 0 } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (line) counts.accountingEntryLines++;
      }
      // Credit 4135
      if (ch4135) {
        const line = await prisma.accounting_entry_lines.create({
          data: { entry_id: entry.id, account_id: ch4135.id, description: 'Ingreso por ventas', debit_amount: 0, credit_amount: new Prisma.Decimal(sub) } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (line) counts.accountingEntryLines++;
      }
      // Credit 2408
      if (ch2408) {
        const line = await prisma.accounting_entry_lines.create({
          data: { entry_id: entry.id, account_id: ch2408.id, description: 'IVA generado 19%', debit_amount: 0, credit_amount: new Prisma.Decimal(tax) } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (line) counts.accountingEntryLines++;
      }
    }

    out(`  ✓ Stage 08: ${JSON.stringify(counts)}`);
    return counts;
  },
};
