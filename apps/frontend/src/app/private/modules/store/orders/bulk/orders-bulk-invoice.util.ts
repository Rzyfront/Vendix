/**
 * Pure logic of the bulk e-invoicing flow. Kept free of Angular so it can be
 * verified by reading it (and unit-tested later without TestBed).
 *
 * Queue order (S6a): independent operations first, dependent last.
 *   group 0 — `paid` and `credit_existing` (emit as they are)
 *   group 1 — `to_credit` (needs the credit conversion first)
 *   group 2 — Consumidor final opt-in rows (holder override), whatever their payment.
 *             An unpaid one goes out cash with payment means «Acuerdo mutuo» (ZZZ).
 */

import { ERROR_MESSAGES } from '../../../../../core/utils/error-messages';
import {
  BULK_INVOICE_CHUNK_SIZE,
  FINAL_CONSUMER_DOCUMENT,
  type BulkInvoiceBlockedCode,
  type BulkInvoiceChunkOutcome,
  type BulkInvoiceHolder,
  type BulkInvoiceItem,
  type BulkInvoicePreviewRow,
  type BulkInvoiceResultItem,
} from './orders-bulk-invoice.interface';

/** How a preview row is treated given the CF opt-in checkbox. */
export type BulkInvoiceRowKind =
  /** Emitted to its own customer / holder. */
  | 'emit'
  /** Emitted as Consumidor final because the user opted in. */
  | 'emit_cf'
  /** Customer data insufficient and the user did not opt in: not emitted. */
  | 'cf_pending'
  /** Not emitted at all. */
  | 'blocked';

export interface BulkInvoiceQueueEntry {
  row: BulkInvoicePreviewRow;
  item: BulkInvoiceItem;
  /** 0 = independent, 1 = needs credit conversion, 2 = CF opt-in. */
  group: 0 | 1 | 2;
}

export function rowKind(
  row: BulkInvoicePreviewRow,
  allowFinalConsumer: boolean,
): BulkInvoiceRowKind {
  if (row.will_emit) return 'emit';
  if (row.cf_overridable) return allowFinalConsumer ? 'emit_cf' : 'cf_pending';
  return 'blocked';
}

/** Rows included in the run, given the CF checkbox. */
export function isRowIncluded(
  row: BulkInvoicePreviewRow,
  allowFinalConsumer: boolean,
): boolean {
  const kind = rowKind(row, allowFinalConsumer);
  return kind === 'emit' || kind === 'emit_cf';
}

/**
 * Builds the execution queue in dependency order. Stable inside each group
 * (keeps the preview order). CF rows go LAST regardless of their payment.
 */
export function buildInvoiceQueue(
  rows: readonly BulkInvoicePreviewRow[],
  allowFinalConsumer: boolean,
): BulkInvoiceQueueEntry[] {
  const entries: BulkInvoiceQueueEntry[] = [];
  for (const row of rows) {
    const kind = rowKind(row, allowFinalConsumer);
    if (kind === 'emit') {
      entries.push({
        row,
        group: row.payment === 'to_credit' ? 1 : 0,
        item: {
          order_id: row.id,
          expected_holder_document: row.holder.document_number ?? '',
        },
      });
    } else if (kind === 'emit_cf') {
      entries.push({
        row,
        group: 2,
        item: {
          order_id: row.id,
          expected_holder_document: FINAL_CONSUMER_DOCUMENT,
          allow_final_consumer: true,
        },
      });
    }
  }
  // Array.prototype.sort is stable: the preview order survives inside a group.
  return entries.sort((a, b) => a.group - b.group);
}

