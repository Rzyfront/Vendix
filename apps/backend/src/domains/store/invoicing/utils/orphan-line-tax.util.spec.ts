import {
  buildSiblingTaxCandidates,
  extractProductTaxCandidates,
  resolveOrphanLineTax,
} from './orphan-line-tax.util';

describe('resolveOrphanLineTax — F-090 remediación (Agente E)', () => {
  it('resuelve por asignación de producto cuando hay una única tarifa que reconstruye la cuota', () => {
    const result = resolveOrphanLineTax({
      taxable_amount: 50000,
      tax_amount: 4000,
      product_candidates: [
        { tax_rate_id: 900, tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', is_inclusive: false },
      ],
      sibling_candidates: [],
    });
    expect(result.resolved).toEqual({
      tax_rate_id: 900,
      tax_name: 'INC',
      tax_rate: 0.08,
      tax_type: 'inc',
      is_inclusive: false,
    });
  });

  it('cae a un hermano real de la misma orden cuando el producto no resuelve nada', () => {
    const result = resolveOrphanLineTax({
      taxable_amount: 50000,
      tax_amount: 4000,
      product_candidates: [],
      sibling_candidates: [
        { tax_rate_id: 68, tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', is_inclusive: true },
      ],
    });
    expect(result.resolved).toEqual({
      tax_rate_id: 68,
      tax_name: 'INC',
      tax_rate: 0.08,
      tax_type: 'inc',
      is_inclusive: true,
    });
  });

  it('el producto gana sobre el hermano cuando ambos resuelven (prioridad de catálogo)', () => {
    const result = resolveOrphanLineTax({
      taxable_amount: 50000,
      tax_amount: 9500,
      product_candidates: [
        { tax_rate_id: 901, tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', is_inclusive: false },
      ],
      sibling_candidates: [
        { tax_rate_id: 68, tax_name: 'INC', tax_rate: 0.19, tax_type: 'inc', is_inclusive: true },
      ],
    });
    expect(result.resolved?.tax_type).toBe('iva');
    expect(result.resolved?.tax_rate_id).toBe(901);
  });

  it('no falla cuando ninguna fuente explica la cuota (no_match)', () => {
    const result = resolveOrphanLineTax({
      taxable_amount: 50000,
      tax_amount: 4000,
      product_candidates: [
        { tax_rate_id: 901, tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', is_inclusive: false },
      ],
      sibling_candidates: [
        { tax_rate_id: 68, tax_name: 'ICA', tax_rate: 0.007, tax_type: 'ica', is_inclusive: false },
      ],
    });
    expect(result.resolved).toBeNull();
    expect((result as { reason: string }).reason).toBe('no_match');
  });

  it('no falla cuando dos tarifas distintas explican la misma cuota (ambiguous)', () => {
    // 50000 × 0.08 = 4000, y también 40000 × 0.10 no aplica — usamos dos
    // candidatos que, sobre la MISMA base, dan la misma cuota.
    const result = resolveOrphanLineTax({
      taxable_amount: 50000,
      tax_amount: 4000,
      product_candidates: [
        { tax_rate_id: 900, tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', is_inclusive: false },
        { tax_rate_id: 901, tax_name: 'IBUA', tax_rate: 0.08, tax_type: 'iva', is_inclusive: false },
      ],
      sibling_candidates: [],
    });
    expect(result.resolved).toBeNull();
    expect((result as { reason: string }).reason).toBe('ambiguous');
  });

  it('tolera hasta 1 ¢ de diferencia (misma tolerancia que FiscalDocumentValidator)', () => {
    const result = resolveOrphanLineTax({
      taxable_amount: 50000,
      tax_amount: 4000.01,
      product_candidates: [
        { tax_rate_id: 900, tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', is_inclusive: false },
      ],
      sibling_candidates: [],
    });
    expect(result.resolved?.tax_rate_id).toBe(900);
  });
});

describe('extractProductTaxCandidates', () => {
  it('lee product_tax_assignments -> tax_categories -> tax_rates', () => {
    const candidates = extractProductTaxCandidates({
      product_tax_assignments: [
        {
          is_inclusive: null,
          tax_categories: {
            tax_type: 'inc',
            is_inclusive: false,
            tax_rates: [{ id: 900, name: 'INC', rate: 0.08 }],
          },
        },
      ],
    });
    expect(candidates).toEqual([
      { tax_rate_id: 900, tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', is_inclusive: false },
    ]);
  });

  it('no lanza ante formas parciales o ausentes', () => {
    expect(extractProductTaxCandidates(undefined)).toEqual([]);
    expect(extractProductTaxCandidates({})).toEqual([]);
    expect(extractProductTaxCandidates({ product_tax_assignments: [{}] })).toEqual([]);
  });
});

describe('buildSiblingTaxCandidates', () => {
  it('deduplica filas repetidas de varias líneas', () => {
    const candidates = buildSiblingTaxCandidates([
      { order_item_taxes: [{ tax_rate_id: 68, tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', is_inclusive: true }] },
      { order_item_taxes: [{ tax_rate_id: 68, tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', is_inclusive: true }] },
      { order_item_taxes: [] },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      tax_rate_id: 68,
      tax_name: 'INC',
      tax_rate: 0.08,
      tax_type: 'inc',
      is_inclusive: true,
    });
  });
});
