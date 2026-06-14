/**
 * Stage 11 — Fiscal & DIAN
 *
 * Creates 5+ `fiscal_transmissions` (sales invoices + 1 credit note),
 * `fiscal_evidences` (xml_signed + pdf + qr) per transmission,
 * `dian_audit_logs` per action, and 1 resolution for credit notes.
 *
 * Each transmission gets a CUFE-like fake hash, qr_code placeholder, and
 * a status that's "accepted" for old ones, "submitted" for recent ones.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { invoiceNumber, transactionRef } from '../lib/ids';
import { randomDateInWindow, monthlyPeriods, addDays, TODAY } from '../lib/dates';

export const stage11FiscalDian: Stage = {
  id: '11',
  name: 'Fiscal & DIAN',
  description: 'Resolutions, transmissions, evidences, audit logs',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;
    const orgId = data.organization.id;
    const storeId = data.store.id;
    const user = data.adminUser;
    const orders = (data.orders || []).filter((o: any) => o.status === 'completed');
    const customers = data.customers;
    const entity = data.accountingEntity;
    const counts: Record<string, number> = {
      invoiceResolutions: 0,
      invoices: 0,
      invoiceItems: 0,
      invoiceTaxes: 0,
      fiscalTransmissions: 0,
      fiscalEvidences: 0,
      dianAuditLogs: 0,
    };

    // === Credit note resolution ===
    out('  · Creating credit note resolution');
    // (accounting_entity_id, prefix) is unique at DB level only — no typed upsert input
    const existingCnRes = await prisma.invoice_resolutions.findFirst({
      where: { accounting_entity_id: entity.id, prefix: 'NC' },
    });
    const cnRes = existingCnRes ?? await prisma.invoice_resolutions.create({
      data: {
        organization_id: orgId,
        store_id: storeId,
        accounting_entity_id: entity.id,
        document_type: 'credit_note' as any,
        resolution_number: 'ROKU-RES-CN-2025-001',
        resolution_date: new Date('2025-11-15T00:00:00Z'),
        prefix: 'NC',
        range_from: 1,
        range_to: 500,
        current_number: 1,
        valid_from: new Date('2025-12-01T00:00:00Z'),
        valid_to: new Date('2027-12-01T00:00:00Z'),
        is_active: true,
        technical_key: 'demo-cn-key',
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (cnRes && !existingCnRes) counts.invoiceResolutions++;

    // === Invoices + transmissions sampled across the whole history ===
    out('  · Creating 12 invoices + fiscal transmissions');
    let invN = 0;
    const createdInvoices: any[] = [];
    // Every 4th completed order so the invoices span all months, not just the oldest.
    const invoiceOrders = orders.filter((_: any, i: number) => i % 4 === 0).slice(0, 12);
    for (const o of invoiceOrders) {
      invN++;
      const invNum = invoiceNumber(invN);
      const customer = o.customer;
      const cufe = `CUFE-ROKU-${rng.uuid().replace(/-/g, '').slice(0, 40).toUpperCase()}`;
      const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice><Number>${invNum}</Number><CUFE>${cufe}</CUFE><Amount>${o.grand_total}</Amount></Invoice>`;
      const invoice = await prisma.invoices.upsert({
        where: { accounting_entity_id_invoice_type_invoice_number: { accounting_entity_id: entity.id, invoice_type: 'sales_invoice' as any, invoice_number: invNum } },
        update: {},
        create: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: entity.id,
          invoice_number: invNum,
          invoice_type: 'sales_invoice' as any,
          status: 'accepted' as any,
          transmission_status: 'accepted' as any,
          dian_status: 'accepted' as any,
          accounting_status: 'posted' as any,
          customer_id: customer?.id,
          customer_name: `${customer?.first_name ?? ''} ${customer?.last_name ?? ''}`,
          customer_tax_id: customer?.document_number,
          customer_address: { city: 'Bogotá' } as any,
          subtotal_amount: new Prisma.Decimal(Number(o.subtotal_amount)),
          discount_amount: new Prisma.Decimal(0),
          tax_amount: new Prisma.Decimal(Number(o.tax_amount)),
          withholding_amount: new Prisma.Decimal(0),
          total_amount: new Prisma.Decimal(Number(o.grand_total)),
          currency: 'COP',
          exchange_rate: new Prisma.Decimal(1),
          resolution_id: data.invoiceResolution.id,
          cufe,
          qr_code: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}`,
          xml_document: xml,
          send_status: 'sent_ok' as any,
          sent_at: o.placed_at,
          accepted_at: addDays(o.placed_at, 0),
          email_sent_at: o.placed_at,
          issue_date: o.placed_at,
          due_date: addDays(o.placed_at, 30),
          payment_date: o.placed_at,
          created_at: o.placed_at,
          created_by_user_id: user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (!invoice) continue;
      createdInvoices.push(invoice);
      counts.invoices++;

      // Items
      for (const l of o.lines) {
        const product = data.products[l.productIdx];
        const variant = data.variants.find((v: any) => v.product_id === product.id);
        const invItem = await prisma.invoice_items.create({
          data: {
            invoice_id: invoice.id,
            product_id: product.id,
            product_variant_id: variant?.id,
            description: product.name,
            quantity: l.quantity,
            unit_price: new Prisma.Decimal(l.unitPrice),
            discount_amount: 0,
            tax_amount: new Prisma.Decimal(l.taxAmount),
            total_amount: new Prisma.Decimal(l.totalPrice + l.taxAmount),
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (invItem) counts.invoiceItems++;
      }

      // Tax line
      await prisma.invoice_taxes.create({
        data: {
          invoice_id: invoice.id,
          tax_name: 'IVA 19%',
          tax_rate: new Prisma.Decimal(0.19),
          taxable_amount: new Prisma.Decimal(Number(o.subtotal_amount)),
          tax_amount: new Prisma.Decimal(Number(o.tax_amount)),
          tax_type: 'iva' as any,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; }).then((r) => { if (r) counts.invoiceTaxes++; });

      // Fiscal transmission
      const trans = await prisma.fiscal_transmissions.upsert({
        where: { accounting_entity_id_document_type_idempotency_key: { accounting_entity_id: entity.id, document_type: 'sales_invoice' as any, idempotency_key: `IK-ROKU-${invNum}` } },
        update: {},
        create: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: entity.id,
          dian_configuration_id: data.dianConfig.id,
          document_type: 'sales_invoice' as any,
          source_type: 'invoice',
          source_id: invoice.id,
          document_number: invNum,
          idempotency_key: `IK-ROKU-${invNum}`,
          request_hash: `RH-${cufe.slice(0, 16)}`,
          xml_hash: `XH-${cufe.slice(0, 16)}`,
          tracking_id: `TRK-${rng.int(100000, 999999)}`,
          cufe,
          qr_code: invoice.qr_code,
          xml_document: xml,
          transmission_status: 'accepted' as any,
          dian_status: 'accepted' as any,
          accounting_status: 'posted' as any,
          provider_response: {
            status: 'OK',
            tracking_id: `TRK-${rng.int(100000, 999999)}`,
            date: o.placed_at.toISOString(),
          } as any,
          sent_at: o.placed_at,
          accepted_at: o.placed_at,
          created_by_user_id: user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (trans) {
        counts.fiscalTransmissions++;
        // 3 evidences per transmission
        for (const evType of ['xml_signed', 'pdf', 'qr'] as const) {
          const evidence = await prisma.fiscal_evidences.create({
            data: {
              organization_id: orgId,
              store_id: storeId,
              accounting_entity_id: entity.id,
              fiscal_transmission_id: trans.id,
              evidence_type: evType as any,
              storage_key: `roku-demo/${invNum}/${evType}.bin`,
              content_hash: `HASH-${evType}-${cufe.slice(0, 16)}`,
              metadata: { source: 'demo' } as any,
              created_by_user_id: user?.id,
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (evidence) counts.fiscalEvidences++;
        }
      }

      // 2 DIAN audit logs
      for (const action of ['sign', 'submit', 'accept'] as const) {
        const auditLog = await prisma.dian_audit_logs.create({
          data: {
            dian_configuration_id: data.dianConfig.id,
            action,
            document_type: 'sales_invoice',
            document_number: invNum,
            status: 'success',
            cufe,
            duration_ms: rng.int(80, 250),
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (auditLog) counts.dianAuditLogs++;
      }
    }

    // === 1 Credit note for the most recent invoice ===
    if (createdInvoices.length > 0) {
      out('  · Creating 1 credit note');
      const orig = createdInvoices[createdInvoices.length - 1];
      const cnNum = `NC-ROKU-${String(1).padStart(6, '0')}`;
      const cufe = `CUFE-NC-${rng.uuid().replace(/-/g, '').slice(0, 40).toUpperCase()}`;
      const cn = await prisma.invoices.upsert({
        where: { accounting_entity_id_invoice_type_invoice_number: { accounting_entity_id: entity.id, invoice_type: 'credit_note' as any, invoice_number: cnNum } },
        update: {},
        create: {
          organization_id: orgId,
          store_id: storeId,
          accounting_entity_id: entity.id,
          invoice_number: cnNum,
          invoice_type: 'credit_note' as any,
          status: 'accepted' as any,
          transmission_status: 'accepted' as any,
          dian_status: 'accepted' as any,
          accounting_status: 'posted' as any,
          customer_id: orig.customer_id,
          customer_name: orig.customer_name,
          customer_tax_id: orig.customer_tax_id,
          customer_address: orig.customer_address as any,
          subtotal_amount: new Prisma.Decimal(-(Number(orig.subtotal_amount) / 2)),
          discount_amount: 0,
          tax_amount: new Prisma.Decimal(-(Number(orig.tax_amount) / 2)),
          withholding_amount: 0,
          total_amount: new Prisma.Decimal(-(Number(orig.total_amount) / 2)),
          currency: 'COP',
          exchange_rate: new Prisma.Decimal(1),
          related_invoice_id: orig.id,
          cufe,
          qr_code: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}`,
          xml_document: `<?xml version="1.0" encoding="UTF-8"?><CreditNote><Number>${cnNum}</Number><Related>${orig.invoice_number}</Related></CreditNote>`,
          issue_date: addDays(orig.issue_date, 5),
          created_by_user_id: user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (cn) {
        counts.invoices++;
        await prisma.fiscal_transmissions.upsert({
          where: { accounting_entity_id_document_type_idempotency_key: { accounting_entity_id: entity.id, document_type: 'credit_note' as any, idempotency_key: `IK-NC-${cnNum}` } },
          update: {},
          create: {
            organization_id: orgId,
            store_id: storeId,
            accounting_entity_id: entity.id,
            dian_configuration_id: data.dianConfig.id,
            document_type: 'credit_note' as any,
            source_type: 'invoice',
            source_id: cn.id,
            document_number: cnNum,
            idempotency_key: `IK-NC-${cnNum}`,
            cufe,
            xml_document: cn.xml_document,
            transmission_status: 'accepted' as any,
            dian_status: 'accepted' as any,
            accounting_status: 'posted' as any,
            sent_at: cn.issue_date,
            accepted_at: cn.issue_date,
            created_by_user_id: user?.id,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        counts.fiscalTransmissions++;
      }
    }

    data.invoices = createdInvoices;
    out(`  ✓ Stage 11: ${JSON.stringify(counts)}`);
    return counts;
  },
};
