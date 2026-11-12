/**
 * Money columns of the Facturación > Facturas list (Total, Saldo, Vence).
 *
 * `listTransmissions` returns raw `fiscal_transmissions` rows: a platform
 * invoice carries its amounts in evidences (`collectionForTransmissions`) and a
 * SaaS invoice in its `subscription_invoices` row. Without this step the list
 * rendered "—" in all three columns.
 */
export interface ListCollection {
  total: string;
  amount_paid: string;
  balance_due: string;
  due_date: string | null;
  collection_status: string | null;
}

type Row = {
  subscription_invoice?: {
    total?: unknown;
    amount_paid?: unknown;
    due_at?: Date | string | null;
  } | null;
};

export function withListMoneyFields<T extends Row>(
  row: T,
  collection: ListCollection | undefined,
): T {
  if (collection) return { ...row, ...collection };

  const invoice = row.subscription_invoice;
  if (!invoice) return row;

  const total = Number(invoice.total ?? 0);
  const paid = Number(invoice.amount_paid ?? 0);
  const due = invoice.due_at ? new Date(invoice.due_at) : null;
  return {
    ...row,
    total: total.toFixed(2),
    amount_paid: paid.toFixed(2),
    balance_due: Math.max(0, total - paid).toFixed(2),
    due_date: due && !Number.isNaN(due.getTime()) ? due.toISOString().slice(0, 10) : null,
  };
}
