import { createHash } from 'crypto';
import { Prisma, invoices, invoice_items, invoice_taxes } from '@prisma/client';

export interface HolderCustomerSnapshot {
  person_type: 'NATURAL' | 'JURIDICA';
  document_type: string;
  document_number: string;
  verification_digit?: string;
  first_name?: string;
  last_name?: string;
  legal_name?: string;
  email: string;
  phone?: string;
  tax_regime?: string;
  fiscal_responsibilities?: string[];
  address: {
    address_line1: string;
    city: string;
    state_province: string;
    country_code: string;
    municipality_code: string;
  };
}
export type HolderMode = 'public' | 'manual' | 'release_only';
export type HolderOperation = Prisma.invoice_holder_changesGetPayload<
  Record<string, never>
>;
export const HOLDER_TERMINAL_EFFECTS = ['posted', 'skipped'];

/** Includes fiscal amounts AND exact source-line/tax associations, never current catalogue prices. */
export function holderEconomicHash(
  invoice: invoices & {
    invoice_items: invoice_items[];
    invoice_taxes: invoice_taxes[];
  },
): string {
  const fields = [
    'subtotal_amount',
    'discount_amount',
    'tax_amount',
    'shipping_amount',
    'withholding_amount',
    'total_amount',
    'currency',
    'foreign_currency',
    'foreign_total_amount',
    'exchange_rate',
    'operation_type',
    'aiu_contract_object',
    'aiu_regime',
    'aiu_minimum_percent',
    'aiu_taxable_matrix',
  ];
  const pick = (row: object, keys: string[]) =>
    keys.map((k) => [k, String((row as Record<string, unknown>)[k] ?? '')]);
  const items = [...invoice.invoice_items].sort((a, b) => a.id - b.id);
  const data = {
    header: pick(invoice, fields),
    items: items.map((i) =>
      pick(i, [
        'product_id',
        'product_variant_id',
        'description',
        'quantity',
        'unit_price',
        'discount_amount',
        'tax_amount',
        'total_amount',
        'unit_code',
        'is_inclusive',
      ]),
    ),
    taxes: [...invoice.invoice_taxes]
      .sort((a, b) => a.id - b.id)
      .map((t) => [
        items.findIndex((i) => i.id === t.invoice_item_id),
        ...pick(t, [
          'tax_rate_id',
          'tax_name',
          'tax_rate',
          'taxable_amount',
          'tax_amount',
          'tax_type',
          'is_inclusive',
        ]),
      ]),
  };
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
