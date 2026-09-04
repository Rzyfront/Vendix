/**
 * CP-print-token-flow A.2 — el adquirente con dirección la conserva en el
 * modelo; sin direcciones no aparece la clave (invariante 1).
 */
import { mapFiscalDocumentToPrintData } from '../fiscal-document-print.mapper';

// La identidad del emisor tiene su propio gate estricto (422 sin NIT/
// municipio); para este spec de mapeo del adquirente se aisla con mock.
jest.mock('../../services/fiscal-issuer-identity', () => ({
  resolveFiscalIssuerForPrint: () => ({
    legal_name: 'Emisor S.A.S.',
    nit_display: '901.555.333-2',
    phone: '+57 601 000 0000',
    email: 'emisor@test.co',
    fiscal_address: 'Calle 1 # 1-01',
    city: 'Bogotá D.C.',
    tax_regime: 'Régimen Común',
    tax_responsibilities: [],
  }),
}));

const BASE_INVOICE: any = {
  id: 1,
  store: { name: 'T', addresses: [] },
  organization: { tax_id: '901.555.333-2', legal_name: 'Emisor S.A.S.' },
  customer: { first_name: 'Ana', last_name: 'Ruiz', document_number: '123' },
  resolution: {},
  invoice_items: [],
  invoice_taxes: [],
};

describe('mapFiscalDocumentToPrintData customer address', () => {
  it('mapea addresses[0] del adquirente', () => {
    const out = mapFiscalDocumentToPrintData({
      ...BASE_INVOICE,
      customer: {
        ...BASE_INVOICE.customer,
        addresses: [{ address_line1: 'Calle 45 # 12-30', address_line2: null, city: 'Bogotá D.C.', state_province: null, country: null }],
      },
    });
    expect(out.customer?.address).toBe('Calle 45 # 12-30, Bogotá D.C.');
    expect(out.customer?.city).toBe('Bogotá D.C.');
  });

  it('sin direcciones no agrega claves de dirección', () => {
    const out = mapFiscalDocumentToPrintData({
      ...BASE_INVOICE,
      customer: { ...BASE_INVOICE.customer, addresses: [] },
    });
    expect(out.customer).not.toHaveProperty('address');
    expect(out.customer?.name).toBe('Ana Ruiz');
  });
});
