/**
 * Stage 05 — Purchasing
 *
 * Creates 6 purchase orders distributed across 6 months (Dec-2025 .. May-2026),
 * each with 3-5 line items, partial or full receptions, payments, accounts_payable
 * entries, and ap_payment_schedules. Each PO generates an accounting entry
 * (auto_purchase) when received.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { purchaseOrderNumber, transactionRef } from '../lib/ids';
import { monthlyPeriods, randomDateInWindow, addDays } from '../lib/dates';

export const stage05Purchasing: Stage = {
  id: '05',
  name: 'Purchasing',
  description: 'POs, receptions, payments, AP, schedules',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;
    const orgId = data.organization.id;
    const storeId = data.store.id;
    const warehouse = data.defaultLocation;
    const user = data.adminUser;
    const products = data.products;
    const variants = data.variants;
    const suppliers = data.suppliers;
    if (!products?.length || !suppliers?.length) {
      throw new Error('Stages 02 and 04 must run first.');
    }
    const counts: Record<string, number> = {
      purchaseOrders: 0,
      purchaseOrderItems: 0,
      purchaseOrderReceptions: 0,
      purchaseOrderPayments: 0,
      accountsPayable: 0,
      apPayments: 0,
      apPaymentSchedules: 0,
    };

    out('  · Creating 6 purchase orders distributed monthly');
    const periods = monthlyPeriods(ctx.options.monthsBack);
    // Skip the most recent period if too close to today
    const usablePeriods = periods.filter((p) => p.end < new Date());

    const createdPOs: any[] = [];
    for (let i = 0; i < 6; i++) {
      const period = usablePeriods[i] ?? usablePeriods[usablePeriods.length - 1];
      const supplier = rng.pick(suppliers);
      const orderDate = randomDateInWindow(rng, period.start, period.end);
      const expectedDate = addDays(orderDate, supplier.lead_time_days ?? 10);
      const isPartial = rng.chance(0.4);
      const isCancelled = rng.chance(0.05);

      // 3-5 line items
      const linesCount = rng.int(3, 5);
      const chosen = rng.pickMany(products, linesCount);

      // Compute totals
      const lines = chosen.map((product) => {
        const variant = variants.find((v) => v.product_id === product.id);
        const qty = rng.int(5, 30);
        const unitCost = Number(product.cost_price ?? 0);
        const total = qty * unitCost;
        return {
          product_id: product.id,
          variant_id: variant?.id,
          quantity_ordered: qty,
          unit_cost: new Prisma.Decimal(unitCost),
          total_cost: new Prisma.Decimal(total),
        };
      });
      const subtotal = lines.reduce((a, l) => a + Number(l.total_cost), 0);
      const taxRate = 0.19;
      const tax = subtotal * taxRate;
      const total = subtotal + tax;

      const status: any = isCancelled
        ? 'cancelled'
        : isPartial
          ? 'partial'
          : 'received';

      const orderNum = purchaseOrderNumber(orderDate, i + 1);
      const po = await prisma.purchase_orders.upsert({
        where: {
          organization_id_order_number: {
            organization_id: orgId,
            order_number: orderNum,
          },
        },
        update: {},
        create: {
          organization_id: orgId,
          supplier_id: supplier.id,
          location_id: warehouse.id,
          order_number: orderNum,
          status: status as any,
          order_date: orderDate,
          expected_date: expectedDate,
          received_date: status === 'received' ? expectedDate : (isPartial ? addDays(expectedDate, 5) : null),
          subtotal_amount: new Prisma.Decimal(subtotal),
          tax_amount: new Prisma.Decimal(tax),
          total_amount: new Prisma.Decimal(total),
          discount_amount: 0,
          shipping_cost: 0,
          payment_terms: '30 días',
          shipping_method: 'Terrestre',
          notes: `PO demo Roku #${i + 1} a ${supplier.name}`,
          created_by_user_id: user?.id,
          approved_by_user_id: user?.id,
          payment_status: 'unpaid' as any,
          payment_due_date: addDays(orderDate, 30),
        } as any,
      });
      createdPOs.push({ ...po, lines, isPartial, isCancelled });
      counts.purchaseOrders++;

      // Items (keep the rows created in THIS run so reception items can
      // reference real purchase_order_item ids instead of stale/placeholder ids)
      const createdItems: { item: any; line: (typeof lines)[number] }[] = [];
      for (const l of lines) {
        const item = await prisma.purchase_order_items.create({
          data: {
            purchase_order_id: po.id,
            product_id: l.product_id,
            product_variant_id: l.variant_id,
            quantity_ordered: l.quantity_ordered,
            quantity_received: isCancelled ? 0 : (isPartial ? Math.floor(l.quantity_ordered * 0.6) : l.quantity_ordered),
            unit_cost: l.unit_cost,
            total_cost: l.total_cost,
            notes: 'Item demo Roku',
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (item) {
          createdItems.push({ item, line: l });
          counts.purchaseOrderItems++;
        }
      }

      // Reception (if not cancelled)
      if (!isCancelled) {
        const receivedAt = isPartial ? addDays(expectedDate, 5) : expectedDate;
        const reception = await prisma.purchase_order_receptions.create({
          data: {
            purchase_order_id: po.id,
            received_at: receivedAt,
            notes: isPartial ? 'Recepción parcial — segundo envío pendiente' : 'Recepción completa',
            received_by_user_id: user?.id,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (reception) {
          counts.purchaseOrderReceptions++;
          for (const ci of createdItems) {
            const qtyR = isPartial ? Math.floor(ci.line.quantity_ordered * 0.6) : ci.line.quantity_ordered;
            await prisma.purchase_order_reception_items.create({
              data: {
                reception_id: reception.id,
                purchase_order_item_id: ci.item.id,
                quantity_received: qtyR,
              } as any,
            }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          }
        }
      }

      // AP record
      const ap = await prisma.accounts_payable.upsert({
        where: { id: -1 } as any,
        update: {},
        create: {
          organization_id: orgId,
          store_id: storeId,
          supplier_id: supplier.id,
          source_type: 'purchase_order' as any,
          source_id: po.id,
          document_number: `AP-${po.order_number}`,
          original_amount: new Prisma.Decimal(total),
          paid_amount: new Prisma.Decimal(0),
          balance: new Prisma.Decimal(total),
          currency: 'COP',
          issue_date: orderDate,
          due_date: addDays(orderDate, 30),
          status: 'open',
        } as any,
      }).catch(async () => {
        const existing = await prisma.accounts_payable.findFirst({
          where: { source_type: 'purchase_order' as any, source_id: po.id },
        });
        return existing;
      });
      if (ap) counts.accountsPayable++;

      // Payment schedule (1-3 installments)
      const numSched = rng.int(1, 3);
      const schedAmt = total / numSched;
      if (ap) {
        for (let s = 0; s < numSched; s++) {
          const sched = await prisma.ap_payment_schedules.create({
            data: {
              accounts_payable_id: ap.id,
              scheduled_date: addDays(orderDate, 30 + s * 30),
              amount: new Prisma.Decimal(schedAmt),
              status: 'pending' as any,
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (sched) counts.apPaymentSchedules++;
        }
      }

      // First payment (if not the most recent PO)
      if (i < 4 && ap) {
        const payAmt = total * rng.decimal(0.3, 1.0);
        const apPayment = await prisma.ap_payments.create({
          data: {
            accounts_payable_id: ap.id,
            amount: new Prisma.Decimal(payAmt),
            payment_date: addDays(orderDate, rng.int(20, 35)),
            payment_method: rng.pick(['transfer', 'ach', 'cash'] as const),
            reference: transactionRef(rng),
            notes: 'Pago parcial a proveedor',
            created_by: user?.id,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (apPayment) counts.apPayments++;
        await prisma.accounts_payable.update({
          where: { id: ap.id },
          data: {
            paid_amount: new Prisma.Decimal(payAmt),
            balance: new Prisma.Decimal(total - payAmt),
            status: total - payAmt < 100 ? 'paid' : 'partial',
          },
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        // Mirror in purchase_order_payments
        const poPayment = await prisma.purchase_order_payments.create({
          data: {
            purchase_order_id: po.id,
            amount: new Prisma.Decimal(payAmt),
            payment_date: addDays(orderDate, rng.int(20, 35)),
            payment_method: rng.pick(['transfer', 'ach', 'cash'] as const),
            reference: transactionRef(rng),
            notes: 'Pago parcial registrado',
            created_by_user_id: user?.id,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (poPayment) counts.purchaseOrderPayments++;
      }
    }

    data.purchaseOrders = createdPOs;
    out(`  ✓ Stage 05: ${JSON.stringify(counts)}`);
    return counts;
  },
};