/** Splits an array in chunks of `size` (default: the backend cap of 5). */
export function chunkBy<T>(
  items: readonly T[],
  size: number = BULK_INVOICE_CHUNK_SIZE,
): T[][] {
  if (size <= 0) return items.length > 0 ? [[...items]] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** True when any included row needs the credit conversion (credit step). */
export function queueRequiresCredit(
  queue: readonly BulkInvoiceQueueEntry[],
): boolean {
  // An unpaid row opted into Consumidor final goes out cash («Acuerdo mutuo»):
  // it never needs the credit conversion.
  return queue.some(
    (e) => e.row.payment === 'to_credit' && !e.item.allow_final_consumer,
  );
}

/** «Nombre · TIPO número[-DV]»; CF rows read «Consumidor final · 222222222222». */
export function formatHolder(holder: BulkInvoiceHolder): string {
  if (holder.rail === 'final_consumer') {
    return `Consumidor final · ${holder.document_number || FINAL_CONSUMER_DOCUMENT}`;
  }
  const number = holder.document_number
    ? `${holder.document_number}${holder.verification_digit ? `-${holder.verification_digit}` : ''}`
    : '';
  const doc = [holder.document_type, number].filter(Boolean).join(' ');
  return [holder.name, doc].filter(Boolean).join(' · ') || 'Sin titular';
}

/** Unpaid rows that go out cash («Acuerdo mutuo») once Consumidor final is opted in. */
export function unpaidFinalConsumerCount(rows: BulkInvoicePreviewRow[]): number {
  return rows.filter((r) => r.cf_overridable && r.payment === 'to_credit').length;
}

export function paymentLabel(
  row: BulkInvoicePreviewRow,
  allowFinalConsumer = false,
): string {
  if (rowKind(row, allowFinalConsumer) === 'emit_cf' && row.payment === 'to_credit') {
    return 'Contado · Acuerdo mutuo';
  }
  switch (row.payment) {
    case 'paid':
      return 'Pagada';
    case 'credit_existing':
      return 'Ya a crédito';
    case 'to_credit':
      return 'Pasa a crédito';
    default:
      return row.blocked_code === 'in_process'
        ? 'En proceso en otra operación'
        : 'Bloqueada';
  }
}

const BLOCKED_REASONS: Record<BulkInvoiceBlockedCode, string> = {
  partial_payment:
    'Tiene pagos parciales: no se factura hasta completar el pago o registrar la venta a crédito desde la orden.',
  customer_required:
    'Está sin pagar y no tiene cliente: una venta a crédito necesita cliente.',
  order_state: 'El estado de la orden no admite facturación.',
  already_invoiced: 'La orden ya tiene factura electrónica.',
  split_active: 'La orden tiene una cuenta dividida activa.',
  not_found: 'No se encontró la orden.',
  in_process:
    'Se está procesando en otra operación; inténtalo cuando termine.',
};

/** Why a row is not emitted (red text); '' when it is. */
export function rowProblemText(
  row: BulkInvoicePreviewRow,
  allowFinalConsumer: boolean,
): string {
  const kind = rowKind(row, allowFinalConsumer);
  if (kind === 'emit' || kind === 'emit_cf') return '';
  if (row.holder_issue?.message) return row.holder_issue.message;
  if (row.skip_reason) return row.skip_reason;
  return row.blocked_code ? BLOCKED_REASONS[row.blocked_code] : 'No se factura.';
}

/** Holder column text, aware of the CF opt-in. */
export function rowHolderText(
  row: BulkInvoicePreviewRow,
  allowFinalConsumer: boolean,
): string {
  return rowKind(row, allowFinalConsumer) === 'emit_cf'
    ? 'Saldrá a Consumidor final'
    : formatHolder(row.holder);
}

/** Display order of the preview: rows that need attention first. */
export function sortPreviewRows(
  rows: readonly BulkInvoicePreviewRow[],
): BulkInvoicePreviewRow[] {
  const weight = (r: BulkInvoicePreviewRow): number =>
    r.will_emit ? 2 : r.cf_overridable ? 1 : 0;
  return [...rows].sort(
    (a, b) =>
      weight(a) - weight(b) || a.order_number.localeCompare(b.order_number),
  );
}

/** Rows skipped for partial payment (they get their own notice). */
export function partialPaymentRows(
  rows: readonly BulkInvoicePreviewRow[],
): BulkInvoicePreviewRow[] {
  return rows.filter((r) => r.blocked_code === 'partial_payment');
}

/** Human message of a failed result: canned by code first, then backend text. */
export function describeResultError(result: BulkInvoiceResultItem): string {
  const canned = result.code ? ERROR_MESSAGES[result.code] : undefined;
  return canned ?? result.message?.trim() ?? 'No se pudo facturar la orden.';
}

/**
 * Normalizes one chunk's answer to exactly one result per sent id: ids the
 * backend did not answer become an explicit error (never silently dropped).
 */
export function alignChunkResults(
  ids: readonly number[],
  results: readonly BulkInvoiceResultItem[],
): BulkInvoiceResultItem[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  return ids.map(
    (id) =>
      byId.get(id) ?? {
        id,
        status: 'error' as const,
        message: 'El servidor no devolvió resultado para esta orden.',
      },
  );
}

/** A failed chunk request marks all of its orders as error. */
export function failedChunkOutcome(
  ids: readonly number[],
  code: string | null,
  message: string,
): BulkInvoiceChunkOutcome {
  return {
    ids: [...ids],
    results: ids.map((id) => ({
      id,
      status: 'error' as const,
      ...(code ? { code } : {}),
      message,
    })),
  };
}

export interface BulkInvoiceRunSummary {
  total: number;
  successful: number;
  failed: number;
}

export function summarizeRun(
  results: readonly BulkInvoiceResultItem[],
): BulkInvoiceRunSummary {
  const successful = results.filter((r) => r.status === 'ok').length;
  return { total: results.length, successful, failed: results.length - successful };
}

/** Progress bar percent (0-100). */
export function percentDone(done: number, total: number): number {
  return total <= 0 ? 0 : Math.min(100, Math.round((done / total) * 100));
}
