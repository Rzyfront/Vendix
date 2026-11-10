/**
 * The printed fiscal document (POS electronic invoice, fiscal invoice, credit
 * notes) must name the same acquirer the DIAN received.
 *
 * A NIT customer stores its business name ONLY in `users.legal_name`
 * (`JuridicaNameRule` forbids `first_name`/`last_name` alongside it), so
 * composing first + last printed "Consumidor Final" for a company invoice.
 * The invoice acquirer snapshot (`customer_name`, `customer_tax_id`, ...) is
 * what the XML and the legal PDF use, so the print reads it first.
 */
import { mapFiscalDocumentToPrintData } from '../fiscal-document-print.mapper';

jest.mock('../../services/fiscal-issuer-identity', () => ({
  resolveFiscalIssuerForPrint: () => ({
    legal_name: 'Emisor S.A.S.',
    nit_display: '901.555.333-2',
    phone: '+57 601 000 0000',
    email: 'emisor@test.co',
    fiscal_address: 'Calle 1 # 1-01',
    city: 'Bogotá D.C.',
    fiscal_qualities: 'Gran contribuyente',
    tax_responsibilities: [],
  }),
}));

const BASE_INVOICE: any = {
  id: 1,
  store: { name: 'T', addresses: [] },
  organization: { tax_id: '901.555.333-2', legal_name: 'Emisor S.A.S.' },
  resolution: {},
  invoice_items: [],
  invoice_taxes: [],
};

describe('mapFiscalDocumentToPrintData acquirer identity', () => {
  it('prints the company from the invoice snapshot, not Consumidor Final', () => {
    const out = mapFiscalDocumentToPrintData({
      ...BASE_INVOICE,
      customer_name: 'Distribuciones El Cedro S.A.S.',
      customer_tax_id: '900123456',
      customer_email: 'compras@elcedro.co',
      customer_phone: '+57 300 111 2233',
      customer: {
        first_name: null,
        last_name: null,
        legal_name: 'Distribuciones El Cedro S.A.S.',
        document_number: '900123456',
        addresses: [],
      },
    });
    expect(out.customer?.name).toBe('Distribuciones El Cedro S.A.S.');
    expect(out.customer?.tax_id).toBe('900123456');
    expect(out.customer?.email).toBe('compras@elcedro.co');
    expect(out.customer?.phone).toBe('+57 300 111 2233');
  });

  it('without snapshot, a NIT customer prints its legal_name', () => {
    const out = mapFiscalDocumentToPrintData({
      ...BASE_INVOICE,
      customer: {
        first_name: null,
        last_name: null,
        legal_name: 'Distribuciones El Cedro S.A.S.',
        document_number: '900123456',
        addresses: [],
      },
    });
    expect(out.customer?.name).toBe('Distribuciones El Cedro S.A.S.');
    expect(out.customer?.tax_id).toBe('900123456');
  });

  it('keeps a natural-person customer as before', () => {
    const out = mapFiscalDocumentToPrintData({
      ...BASE_INVOICE,
      customer: {
        first_name: 'Ana',
        last_name: 'Ruiz',
        document_number: '123',
        addresses: [],
      },
    });
    expect(out.customer?.name).toBe('Ana Ruiz');
    expect(out.customer?.tax_id).toBe('123');
  });

  it('keeps Consumidor Final when there is no acquirer', () => {
    const out = mapFiscalDocumentToPrintData({ ...BASE_INVOICE, customer: null });
    expect(out.customer?.name).toBe('Consumidor Final');
    expect(out.customer?.tax_id).toBe('222222222222');
  });
});
