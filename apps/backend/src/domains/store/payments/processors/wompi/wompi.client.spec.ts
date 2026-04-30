import { WompiClient, WompiInvalidAcceptanceTokenError } from './wompi.client';
import {
  WompiConfig,
  WompiCreatePaymentSourceRequest,
  WompiEnvironment,
} from './wompi.types';

/**
 * WompiClient — payment_sources API tests.
 *
 * Covers the two new methods added in Phase 2 of the COF (Card-On-File)
 * migration: createPaymentSource and getPaymentSource.
 *
 * The same global fetch mock pattern used in wompi.processor.spec.ts is used
 * here for consistency.
 */
describe('WompiClient — payment_sources', () => {
  let client: WompiClient;
  let fetchMock: jest.Mock;

  const baseConfig: WompiConfig = {
    public_key: 'pub_test_xxx',
    private_key: 'prv_test_xxx',
    events_secret: 'evt_test',
    integrity_secret: 'int_test',
    environment: WompiEnvironment.SANDBOX,
  };

  const sandboxBase = 'https://sandbox.wompi.co/v1';

  const validRequest: WompiCreatePaymentSourceRequest = {
    type: 'CARD',
    token: 'tok_test_card_123',
    customer_email: 'rafa@vendix.app',
    acceptance_token: 'eyJhbGciOiJIUzI1NiJ9.acceptance.signature',
    accept_personal_auth: 'eyJhbGciOiJIUzI1NiJ9.personal.signature',
  };

  const successResponse = {
    data: {
      id: 778899,
      public_data: {
        type: 'CARD' as const,
        extra: {
          bin: '424242',
          name: 'VISA-4242',
          brand: 'VISA',
          exp_year: '29',
          exp_month: '12',
          last_four: '4242',
          card_holder: 'RAFAEL MARTINEZ',
          is_three_ds: false,
          three_ds_auth_type: null,
          external_identifier: null,
        },
      },
      status: 'AVAILABLE' as const,
      customer_email: 'rafa@vendix.app',
      token: 'tok_test_card_123',
      type: 'CARD' as const,
    },
  };

  beforeEach(() => {
    client = new WompiClient(baseConfig);
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete (global as any).fetch;
    jest.restoreAllMocks();
  });

  // ── createPaymentSource ──────────────────────

  describe('createPaymentSource', () => {
    it('happy path — POSTs /v1/payment_sources with X-Wompi-Idempotency-Key and returns AVAILABLE source', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => successResponse,
      } as any);

      const result = await client.createPaymentSource(
        validRequest,
        'idem-ps-001',
      );

      expect(result).toEqual(successResponse);
      expect(result.data.id).toBe(778899);
      expect(result.data.status).toBe('AVAILABLE');
      expect(result.data.public_data.type).toBe('CARD');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = fetchMock.mock.calls[0];

      expect(calledUrl).toBe(`${sandboxBase}/payment_sources`);
      expect(calledOptions.method).toBe('POST');

      const headers = calledOptions.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe(`Bearer ${baseConfig.private_key}`);
      // Wompi convention: X-Wompi-Idempotency-Key (NOT plain Idempotency-Key
      // which the /transactions endpoint uses).
      expect(headers['X-Wompi-Idempotency-Key']).toBe('idem-ps-001');
      expect(headers['Idempotency-Key']).toBeUndefined();

      const sentBody = JSON.parse(calledOptions.body as string);
      expect(sentBody).toEqual(validRequest);
    });

    it('propagates the acceptance_token bit-exact (no re-fetch, no mutation)', async () => {
      const exactAcceptance =
        'eyJhbGciOiJIUzI1NiJ9.LEGAL_TRAIL.exact-token-from-widget';
      const exactPersonal =
        'eyJhbGciOiJIUzI1NiJ9.LEGAL_TRAIL.personal-from-widget';

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => successResponse,
      } as any);

      await client.createPaymentSource(
        {
          ...validRequest,
          acceptance_token: exactAcceptance,
          accept_personal_auth: exactPersonal,
        },
        'idem-ps-002',
      );

      const [, calledOptions] = fetchMock.mock.calls[0];
      const sentBody = JSON.parse(calledOptions.body as string);

      // Bit-exact assertion — the client must NOT call /merchants nor mutate
      // these tokens. The user already legally accepted them in the widget.
      expect(sentBody.acceptance_token).toBe(exactAcceptance);
      expect(sentBody.accept_personal_auth).toBe(exactPersonal);

      // Single network call — no /merchants pre-fetch
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(`${sandboxBase}/payment_sources`);
    });

    it('throws WompiInvalidAcceptanceTokenError on 401 INVALID_ACCEPTANCE_TOKEN', async () => {
      const errorBody = {
        error: {
          type: 'INPUT_VALIDATION_ERROR',
          reason: 'INVALID_ACCEPTANCE_TOKEN',
          message:
            'The acceptance_token does not correspond to the merchant private key',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => errorBody,
      } as any);

      await expect(
        client.createPaymentSource(validRequest, 'idem-ps-003'),
      ).rejects.toBeInstanceOf(WompiInvalidAcceptanceTokenError);

      // Re-run to inspect the error instance properties
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => errorBody,
      } as any);

      try {
        await client.createPaymentSource(validRequest, 'idem-ps-003-bis');
        fail('Expected WompiInvalidAcceptanceTokenError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(WompiInvalidAcceptanceTokenError);
        const typed = err as WompiInvalidAcceptanceTokenError;
        expect(typed.code).toBe('WOMPI_INVALID_ACCEPTANCE_TOKEN');
        expect(typed.statusCode).toBe(401);
        expect(typed.responseBody).toEqual(errorBody);
      }
    });
  });

  // ── getPaymentSource ────────────────────────

  describe('getPaymentSource', () => {
    it('happy path — GET /v1/payment_sources/:id with bearer auth, returns AVAILABLE source', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => successResponse,
      } as any);

      const result = await client.getPaymentSource(778899);

      expect(result).toEqual(successResponse);
      expect(result.data.status).toBe('AVAILABLE');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = fetchMock.mock.calls[0];

      expect(calledUrl).toBe(`${sandboxBase}/payment_sources/778899`);
      expect(calledOptions.method).toBe('GET');
      expect(calledOptions.headers['Authorization']).toBe(
        `Bearer ${baseConfig.private_key}`,
      );
      // No body on GET
      expect(calledOptions.body).toBeUndefined();
    });

    it('propagates 404 as a thrown error', async () => {
      const errorBody = {
        error: {
          type: 'NOT_FOUND_ERROR',
          reason: 'NOT_FOUND',
          message: 'The requested payment_source does not exist',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => errorBody,
      } as any);

      await expect(client.getPaymentSource(999999)).rejects.toThrow(
        /payment_source does not exist/i,
      );
    });
  });
});
