import {
  buildInvoiceItemCreateInput,
  buildInvoiceTaxCreateInput,
  needsPersistedLineTaxes,
} from './invoice-calculation-persistence.util';

describe('invoice-calculation-persistence.util', () => {
  describe('buildInvoiceItemCreateInput', () => {
    it('preserves captured price, inclusive state, unit divisor, and fiscal base inputs', () => {
      const result = buildInvoiceItemCreateInput(
        {
          product_id: 10,
          product_variant_id: 11,
          description: 'Servicio AIU',
          quantity: '1.5',
          unit_price: '1200.00',
          aiu_component: 'utilidad',
        },
        {
          discount_amount: '0',
          tax_amount: '19.00',
          is_inclusive: true,
          total_amount: '119.00',
        },
        {
          price_unit_quantity: 12,
          unit_code: 'KGM',
          account_code: '413595',
        },
      );

      expect(result.quantity.toString()).toBe('1.5');
      expect(result.unit_price.toString()).toBe('1200');
      expect(result.discount_amount.toString()).toBe('0');
      expect(result.tax_amount.toString()).toBe('19');
      expect(result.total_amount.toString()).toBe('119');
      expect(result.is_inclusive).toBe(true);
      expect(result.aiu_component).toBe('utilidad');
      expect(result.price_unit_quantity).toBe(12);
      expect(result.unit_code).toBe('KGM');
      expect(result.account_code).toBe('413595');
    });

    it('keeps an exempt non-inclusive line and does not infer a tax amount', () => {
      const result = buildInvoiceItemCreateInput(
        { quantity: 1, unit_price: 500, description: 'Exento' },
        {
          discount_amount: '0',
          tax_amount: '0',
          is_inclusive: false,
          total_amount: '500',
        },
        {},
      );

      expect(result.tax_amount.toString()).toBe('0');
      expect(result.is_inclusive).toBe(false);
      expect(result.price_unit_quantity).toBeUndefined();
    });
  });

  describe('buildInvoiceTaxCreateInput', () => {
    it('preserves an already-resolved fiscal type and inclusive tax semantics', () => {
      const result = buildInvoiceTaxCreateInput({
        tax_rate_id: 7,
        tax_name: 'INC',
        tax_rate: 8,
        taxable_amount: '100.00',
        tax_amount: '8.00',
        tax_type: 'inc',
        is_inclusive: true,
      });

      expect(result.tax_type).toBe('inc');
      expect(result.tax_rate.toString()).toBe('8');
      expect(result.taxable_amount.toString()).toBe('100');
      expect(result.tax_amount.toString()).toBe('8');
      expect(result.is_inclusive).toBe(true);
    });

    it('retains the legacy IVA fraction normalization and zero defaults', () => {
      const result = buildInvoiceTaxCreateInput({
        tax_name: 'IVA',
        tax_rate: '0.19',
        tax_type: 'iva',
      });

      expect(result.tax_rate.toString()).toBe('19');
      expect(result.taxable_amount.toString()).toBe('0');
      expect(result.tax_amount.toString()).toBe('0');
      expect(result.is_inclusive).toBe(false);
    });
  });

  describe('needsPersistedLineTaxes', () => {
    it('keeps one ordinary tax aggregated but splits multiple taxes per line', () => {
      const ordinaryLine = [
        {
          omit_tax_total: false,
          taxable_amount: '100',
          line_extension_amount: '100',
        },
      ];

      expect(needsPersistedLineTaxes([{}], ordinaryLine)).toBe(false);
      expect(needsPersistedLineTaxes([{}, {}], ordinaryLine)).toBe(true);
    });

    it('splits a single-tax line when its AIU taxable base differs from its extension', () => {
      expect(
        needsPersistedLineTaxes(
          [{}],
          [
            {
              omit_tax_total: false,
              taxable_amount: '19',
              line_extension_amount: '100',
            },
          ],
        ),
      ).toBe(true);
    });

    it('compares decimal quantities exactly and ignores excluded AIU components', () => {
      expect(
        needsPersistedLineTaxes(
          [{}],
          [
            {
              omit_tax_total: false,
              taxable_amount: '0.0001',
              line_extension_amount: '0.000100',
            },
          ],
        ),
      ).toBe(false);
      expect(
        needsPersistedLineTaxes(
          [{}],
          [
            {
              omit_tax_total: true,
              taxable_amount: '0',
              line_extension_amount: '100',
            },
          ],
        ),
      ).toBe(false);
    });
  });
});
