/**
 * Stage 10 — Withholdings & Taxes
 *
 * Creates 5+ withholding_concepts (retefuente servicios, compras, honorarios;
 * reteiva; reteica) and ~15+ withholding_calculations applied to historical
 * supplier invoices and customer sales. Also creates ICA calculations for
 * the bimestral periods 2025-12/2026-01, 2026-02/03, 2026-04/05.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { randomDateInWindow, monthlyPeriods, addDays, TODAY } from '../lib/dates';
import { WITHHOLDING_RATES, ICA_RATES_PER_MIL, UVT_2026 } from '../lib/fiscal-co';

export const stage10Withholdings: Stage = {
  id: '10',
  name: 'Withholdings',
  description: 'Withholding concepts, calculations, ICA',
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
    let entity = data.accountingEntity;
    if (!entity) {
      const e = await prisma.accounting_entities.findFirst({
        where: { organization_id: orgId, store_id: storeId, scope: 'STORE' as any },
      });
      if (e) {
        data.accountingEntity = e;
        entity = e;
      }
    }
    let customers = data.customers;
    let orders = data.orders;
    let concepts: any[] = data.withholdingConcepts ?? [];
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
    if (!concepts?.length) {
      // Look for concepts scoped either to this org's entity OR to the org
      // (the system seed creates org-level concepts with entity=null)
      concepts = await prisma.withholding_concepts.findMany({
        where: {
          organization_id: orgId,
          OR: [
            { accounting_entity_id: entity!.id },
            { accounting_entity_id: null },
          ],
        },
        take: 20,
      });
      data.withholdingConcepts = concepts;
    }
    const purchaseOrders = data.purchaseOrders || [];
    const counts: Record<string, number> = {
      withholdingConcepts: 0,
      withholdingCalculations: 0,
      uvtValues: 0,
    };

    // === Withholding concepts (5) ===
    out('  · Creating 5+ withholding concepts');
    if (!concepts.length) {
      const conceptData = [
        { code: 'RETSERV-04', name: 'Retención en la fuente servicios 4%', rate: WITHHOLDING_RATES.RETEFUENTE_SERVICIOS, type: 'retefuente' as any, applies: 'service' as any, account: '2365' },
        { code: 'RETCOMP-025', name: 'Retención en la fuente compras 2.5%', rate: WITHHOLDING_RATES.RETEFUENTE_COMPRAS, type: 'retefuente' as any, applies: 'purchase' as any, account: '2365' },
        { code: 'RETHON-10', name: 'Retención en la fuente honorarios 10%', rate: WITHHOLDING_RATES.RETEFUENTE_HONORARIOS, type: 'retefuente' as any, applies: 'fees' as any, account: '2365' },
        { code: 'RETEIVA-15', name: 'Retención de IVA 15%', rate: WITHHOLDING_RATES.RETEIVA, type: 'reteiva' as any, applies: 'purchase' as any, account: '2367' },
        { code: 'RETEICABOG-966', name: 'ReteICA Bogotá industrial 9.66‰', rate: WITHHOLDING_RATES.RETEICA_BOGOTA_INDUSTRIAL, type: 'reteica' as any, applies: 'purchase' as any, account: '2368' },
      ];
      for (const c of conceptData) {
        // Real unique key is (organization_id, accounting_entity_id, code)
        const concept = await prisma.withholding_concepts.upsert({
          where: {
            organization_id_accounting_entity_id_code: {
              organization_id: orgId,
              accounting_entity_id: entity!.id,
              code: c.code,
            },
          },
          update: {},
          create: {
            organization_id: orgId,
            accounting_entity_id: entity!.id,
            code: c.code,
            name: c.name,
            rate: new Prisma.Decimal(c.rate),
            min_uvt_threshold: c.type === 'retefuente' ? 27 : 0,
            applies_to: c.applies as any,
            supplier_type_filter: 'any' as any,
            withholding_type: c.type,
            account_code: c.account,
            is_active: true,
          } as any,
        }).catch(async () => {
          const existing = await prisma.withholding_concepts.findFirst({
            where: { organization_id: orgId, code: c.code },
          });
          return existing;
        });
        if (concept) {
          concepts.push(concept);
          counts.withholdingConcepts++;
        }
      }
      data.withholdingConcepts = concepts;
    }

    // === UVT values (2025 and 2026) ===
    out('  · Creating UVT values for 2025 and 2026');
    for (const y of [2025, 2026]) {
      // Real unique key is (organization_id, accounting_entity_id, year)
      const uvt = await prisma.uvt_values.upsert({
        where: {
          organization_id_accounting_entity_id_year: {
            organization_id: orgId,
            accounting_entity_id: entity!.id,
            year: y,
          },
        },
        update: {},
        create: {
          organization_id: orgId,
          accounting_entity_id: entity!.id,
          year: y,
          value_cop: new Prisma.Decimal(y === 2025 ? 49799 : UVT_2026),
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (uvt) counts.uvtValues++;
    }

    // === Withholding calculations on customer sales (practiced) ===
    out('  · Creating 10 withholding_calculations on sales');
    const conceptSales = concepts.find((c: any) => c.withholding_type === 'retefuente') ?? concepts[0];
    if (!conceptSales) {
      out('    ! No retefuente concept found; skipping sales withholdings');
    } else {
    let wcIdx = 0;
    for (const o of orders.filter((o: any) => o.status === 'completed').slice(0, 10)) {
      const customer = o.customer;
      if (!customer) continue;
      const isWithholdingAgent = (customer as any).is_withholding_agent;
      if (!isWithholdingAgent) continue;
      const concept = conceptSales;
      const base = Number(o.subtotal_amount);
      const whAmount = base * Number(concept.rate);
      const year = o.placed_at.getUTCFullYear();
      const calc = await prisma.withholding_calculations.create({
        data: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: entity!.id,
          // invoice_id is nullable; do not pass a fake id (FK violation)
          customer_id: customer.id,
          concept_id: concept.id,
          role: 'practiced' as any,
          counterparty_type: 'customer' as any,
          withholding_type: 'retefuente' as any,
          base_amount: new Prisma.Decimal(base),
          withholding_rate: concept.rate,
          withholding_amount: new Prisma.Decimal(whAmount),
          uvt_value_used: year === 2025 ? 49799 : UVT_2026,
          year,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (calc) counts.withholdingCalculations++;
      wcIdx++;
      if (wcIdx >= 10) break;
    }
    } // close if (conceptSales)

    // === Withholding calculations on purchase orders (suffered) ===
    out('  · Creating 5+ withholding_calculations on purchases');
    const conceptPurchase = concepts.find((c: any) => c.withholding_type === 'retefuente' && c.code?.includes('COMP')) ?? concepts[1] ?? concepts[0];
    for (const po of purchaseOrders.slice(0, 5)) {
      if (!conceptPurchase) break;
      const concept = conceptPurchase;
      const base = Number(po.subtotal_amount);
      const whAmount = base * Number(concept.rate);
      const year = po.order_date.getUTCFullYear();
      const calc = await prisma.withholding_calculations.create({
        data: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: entity!.id,
          supplier_id: po.supplier_id,
          concept_id: concept.id,
          role: 'suffered' as any,
          counterparty_type: 'supplier' as any,
          withholding_type: 'retefuente' as any,
          base_amount: new Prisma.Decimal(base),
          withholding_rate: concept.rate,
          withholding_amount: new Prisma.Decimal(whAmount),
          uvt_value_used: year === 2025 ? 49799 : UVT_2026,
          year,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (calc) counts.withholdingCalculations++;
    }

    // === ICA bimestral (3 bimestres) ===
    out('  · Creating 3 ICA bimestral calculations');
    const bimestres = [
      { label: '2025-B06', start: new Date('2025-12-01T00:00:00Z'), end: new Date('2026-01-31T23:59:59Z') },
      { label: '2026-B01', start: new Date('2026-02-01T00:00:00Z'), end: new Date('2026-03-31T23:59:59Z') },
      { label: '2026-B02', start: new Date('2026-04-01T00:00:00Z'), end: new Date('2026-05-31T23:59:59Z') },
    ];
    for (const b of bimestres) {
      const totalSalesInBim = orders
        .filter((o: any) => o.placed_at >= b.start && o.placed_at <= b.end)
        .reduce((sum: number, o: any) => sum + Number(o.subtotal_amount), 0);
      const icaAmt = (totalSalesInBim * ICA_RATES_PER_MIL.BOGOTA_COMERCIAL) / 1000;
      // Find a reteica concept; fall back to the last one
      const concept = concepts.find((c: any) => c.withholding_type === 'reteica') ?? concepts[concepts.length - 1];
      if (!concept || !concept.id) {
        out(`    ! No concept found for ICA bimestre ${b.label} (concepts.length=${concepts.length}, first=${JSON.stringify(concepts[0]?.id)}, types=${concepts.map((c: any) => c.withholding_type).join(',')})`);
        continue;
      }
      const icaCalc = await prisma.withholding_calculations.create({
        data: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: entity!.id,
          concept_id: concept.id,
          role: 'practiced' as any,
          counterparty_type: 'self' as any,
          withholding_type: 'reteica' as any,
          base_amount: new Prisma.Decimal(totalSalesInBim),
          withholding_rate: concept.rate,
          withholding_amount: new Prisma.Decimal(icaAmt),
          uvt_value_used: UVT_2026,
          year: b.start.getUTCFullYear(),
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (icaCalc) counts.withholdingCalculations++;
    }

    out(`  ✓ Stage 10: ${JSON.stringify(counts)}`);
    return counts;
  },
};
