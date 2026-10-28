import { ErrorCodes } from 'src/common/errors';
import {
  buildDeclaredAcquirer,
  evaluateOrderHolder,
} from './order-acquirer-holder.util';

const user = (over: Record<string, unknown> = {}) => ({
  document_type: 'CC',
  document_number: '1020304050',
  legal_name: null,
  first_name: 'Juan',
  last_name: 'Pérez',
  ...over,
});

describe('order-acquirer-holder util', () => {
  describe('buildDeclaredAcquirer', () => {
    it('uses the users row when the order has a customer, never mixing the guest request', () => {
      const r = buildDeclaredAcquirer({
        users: user({ document_number: null }),
        invoice_data_requests: [
          { document_type: 'CC', document_number: '999', first_name: 'A', last_name: 'B' },
        ],
      });
      expect(r.source).toBe('customer');
      expect(r.input.document_number).toBeNull();
      expect(r.input.first_name).toBe('Juan');
    });

    it('falls back to the first guest request without legal_name', () => {
      const r = buildDeclaredAcquirer({
        users: null,
        invoice_data_requests: [
          { document_type: 'NIT', document_number: '900', first_name: 'Ana', last_name: 'Gil' },
        ],
      });
      expect(r.source).toBe('guest_request');
      expect(r.input).toEqual({
        document_type: 'NIT',
        document_number: '900',
        legal_name: null,
        first_name: 'Ana',
        last_name: 'Gil',
      });
    });

    it('returns an empty input and source none without customer or request', () => {
      expect(buildDeclaredAcquirer({ users: null, invoice_data_requests: [] })).toEqual({
        source: 'none',
        input: {},
      });
    });
  });

  describe('evaluateOrderHolder', () => {
    it('complete customer is nominative with no issue', () => {
      const h = evaluateOrderHolder({ users: user(), invoice_data_requests: [] });
      expect(h).toMatchObject({
        source: 'customer',
        rail: 'nominative',
        name: 'Juan Pérez',
        document_type: 'CC',
        document_number: '1020304050',
        issue: null,
      });
    });

    it('no customer is final consumer without issue', () => {
      const h = evaluateOrderHolder({ users: null, invoice_data_requests: [] });
      expect(h).toMatchObject({
        source: 'none',
        rail: 'final_consumer',
        document_number: '222222222222',
        issue: null,
      });
    });

    it('customer missing last name: missing_name naming last_name and the customer', () => {
      const h = evaluateOrderHolder({
        users: user({ last_name: '' }),
        invoice_data_requests: [],
      });
      expect(h.rail).toBe('final_consumer');
      expect(h.issue).toMatchObject({
        code: 'missing_name',
        missing_fields: ['last_name'],
        message:
          'Al cliente Juan le falta el apellido; la factura saldría a Consumidor final. Complétalo en la ficha del cliente (razón social, o nombres y apellidos).',
      });
    });

    it('customer with no names and no legal name lists every name field', () => {
      const h = evaluateOrderHolder({
        users: user({ first_name: null, last_name: null }),
        invoice_data_requests: [],
      });
      expect(h.issue?.code).toBe('missing_name');
      expect(h.issue?.missing_fields).toEqual(['legal_name', 'first_name', 'last_name']);
    });

    it('legal_name alone is enough for the name', () => {
      const h = evaluateOrderHolder({
        users: user({ legal_name: 'ACME SAS', first_name: null, last_name: null, document_type: 'NIT', document_number: '900123456' }),
        invoice_data_requests: [],
      });
      expect(h).toMatchObject({ rail: 'nominative', name: 'ACME SAS', issue: null });
    });

    it('customer missing document number: missing_document_number', () => {
      const h = evaluateOrderHolder({
        users: user({ document_number: ' ' }),
        invoice_data_requests: [],
      });
      expect(h.rail).toBe('final_consumer');
      expect(h.issue).toMatchObject({
        code: 'missing_document_number',
        missing_fields: ['document_number'],
      });
      expect(h.issue?.message).toContain('Juan');
      expect(h.issue?.message).toContain('número de documento');
    });

    it('customer missing both: reports both fields, document number code first', () => {
      const h = evaluateOrderHolder({
        users: user({ document_number: null, first_name: null }),
        invoice_data_requests: [],
      });
      expect(h.issue?.code).toBe('missing_document_number');
      expect(h.issue?.missing_fields).toEqual(['document_number', 'first_name']);
    });

    it('customer with the final-consumer sentinel: final_consumer_sentinel', () => {
      const h = evaluateOrderHolder({
        users: user({ document_number: '222.222.222.222' }),
        invoice_data_requests: [],
      });
      expect(h.rail).toBe('final_consumer');
      expect(h.issue).toMatchObject({
        code: 'final_consumer_sentinel',
        missing_fields: ['document_number'],
      });
    });

    it('juridical signal without document type: document_type_required, nominative, empty type', () => {
      const h = evaluateOrderHolder({
        users: user({
          document_type: null,
          document_number: '900123456',
          legal_name: 'ACME SAS',
          first_name: null,
          last_name: null,
        }),
        invoice_data_requests: [],
      });
      expect(h).toMatchObject({
        rail: 'nominative',
        document_type: '',
        document_number: '900123456',
        name: 'ACME SAS',
      });
      expect(h.issue).toMatchObject({
        code: 'document_type_required',
        missing_fields: ['document_type'],
      });
    });

    it('rethrows unexpected errors from the resolver', () => {
      expect(ErrorCodes.INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED.code).toBeDefined();
      expect(() =>
        evaluateOrderHolder({ users: undefined as any, invoice_data_requests: undefined as any }),
      ).not.toThrow();
    });
  });
});
