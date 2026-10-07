import { buildPurchaseVatContributionSnapshot } from './purchase-vat-contribution-snapshot.util';

const base = {
  organization_id: 1, accounting_entity_id: 2, store_id: 3,
  purchase_order_id: 42, reception_id: 91, supplier_id: 7,
  supplier_tax_id_snapshot: ' 900123456 ', invoice_number_snapshot: ' FC-1 ',
  invoice_issue_date_snapshot: '2026-09-30', currency: 'cop',
  net_amount: '100.00', iva_amount: '19.00',
  tax_groups: [{ tax_type: 'iva', tax_rate: 19, taxable_amount: '100.00', tax_amount: '19.00' }],
};

describe('buildPurchaseVatContributionSnapshot', () => {
  it('normalizes COP and yields stable replay hash regardless of group order', () => {
    const a = buildPurchaseVatContributionSnapshot({ ...base, tax_groups: [
      ...base.tax_groups,
      { tax_type: 'iva', tax_rate: 5, taxable_amount: '20.00', tax_amount: '1.00' },
    ], iva_amount: '20.00' });
    const b = buildPurchaseVatContributionSnapshot({ ...base, tax_groups: [
      { tax_type: 'iva', tax_rate: 5, taxable_amount: '20', tax_amount: '1' },
      ...base.tax_groups,
    ], iva_amount: '20' });
    expect(a).toEqual(b);
    expect(a.currency).toBe('COP');
    expect(a.net_amount).toBe('100.00');
    expect(a.source_effect_key).toBe('po:42:deductible-iva:v1');
    expect(a.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes hash for cent, identity, or issue-date drift; invoice number does not key collisions across POs', () => {
    const original = buildPurchaseVatContributionSnapshot(base);
    expect(buildPurchaseVatContributionSnapshot({ ...base, iva_amount: '19.01', tax_groups: [{ ...base.tax_groups[0], tax_amount: '19.01' }] }).payload_hash).not.toBe(original.payload_hash);
    expect(buildPurchaseVatContributionSnapshot({ ...base, supplier_id: 8 }).payload_hash).not.toBe(original.payload_hash);
    expect(buildPurchaseVatContributionSnapshot({ ...base, invoice_issue_date_snapshot: '2026-10-01' }).payload_hash).not.toBe(original.payload_hash);
    const otherPo = buildPurchaseVatContributionSnapshot({ ...base, purchase_order_id: 43 });
    expect(otherPo.invoice_number_snapshot).toBe(original.invoice_number_snapshot);
    expect(otherPo.source_effect_key).not.toBe(original.source_effect_key);
  });

  it('rejects non-IVA groups, over-precision, mismatched totals, negatives, invalid IDs and dates', () => {
    expect(() => buildPurchaseVatContributionSnapshot({ ...base, tax_groups: [{ ...base.tax_groups[0], tax_type: 'inc' }] })).toThrow(/only IVA/);
    expect(() => buildPurchaseVatContributionSnapshot({ ...base, net_amount: '100.001' })).toThrow(/2 decimal/);
    expect(() => buildPurchaseVatContributionSnapshot({ ...base, tax_groups: [{ ...base.tax_groups[0], tax_rate: '19.123456' }] })).toThrow(/5 decimal/);
    expect(() => buildPurchaseVatContributionSnapshot({ ...base, iva_amount: '18.99' })).toThrow(/equal/);
    expect(() => buildPurchaseVatContributionSnapshot({ ...base, net_amount: '-1' })).toThrow(/2 decimal|nonnegative/);
    expect(() => buildPurchaseVatContributionSnapshot({ ...base, purchase_order_id: 0 })).toThrow(/positive integer/);
    expect(() => buildPurchaseVatContributionSnapshot({ ...base, invoice_issue_date_snapshot: '2026-02-30' })).toThrow(/valid date/);
  });
});
