import { Injectable, Logger } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { Prisma } from '@prisma/client';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  InvoiceLineItem,
  InvoiceSplitBreakdown,
} from '../types/billing.types';

/**
 * S3.1 — Generates a customer-facing PDF for SaaS subscription invoices.
 *
 * Design notes:
 *  - Uses pdfkit (already declared in package.json), zero external assets,
 *    standard fonts only — survives strict container filesystems and avoids
 *    the puppeteer/chromium runtime cost.
 *  - All money math is rendered straight from `Prisma.Decimal` strings via
 *    a local `formatCop` helper. We deliberately do NOT call the frontend
 *    `CurrencyFormatService` from the backend; the locale rules for COP are
 *    fixed (es-CO, no decimals on whole-peso totals, 2dp on partial).
 *  - The split breakdown (Vendix vs partner) is intentionally omitted from
 *    the customer-facing PDF — the store sees only the total they were
 *    charged. Internal split is still queryable via the API for super-admin.
 *  - Footer always carries the NO_REFUND notice.
 *
 * Ownership validation:
 *  - The caller MUST pass the resolved `storeId` from RequestContext. We
 *    re-verify `invoice.store_id === storeId` defensively before rendering.
 */
@Injectable()
export class SubscriptionInvoicePdfService {
  private readonly logger = new Logger(SubscriptionInvoicePdfService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  async generatePdf(invoiceId: number, storeId: number): Promise<{
    buffer: Buffer;
    filename: string;
  }> {
    const invoice = await this.prisma.subscription_invoices.findFirst({
      where: { id: invoiceId },
      include: {
        store_subscription: {
          include: {
            plan: true,
            store: { include: { organizations: true } },
          },
        },
        payments: {
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Invoice not found',
      );
    }

    // Defense in depth — controller already filters by storeId, but we
    // re-validate ownership here so the service is safe in isolation.
    if (invoice.store_id !== storeId) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Invoice not found',
      );
    }

    const store = invoice.store_subscription.store;
    const organization = store.organizations;

    const lineItems: InvoiceLineItem[] = Array.isArray(invoice.line_items)
      ? (invoice.line_items as unknown as InvoiceLineItem[])
      : [];

    const splitRaw = invoice.split_breakdown;
    const splitBreakdown: InvoiceSplitBreakdown | null =
      splitRaw &&
      typeof splitRaw === 'object' &&
      !Array.isArray(splitRaw) &&
      'partner_org_id' in splitRaw
        ? (splitRaw as unknown as InvoiceSplitBreakdown)
        : null;

    const currency = invoice.currency ?? 'COP';

    const buffer = await this.renderPdf({
      invoice,
      store: { name: store.name, code: store.store_code ?? null },
      organization: {
        name: organization?.name ?? '',
        legal_name: organization?.legal_name ?? null,
        tax_id: organization?.tax_id ?? null,
        email: organization?.email ?? null,
      },
      planName: invoice.store_subscription.plan?.name ?? null,
      lineItems,
      splitBreakdown,
      payments: invoice.payments,
      currency,
    });

    const safeNumber = invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
      buffer,
      filename: `factura-${safeNumber}.pdf`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────

  private renderPdf(ctx: {
    invoice: {
      invoice_number: string;
      state: string;
      issued_at: Date | null;
      due_at: Date;
      period_start: Date;
      period_end: Date;
      subtotal: Prisma.Decimal;
      tax_amount: Prisma.Decimal;
      total: Prisma.Decimal;
      amount_paid: Prisma.Decimal;
      created_at: Date;
    };
    store: { name: string; code: string | null };
    organization: {
      name: string;
      legal_name: string | null;
      tax_id: string | null;
      email: string | null;
    };
    planName: string | null;
    lineItems: InvoiceLineItem[];
    splitBreakdown: InvoiceSplitBreakdown | null;
    payments: Array<{
      id: number;
      state: string;
      amount: Prisma.Decimal;
      payment_method: string | null;
      paid_at: Date | null;
      created_at: Date;
    }>;
    currency: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'LETTER',
          margins: { top: 56, bottom: 56, left: 56, right: 56 },
          info: {
            Title: `Factura ${ctx.invoice.invoice_number}`,
            Author: 'Vendix',
            Subject: 'Factura de suscripción SaaS',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));

        // ── Header ────────────────────────────────────────────────
        doc
          .fillColor('#0F172A')
          .font('Helvetica-Bold')
          .fontSize(22)
          .text('Vendix', { continued: false });
        doc
          .moveUp()
          .font('Helvetica')
          .fontSize(11)
          .fillColor('#64748B')
          .text('Factura de Suscripción SaaS', { align: 'right' });

        doc.moveDown(0.6);
        doc
          .strokeColor('#E2E8F0')
          .lineWidth(1)
          .moveTo(doc.page.margins.left, doc.y)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y)
          .stroke();
        doc.moveDown(0.8);

        // ── Invoice meta ──────────────────────────────────────────
        const metaTop = doc.y;
        doc
          .fillColor('#0F172A')
          .font('Helvetica-Bold')
          .fontSize(14)
          .text(`Factura ${ctx.invoice.invoice_number}`);

        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#475569')
          .text(
            `Emitida: ${this.formatDate(ctx.invoice.issued_at ?? ctx.invoice.created_at)}`,
          )
          .text(`Vencimiento: ${this.formatDate(ctx.invoice.due_at)}`)
          .text(`Estado: ${this.stateLabel(ctx.invoice.state)}`);

        // State badge — colored stamp on the right
        const badgeColor = this.stateBadgeColor(ctx.invoice.state);
        const badgeText = this.stateLabel(ctx.invoice.state).toUpperCase();
        const badgeWidth = 110;
        const badgeHeight = 26;
        const badgeX =
          doc.page.width - doc.page.margins.right - badgeWidth;
        doc
          .save()
          .roundedRect(badgeX, metaTop, badgeWidth, badgeHeight, 4)
          .fillAndStroke(badgeColor.bg, badgeColor.border);
        doc
          .fillColor(badgeColor.fg)
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(badgeText, badgeX, metaTop + 8, {
            width: badgeWidth,
            align: 'center',
          });
        doc.restore();

        doc.moveDown(1);

        // ── Two-column block: Cliente / Periodo ───────────────────
        const colWidth =
          (doc.page.width -
            doc.page.margins.left -
            doc.page.margins.right -
            16) /
          2;
        const colTop = doc.y;
        const colLeft = doc.page.margins.left;
        const colRight = colLeft + colWidth + 16;

        this.renderInfoBlock(
          doc,
          colLeft,
          colTop,
          colWidth,
          'Facturado a',
          [
            ctx.organization.legal_name ?? ctx.organization.name,
            ctx.organization.tax_id ? `NIT: ${ctx.organization.tax_id}` : null,
            `Tienda: ${ctx.store.name}` +
              (ctx.store.code ? ` (${ctx.store.code})` : ''),
            ctx.organization.email,
          ].filter(Boolean) as string[],
        );

        this.renderInfoBlock(
          doc,
          colRight,
          colTop,
          colWidth,
          'Periodo facturado',
          [
            `Del ${this.formatDate(ctx.invoice.period_start)}`,
            `Al ${this.formatDate(ctx.invoice.period_end)}`,
            ctx.planName ? `Plan: ${ctx.planName}` : null,
            `Moneda: ${ctx.currency}`,
          ].filter(Boolean) as string[],
        );

        doc.y = Math.max(doc.y, colTop + 110);
        doc.moveDown(0.4);

        // ── Line items table ──────────────────────────────────────
        this.renderLineItemsTable(doc, ctx.lineItems, ctx.currency);

        // ── Totals box ────────────────────────────────────────────
        doc.moveDown(0.6);
        this.renderTotalsBox(doc, {
          subtotal: ctx.invoice.subtotal,
          tax: ctx.invoice.tax_amount,
          total: ctx.invoice.total,
          amount_paid: ctx.invoice.amount_paid,
          currency: ctx.currency,
        });

        // ── Payments (if any succeeded) ───────────────────────────
        const succeededPayments = ctx.payments.filter(
          (p) => p.state === 'succeeded',
        );
        if (succeededPayments.length > 0) {
          doc.moveDown(0.8);
          doc
            .fillColor('#0F172A')
            .font('Helvetica-Bold')
            .fontSize(11)
            .text('Pagos registrados');
          doc.moveDown(0.2);
          for (const p of succeededPayments) {
            const date = this.formatDate(p.paid_at ?? p.created_at);
            const method = p.payment_method ?? 'Pago electrónico';
            doc
              .font('Helvetica')
              .fontSize(10)
              .fillColor('#334155')
              .text(
                `• ${date} — ${method}: ${this.formatMoney(p.amount, ctx.currency)}`,
              );
          }
        }

        // ── Footer (NO REFUND) ────────────────────────────────────
        // Pin the disclaimer near the bottom of the current page.
        const footerHeight = 64;
        const footerTop =
          doc.page.height - doc.page.margins.bottom - footerHeight;
        if (doc.y > footerTop - 20) {
          doc.addPage();
        }
        doc
          .save()
          .roundedRect(
            doc.page.margins.left,
            footerTop,
            doc.page.width - doc.page.margins.left - doc.page.margins.right,
            footerHeight,
            6,
          )
          .fillAndStroke('#F8FAFC', '#E2E8F0');
        doc
          .fillColor('#0F172A')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(
            'Política de no reembolsos',
            doc.page.margins.left + 14,
            footerTop + 12,
            {
              width:
                doc.page.width -
                doc.page.margins.left -
                doc.page.margins.right -
                28,
            },
          );
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#475569')
          .text(
            'Las suscripciones de Vendix no son reembolsables. La cancelación detiene la próxima renovación pero no genera devolución del periodo facturado ni de pagos previos. Soporte: soporte@vendix.com',
            doc.page.margins.left + 14,
            footerTop + 28,
            {
              width:
                doc.page.width -
                doc.page.margins.left -
                doc.page.margins.right -
                28,
              lineGap: 1,
            },
          );
        doc.restore();

        doc.end();
      } catch (err) {
        reject(err as Error);
      }
    });
  }

  private renderInfoBlock(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    title: string,
    lines: string[],
  ): void {
    doc
      .fillColor('#64748B')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(title.toUpperCase(), x, y, { width, characterSpacing: 0.6 });
    doc.moveDown(0.2);
    for (const line of lines) {
      doc
        .fillColor('#0F172A')
        .font('Helvetica')
        .fontSize(10)
        .text(line, x, doc.y, { width });
    }
  }

  private renderLineItemsTable(
    doc: PDFKit.PDFDocument,
    items: InvoiceLineItem[],
    currency: string,
  ): void {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const tableWidth = right - left;

    const cols = {
      desc: { x: left + 8, w: tableWidth * 0.5 },
      qty: { x: left + tableWidth * 0.5 + 8, w: tableWidth * 0.12 },
      unit: { x: left + tableWidth * 0.62 + 8, w: tableWidth * 0.18 },
      total: { x: left + tableWidth * 0.8 + 8, w: tableWidth * 0.2 - 16 },
    };

    // Header
    const headerTop = doc.y;
    doc
      .save()
      .rect(left, headerTop, tableWidth, 22)
      .fill('#F1F5F9')
      .restore();
    doc
      .fillColor('#475569')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('DESCRIPCIÓN', cols.desc.x, headerTop + 7, { width: cols.desc.w });
    doc.text('CANT.', cols.qty.x, headerTop + 7, {
      width: cols.qty.w,
      align: 'right',
    });
    doc.text('UNITARIO', cols.unit.x, headerTop + 7, {
      width: cols.unit.w,
      align: 'right',
    });
    doc.text('TOTAL', cols.total.x, headerTop + 7, {
      width: cols.total.w,
      align: 'right',
    });
    doc.y = headerTop + 26;

    if (items.length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .fillColor('#94A3B8')
        .text('Esta factura no tiene líneas de detalle.', left + 8, doc.y, {
          width: tableWidth - 16,
        });
      doc.moveDown(0.4);
      return;
    }

    // Rows
    for (const item of items) {
      const rowTop = doc.y;
      const description = item.description || '—';

      doc
        .fillColor('#0F172A')
        .font('Helvetica')
        .fontSize(10)
        .text(description, cols.desc.x, rowTop + 4, { width: cols.desc.w });

      const descBottom = doc.y;

      doc.text(String(item.quantity ?? 1), cols.qty.x, rowTop + 4, {
        width: cols.qty.w,
        align: 'right',
      });
      doc.text(
        this.formatMoney(item.unit_price, currency),
        cols.unit.x,
        rowTop + 4,
        { width: cols.unit.w, align: 'right' },
      );
      doc
        .font('Helvetica-Bold')
        .text(
          this.formatMoney(item.total, currency),
          cols.total.x,
          rowTop + 4,
          { width: cols.total.w, align: 'right' },
        );

      const rowBottom = Math.max(descBottom, rowTop + 22);
      doc
        .strokeColor('#E2E8F0')
        .lineWidth(0.5)
        .moveTo(left, rowBottom + 4)
        .lineTo(right, rowBottom + 4)
        .stroke();
      doc.y = rowBottom + 8;
    }
  }

  private renderTotalsBox(
    doc: PDFKit.PDFDocument,
    money: {
      subtotal: Prisma.Decimal;
      tax: Prisma.Decimal;
      total: Prisma.Decimal;
      amount_paid: Prisma.Decimal;
      currency: string;
    },
  ): void {
    const right = doc.page.width - doc.page.margins.right;
    const boxWidth = 240;
    const boxLeft = right - boxWidth;
    const lineHeight = 18;

    const drawRow = (
      label: string,
      value: string,
      opts: { bold?: boolean; emphasis?: boolean } = {},
    ) => {
      const y = doc.y;
      doc
        .fillColor(opts.emphasis ? '#0F172A' : '#475569')
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts.emphasis ? 12 : 10)
        .text(label, boxLeft, y, { width: boxWidth * 0.55 });
      doc
        .fillColor(opts.emphasis ? '#0F172A' : '#0F172A')
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts.emphasis ? 12 : 10)
        .text(value, boxLeft + boxWidth * 0.55, y, {
          width: boxWidth * 0.45,
          align: 'right',
        });
      doc.y = y + lineHeight;
    };

    drawRow('Subtotal', this.formatMoney(money.subtotal, money.currency));
    drawRow('Impuestos', this.formatMoney(money.tax, money.currency));

    // Separator
    doc
      .strokeColor('#CBD5E1')
      .lineWidth(0.8)
      .moveTo(boxLeft, doc.y + 2)
      .lineTo(boxLeft + boxWidth, doc.y + 2)
      .stroke();
    doc.y += 6;

    drawRow('Total', this.formatMoney(money.total, money.currency), {
      bold: true,
      emphasis: true,
    });

    if (this.toDecimal(money.amount_paid).gt(0)) {
      drawRow(
        'Pagado',
        this.formatMoney(money.amount_paid, money.currency),
        { bold: true },
      );
      const balance = this.toDecimal(money.total).sub(
        this.toDecimal(money.amount_paid),
      );
      if (balance.gt(0)) {
        drawRow('Saldo pendiente', this.formatMoney(balance, money.currency), {
          bold: true,
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────

  private toDecimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
    if (value instanceof Prisma.Decimal) return value;
    return new Prisma.Decimal(value ?? 0);
  }

  /**
   * Format COP (or any 0-decimal currency) — uses Intl with es-CO. Falls back
   * to a manual format when Intl/ICU is unavailable in minimal Node builds.
   */
  private formatMoney(
    value: Prisma.Decimal | string | number,
    currency: string,
  ): string {
    const dec = this.toDecimal(value);
    const num = Number(dec.toFixed(2));
    try {
      const fractionDigits = currency === 'COP' ? 0 : 2;
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(num);
    } catch {
      return `${currency} ${dec.toFixed(2)}`;
    }
  }

  private formatDate(value: Date | string | null | undefined): string {
    if (!value) return '-';
    const d = typeof value === 'string' ? new Date(value) : value;
    if (isNaN(d.getTime())) return '-';
    try {
      return new Intl.DateTimeFormat('es-CO', {
        year: 'numeric',
        month: 'long',
        day: '2-digit',
        timeZone: 'UTC',
      }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }

  private stateLabel(state: string): string {
    const map: Record<string, string> = {
      draft: 'Borrador',
      issued: 'Emitida',
      paid: 'Pagada',
      partially_paid: 'Pago parcial',
      void: 'Anulada',
      overdue: 'Vencida',
      uncollectible: 'Incobrable',
      refunded: 'Reembolsada',
    };
    return map[state] ?? state;
  }

  private stateBadgeColor(state: string): {
    bg: string;
    border: string;
    fg: string;
  } {
    switch (state) {
      case 'paid':
        return { bg: '#ECFDF5', border: '#A7F3D0', fg: '#047857' };
      case 'overdue':
      case 'uncollectible':
        return { bg: '#FEF2F2', border: '#FECACA', fg: '#B91C1C' };
      case 'partially_paid':
        return { bg: '#FFFBEB', border: '#FDE68A', fg: '#B45309' };
      case 'void':
      case 'refunded':
        return { bg: '#F3F4F6', border: '#D1D5DB', fg: '#374151' };
      case 'issued':
      default:
        return { bg: '#EFF6FF', border: '#BFDBFE', fg: '#1D4ED8' };
    }
  }
}
