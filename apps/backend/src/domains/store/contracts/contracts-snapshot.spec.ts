import {
  buildContractSnapshot,
  contractNumberPrefix,
  nextContractNumber,
} from './contracts-snapshot';

/**
 * C.1 — forma congelada del contrato (lo que D.1 copiara a la factura AIU).
 * Sin base de datos: la forma del snapshot es contrato fiscal y se fija aca.
 */
describe('contracts-snapshot (C.1)', () => {
  const quotation = {
    id: 7,
    quotation_number: 'QT-20260906-0003',
    destination: 'contract',
    status: 'accepted',
    subtotal_amount: '100000.00',
    discount_amount: '5000.00',
    tax_amount: '19000.00',
    grand_total: '114000.00',
    valid_until: '2026-10-06T00:00:00.000Z',
    notes: 'Obra gris',
    terms_and_conditions: 'Anticipo 30%',
    accepted_at: '2026-09-06T10:00:00.000Z',
    contract_economic_snapshot: null,
    quotation_items: [
      {
        product_id: 11,
        product_variant_id: null,
        product_name: 'Cemento x50kg',
        variant_sku: null,
        quantity: 100,
        unit_price: '1000.00',
        discount_amount: '50.00',
        tax_rate: '0.19000',
        tax_amount_item: '190.00',
        total_price: '100000.00',
        notes: null,
        applied_price_tier_id: null,
        applied_price_tier_name_snapshot: null,
      },
    ],
  };

  it('congela items, totales y trazabilidad sin perfil', () => {
    const snapshot = buildContractSnapshot(quotation);

    expect(snapshot.profile).toBeNull();
    expect(snapshot.economic).toBeNull();
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.quotation.quotation_number).toBe('QT-20260906-0003');
    expect(snapshot.quotation.grand_total).toBe('114000.00');
    expect(snapshot.quotation.items).toHaveLength(1);
    expect(snapshot.quotation.items[0].product_name).toBe('Cemento x50kg');
    expect(snapshot.quotation.items[0].total_price).toBe('100000.00');
    expect(typeof snapshot.frozen_at).toBe('string');
  });

  it('hereda economía exacta y perfil de términos desde el snapshot de cotización', () => {
    const economic = {
      schema_version: 1,
      frozen_at: '2026-09-06T09:00:00.000Z',
      invoice_profile: {
        profile_id: 81,
        version: 4,
        name: 'AIU cliente',
        config: { aiu: { regime: 'et_462_1' } },
      },
      quotation_profile: {
        profile_id: 3,
        version: 2,
        config: { admin_percent: 10, payment_terms: 'Anticipo 30%' },
      },
      contract_object: 'Construcción y adecuación del local comercial',
      aiu_value: '23000.00',
      direct_cost: '100000.00',
      contract_value: '123000.00',
      invoice_lines: [{ description: 'Costo directo', unit_price: '100000.00' }],
      calculation: { total: '123000.00' },
    };
    const snapshot = buildContractSnapshot({
      ...quotation,
      contract_economic_snapshot: economic,
    });

    expect(snapshot.economic).toBe(economic);
    expect(snapshot.profile).toEqual({
      profile_id: 3,
      version: 2,
      config: { admin_percent: 10, payment_terms: 'Anticipo 30%' },
    });
  });

  it('no recompone snapshots históricos ausentes desde el profile_id vivo', () => {
    const snapshot = buildContractSnapshot({
      ...quotation,
      profile_id: 3,
      contract_economic_snapshot: null,
    });

    expect(snapshot.profile).toBeNull();
    expect(snapshot.economic).toBeNull();
  });

  it('numera CT-YYYYMMDD-0001 sin anterior y secuencia despues', () => {
    const prefix = contractNumberPrefix(new Date(2026, 8, 6));

    expect(prefix).toBe('CT-20260906-');
    expect(nextContractNumber(null, prefix)).toBe('CT-20260906-0001');
    expect(nextContractNumber('CT-20260906-0001', prefix)).toBe(
      'CT-20260906-0002',
    );
    // Otra serie diaria no contamina la secuencia.
    expect(nextContractNumber('CT-20260905-0041', prefix)).toBe(
      'CT-20260906-0001',
    );
  });
});
