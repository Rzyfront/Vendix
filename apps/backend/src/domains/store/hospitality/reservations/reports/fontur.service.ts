import { Injectable } from '@nestjs/common';
import { Prisma, invoice_status_enum, invoice_type_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import {
  localDateString,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { SettingsService } from '../../../settings/settings.service';
import { COMPLETED_SALE_STATES, round2 } from '../../../analytics/analytics-metrics.contract';
import { LodgingFonturQueryDto } from './fontur.dto';

/** Default Fontur rate for lodging (per mil); the store can change it in Configuración → Hotelería. */
export const DEFAULT_FONTUR_RATE_PER_MIL = 2.5;

/** Fiscal documents that bill a folio (electronic invoice or POS equivalent document). */
const BILLING_TYPES: invoice_type_enum[] = ['sales_invoice', 'pos_equivalent_document'];
/** Notes on those documents: a credit note lowers the base, a debit note raises it. */
const NOTE_SIGN: Partial<Record<invoice_type_enum, number>> = { credit_note: -1, debit_note: 1 };
/** Never issued or annulled: they carry no income. */
const EXCLUDED_STATUSES: invoice_status_enum[] = ['draft', 'rejected', 'voided', 'cancelled'];

const OTHER_LINE_KEY = 'other';
const OTHER_LINE_LABEL = 'Otros consumos del huésped';

/**
 * One income source of the quarter: a fiscal document (signed by its type)
 * or a folio closed as a sale without one. `base` is the line's income
 * before taxes.
 */
export interface FonturSource {
  id: string;
  sign: number;
  items: Array<{ product_id: number | null; base: number }>;
}

/** One revenue line of the report: a room type or the other guest charges. */
export interface LodgingFonturLine {
  key: string;
  label: string;
  kind: 'lodging' | 'other';
  /** Distinct sources (invoices, notes and closed accounts) with a line here. */
  documents: number;
  /** Income before taxes, net of credit notes. */
  base: number;
}

export interface LodgingFonturReport {
  year: number;
  quarter: number;
  from: string;
  to: string;
  timezone: string;
  rate_per_mil: number;
  lines: LodgingFonturLine[];
  totals: {
    documents: number;
    /** Of those, guest accounts closed as a sale without a fiscal document. */
    without_invoice: number;
    base: number;
    contribution: number;
  };
}

/** `[year, quarter]` of the last quarter that already ended on `today` (store civil date). */
export function lastClosedQuarter(today: string): { year: number; quarter: number } {
  const year = Number(today.slice(0, 4));
  const current = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  return current === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: current - 1 };
}

/** First and last civil day of a quarter (`YYYY-MM-DD`, inclusive). */
export function quarterDates(year: number, quarter: number): { from: string; to: string } {
  const first = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const last = new Date(Date.UTC(year, quarter * 3, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** Sign of a fiscal document: +1 billing, −1 credit note, +1 debit note, 0 anything else. */
export function documentSign(type: invoice_type_enum): number {
  return BILLING_TYPES.includes(type) ? 1 : (NOTE_SIGN[type] ?? 0);
}

/**
 * Pure aggregate of the report: every source line goes to its room type
 * (`unitTypeByProduct`) or to "Otros consumos del huésped", signed by its
 * source. The estimated contribution is `base × rate ‰` over the same total
 * the screen and the XLSX show.
 */
export function buildFonturLines(
  sources: FonturSource[],
  unitTypeByProduct: Map<number, { id: number; name: string }>,
  rate_per_mil: number,
): { lines: LodgingFonturLine[]; base: number; contribution: number } {
  const lines = new Map<string, LodgingFonturLine & { ids: Set<string> }>();
  for (const source of sources) {
    if (source.sign === 0) continue;
    for (const item of source.items) {
      const unitType = item.product_id !== null ? unitTypeByProduct.get(item.product_id) : undefined;
      const key = unitType ? `unit_type:${unitType.id}` : OTHER_LINE_KEY;
      let line = lines.get(key);
      if (!line) {
        line = {
          key,
          label: unitType ? `Alojamiento – ${unitType.name}` : OTHER_LINE_LABEL,
          kind: unitType ? 'lodging' : 'other',
          documents: 0,
          base: 0,
          ids: new Set(),
        };
        lines.set(key, line);
      }
      line.base += source.sign * item.base;
      line.ids.add(source.id);
    }
  }
  // Room types first (by name), the other charges last.
  const sorted = [...lines.values()]
    .map(({ ids, ...line }) => ({ ...line, documents: ids.size, base: round2(line.base) }))
    .sort((a, b) =>
      a.kind === b.kind ? a.label.localeCompare(b.label, 'es') : a.kind === 'lodging' ? -1 : 1,
    );
  const base = round2(sorted.reduce((sum, line) => sum + line.base, 0));
  return { lines: sorted, base, contribution: round2((base * rate_per_mil) / 1000) };
}

/** The store's rate, or the default when unset or not a valid number. */
export function fonturRate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_FONTUR_RATE_PER_MIL;
}

/**
 * Hospitality Suite (H4.4) — base of the Fontur contribution: the income of
 * the hotel guest accounts (folios) in one quarter, by line, and the
 * estimated contribution at the store's rate. Informative only (D14): it
 * never blocks anything; the accountant declares on the Fontur platform.
 *
 * Sources, all in the quarter (store time zone):
 * - fiscal documents issued on a folio (electronic invoice or POS equivalent
 *   document) and the credit/debit notes issued on them, by their lines'
 *   base before taxes (`total_amount − tax_amount`, as the DIAN calculator);
 * - folios closed as a completed sale without any such document (stores
 *   without electronic invoicing close the folio as a POS sale), by their
 *   active order lines' `total_price` (the sale's subtotal).
 */
@Injectable()
export class LodgingFonturService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly settings: SettingsService,
  ) {}

  async get(query: LodgingFonturQueryDto): Promise<LodgingFonturReport> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const fallback = lastClosedQuarter(localDateString(new Date(), timezone));
    const year = query.year ?? fallback.year;
    const quarter = query.quarter ?? fallback.quarter;
    const { from, to } = quarterDates(year, quarter);
    const window = { gte: this.localMidnight(from, timezone), lt: this.localMidnight(to, timezone, 1) };
    const folioOrder = { lodging_folio: { isNot: null } } satisfies Prisma.ordersWhereInput;
    const billed = { invoice_type: { in: BILLING_TYPES }, status: { notIn: EXCLUDED_STATUSES } };

    const [documents, unbilled, settings] = await Promise.all([
      this.prisma.invoices.findMany({
        where: {
          status: { notIn: EXCLUDED_STATUSES },
          issue_date: window,
          OR: [
            { invoice_type: { in: BILLING_TYPES }, order: folioOrder },
            {
              invoice_type: { in: Object.keys(NOTE_SIGN) as invoice_type_enum[] },
              related_invoice: { invoice_type: { in: BILLING_TYPES }, order: folioOrder },
            },
          ],
        },
        select: {
          id: true,
          invoice_type: true,
          invoice_items: { select: { product_id: true, total_amount: true, tax_amount: true } },
        },
      }),
      this.prisma.lodging_folios.findMany({
        where: {
          status: 'closed',
          closed_at: window,
          order: {
            state: { in: [...COMPLETED_SALE_STATES] },
            invoices: { none: billed },
          },
        },
        select: {
          order_id: true,
          // Cancelled lines never reached the subtotal of the sale.
          order: {
            select: {
              order_items: {
                where: { cancelled_at: null },
                select: { product_id: true, total_price: true },
              },
            },
          },
        },
      }),
      this.settings.getSettings() as Promise<{ hospitality?: { fontur_rate_per_mil?: unknown } }>,
    ]);

    const sources: FonturSource[] = [
      ...documents.map((d) => ({
        id: `invoice:${d.id}`,
        sign: documentSign(d.invoice_type),
        items: d.invoice_items.map((i) => ({
          product_id: i.product_id,
          base: Number(i.total_amount) - Number(i.tax_amount),
        })),
      })),
      ...unbilled.map((f) => ({
        id: `order:${f.order_id}`,
        sign: 1,
        items: f.order.order_items.map((i) => ({ product_id: i.product_id, base: Number(i.total_price) })),
      })),
    ];

    const productIds = [
      ...new Set(
        sources.flatMap((s) => s.items.map((i) => i.product_id)).filter((id): id is number => id !== null),
      ),
    ];
    const unitTypes = productIds.length
      ? await this.prisma.lodging_unit_types.findMany({
          where: { product_id: { in: productIds } },
          select: { id: true, name: true, product_id: true },
        })
      : [];
    const unitTypeByProduct = new Map<number, { id: number; name: string }>(
      unitTypes.map((u) => [u.product_id, { id: u.id, name: u.name }]),
    );

    const rate_per_mil = fonturRate(settings?.hospitality?.fontur_rate_per_mil);
    const { lines, base, contribution } = buildFonturLines(sources, unitTypeByProduct, rate_per_mil);
    return {
      year,
      quarter,
      from,
      to,
      timezone,
      rate_per_mil,
      lines,
      totals: { documents: sources.length, without_invoice: unbilled.length, base, contribution },
    };
  }

  /** UTC instant of the store's local midnight of `date` (+ `days`). */
  private localMidnight(date: string, tz: string, days = 0): Date {
    const [y, m, d] = date.split('-').map(Number);
    const civil = new Date(Date.UTC(y, m - 1, d + days));
    return zonedWallClockToUtc(civil.getUTCFullYear(), civil.getUTCMonth() + 1, civil.getUTCDate(), 0, 0, 0, 0, tz);
  }
}
