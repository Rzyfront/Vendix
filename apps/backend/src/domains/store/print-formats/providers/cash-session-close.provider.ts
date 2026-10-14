import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  formatStoreDate,
  formatStoreTime,
  resolveStoreTimezone,
} from '../../../../common/utils/store-timezone.util';
import { SessionsService } from '../../cash-registers/sessions/sessions.service';
import type { CashSessionCloseReport } from '../../cash-registers/sessions/interfaces/cash-session-close-report.interface';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
import { signStoreLogoUrl } from '../lib/print-logo.util';

/**
 * Reporte de cierre de caja (`cash_session_close`).
 *
 * NO recalcula nada: las cifras salen de `SessionsService.getCloseReport`, la
 * misma fuente que la pantalla de cierre, y viajan en
 * `custom_variables.cash_report` para que la sección `cash_session_report` del
 * compositor las pinte. Este provider solo (1) valida que la sesión sea de la
 * tienda, (2) formatea fechas en la zona horaria de la tienda y (3) firma el
 * logo.
 *
 * `SessionsService` se resuelve perezosamente vía `ModuleRef` (strict:false):
 * importar `CashRegistersModule` desde el módulo de impresión arrastraría
 * `SettingsModule` al grafo de carga (ver ADR-15 §4 sobre ciclos de `require`).
 */
