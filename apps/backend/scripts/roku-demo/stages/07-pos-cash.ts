/**
 * Stage 07 — POS / Cash
 *
 * Creates 1 cash register, 5 sessions (3 closed, 2 open), movements per
 * session, 5 wallets with transactions, 5 accounts_receivable records,
 * 2 payment_agreements, 1 commission rule, and commission_calculations
 * for top sellers.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { randomDateInWindow, monthlyPeriods, addDays, TODAY } from '../lib/dates';
import { transactionRef, paymentAgreementNumber } from '../lib/ids';

export const stage07PosCash: Stage = {
  id: '07',
  name: 'POS / Cash',
  description: 'Cash registers, sessions, movements, wallets, AR, payment_agreements, commissions',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;

    // Recover org/store if running standalone
    let org = data.organization;
    let store = data.store;
    if (!org) {
      org = await prisma.organizations.findUnique({ where: { slug: 'roku' } });
      if (org) data.organization = org;
    }
    if (!store && org) {
      store = await prisma.stores.findFirst({ where: { organization_id: org.id, slug: 'roku' } });
      if (store) data.store = store;
    }
    if (!org || !store) throw new Error('Roku org/store not found. Run stage 01 first.');

    const orgId = org.id;
    const storeId = store.id;
    const user = data.adminUser;
    const posUser = data.posCashier;
    let customers = data.customers;
    let orders = data.orders;
    if (!customers?.length) {
      const customerRole = await prisma.roles.findUnique({ where: { name: 'customer' } });
      if (customerRole) {
        const customerUsers = await prisma.users.findMany({
          where: { user_roles: { some: { role_id: customerRole.id } }, store_users: { some: { store_id: storeId } } },
          take: 10,
        });
        customers = customerUsers.map(u => ({ ...u, _isB2B: u.person_type === 'JURIDICA' }));
        data.customers = customers;
      }
    }
    if (!orders?.length) {
      orders = await prisma.orders.findMany({ where: { store_id: storeId } });
      data.orders = orders;
    }
    const counts: Record<string, number> = {
      cashRegisters: 0,
      cashRegisterSessions: 0,
      cashRegisterMovements: 0,
      wallets: 0,
      walletTransactions: 0,
      accountsReceivable: 0,
      arPayments: 0,
      paymentAgreements: 0,
      agreementInstallments: 0,
      commissionRules: 0,
      commissionCalculations: 0,
    };

    // === Cash register ===
    out('  · Creating cash register + 5 sessions');
    const register = await prisma.cash_registers.upsert({
      where: { store_id_code: { store_id: storeId, code: 'ROKU-CASH-01' } } as any,
      update: {},
      create: {
        store_id: storeId,
        name: 'Caja Principal',
        code: 'ROKU-CASH-01',
        description: 'Caja registradora principal del showroom',
        is_active: true,
        default_opening_amount: new Prisma.Decimal(200000),
      } as any,
    }).catch(async () => {
      const existing = await prisma.cash_registers.findFirst({
        where: { store_id: storeId, code: 'ROKU-CASH-01' },
      });
      return existing;
    });
    if (register) counts.cashRegisters++;

    // === 5 sessions (3 closed, 2 open) ===
    if (register) {
      const periods = monthlyPeriods(ctx.options.monthsBack);
      const usable = periods.filter((p) => p.end < TODAY);
      for (let s = 0; s < 5; s++) {
        const period = usable[s] ?? usable[usable.length - 1];
        const openedAt = randomDateInWindow(rng, period.start, period.end);
        const isOpen = s >= 3;
        const openedBy = posUser?.id ?? user?.id;
        const closedBy = isOpen ? null : openedBy;
        const expectedClosing = 200000 + rng.pesos(800000, 2500000);
        const actualClosing = isOpen ? null : expectedClosing + rng.pesos(-5000, 5000);
        const session = await prisma.cash_register_sessions.create({
          data: {
            cash_register_id: register.id,
            store_id: storeId,
            status: (isOpen ? 'open' : 'closed') as any,
            opened_at: openedAt,
            closed_at: isOpen ? null : addDays(openedAt, 0),
            opening_amount: new Prisma.Decimal(200000),
            expected_closing_amount: new Prisma.Decimal(expectedClosing),
            actual_closing_amount: actualClosing ? new Prisma.Decimal(actualClosing) : null,
            difference: actualClosing ? new Prisma.Decimal(actualClosing - expectedClosing) : null,
            closing_notes: isOpen ? null : 'Cierre normal de jornada',
            opened_by: openedBy!,
            closed_by: closedBy,
            summary: {
              total_sales: expectedClosing - 200000,
              total_refunds: 0,
              transactions_count: rng.int(5, 15),
              cash_in: 0,
              cash_out: 0,
            } as any,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (!session) continue;
        counts.cashRegisterSessions++;

        // Movements: opening + 2-5 sales + closing
        const openingMovement = await prisma.cash_register_movements.create({
          data: {
            session_id: session.id,
            store_id: storeId,
            type: 'opening_balance' as any,
            amount: new Prisma.Decimal(200000),
            payment_method: 'cash',
            reference: transactionRef(rng),
            notes: 'Apertura de caja',
            created_at: openedAt,
            user_id: openedBy!,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (openingMovement) counts.cashRegisterMovements++;

        const saleCount = rng.int(2, 5);
        for (let mv = 0; mv < saleCount; mv++) {
          const amt = rng.pesos(50000, 800000);
          const orderForMovement = orders[mv % orders.length];
          const saleMovement = await prisma.cash_register_movements.create({
            data: {
              session_id: session.id,
              store_id: storeId,
              type: 'sale' as any,
              amount: new Prisma.Decimal(amt),
              payment_method: 'cash',
              reference: transactionRef(rng),
              order_id: orderForMovement?.id,
              notes: 'Venta en mostrador',
              created_at: addDays(openedAt, Math.floor(mv / 3)),
              user_id: openedBy!,
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (saleMovement) counts.cashRegisterMovements++;
        }

        if (!isOpen) {
          const closingMovement = await prisma.cash_register_movements.create({
            data: {
              session_id: session.id,
              store_id: storeId,
              type: 'closing_balance' as any,
              amount: new Prisma.Decimal(actualClosing!),
              payment_method: 'cash',
              reference: transactionRef(rng),
              notes: 'Cierre de caja',
              created_at: session.closed_at!,
              user_id: openedBy!,
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (closingMovement) counts.cashRegisterMovements++;
        }
      }
    }

    // === Wallets (5) ===
    out('  · Creating 5 customer wallets with transactions');
    for (let w = 0; w < 5; w++) {
      const customer = customers[w] ?? customers[0]!;
      const balance = rng.pesos(20000, 500000);
      const wallet = await prisma.wallets.upsert({
        where: { store_id_customer_id: { store_id: storeId, customer_id: customer.id } } as any,
        update: {},
        create: {
          store_id: storeId,
          organization_id: orgId,
          customer_id: customer.id,
          balance: new Prisma.Decimal(balance),
          held_balance: new Prisma.Decimal(0),
          currency: 'COP',
          is_active: true,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (!wallet) continue;
      counts.wallets++;

      // 2 transactions
      const tx1 = await prisma.wallet_transactions.create({
        data: {
          wallet_id: wallet.id,
          type: 'credit' as any,
          state: 'completed' as any,
          amount: new Prisma.Decimal(balance * 0.6),
          balance_before: new Prisma.Decimal(0),
          balance_after: new Prisma.Decimal(balance * 0.6),
          reference_type: 'topup',
          reference_id: w + 100,
          description: 'Recarga inicial',
          metadata: { source: 'demo' } as any,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (tx1) counts.walletTransactions++;
      const tx2 = await prisma.wallet_transactions.create({
        data: {
          wallet_id: wallet.id,
          type: 'credit' as any,
          state: 'completed' as any,
          amount: new Prisma.Decimal(balance * 0.4),
          balance_before: new Prisma.Decimal(balance * 0.6),
          balance_after: new Prisma.Decimal(balance),
          reference_type: 'cashback',
          reference_id: w + 200,
          description: 'Cashback por compra',
          metadata: { source: 'demo' } as any,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (tx2) counts.walletTransactions++;
    }

    // === Accounts Receivable (5) ===
    out('  · Creating 5 AR records + 2 payment agreements');
    for (let a = 0; a < 5; a++) {
      const customer = customers[a + 2] ?? customers[0]!;
      const arDate = randomDateInWindow(rng, addDays(TODAY, -120), addDays(TODAY, -10));
      const totalAmt = rng.pesos(500000, 4000000);
      const isPaid = a === 0;
      const ar = await prisma.accounts_receivable.upsert({
        where: { id: -1 } as any,
        update: {},
        create: {
          store_id: storeId,
          organization_id: orgId,
          customer_id: customer.id,
          source_type: 'sale' as any,
          source_id: 50000 + a,
          document_number: `AR-ROKU-${String(a + 1).padStart(4, '0')}`,
          original_amount: new Prisma.Decimal(totalAmt),
          paid_amount: new Prisma.Decimal(isPaid ? totalAmt : 0),
          balance: new Prisma.Decimal(isPaid ? 0 : totalAmt),
          currency: 'COP',
          issue_date: arDate,
          due_date: addDays(arDate, 30),
          status: isPaid ? 'paid' : (a < 3 ? 'open' : 'overdue'),
          days_overdue: isPaid ? 0 : (a < 3 ? 0 : rng.int(1, 30)),
          notes: 'Cuenta por cobrar demo',
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (!ar) continue;
      counts.accountsReceivable++;

      // Payment agreement for the overdue AR
      if (a >= 3) {
        const ag = await prisma.payment_agreements.create({
          data: {
            accounts_receivable_id: ar.id,
            store_id: storeId,
            agreement_number: paymentAgreementNumber(arDate, a + 1),
            total_amount: new Prisma.Decimal(totalAmt),
            num_installments: 3,
            interest_rate: new Prisma.Decimal(0),
            state: 'active' as any,
            start_date: arDate,
            notes: 'Acuerdo de pago demo',
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (ag) {
          counts.paymentAgreements++;
          for (let i = 0; i < 3; i++) {
            const agInstallment = await prisma.agreement_installments.create({
              data: {
                payment_agreement_id: ag.id,
                installment_number: i + 1,
                amount: new Prisma.Decimal(totalAmt / 3),
                due_date: addDays(arDate, 30 * (i + 1)),
                state: i === 0 ? 'paid' : 'pending' as any,
                paid_amount: i === 0 ? new Prisma.Decimal(totalAmt / 3) : 0,
                paid_at: i === 0 ? addDays(arDate, 5) : null,
              } as any,
            }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
            if (agInstallment) counts.agreementInstallments++;
          }
        }
      }
    }

    // === Commission rule + calculations ===
    out('  · Creating 1 commission rule + 6 calculations');
    const rule = await prisma.commission_rules.upsert({
      where: { id: -1 } as any,
      update: {},
      create: {
        store_id: storeId,
        name: 'Comisión vendedor 3% sobre ventas',
        description: 'Regla general: 3% sobre el total de cada venta POS',
        rule_type: 'sales_percentage' as any,
        conditions: { channels: ['pos'] } as any,
        commission_type: 'percentage' as any,
        value: new Prisma.Decimal(3),
        is_active: true,
        priority: 0,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (rule) {
      counts.commissionRules++;
      // Apply to first 6 completed orders
      const posOrders = orders.filter((o: any) => o.channel === 'pos' && o.status === 'completed').slice(0, 6);
      for (const o of posOrders) {
        const commission = Number(o.grand_total) * 0.03;
        const calc = await prisma.commission_calculations.create({
          data: {
            store_id: storeId,
            commission_rule_id: rule.id,
            source_type: 'order' as any,
            source_id: o.id,
            base_amount: new Prisma.Decimal(Number(o.grand_total)),
            commission_amount: new Prisma.Decimal(commission),
            calculation_detail: { rule: 'pos_3_percent' } as any,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (calc) counts.commissionCalculations++;
      }
    }

    out(`  ✓ Stage 07: ${JSON.stringify(counts)}`);
    return counts;
  },
};
