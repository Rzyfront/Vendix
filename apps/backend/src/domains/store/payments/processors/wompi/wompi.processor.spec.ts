import { WompiProcessor } from './wompi.processor';
import { WompiClient, WompiInvalidAcceptanceTokenError } from './wompi.client';
import { WompiClientFactory } from './wompi.factory';
import { PaymentData } from '../../interfaces';
import { WompiEnvironment, WompiTransactionStatus } from './wompi.types';
import { VendixHttpException } from '../../../../../common/errors';

/**
 * Wompi Idempotency-Key tests.
 *
 * These tests pin the contract that `WompiProcessor.processPayment` always maps
 * `paymentData.idempotencyKey` to the HTTP `Idempotency-Key` header on the
 * `POST /transactions` call (or generates a UUID v4 fallback if the caller did
 * not pass one — back-compat for legacy eCommerce DTOs).
 */
describe('WompiProcessor — idempotency key', () => {
  let processor: WompiProcessor;
  let client: WompiClient;
  let factory: WompiClientFactory;
  let fetchMock: jest.Mock;

  const baseConfig = {
    public_key: 'pub_test_xxx',
    private_key: 'prv_test_xxx',
    events_secret: 'evt_test',
    integrity_secret: 'int_test',
    environment: WompiEnvironment.SANDBOX,
  };

  const acceptanceTokenResponse = {
    data: {
      id: 1,
      name: 'Vendix Test',
      presigned_acceptance: {
        acceptance_token: 'accept-tok',
        permalink: '',
        type: 'END_USER',
      },
      presigned_personal_data_auth: {
        acceptance_token: 'personal-tok',
        permalink: '',
        type: 'PERSONAL_DATA_AUTH',
      },
    },
  };

  const transactionResponse = {
    data: {
      id: 'wompi-txn-1',
      created_at: new Date().toISOString(),
      amount_in_cents: 100000,
      reference: 'vendix_1_1_0',
      currency: 'COP',
      payment_method_type: 'CARD',
      payment_method: {},
      status: WompiTransactionStatus.APPROVED,
      status_message: 'OK',
    },
  };

  const buildPaymentData = (
    overrides: Partial<PaymentData> = {},
  ): PaymentData => ({
    orderId: 1,
    customerId: 10,
    amount: 1000,
    currency: 'COP',
    storePaymentMethodId: 1,
    storeId: 1,
    idempotencyKey: 'idem-key-abc-123',
    metadata: {
      paymentMethod: { type: 'CARD', token: 'tok_xyz', installments: 1 },
      wompiConfig: baseConfig,
      customerEmail: 'rafa@vendix.app',
    },
    ...overrides,
  });

  beforeEach(() => {
    client = new WompiClient(baseConfig);
    factory = {
      getClient: jest.fn().mockReturnValue(client),
    } as unknown as WompiClientFactory;

    processor = new WompiProcessor(factory, {} as any, {} as any);

    fetchMock = jest.fn(async (url: string) => {
      // First call: GET /merchants/:public_key (acceptance tokens)
      if (typeof url === 'string' && url.includes('/merchants/')) {
        return {
          ok: true,
          status: 200,
          json: async () => acceptanceTokenResponse,
        } as any;
      }

      // Second call: POST /transactions
      return {
        ok: true,
        status: 201,
        json: async () => transactionResponse,
      } as any;
    });

    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete (global as any).fetch;
    jest.restoreAllMocks();
  });

  it('forwards idempotencyKey from PaymentData as Idempotency-Key header on createTransaction', async () => {
    const paymentData = buildPaymentData({ idempotencyKey: 'abc-123' });

    const result = await processor.processPayment(paymentData);

    expect(result.success).toBe(true);

    // Find the POST /transactions call
    const txCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.endsWith('/transactions'),
    );
    expect(txCall).toBeDefined();

    const [, fetchOptions] = txCall!;
    expect(fetchOptions.method).toBe('POST');
    expect(fetchOptions.headers['Idempotency-Key']).toBe('abc-123');
  });

  it('generates a UUID fallback when idempotencyKey is empty (back-compat)', async () => {
    const paymentData = buildPaymentData({ idempotencyKey: '' });

    await processor.processPayment(paymentData);

    const txCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.endsWith('/transactions'),
    );
    expect(txCall).toBeDefined();

    const [, fetchOptions] = txCall!;
    const headerValue = fetchOptions.headers['Idempotency-Key'];

    // UUID v4: 8-4-4-4-12 hex characters
    expect(headerValue).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('reuses the same Idempotency-Key on a replayed call when caller provides a stable key', async () => {
    const paymentData = buildPaymentData({ idempotencyKey: 'replay-key-001' });

    // Same provider response for both — simulating Wompi's idempotent behavior
    await processor.processPayment(paymentData);
    await processor.processPayment(paymentData);

    const txCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.endsWith('/transactions'),
    );
    expect(txCalls.length).toBe(2);

    expect(txCalls[0][1].headers['Idempotency-Key']).toBe('replay-key-001');
    expect(txCalls[1][1].headers['Idempotency-Key']).toBe('replay-key-001');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Card-On-File / Recurrent (MIT) — payment_sources tokenize flow
// ────────────────────────────────────────────────────────────────────────────
describe('WompiProcessor — createPaymentSourceFromCardToken', () => {
  let processor: WompiProcessor;
  let client: WompiClient;
  let factory: WompiClientFactory;

  const baseConfig = {
    public_key: 'pub_test_xxx',
    private_key: 'prv_test_xxx',
    events_secret: 'evt_test',
    integrity_secret: 'int_test',
    environment: WompiEnvironment.SANDBOX,
  };

  const baseInput = {
    storeId: 7,
    cardTokenFromWidget: 'tok_widget_abc',
    acceptanceToken: 'accept-tok-bit-exact',
    personalAuthToken: 'personal-tok-bit-exact',
    customerEmail: 'rafa@vendix.app',
    wompiConfig: baseConfig,
    idempotencyKey: 'pm:tokenize:7:hash',
  };

  beforeEach(() => {
    client = new WompiClient(baseConfig);
    factory = {
      getClient: jest.fn().mockReturnValue(client),
    } as unknown as WompiClientFactory;
    processor = new WompiProcessor(factory, {} as any, {} as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('happy path: returns paymentSourceId, acceptanceTokenUsed, publicData', async () => {
    const publicData = {
      type: 'CARD' as const,
      extra: {
        bin: '424242',
        last_four: '4242',
        brand: 'VISA',
        exp_month: '12',
        exp_year: '30',
      },
    };
    jest.spyOn(client, 'createPaymentSource').mockResolvedValue({
      data: {
        id: 12345,
        public_data: publicData,
        status: 'AVAILABLE',
        customer_email: 'rafa@vendix.app',
        token: 'tok_widget_abc',
        type: 'CARD',
      },
    } as any);

    const result = await processor.createPaymentSourceFromCardToken(baseInput);

    expect(result.paymentSourceId).toBe('12345');
    expect(result.acceptanceTokenUsed).toBe('accept-tok-bit-exact');
    expect(result.publicData).toEqual(publicData);
  });

  it('forwards acceptance_token / personal_auth bit-exact (no re-fetch, no mutation)', async () => {
    const spy = jest.spyOn(client, 'createPaymentSource').mockResolvedValue({
      data: {
        id: 1,
        public_data: { type: 'CARD', extra: {} },
        status: 'AVAILABLE',
        customer_email: 'rafa@vendix.app',
        token: 'tok_widget_abc',
        type: 'CARD',
      },
    } as any);

    await processor.createPaymentSourceFromCardToken(baseInput);

    expect(spy).toHaveBeenCalledTimes(1);
    const [body, idem] = spy.mock.calls[0];
    expect(body).toEqual({
      type: 'CARD',
      token: 'tok_widget_abc',
      customer_email: 'rafa@vendix.app',
      acceptance_token: 'accept-tok-bit-exact',
      accept_personal_auth: 'personal-tok-bit-exact',
    });
    expect(idem).toBe('pm:tokenize:7:hash');
  });

  it('throws PAYMENT_SOURCE_NOT_AVAILABLE when status !== AVAILABLE', async () => {
    jest.spyOn(client, 'createPaymentSource').mockResolvedValue({
      data: {
        id: 99,
        public_data: { type: 'CARD', extra: {} },
        status: 'ERROR',
        customer_email: 'rafa@vendix.app',
        token: 'tok_widget_abc',
        type: 'CARD',
      },
    } as any);

    await expect(
      processor.createPaymentSourceFromCardToken(baseInput),
    ).rejects.toMatchObject({
      errorCode: 'PAYMENT_SOURCE_NOT_AVAILABLE',
    });
  });

  it('maps WompiInvalidAcceptanceTokenError to PAYMENT_SOURCE_INVALID_ACCEPTANCE_TOKEN', async () => {
    jest
      .spyOn(client, 'createPaymentSource')
      .mockRejectedValue(
        new WompiInvalidAcceptanceTokenError(
          'INVALID_ACCEPTANCE_TOKEN',
          401,
          { error: { reason: 'INVALID_ACCEPTANCE_TOKEN' } },
        ),
      );

    const promise = processor.createPaymentSourceFromCardToken(baseInput);
    await expect(promise).rejects.toBeInstanceOf(VendixHttpException);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'PAYMENT_SOURCE_INVALID_ACCEPTANCE_TOKEN',
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// processPayment — payment_source_id branch (recurrent / MIT)
// ────────────────────────────────────────────────────────────────────────────
describe('WompiProcessor — processPayment with payment_source_id', () => {
  let processor: WompiProcessor;
  let client: WompiClient;
  let factory: WompiClientFactory;
  let fetchMock: jest.Mock;

  const baseConfig = {
    public_key: 'pub_test_xxx',
    private_key: 'prv_test_xxx',
    events_secret: 'evt_test',
    integrity_secret: 'int_test',
    environment: WompiEnvironment.SANDBOX,
  };

  const acceptanceTokenResponse = {
    data: {
      id: 1,
      name: 'Vendix Test',
      presigned_acceptance: {
        acceptance_token: 'fresh-acceptance',
        permalink: '',
        type: 'END_USER',
      },
      presigned_personal_data_auth: {
        acceptance_token: 'fresh-personal',
        permalink: '',
        type: 'PERSONAL_DATA_AUTH',
      },
    },
  };

  const buildPaymentData = (
    overrides: Partial<PaymentData> = {},
  ): PaymentData => ({
    orderId: 1,
    customerId: 10,
    amount: 1500,
    currency: 'COP',
    storePaymentMethodId: 1,
    storeId: 5,
    idempotencyKey: 'sub:invoice:42:retry-0',
    metadata: {
      payment_source_id: 999,
      customerEmail: 'rafa@vendix.app',
      wompiConfig: baseConfig,
    },
    ...overrides,
  });

  beforeEach(() => {
    client = new WompiClient(baseConfig);
    factory = {
      getClient: jest.fn().mockReturnValue(client),
    } as unknown as WompiClientFactory;
    processor = new WompiProcessor(factory, {} as any, {} as any);
  });

  afterEach(() => {
    delete (global as any).fetch;
    jest.restoreAllMocks();
  });

  const installFetch = (
    txnStatus: WompiTransactionStatus,
    statusMessage?: string,
  ) => {
    fetchMock = jest.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/merchants/')) {
        return {
          ok: true,
          status: 200,
          json: async () => acceptanceTokenResponse,
        } as any;
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            id: 'wompi-cof-1',
            created_at: new Date().toISOString(),
            amount_in_cents: 150000,
            reference: 'vendix_5_1_x',
            currency: 'COP',
            payment_method_type: 'CARD',
            payment_method: {},
            status: txnStatus,
            status_message: statusMessage || 'OK',
          },
        }),
      } as any;
    });
    (global as any).fetch = fetchMock;
  };

  it('builds request with payment_source_id + recurrent:true and NO payment_method', async () => {
    installFetch(WompiTransactionStatus.APPROVED);

    const result = await processor.processPayment(buildPaymentData());

    expect(result.success).toBe(true);

    const txCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.endsWith('/transactions'),
    );
    expect(txCall).toBeDefined();
    const [, fetchOptions] = txCall!;
    const body = JSON.parse(fetchOptions.body);

    expect(body.payment_source_id).toBe(999);
    expect(body.recurrent).toBe(true);
    expect(body.payment_method).toBeUndefined();
    expect(body.signature).toEqual(expect.any(String));
  });

  it('throws PAYMENT_SOURCE_NOT_FOUND when payment_source_id is invalid (NaN/0)', async () => {
    installFetch(WompiTransactionStatus.APPROVED);

    await expect(
      processor.processPayment(
        buildPaymentData({
          metadata: {
            payment_source_id: 'not-a-number' as any,
            customerEmail: 'rafa@vendix.app',
            wompiConfig: baseConfig,
          },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: 'PAYMENT_SOURCE_NOT_FOUND' });

    await expect(
      processor.processPayment(
        buildPaymentData({
          metadata: {
            payment_source_id: 0 as any,
            customerEmail: 'rafa@vendix.app',
            wompiConfig: baseConfig,
          },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: 'PAYMENT_SOURCE_NOT_FOUND' });
  });

  it('maps INVALID_PAYMENT_SOURCE response to status=failed + errorCode=PAYMENT_SOURCE_REVOKED', async () => {
    installFetch(WompiTransactionStatus.DECLINED, 'INVALID_PAYMENT_SOURCE');

    const result = await processor.processPayment(buildPaymentData());

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('PAYMENT_SOURCE_REVOKED');
  });
});
