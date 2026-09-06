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
    const snapshot = buildContractSnapshot(quotation, null);

    expect(snapshot.profile).toBeNull();
    expect(snapshot.quotation.quotation_number).toBe('QT-20260906-0003');
    expect(snapshot.quotation.grand_total).toBe('114000.00');
    expect(snapshot.quotation.items).toHaveLength(1);
    expect(snapshot.quotation.items[0].product_name).toBe('Cemento x50kg');
    expect(snapshot.quotation.items[0].total_price).toBe('100000.00');
    expect(typeof snapshot.frozen_at).toBe('string');
  });

  it('congela la version vigente del perfil (A/I/U)', () => {
    const profile = {
      id: 3,
      current_version: 2,
      current_config: {
        admin_percent: 10,
        contingency_percent: 5,
        profit_percent: 8,
      },
    };

    const snapshot = buildContractSnapshot(quotation, profile);

    expect(snapshot.profile).toEqual({
      profile_id: 3,
      version: 2,
      config: {
        admin_percent: 10,
        contingency_percent: 5,
        profit_percent: 8,
      },
    });
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
