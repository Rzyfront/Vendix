/**
 * Stage 09 — Payroll
 *
 * Creates 5 employees, 5 employee_stores links, 5 payroll_runs (monthly
 * Dec-2025 .. May-2026), payroll_items per employee per run with provisions
 * (prima, cesantías, intereses, vacaciones), 2 payroll_novelties,
 * 1 payroll_settlement, 1 employee_advance with 3 installments.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { monthlyPeriods, payrollDueDate, randomDateInWindow, addDays, TODAY } from '../lib/dates';
import { employeeCode, payrollNumber, settlementNumber, advanceNumber } from '../lib/ids';
import {
  PAYROLL_HEALTH_PCT,
  PAYROLL_PENSION_PCT,
  SEVERANCE_PCT,
  SEVERANCE_INTEREST_PCT,
  PRIMA_PCT,
  VACATION_PCT,
  SALARY_MINIMUM_2026,
  TRANSPORT_ALLOWANCE_2026,
} from '../lib/fiscal-co';

const EMPLOYEES = [
  { code: 'EMP-0001', first_name: 'Sandra', last_name: 'Moreno', position: 'Gerente de tienda', department: 'Administración', salary: 4200000 },
  { code: 'EMP-0002', first_name: 'Felipe', last_name: 'Cárdenas', position: 'Vendedor senior', department: 'Ventas', salary: 2300000 },
  { code: 'EMP-0003', first_name: 'Diana', last_name: 'Rincón', position: 'Vendedor', department: 'Ventas', salary: 1800000 },
  { code: 'EMP-0004', first_name: 'Andrés', last_name: 'Gaviria', position: 'Técnico de instalación', department: 'Servicio técnico', salary: 2100000 },
  { code: 'EMP-0005', first_name: 'Carolina', last_name: 'Mendoza', position: 'Cajera / Auxiliar contable', department: 'Operaciones', salary: 1750905 },
];

export const stage09Payroll: Stage = {
  id: '09',
  name: 'Payroll',
  description: 'Employees, payroll_runs, items, novelties, settlements, advances',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;
    const orgId = data.organization.id;
    const storeId = data.store.id;
    const user = data.adminUser;
    const bookkeeper = data.bookkeepingUser;
    const counts: Record<string, number> = {
      employees: 0,
      employeeStores: 0,
      payrollRuns: 0,
      payrollItems: 0,
      payrollNovelties: 0,
      payrollSettlements: 0,
      employeeAdvances: 0,
      employeeAdvanceInstallments: 0,
      accountingEntries: 0,
      accountingEntryLines: 0,
    };

    // === Employees ===
    out('  · Creating 5 employees');
    const createdEmployees: any[] = [];
    for (let i = 0; i < EMPLOYEES.length; i++) {
      const emp = EMPLOYEES[i]!;
      // Deterministic document number so re-runs don't create duplicates
      const doc = `79000000${String(i + 1).padStart(2, '0')}`;
      const employee = await prisma.employees.upsert({
        where: {
          organization_id_document_type_document_number: {
            organization_id: orgId,
            document_type: 'CC',
            document_number: doc,
          },
        },
        update: {},
        create: {
          organization_id: orgId,
          employee_code: employeeCode('roku', i + 1),
          first_name: emp.first_name,
          last_name: emp.last_name,
          document_type: 'CC',
          document_number: doc,
          hire_date: addDays(TODAY, -180 - i * 30),
          status: 'active' as any,
          contract_type: 'indefinite' as any,
          position: emp.position,
          department: emp.department,
          base_salary: new Prisma.Decimal(emp.salary),
          payment_frequency: 'monthly' as any,
          bank_name: 'Bancolombia',
          bank_account_number: `123-${rng.int(100000, 999999)}-${rng.int(10, 99)}`,
          bank_account_type: 'savings',
          health_provider: rng.pick(['Sura', 'Sanitas', 'Nueva EPS', 'Compensar']),
          pension_fund: rng.pick(['Porvenir', 'Protección', 'Skandia', 'Colfondos']),
          arl_risk_level: 1,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (employee) {
        createdEmployees.push({ ...employee, _salary: emp.salary });
        counts.employees++;
        const empStore = await prisma.employee_stores.upsert({
          where: { employee_id_store_id: { employee_id: employee.id, store_id: storeId } },
          update: {},
          create: {
            employee_id: employee.id,
            store_id: storeId,
            is_primary: true,
            status: 'active' as any,
          },
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (empStore) counts.employeeStores++;
      }
    }

    // === Payroll runs (5 monthly runs: Dec-2025 .. May-2026) ===
    out('  · Creating 6 monthly payroll runs with items');
    const fiscalPeriodsByLabel = data.fiscalPeriodByLabel;
    for (const periodLabel of ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05']) {
      const period = fiscalPeriodsByLabel?.get(periodLabel);
      if (!period) continue;
      const [yStr, mStr] = periodLabel.split('-');
      const year = parseInt(yStr!);
      const month = parseInt(mStr!);
      const periodStart = new Date(Date.UTC(year, month - 1, 1));
      const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
      const payDate = payrollDueDate(year, month);
      const isPaid = payDate < TODAY;

      // Re-runnable: payroll_number is unique per org → skip period if already seeded
      const runNumber = payrollNumber(payDate, month + (year - 2025) * 12);
      const existingRun = await prisma.payroll_runs.findFirst({
        where: { organization_id: orgId, payroll_number: runNumber },
      });
      if (existingRun) continue;

      const run = await prisma.payroll_runs.create({
        data: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: data.accountingEntity.id,
          payroll_number: runNumber,
          status: isPaid ? 'paid' : 'approved' as any,
          frequency: 'monthly' as any,
          period_start: periodStart,
          period_end: periodEnd,
          payment_date: payDate,
          total_earnings: new Prisma.Decimal(0), // computed below
          total_deductions: new Prisma.Decimal(0),
          total_employer_costs: new Prisma.Decimal(0),
          total_net_pay: new Prisma.Decimal(0),
          approved_at: addDays(periodStart, 12),
          approved_by_user_id: user?.id,
          created_by_user_id: bookkeeper?.id ?? user?.id,
          sent_at: isPaid ? payDate : null,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (!run) continue;
      counts.payrollRuns++;

      // Per-employee items
      let runEarnings = 0, runDeductions = 0, runNet = 0;
      for (const emp of createdEmployees) {
        const baseSalary = emp._salary;
        const transport = baseSalary <= 2 * SALARY_MINIMUM_2026 ? TRANSPORT_ALLOWANCE_2026 : 0;
        const prima = baseSalary * PRIMA_PCT;
        const severance = baseSalary * SEVERANCE_PCT;
        const severanceInterest = severance * SEVERANCE_INTEREST_PCT;
        const vacation = baseSalary * VACATION_PCT;
        const totalEarnings = baseSalary + transport + (rng.chance(0.4) ? prima : 0);
        const healthDeduction = baseSalary * PAYROLL_HEALTH_PCT;
        const pensionDeduction = baseSalary * PAYROLL_PENSION_PCT;
        const withholding = baseSalary > 4 * SALARY_MINIMUM_2026 ? baseSalary * 0.01 : 0;
        const totalDeductions = healthDeduction + pensionDeduction + withholding;
        const netPay = totalEarnings - totalDeductions;

        const item = await prisma.payroll_items.create({
          data: {
            payroll_run_id: run.id,
            employee_id: emp.id,
            accounting_entity_id: data.accountingEntity.id,
            base_salary: new Prisma.Decimal(baseSalary),
            worked_days: 30,
            earnings: {
              base_salary: baseSalary,
              transport_allowance: transport,
              prima: rng.chance(0.4) ? prima : 0,
            } as any,
            deductions: {
              health: healthDeduction,
              pension: pensionDeduction,
              withholding: withholding,
            } as any,
            employer_costs: {
              health_employer: baseSalary * 0.085,
              pension_employer: baseSalary * 0.12,
              arl: baseSalary * 0.00522,
              caja: baseSalary * 0.04,
            } as any,
            provisions: {
              severance,
              severance_interest: severanceInterest,
              vacation,
            } as any,
            total_earnings: new Prisma.Decimal(totalEarnings),
            total_deductions: new Prisma.Decimal(totalDeductions),
            total_employer_costs: new Prisma.Decimal(baseSalary * 0.24522),
            net_pay: new Prisma.Decimal(netPay),
            send_status: (isPaid ? 'sent_ok' : 'pending') as any,
            dian_status: (isPaid ? 'accepted' : 'pending') as any,
            accounting_status: (isPaid ? 'posted' : 'provisional') as any,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (item) counts.payrollItems++;
        runEarnings += totalEarnings;
        runDeductions += totalDeductions;
        runNet += netPay;
      }

      // Update run totals
      await prisma.payroll_runs.update({
        where: { id: run.id },
        data: {
          total_earnings: new Prisma.Decimal(runEarnings),
          total_deductions: new Prisma.Decimal(runDeductions),
          total_net_pay: new Prisma.Decimal(runNet),
          total_employer_costs: new Prisma.Decimal(runEarnings * 0.24522),
        },
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });

      // Auto-entry for the run
      const ch5105 = await prisma.chart_of_accounts.findFirst({ where: { organization_id: orgId, code: '5105' } });
      const ch2505 = await prisma.chart_of_accounts.findFirst({ where: { organization_id: orgId, code: '2505' } });
      const ch2370 = await prisma.chart_of_accounts.findFirst({ where: { organization_id: orgId, code: '2370' } });
      const ch2380 = await prisma.chart_of_accounts.findFirst({ where: { organization_id: orgId, code: '2380' } });
      const ch1110 = await prisma.chart_of_accounts.findFirst({ where: { organization_id: orgId, code: '1110' } });
      const entry = await prisma.accounting_entries.create({
        data: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: data.accountingEntity.id,
          fiscal_period_id: period.id,
          entry_number: `JE-PAY-${run.payroll_number}`,
          entry_type: 'auto_payroll' as any,
          status: isPaid ? 'posted' : 'draft' as any,
          entry_date: payDate,
          description: `Nómina ${periodLabel}`,
          source_type: 'payroll_run',
          source_id: run.id,
          total_debit: new Prisma.Decimal(runEarnings),
          total_credit: new Prisma.Decimal(runEarnings),
          created_by_user_id: bookkeeper?.id ?? user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (entry) {
        counts.accountingEntries++;
        if (ch5105) {
          const line = await prisma.accounting_entry_lines.create({
            data: { entry_id: entry.id, account_id: ch5105.id, description: 'Gasto de nómina', debit_amount: new Prisma.Decimal(runEarnings), credit_amount: 0 } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (line) counts.accountingEntryLines++;
        }
        if (ch2505) {
          const line = await prisma.accounting_entry_lines.create({
            data: { entry_id: entry.id, account_id: ch2505.id, description: 'Salarios por pagar', debit_amount: 0, credit_amount: new Prisma.Decimal(runNet) } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (line) counts.accountingEntryLines++;
        }
        if (ch2370) {
          const line = await prisma.accounting_entry_lines.create({
            data: { entry_id: entry.id, account_id: ch2370.id, description: 'Salud por pagar', debit_amount: 0, credit_amount: new Prisma.Decimal(runEarnings * 0.085) } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (line) counts.accountingEntryLines++;
        }
        if (ch2380) {
          const line = await prisma.accounting_entry_lines.create({
            data: { entry_id: entry.id, account_id: ch2380.id, description: 'Pensión por pagar', debit_amount: 0, credit_amount: new Prisma.Decimal(runEarnings * 0.12) } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (line) counts.accountingEntryLines++;
        }
        if (ch1110) {
          const line = await prisma.accounting_entry_lines.create({
            data: { entry_id: entry.id, account_id: ch1110.id, description: 'Pago en banco', debit_amount: 0, credit_amount: new Prisma.Decimal(runNet) } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (line) counts.accountingEntryLines++;
        }
      }
    }

    // === Novelties (2) ===
    out('  · Creating 2 payroll novelties');
    const novelty1 = await prisma.payroll_novelties.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        employee_id: createdEmployees[1]?.id,
        novelty_type: 'overtime_nocturna' as any,
        status: 'applied' as any,
        date_start: new Date('2026-02-10T00:00:00Z'),
        date_end: new Date('2026-02-10T00:00:00Z'),
        hours: 4,
        amount: new Prisma.Decimal(80000),
        notes: 'Horas extras nocturnas inventario',
        created_by_user_id: user?.id,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (novelty1) counts.payrollNovelties++;
    const novelty2 = await prisma.payroll_novelties.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        employee_id: createdEmployees[3]?.id,
        novelty_type: 'incapacity_general' as any,
        status: 'applied' as any,
        date_start: new Date('2026-03-05T00:00:00Z'),
        date_end: new Date('2026-03-09T00:00:00Z'),
        days: 5,
        amount: new Prisma.Decimal(350000),
        notes: 'Incapacidad EPS',
        created_by_user_id: user?.id,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (novelty2) counts.payrollNovelties++;

    // === Settlement (1) ===
    out('  · Creating 1 payroll settlement');
    const terminationDate = new Date('2026-04-30T00:00:00Z');
    const settlementNo = settlementNumber(terminationDate, 1);
    // Re-runnable: settlement_number is unique per org
    const existingSettlement = await prisma.payroll_settlements.findFirst({
      where: { organization_id: orgId, settlement_number: settlementNo },
    });
    const settlement = existingSettlement ?? await prisma.payroll_settlements.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        accounting_entity_id: data.accountingEntity.id,
        settlement_number: settlementNo,
        status: 'paid' as any,
        employee_id: createdEmployees[2]?.id,
        termination_date: terminationDate,
        termination_reason: 'voluntary_resignation' as any,
        hire_date: addDays(TODAY, -180),
        days_worked: 545,
        base_salary: new Prisma.Decimal(1800000),
        contract_type: 'indefinite' as any,
        severance: new Prisma.Decimal(900000),
        severance_interest: new Prisma.Decimal(108000),
        bonus: new Prisma.Decimal(150000),
        vacation: new Prisma.Decimal(450000),
        pending_salary: new Prisma.Decimal(0),
        indemnification: new Prisma.Decimal(0),
        health_deduction: new Prisma.Decimal(72000),
        pension_deduction: new Prisma.Decimal(72000),
        other_deductions: new Prisma.Decimal(0),
        total_deductions: new Prisma.Decimal(144000),
        gross_settlement: new Prisma.Decimal(1608000),
        net_settlement: new Prisma.Decimal(1464000),
        calculation_detail: { source: 'demo' } as any,
        approved_by_user_id: user?.id,
        created_by_user_id: bookkeeper?.id ?? user?.id,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (settlement) counts.payrollSettlements++;

    // === Employee advance (1) ===
    out('  · Creating 1 employee advance with 3 installments');
    const advDate = new Date('2026-01-20T00:00:00Z');
    const advAmt = 1200000;
    const advanceNo = advanceNumber(advDate, 1);
    // Re-runnable: advance_number is unique per org
    const existingAdvance = await prisma.employee_advances.findFirst({
      where: { organization_id: orgId, advance_number: advanceNo },
    });
    const advance = existingAdvance ?? await prisma.employee_advances.create({
      data: {
        organization_id: orgId,
        employee_id: createdEmployees[1]?.id,
        advance_number: advanceNo,
        amount_requested: new Prisma.Decimal(advAmt),
        amount_approved: new Prisma.Decimal(advAmt),
        amount_paid: new Prisma.Decimal(advAmt),
        amount_pending: new Prisma.Decimal(0),
        installments: 3,
        installment_value: new Prisma.Decimal(advAmt / 3),
        frequency: 'monthly' as any,
        status: 'repaying' as any,
        advance_date: advDate,
        reason: 'Anticipo para gastos médicos',
        approved_at: advDate,
        approved_by_user_id: user?.id,
        notes: 'Anticipo aprobado',
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (advance) {
      counts.employeeAdvances++;
      for (let i = 0; i < 3; i++) {
        const installment = await prisma.employee_advance_installments.upsert({
          where: { advance_id_installment_number: { advance_id: advance.id, installment_number: i + 1 } },
          update: {},
          create: {
            advance_id: advance.id,
            installment_number: i + 1,
            amount: new Prisma.Decimal(advAmt / 3),
            due_date: addDays(advDate, 30 * (i + 1)),
            status: (i < 2 ? 'paid' : 'pending') as any,
            paid_at: i < 2 ? addDays(advDate, 30 * (i + 1)) : null,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (installment) counts.employeeAdvanceInstallments++;
      }
    }

    data.employees = createdEmployees;
    out(`  ✓ Stage 09: ${JSON.stringify(counts)}`);
    return counts;
  },
};
