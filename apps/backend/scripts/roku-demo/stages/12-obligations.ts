/**
 * Stage 12 — Obligations & Declarations
 *
 * Creates 12+ `fiscal_obligations` (monthly: VAT, withholding, ICA, exogena,
 * monthly close; annual: income_tax_precierre, annual close), ~10
 * `tax_declaration_drafts` with `tax_declaration_lines`, 2+
 * `fiscal_close_sessions` with checks, and `fiscal_operation_events`.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { monthlyPeriods, vatDueDate, incomeTaxDueDate, TODAY } from '../lib/dates';

export const stage12Obligations: Stage = {
  id: '12',
  name: 'Obligations & Declarations',
  description: 'Monthly obligations, declarations, close sessions, events',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;
    const orgId = data.organization.id;
    const storeId = data.store.id;
    const user = data.adminUser;
    const entity = data.accountingEntity;
    const orders = data.orders || [];
    const fiscalPeriodByLabel = data.fiscalPeriodByLabel;
    const counts: Record<string, number> = {
      fiscalObligations: 0,
      taxDeclarationDrafts: 0,
      taxDeclarationLines: 0,
      fiscalCloseSessions: 0,
      fiscalCloseChecks: 0,
      fiscalOperationEvents: 0,
    };

    // === Monthly obligations: VAT + withholding + monthly close per period ===
    out('  · Creating monthly obligations (VAT, withholding, monthly close) per period');
    const periods = monthlyPeriods(ctx.options.monthsBack);
    for (const p of periods) {
      const period = fiscalPeriodByLabel?.get(p.label);
      if (!period) continue;
      const isPast = p.end < TODAY;
      // VAT bimonthly: 2025-12/2026-01, 2026-02/03, 2026-04/05
      const isBimonthly = p.month % 2 === 0;
      if (isBimonthly) {
        const [yStr, mStr] = p.label.split('-');
        const vatDue = vatDueDate(parseInt(yStr!), parseInt(mStr!));
        const totalSalesInBim = orders.filter((o: any) => o.placed_at >= p.start && o.placed_at <= p.end)
          .reduce((sum: number, o: any) => sum + Number(o.subtotal_amount), 0);
        const generatedVAT = totalSalesInBim * 0.19;
        const deductibleVAT = totalSalesInBim * 0.05; // assume
        const payable = Math.max(0, generatedVAT - deductibleVAT);
        // Re-runnable: unique (accounting_entity_id, type, period_year, period_month, period_quarter)
        const existingVatOb = await prisma.fiscal_obligations.findFirst({
          where: { accounting_entity_id: entity.id, type: 'vat_return' as any, period_year: p.year, period_month: p.month },
        });
        const vatOb = existingVatOb ? null : await prisma.fiscal_obligations.create({
          data: {
            organization_id: orgId,
            store_id: storeId,
            accounting_entity_id: entity.id,
            type: 'vat_return' as any,
            status: isPast ? 'paid' : (rng.chance(0.5) ? 'ready' : 'in_progress') as any,
            period_year: p.year,
            period_month: p.month, // schema has no period_bimester; closing month of the bimester
            period_start: p.start,
            period_end: p.end,
            due_date: vatDue,
            estimated_amount: new Prisma.Decimal(payable),
            final_amount: new Prisma.Decimal(payable),
            currency: 'COP',
            source: 'auto',
            source_ref: `VAT-${p.label}`,
            notes: 'Obligación bimestral de IVA',
            assigned_to_user_id: data.bookkeepingUser?.id ?? user?.id,
            approved_by_user_id: isPast ? user?.id : null,
            submitted_at: isPast ? vatDue : null,
            paid_at: isPast ? vatDue : null,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (vatOb) counts.fiscalObligations++;

        // Declaration draft (re-runnable: skip if one already exists for this period)
        const existingDraft = await prisma.tax_declaration_drafts.findFirst({
          where: { accounting_entity_id: entity.id, declaration_type: 'vat' as any, period_year: p.year, period_month: p.month },
        });
        const draft = existingDraft ? null : await prisma.tax_declaration_drafts.create({
          data: {
            organization_id: orgId,
            store_id: storeId,
            accounting_entity_id: entity.id,
            declaration_type: 'vat' as any,
            status: isPast ? 'paid' : 'draft' as any,
            period_year: p.year,
            period_month: p.month, // schema has no period_bimester
            period_start: p.start,
            period_end: p.end,
            currency: 'COP',
            gross_base_amount: new Prisma.Decimal(totalSalesInBim),
            taxable_base_amount: new Prisma.Decimal(totalSalesInBim),
            generated_tax_amount: new Prisma.Decimal(generatedVAT),
            deductible_tax_amount: new Prisma.Decimal(deductibleVAT),
            balance_due: new Prisma.Decimal(payable),
            total_payable: new Prisma.Decimal(payable),
            rules_snapshot: { source: 'demo' } as any,
            source_snapshot: { source: 'demo' } as any,
            validation_summary: { ok: true } as any,
            approved_by_user_id: isPast ? user?.id : null,
            submitted_at: isPast ? vatDue : null,
            paid_at: isPast ? vatDue : null,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (draft) {
          counts.taxDeclarationDrafts++;
          // 2 lines: gross VAT and deductible VAT (source_type is required in schema)
          const line1 = await prisma.tax_declaration_lines.create({
            data: {
              declaration_id: draft.id,
              line_type: 'vat_generated',
              source_type: 'invoice',
              description: 'IVA generado en ventas',
              base_amount: new Prisma.Decimal(totalSalesInBim),
              tax_amount: new Prisma.Decimal(generatedVAT),
              credit_amount: new Prisma.Decimal(generatedVAT),
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (line1) counts.taxDeclarationLines++;
          const line2 = await prisma.tax_declaration_lines.create({
            data: {
              declaration_id: draft.id,
              line_type: 'vat_deductible',
              source_type: 'invoice',
              description: 'IVA descontable en compras',
              base_amount: new Prisma.Decimal(totalSalesInBim),
              tax_amount: new Prisma.Decimal(deductibleVAT),
              debit_amount: new Prisma.Decimal(deductibleVAT),
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (line2) counts.taxDeclarationLines++;
        }
      }

      // Monthly withholding
      const totalWh = orders.filter((o: any) => o.placed_at >= p.start && o.placed_at <= p.end)
        .reduce((sum: number, o: any) => sum + Number(o.subtotal_amount) * 0.04, 0);
      const existingWhOb = await prisma.fiscal_obligations.findFirst({
        where: { accounting_entity_id: entity.id, type: 'withholding_return' as any, period_year: p.year, period_month: p.month },
      });
      const whOb = existingWhOb ? null : await prisma.fiscal_obligations.create({
        data: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: entity.id,
          type: 'withholding_return' as any,
          status: isPast ? 'paid' : 'pending' as any,
          period_year: p.year,
          period_month: p.month,
          period_start: p.start,
          period_end: p.end,
          due_date: vatDueDate(p.year, p.month),
          estimated_amount: new Prisma.Decimal(totalWh),
          final_amount: new Prisma.Decimal(totalWh),
          currency: 'COP',
          source: 'auto',
          source_ref: `WH-${p.label}`,
          notes: 'Retención en la fuente mensual',
          assigned_to_user_id: data.bookkeepingUser?.id ?? user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (whOb) counts.fiscalObligations++;

      // Monthly close obligation
      if (isPast) {
        const existingCloseOb = await prisma.fiscal_obligations.findFirst({
          where: { accounting_entity_id: entity.id, type: 'monthly_close' as any, period_year: p.year, period_month: p.month },
        });
        const closeOb = existingCloseOb ? null : await prisma.fiscal_obligations.create({
          data: {
            organization_id: orgId,
            store_id: storeId,
            accounting_entity_id: entity.id,
            type: 'monthly_close' as any,
            status: 'paid' as any,
            period_year: p.year,
            period_month: p.month,
            period_start: p.start,
            period_end: p.end,
            due_date: p.end,
            currency: 'COP',
            source: 'auto',
            source_ref: `CLOSE-${p.label}`,
            notes: 'Cierre contable mensual',
            // schema has no closed_at / closed_by_user_id on fiscal_obligations
            approved_at: p.end,
            accepted_at: p.end,
            approved_by_user_id: user?.id,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (closeOb) counts.fiscalObligations++;
      }
    }

    // === Annual: income_tax_precierre + annual_close ===
    out('  · Creating annual obligations (income tax pre-cierre, annual close)');
    const existingPrecOb = await prisma.fiscal_obligations.findFirst({
      where: { accounting_entity_id: entity.id, type: 'income_tax_precierre' as any, period_year: 2025 },
    });
    const precOb = existingPrecOb ? null : await prisma.fiscal_obligations.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        accounting_entity_id: entity.id,
        type: 'income_tax_precierre' as any,
        status: 'ready' as any,
        period_year: 2025,
        period_start: new Date('2025-01-01T00:00:00Z'),
        period_end: new Date('2025-12-31T23:59:59Z'),
        due_date: incomeTaxDueDate(2026),
        estimated_amount: new Prisma.Decimal(45000000),
        final_amount: new Prisma.Decimal(45000000),
        currency: 'COP',
        source: 'auto',
        source_ref: 'IT-2025-PREC',
        notes: 'Pre-cierre renta 2025 (no declaración oficial)',
        assigned_to_user_id: data.bookkeepingUser?.id ?? user?.id,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (precOb) counts.fiscalObligations++;

    // Pre-cierre draft
    const totalRevenues = orders.reduce((s: number, o: any) => s + Number(o.subtotal_amount), 0);
    const existingIncomeDraft = await prisma.tax_declaration_drafts.findFirst({
      where: { accounting_entity_id: entity.id, declaration_type: 'income_tax_precierre' as any, period_year: 2025 },
    });
    const incomeDraft = existingIncomeDraft ? null : await prisma.tax_declaration_drafts.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        accounting_entity_id: entity.id,
        declaration_type: 'income_tax_precierre' as any,
        status: 'ready' as any,
        period_year: 2025,
        period_start: new Date('2025-01-01T00:00:00Z'),
        period_end: new Date('2025-12-31T23:59:59Z'),
        currency: 'COP',
        gross_base_amount: new Prisma.Decimal(totalRevenues),
        taxable_base_amount: new Prisma.Decimal(totalRevenues * 0.35), // 35% of revenue as est. base
        generated_tax_amount: new Prisma.Decimal(45000000),
        balance_due: new Prisma.Decimal(45000000),
        total_payable: new Prisma.Decimal(45000000),
        rules_snapshot: { source: 'demo' } as any,
        source_snapshot: { source: 'demo' } as any,
        validation_summary: { disclaimer: 'Pre-cierre operativo, no declaración oficial' } as any,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (incomeDraft) {
      counts.taxDeclarationDrafts++;
      const incomeLine = await prisma.tax_declaration_lines.create({
        data: {
          declaration_id: incomeDraft.id,
          line_type: 'income_tax_estimate',
          source_type: 'fiscal_rule',
          description: 'Estimación renta 2025 (utilidad fiscal x 35%)',
          base_amount: new Prisma.Decimal(totalRevenues * 0.35),
          tax_amount: new Prisma.Decimal(45000000),
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (incomeLine) counts.taxDeclarationLines++;
    }

    // Annual close
    const existingAnnualOb = await prisma.fiscal_obligations.findFirst({
      where: { accounting_entity_id: entity.id, type: 'annual_close' as any, period_year: 2025 },
    });
    const annualOb = existingAnnualOb ? null : await prisma.fiscal_obligations.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        accounting_entity_id: entity.id,
        type: 'annual_close' as any,
        status: 'in_progress' as any,
        period_year: 2025,
        period_start: new Date('2025-01-01T00:00:00Z'),
        period_end: new Date('2025-12-31T23:59:59Z'),
        due_date: new Date('2026-04-15T00:00:00Z'),
        currency: 'COP',
        source: 'auto',
        source_ref: 'CLOSE-2025',
        notes: 'Cierre contable anual 2025',
        assigned_to_user_id: data.bookkeepingUser?.id ?? user?.id,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (annualOb) counts.fiscalObligations++;

    // Exogenous 2025
    const existingExogOb = await prisma.fiscal_obligations.findFirst({
      where: { accounting_entity_id: entity.id, type: 'exogenous_report' as any, period_year: 2025 },
    });
    const exogOb = existingExogOb ? null : await prisma.fiscal_obligations.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        accounting_entity_id: entity.id,
        type: 'exogenous_report' as any,
        status: 'ready' as any,
        period_year: 2025,
        period_start: new Date('2025-01-01T00:00:00Z'),
        period_end: new Date('2025-12-31T23:59:59Z'),
        due_date: new Date('2026-03-31T00:00:00Z'),
        currency: 'COP',
        source: 'auto',
        source_ref: 'EXOG-2025',
        notes: 'Reporte exógena 2025',
        assigned_to_user_id: data.bookkeepingUser?.id ?? user?.id,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (exogOb) counts.fiscalObligations++;

    // === Fiscal close sessions (2: monthly + annual) ===
    out('  · Creating 2 fiscal close sessions with checks');
    // Re-runnable: unique (accounting_entity_id, close_type, period_year, period_month)
    const existingSession1 = await prisma.fiscal_close_sessions.findFirst({
      where: { accounting_entity_id: entity.id, close_type: 'monthly', period_year: 2026, period_month: 4 },
    });
    const session1 = existingSession1 ?? await prisma.fiscal_close_sessions.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        accounting_entity_id: entity.id,
        fiscal_period_id: fiscalPeriodByLabel?.get('2026-04')?.id,
        status: 'closed' as any,
        close_type: 'monthly' as any,
        period_year: 2026,
        period_month: 4,
        period_start: new Date('2026-04-01T00:00:00Z'),
        period_end: new Date('2026-04-30T23:59:59Z'),
        started_by_user_id: user?.id,
        approved_at: new Date('2026-05-05T00:00:00Z'),
        approved_by_user_id: user?.id,
        closed_at: new Date('2026-05-05T00:00:00Z'),
        closed_by_user_id: user?.id,
        summary: { source: 'demo' } as any,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (session1) {
      if (!existingSession1) counts.fiscalCloseSessions++;
      for (const checkKey of ['trial_balance', 'bank_reconciliation', 'inventory_valuation', 'ar_aging', 'ap_aging'] as const) {
        const check = await prisma.fiscal_close_checks.upsert({
          where: { close_session_id_check_key: { close_session_id: session1.id, check_key: checkKey } },
          update: {},
          create: {
            close_session_id: session1.id,
            check_key: checkKey,
            status: checkKey === 'bank_reconciliation' ? 'warning' : 'passed' as any,
            severity: checkKey === 'bank_reconciliation' ? 'warning' : 'info' as any,
            title: `Check: ${checkKey}`,
            description: `Resultado del cierre para ${checkKey}`,
            blocking: false,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (check) counts.fiscalCloseChecks++;
      }
    }

    const existingSession2 = await prisma.fiscal_close_sessions.findFirst({
      where: { accounting_entity_id: entity.id, close_type: 'annual', period_year: 2025, period_month: null },
    });
    const session2 = existingSession2 ?? await prisma.fiscal_close_sessions.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        accounting_entity_id: entity.id,
        fiscal_period_id: fiscalPeriodByLabel?.get('2025-12')?.id,
        status: 'checking' as any, // fiscal_close_status_enum has no 'in_progress'
        close_type: 'annual' as any,
        period_year: 2025,
        period_start: new Date('2025-01-01T00:00:00Z'),
        period_end: new Date('2025-12-31T23:59:59Z'),
        started_by_user_id: user?.id,
        started_at: new Date('2026-01-15T00:00:00Z'),
        summary: { source: 'demo' } as any,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (session2) {
      if (!existingSession2) counts.fiscalCloseSessions++;
      for (const checkKey of ['trial_balance', 'inventory_valuation', 'fixed_assets_depreciation', 'bank_reconciliation', 'tax_provisions', 'income_tax_estimate'] as const) {
        const check = await prisma.fiscal_close_checks.upsert({
          where: { close_session_id_check_key: { close_session_id: session2.id, check_key: checkKey } },
          update: {},
          create: {
            close_session_id: session2.id,
            check_key: checkKey,
            status: checkKey === 'tax_provisions' ? 'failed' : (checkKey === 'fixed_assets_depreciation' ? 'warning' : 'passed') as any,
            severity: checkKey === 'tax_provisions' ? 'error' : (checkKey === 'fixed_assets_depreciation' ? 'warning' : 'info') as any,
            title: `Check anual: ${checkKey}`,
            description: `Resultado del cierre anual para ${checkKey}`,
            blocking: checkKey === 'tax_provisions',
            override_reason: checkKey === 'tax_provisions' ? 'Pendiente cálculo final de provisión' : null,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (check) counts.fiscalCloseChecks++;
      }
    }

    // === Fiscal operation events (30+) ===
    out('  · Creating 30 fiscal_operation_events');
    const eventTypes = [
      'obligation_created', 'obligation_status_changed',
      'declaration_created', 'declaration_status_changed',
      'close_session_started', 'close_check_resolved',
      'transmission_accepted', 'fiscal_period_closed',
    ];
    for (let i = 0; i < 30; i++) {
      const evDate = addDays(TODAY, -Math.floor(rng.int(1, 180)));
      const event = await prisma.fiscal_operation_events.create({
        data: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: entity.id,
          event_type: rng.pick(eventTypes),
          resource_type: 'fiscal_obligation',
          resource_id: rng.int(1, 50),
          previous_status: 'pending',
          new_status: rng.pick(['approved', 'submitted', 'paid', 'ready', 'closed']),
          actor_user_id: user?.id,
          created_at: evDate, // schema has no occurred_at; created_at carries the event date
          metadata: { source: 'demo' } as any,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (event) counts.fiscalOperationEvents++;
    }

    out(`  ✓ Stage 12: ${JSON.stringify(counts)}`);
    return counts;
  },
};

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
