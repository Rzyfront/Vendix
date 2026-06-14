/**
 * Stage 13 — Exogenous
 *
 * Creates 2 exogenous_reports (format 1001 compras, 1007 ventas) for
 * fiscal year 2025, with lines per counterparty.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';

export const stage13Exogenous: Stage = {
  id: '13',
  name: 'Exogenous',
  description: 'Exogenous reports + lines (1001 purchases, 1007 sales)',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;
    const orgId = data.organization.id;
    const storeId = data.store.id;
    const user = data.adminUser;
    const customers = data.customers;
    const suppliers = data.suppliers;
    const orders = data.orders || [];
    const purchaseOrders = data.purchaseOrders || [];
    const counts: Record<string, number> = {
      exogenousReports: 0,
      exogenousReportLines: 0,
    };

    out('  · Creating 2 exogenous_reports (1001, 1007) for FY2025');

    // Format 1001 — Purchases (skip lines on re-run: lines have no unique key)
    const existing1001 = await prisma.exogenous_reports.findUnique({
      where: { organization_id_fiscal_year_format_code: { organization_id: orgId, fiscal_year: 2025, format_code: '1001' } },
    });
    const report1001 = existing1001 ? null : await prisma.exogenous_reports.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        fiscal_year: 2025,
        format_code: '1001',
        status: 'generated' as any,
        total_records: suppliers.length + 5,
        total_amount: new Prisma.Decimal(purchaseOrders.reduce((s: number, po: any) => s + Number(po.total_amount), 0)),
        generated_at: new Date('2026-02-15T00:00:00Z'),
        created_by_user_id: user?.id,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (report1001) {
      counts.exogenousReports++;
      for (let s = 0; s < suppliers.length; s++) {
        const supplier = suppliers[s];
        const supPOs = purchaseOrders.filter((po: any) => po.supplier_id === supplier.id);
        const total = supPOs.reduce((sum: number, po: any) => sum + Number(po.total_amount), 0);
        const tax = total * 0.19 / 1.19;
        if (total < 1000) continue;
        await prisma.exogenous_report_lines.create({
          data: {
            report_id: report1001.id,
            third_party_nit: supplier.tax_id,
            third_party_name: supplier.name,
            third_party_dv: supplier.verification_digit,
            concept_code: '5001',
            payment_amount: new Prisma.Decimal(total),
            tax_amount: new Prisma.Decimal(tax),
            withholding_amount: new Prisma.Decimal(0),
            line_data: { source: 'demo' } as any,
          } as any,
        }).then((r) => { if (r) counts.exogenousReportLines++; }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      }
    }

    // Format 1007 — Sales (skip lines on re-run: lines have no unique key)
    const existing1007 = await prisma.exogenous_reports.findUnique({
      where: { organization_id_fiscal_year_format_code: { organization_id: orgId, fiscal_year: 2025, format_code: '1007' } },
    });
    const report1007 = existing1007 ? null : await prisma.exogenous_reports.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        fiscal_year: 2025,
        format_code: '1007',
        status: 'generated' as any,
        total_records: customers.length + 5,
        total_amount: new Prisma.Decimal(orders.filter((o: any) => o.placed_at < new Date('2026-01-01T00:00:00Z')).reduce((s: number, o: any) => s + Number(o.grand_total), 0)),
        generated_at: new Date('2026-02-15T00:00:00Z'),
        created_by_user_id: user?.id,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (report1007) {
      counts.exogenousReports++;
      for (let c = 0; c < customers.length; c++) {
        const customer = customers[c];
        const custOrders = orders.filter((o: any) => o.customer?.id === customer.id && o.placed_at < new Date('2026-01-01T00:00:00Z'));
        const total = custOrders.reduce((sum: number, o: any) => sum + Number(o.grand_total), 0);
        if (total < 1000) continue;
        const tax = total * 0.19 / 1.19;
        await prisma.exogenous_report_lines.create({
          data: {
            report_id: report1007.id,
            third_party_nit: customer.document_number ?? '222222222',
            third_party_name: `${customer.first_name} ${customer.last_name}`,
            concept_code: '1301',
            payment_amount: new Prisma.Decimal(total),
            tax_amount: new Prisma.Decimal(tax),
            withholding_amount: new Prisma.Decimal(0),
            line_data: { source: 'demo' } as any,
          } as any,
        }).then((r) => { if (r) counts.exogenousReportLines++; }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      }
    }

    out(`  ✓ Stage 13: ${JSON.stringify(counts)}`);
    return counts;
  },
};
