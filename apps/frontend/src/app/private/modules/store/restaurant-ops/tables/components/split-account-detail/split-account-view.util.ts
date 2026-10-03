import type {
  SplitAccountPayment,
  SplitFinancialAccount,
  SplitResultMode,
} from '../../interfaces';

/** Estado visible de una cuenta: siempre en español, nunca el valor crudo. */
export type SplitAccountStatus =
  | 'pending'
  | 'partial'
  | 'awaiting_confirmation'
  | 'paid'
  | 'invoiced';

export type SplitPrimaryActionKind =
  | 'pay'
  | 'confirm'
  | 'continue'
  | 'invoice'
  | 'print_ticket'
  | 'view_invoice';

export interface SplitPrimaryAction {
  kind: SplitPrimaryActionKind;
  label: string;
  paymentId?: number;
  url?: string;
}

export interface SplitActionPermissions {
  canPay: boolean;
  canInvoice: boolean;
  /**
   * FE realmente viva (`is_live` de la config DIAN). Fail-closed: sin ella una
   * cuenta pagada no se factura, se imprime su ticket (igual que una orden normal).
   */
  electronicInvoicingLive: boolean;
}

export const money = (value: string | number | null | undefined): number =>
  Number(value ?? 0);

export function safeHttpsUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function paymentNextUrl(payment: SplitAccountPayment): string | null {
  const next = payment.next_action as { url?: unknown } | null | undefined;
  return safeHttpsUrl(next?.url);
}

export function accountStatus(account: SplitFinancialAccount): SplitAccountStatus {
  if (account.invoice_id || account.invoice) return 'invoiced';
  if (account.payment_state === 'paid') return 'paid';
  if (money(account.reserved_amount) > 0 || account.payment_state === 'pending')
    return 'awaiting_confirmation';
  if (account.payment_state === 'partial') return 'partial';
  return 'pending';
}

export const STATUS_LABEL: Record<SplitAccountStatus, string> = {
  pending: 'Pendiente',
  partial: 'Pago parcial',
  awaiting_confirmation: 'Pago por confirmar',
  paid: 'Pagada',
  invoiced: 'Facturada',
};

export const STATUS_BADGE: Record<
  SplitAccountStatus,
  'neutral' | 'warning' | 'success' | 'primary'
> = {
  pending: 'neutral',
  partial: 'warning',
  awaiting_confirmation: 'warning',
  paid: 'success',
  invoiced: 'primary',
};

export function paymentStateLabel(state: string): string {
  switch (state) {
    case 'succeeded':
    case 'captured':
      return 'Recibido';
    case 'pending':
    case 'processing':
    case 'authorized':
      return 'Por confirmar';
    case 'failed':
      return 'Fallido';
    case 'cancelled':
    case 'canceled':
      return 'Cancelado';
    case 'refunded':
      return 'Reembolsado';
    case 'partially_refunded':
      return 'Reembolso parcial';
    default:
      return 'En proceso';
  }
}

export function invoiceStatusLabel(
  invoice: { status: string; dian_status: string | null } | null,
): string {
  if (!invoice) return '';
  const dian = (invoice.dian_status ?? '').toLowerCase();
  if (dian) {
    if (['accepted', 'approved'].includes(dian)) return 'Aceptada por la DIAN';
    if (['rejected', 'error', 'failed'].includes(dian))
      return 'Rechazada por la DIAN';
    if (['sent', 'transmitted', 'submitted', 'processing', 'pending'].includes(dian))
      return 'Enviada a la DIAN';
  }
  switch ((invoice.status ?? '').toLowerCase()) {
    case 'draft':
      return 'Borrador';
    case 'validated':
      return 'Validada';
    case 'sent':
      return 'Enviada a la DIAN';
    case 'accepted':
      return 'Aceptada por la DIAN';
    case 'rejected':
      return 'Rechazada por la DIAN';
    case 'cancelled':
    case 'voided':
      return 'Anulada';
    default:
      return 'En proceso';
  }
}

/**
 * UNA acción principal por estado. «Facturar» solo existe con la cuenta
 * cobrada completa (regla del dueño; el backend responde 409 si no).
 */
export function primaryAction(
  account: SplitFinancialAccount,
  perms: SplitActionPermissions,
): SplitPrimaryAction | null {
  const status = accountStatus(account);
  if (status === 'invoiced') {
    if (!perms.canInvoice) return null;
    const number = account.invoice?.invoice_number;
    return {
      kind: 'view_invoice',
      label: number ? `Ver factura N° ${number}` : 'Ver factura',
    };
  }
  if (status === 'awaiting_confirmation') {
    if (!perms.canPay) return null;
    const open = account.payments.filter((p) =>
      ['pending', 'processing', 'authorized'].includes(p.state),
    );
    const confirmable = open.find((p) => p.can_confirm);
    if (confirmable)
      return { kind: 'confirm', label: 'Confirmar recibido', paymentId: confirmable.id };
    const withUrl = open.find((p) => paymentNextUrl(p));
    if (withUrl)
      return {
        kind: 'continue',
        label: 'Continuar pago',
        paymentId: withUrl.id,
        url: paymentNextUrl(withUrl)!,
      };
    return null;
  }
  if (status === 'paid') {
    // Sin FE viva no hay nada que emitir: el cierre de la cuenta es el ticket.
    if (!perms.electronicInvoicingLive)
      return { kind: 'print_ticket', label: 'Imprimir ticket' };
    return perms.canInvoice ? { kind: 'invoice', label: 'Facturar' } : null;
  }
  if (account.role === 'payable' && perms.canPay && money(account.available_to_pay) > 0) {
    return { kind: 'pay', label: 'Cobrar' };
  }
  return null;
}

/** Resumen de una línea de lo que incluye la cuenta. */
export function includesSummary(
  account: SplitFinancialAccount,
  mode: SplitResultMode | null,
  sourceProductCount: number,
): string {
  if (account.role === 'paid_original') return 'Pagos hechos antes de dividir';
  if (mode === 'items') {
    const n = account.lines.length;
    return n === 1 ? '1 producto' : `${n} productos`;
  }
  const total = account.lines.length || sourceProductCount;
  return total ? `Parte de ${total} ${total === 1 ? 'producto' : 'productos'}` : 'Parte proporcional de la cuenta';
}