@Injectable()
export class CashSessionCloseDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'cash_session_close';
  private readonly logger = new Logger(CashSessionCloseDataProvider.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly moduleRef: ModuleRef,
    private readonly s3Service?: S3Service,
  ) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Invalid cash session id: ${documentId}`,
      );
    }

    // Propiedad: sin esta lectura con `store_id`, `getCloseReport(id)` serviría
    // la sesión de cualquier tienda a quien conozca el id (IDOR).
    const owned = await this.prisma.cash_register_sessions.findFirst({
      where: { id, store_id: storeId },
      select: { id: true },
    });
    if (!owned) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Cash session ${id} not found in store ${storeId}`,
      );
    }

    const sessions = this.moduleRef.get(SessionsService, { strict: false });
    let report: CashSessionCloseReport;
    try {
      report = await sessions.getCloseReport(id);
    } catch (e) {
      if ((e as any)?.status === 404) {
        throw new VendixHttpException(
          ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
          `Cash session ${id} not found in store ${storeId}`,
        );
      }
      throw e;
    }

    const store = await this.prisma.stores.findFirst({
      where: { id: storeId },
      select: {
        name: true,
        legal_name: true,
        logo_url: true,
        // `stores` no tiene phone/email: salen de la dirección y de la organización.
        addresses: { take: 1 },
        organizations: {
          select: { tax_id: true, legal_name: true, email: true, phone: true },
        },
      },
    });
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const signedLogo = await signStoreLogoUrl(
      this.s3Service,
      (store as any)?.logo_url,
      this.logger,
    );

    return this.mapReportToPrintData(report, store as any, signedLogo, tz);
  }

  async getSampleData(_storeId?: number): Promise<StandardPrintDataModel> {
    const iso = new Date().toISOString();
    const sample: CashSessionCloseReport = {
      session: {
        id: 0,
        status: 'closed',
        register: { id: 1, name: 'Caja Principal', code: 'CAJA-1' },
        opened_by: { id: 1, name: 'Ana Torres' },
        closed_by: { id: 1, name: 'Ana Torres' },
        opened_at: iso,
        closed_at: iso,
        closing_notes: null,
      },
      currency: { code: 'COP', symbol: '$' },
      cash: {
        opening: 100000,
        cash_sales: 850000,
        cash_in: { count: 0, total: 0 },
        cash_out: { count: 1, total: 50000 },
        cash_refunds: { count: 0, total: 0 },
        expected: 900000,
        declared: 895000,
        difference: -5000,
      },
      payment_methods: [
        { method: 'cash', count: 24, total: 850000 },
        { method: 'card', count: 11, total: 430000 },
      ],
      consolidated: {
        rows: [
          {
            method: 'cash',
            sales: 850000,
            cash_in: 0,
            entered: 850000,
            refunds: 0,
            cancellations: 0,
            withdrawals: 50000,
            exited: 50000,
            expected: 900000,
            counted: 895000,
            difference: -5000,
          },
          {
            method: 'card',
            sales: 430000,
            cash_in: 0,
            entered: 430000,
            refunds: 0,
            cancellations: 0,
            withdrawals: 0,
            exited: 0,
            expected: 430000,
            counted: null,
            difference: null,
          },
        ],
        totals: { entered: 1280000, exited: 50000, expected: 1330000 },
      },
      cash_breakdown: {
        opening: 100000,
        sales: 850000,
        cash_in: 0,
        refunds: 0,
        cancellations: 0,
        withdrawals: 50000,
        expected: 900000,
        counted: 895000,
        difference: -5000,
      },
      outflows: [
        {
          id: 1,
          at: iso,
          kind: 'withdrawal',
          order_id: null,
          order_number: null,
          payment_method: 'cash',
          amount: 50000,
          reason: 'Pago a proveedor',
          user_name: 'Ana Torres',
        },
      ],
      sales_summary: {
        orders_count: 35,
        payments_count: 35,
        subtotal: 1075630,
        discounts: 20000,
        product_taxes: 204370,
        shipping_taxes: 0,
        taxes: 204370,
        shipping: 0,
        tips: 0,
        grand_total: 1280000,
        orders_grand_total: 1280000,
        average_ticket: 36571.43,
        cancelled: { count: 0, total: 0 },
      },
      integrity: { sales_match: true, notes: [] },
      sales: {
        orders_count: 35,
        payments_count: 35,
        subtotal: 1075630,
        discounts: 20000,
        product_taxes: 204370,
        shipping_taxes: 0,
        taxes: 204370,
        shipping: 0,
        tips: 0,
        grand_total: 1280000,
        average_ticket: 36571.43,
      },
      refunds: {
        count: 0,
        total: 0,
        by_method: [],
        payment_cancellations: { count: 0, total: 0 },
      },
      returns: {
        refunds_count: 0,
        refunds_total: 0,
        refunds_tax: 0,
        payments_cancelled_count: 0,
        payments_cancelled_total: 0,
      },
      net: { net_sales: 1280000, net_taxes: 204370 },
      pending_collection: { count: 0, total: 0 },
      discounts: {
        orders_with_discount: 3,
        total: 20000,
        promotions: [{ name: 'Promo 2x1', count: 2, total: 15000 }],
        coupons: [{ code: 'BIENVENIDA', count: 1, total: 5000 }],
        other: { count: 0, total: 0 },
      },
      generated_at: iso,
    };
    return this.mapReportToPrintData(
      sample,
      {
        name: 'Vendix Store Demo',
        legal_name: 'Vendix Comercio S.A.S.',
        phone: '+57 300 123 4567',
        addresses: [{ address_line1: 'Calle 100 # 15-20', city: 'Bogotá D.C.' }],
        organizations: { tax_id: '901.234.567-8' },
      },
      undefined,
      'America/Bogota',
    );
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{ document.number }}', path: 'document.number', description: 'Número de la sesión de caja', example: 'Sesión #128' },
      { token: '{{ register_name }}', path: 'custom_variables.cash_report.session.register.name', description: 'Nombre de la caja', example: 'Caja Principal' },
      { token: '{{ opened_by }}', path: 'custom_variables.cash_report.session.opened_by.name', description: 'Quién abrió la caja', example: 'Ana Torres' },
      { token: '{{ closed_by }}', path: 'custom_variables.cash_report.session.closed_by.name', description: 'Quién cerró la caja', example: 'Ana Torres' },
      { token: '{{ cash_expected }}', path: 'custom_variables.cash_report.cash.expected', description: 'Efectivo esperado', example: '900.000' },
      { token: '{{ cash_declared }}', path: 'custom_variables.cash_report.cash.declared', description: 'Efectivo declarado', example: '895.000' },
      { token: '{{ cash_difference }}', path: 'custom_variables.cash_report.cash.difference', description: 'Diferencia (sobrante / faltante)', example: '-5.000' },
    ];
  }

  /** Sesiones cerradas más recientes de la tienda para el picker del editor. */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.cash_register_sessions.findMany({
      where: { store_id: storeId, status: 'closed' },
      orderBy: { closed_at: 'desc' },
      take: limit,
      select: {
        id: true,
        closed_at: true,
        actual_closing_amount: true,
        register: { select: { name: true } },
      },
    } as any);
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    return (rows as any[]).map((r) => ({
      id: r.id,
      number: `${r.register?.name ?? 'Caja'} · Sesión #${r.id}`,
      date_formatted: r.closed_at
        ? `${formatStoreDate(new Date(r.closed_at), tz)} ${formatStoreTime(new Date(r.closed_at), tz)}`
        : '',
      total_formatted:
        r.actual_closing_amount != null
          ? `$${Number(r.actual_closing_amount).toLocaleString('es-CO')}`
          : undefined,
    }));
  }

  // ============================================================
  // Mapeo interno
  // ============================================================

  private mapReportToPrintData(
    report: CashSessionCloseReport,
    store: any,
    signedLogo: string | undefined,
    tz: string,
  ): StandardPrintDataModel {
    const stamp = (iso: string | null | undefined): string => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return `${formatStoreDate(d, tz)} ${formatStoreTime(d, tz)}`;
    };
    const s = report.session;
    const addr = store?.addresses?.[0] ?? {};
    const anchor = s.closed_at ?? s.opened_at;
    const anchorDate = new Date(anchor);
    const grand = Number(
      (report.sales_summary ?? report.sales)?.grand_total ?? 0,
    );
    const money = `$${grand.toLocaleString('es-CO')}`;

    const cashReport = {
      ...report,
      session: {
        ...s,
        opened_at_formatted: stamp(s.opened_at),
        closed_at_formatted: stamp(s.closed_at),
      },
      outflows: (report.outflows ?? []).map((o) => ({
        ...o,
        at_formatted: stamp(o.at),
      })),
      printed_at_formatted: stamp(new Date().toISOString()),
    };

    return {
      store: {
        name: store?.name || 'Vendix',
        legal_name: store?.legal_name || store?.organizations?.legal_name,
        tax_id: store?.organizations?.tax_id,
        phone: addr.phone_number || store?.organizations?.phone || undefined,
        email: store?.organizations?.email || undefined,
        address: addr.address_line1
          ? `${addr.address_line1} ${addr.address_line2 || ''}`.trim()
          : undefined,
        city: addr.city,
        logo_url: signedLogo,
      },
      document: {
        id: s.id,
        number: `Sesión #${s.id}`,
        date: anchorDate.toISOString(),
        date_formatted: formatStoreDate(anchorDate, tz),
        time: formatStoreTime(anchorDate, tz),
        state: s.status,
        state_label: s.status === 'closed' ? 'Cerrada' : 'Abierta',
        notes: s.closing_notes || undefined,
        pos_terminal: s.register?.name,
      },
      money_basis: 'gross',
      prints_vat_breakdown: false,
      items: [],
      taxes: [],
      totals: {
        subtotal: 0,
        subtotal_formatted: '$0',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: grand,
        grand_total_formatted: money,
      },
      custom_variables: { cash_report: cashReport },
    };
  }
}
