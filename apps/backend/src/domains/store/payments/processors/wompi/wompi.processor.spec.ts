import { WompiProcessor } from './wompi.processor';
import { WompiClient } from './wompi.client';
import { PaymentData } from '../../interfaces';
import {
  WompiEnvironment,
  WompiTransactionStatus,
} from './wompi.types';

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
      presigned_acceptance: { acceptance_token: 'accept-tok', permalink: '', type: 'END_USER' },
      presigned_personal_data_auth: { acceptance_token: 'personal-tok', permalink: '', type: 'PERSONAL_DATA_AUTH' },
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

  const buildPaymentData = (overrides: Partial<PaymentData> = {}): PaymentData => ({
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
    client = new WompiClient();
    processor = new WompiProcessor(client);

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
    const txCall = fetchMock.mock.calls.find(([url]) =>
      typeof url === 'string' && url.endsWith('/transactions'),
    );
    expect(txCall).toBeDefined();

    const [, fetchOptions] = txCall!;
    expect(fetchOptions.method).toBe('POST');
    expect(fetchOptions.headers['Idempotency-Key']).toBe('abc-123');
  });

  it('generates a UUID fallback when idempotencyKey is empty (back-compat)', async () => {
    const paymentData = buildPaymentData({ idempotencyKey: '' });

    await processor.processPayment(paymentData);

    const txCall = fetchMock.mock.calls.find(([url]) =>
      typeof url === 'string' && url.endsWith('/transactions'),
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

    const txCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.endsWith('/transactions'),
    );
    expect(txCalls.length).toBe(2);

    expect(txCalls[0][1].headers['Idempotency-Key']).toBe('replay-key-001');
    expect(txCalls[1][1].headers['Idempotency-Key']).toBe('replay-key-001');
  });
});
