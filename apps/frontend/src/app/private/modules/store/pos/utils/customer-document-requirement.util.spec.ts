import {
  customerDocumentRequirement,
  customerDocumentHint,
} from './customer-document-requirement.util';

/**
 * cod-auto-invoicing S4 — the POS «Nuevo cliente» form never makes the
 * document mandatory by itself: a customer can be saved with no document and
 * the sale goes out as Consumidor final. The only rule left is the pair: a
 * number needs its type and a type needs its number.
 */
describe('customerDocumentRequirement', () => {
  it('requires nothing when both fields are empty', () => {
    expect(customerDocumentRequirement('', '')).toEqual({
      typeRequired: false,
      numberRequired: false,
    });
    expect(customerDocumentRequirement(null, '   ')).toEqual({
      typeRequired: false,
      numberRequired: false,
    });
  });

  it('asks for the type when only the number was typed', () => {
    expect(customerDocumentRequirement('', '1020304050')).toEqual({
      typeRequired: true,
      numberRequired: false,
    });
  });

  it('asks for the number when only the type was picked', () => {
    expect(customerDocumentRequirement('CC', '')).toEqual({
      typeRequired: false,
      numberRequired: true,
    });
  });
});

describe('customerDocumentHint', () => {
  it('says nothing when automatic invoicing is off', () => {
    expect(customerDocumentHint(false)).toBeNull();
  });

  it('explains the Consumidor final fallback when automatic invoicing is on', () => {
    expect(customerDocumentHint(true)).toBe(
      'Opcional. Sin documento, la factura electrónica saldrá a Consumidor final.',
    );
  });
});
