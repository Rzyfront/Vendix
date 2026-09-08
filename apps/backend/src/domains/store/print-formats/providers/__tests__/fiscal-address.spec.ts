/**
 * CP-print-token-flow A.2 — el adquirente con dirección la conserva en el
 * modelo; sin direcciones NO se emite ninguna clave de ubicación.
 *
 * La representación gráfica de una factura electrónica, nota crédito o
 * documento equivalente POS no puede afirmar un domicilio del adquirente que
 * nadie capturó: el XML omite la dirección cuando no la hay, y rellenarla en
 * el papel haría que los dos documentos del mismo hecho se contradigan. Es la
 * regla que el repositorio ya escribió del lado XML — `dian-geography.ts`
 * («NUNCA rellenar Bogotá en silencio») y `ubl-common.builder.ts` («produce
 * uno ACEPTADO que afirma que la operación ocurrió en Bogotá … se anula con
 * nota crédito y se reemite, gastando dos consecutivos autorizados»).
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

  it('sin direcciones NO emite dirección, ciudad ni país', () => {
    const out = mapFiscalDocumentToPrintData({
      ...BASE_INVOICE,
      customer: { ...BASE_INVOICE.customer, addresses: [] },
    });
    expect(out.customer?.address).toBeUndefined();
    expect(out.customer?.city).toBeUndefined();
    expect(out.customer?.country).toBeUndefined();
    expect(out.customer?.name).toBe('Ana Ruiz');
  });

  it('sin `addresses` en el payload tampoco se inventa ubicación', () => {
    const out = mapFiscalDocumentToPrintData({ ...BASE_INVOICE });
    expect(out.customer).toBeDefined();
    expect(out.customer?.address).toBeUndefined();
    expect(out.customer?.city).toBeUndefined();
    expect(out.customer?.country).toBeUndefined();
  });

  it('regresión: «Consumidor Final» de POS no recibe domicilio fabricado', () => {
    // Caso frecuente del POS: venta sin cliente identificado. El mapper pone
    // el nombre y el NIT genéricos de la DIAN, pero NO puede afirmar dónde
    // vive un adquirente que no existe. Este test falla si alguien vuelve a
    // meter el relleno «Bogotá D.C., CO» en la ruta fiscal.
    const out = mapFiscalDocumentToPrintData({
      ...BASE_INVOICE,
      customer: { addresses: [] },
    });
    expect(out.customer?.name).toBe('Consumidor Final');
    expect(out.customer?.tax_id).toBe('222222222222');

    const printed = JSON.stringify(out.customer);
    expect(printed).not.toMatch(/Bogot/);
    expect(printed).not.toMatch(/"country"/);
  });
});
