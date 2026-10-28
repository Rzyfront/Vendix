import { Prisma } from '@prisma/client';

/**
 * The only invoice an ORDER prints as electronic invoice: its own sales invoice
 * (or POS equivalent document) ACCEPTED by the DIAN. Credit/debit notes carry
 * the order's `order_id`, a split-account invoice belongs to one account, and a
 * pending/rejected/error document is not a valid FE — all of them print the POS
 * ticket instead. Shared with the bulk-print ticket footer so both agree.
 */
export const PRINTABLE_ORDER_INVOICE_WHERE: Prisma.invoicesWhereInput = {
  invoice_type: { in: ['sales_invoice', 'pos_equivalent_document'] },
  dian_status: 'accepted',
  financial_account_id: null,
};
