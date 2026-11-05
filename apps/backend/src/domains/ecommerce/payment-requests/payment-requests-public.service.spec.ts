import { PaymentRequestsPublicService } from './payment-requests-public.service';
import { hashPaymentRequestToken } from '../../store/payment-requests/payment-requests.service';
import { RequestContextService } from '@common/context/request-context.service';

const future = () => new Date(Date.now() + 3600_000);
const past = () => new Date(Date.now() - 3600_000);

const baseRow = (over: Record<string, unknown> = {}) => ({
  id: 5,
  store_id: 7,
  public_token_hash: 'hash',
  purpose: 'service_deposit',
  amount: { toString: () => '400000.00' },
  currency: 'COP',
  description: 'Anticipo Cava 3',
  status: 'pending',
  expires_at: future(),
  payment_link_id: null,
  transfer_receipt_s3_key: null,
  rejection_reason: null,
  paid_at: null,
  ...over,
});

const file = (over: Partial<Express.Multer.File> = {}) =>
  ({
    mimetype: 'image/png',
    size: 1000,
    originalname: 'comprobante 1.png',
    buffer: Buffer.from('x'),
    ...over,
  }) as Express.Multer.File;

describe('PaymentRequestsPublicService', () => {
  let service: PaymentRequestsPublicService;
  let prisma: any;
  let paymentLinks: any;
  let s3: any;
  let paths: any;
  let events: any;

  beforeEach(() => {
    prisma = {
      payment_requests: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment_links: { findFirst: jest.fn() },
      store_payment_methods: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      stores: { findUnique: jest.fn().mockResolvedValue({ id: 7, slug: 'tienda', organization_id: 2 }) },
      organizations: { findUnique: jest.fn().mockResolvedValue({ id: 2, slug: 'org' }) },
    };
    paymentLinks = {
      create: jest.fn().mockResolvedValue({ data: { id: 11, checkout_url: 'https://checkout.wompi.co/l/abc' } }),
      deactivate: jest.fn(),
    };
    s3 = { uploadFile: jest.fn().mockResolvedValue(undefined) };
    paths = { buildReceiptPath: jest.fn().mockReturnValue('organizations/org-2/stores/tienda-7/receipts') };
    events = { emit: jest.fn() };
    service = new PaymentRequestsPublicService(prisma, paymentLinks, s3, paths, events);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(7);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('get', () => {
    it('answers PAYMENT_REQUEST_NOT_FOUND for an unknown token, looking it up by hash', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(null);

      await expect(service.get('nope')).rejects.toMatchObject({
        errorCode: 'PAYMENT_REQUEST_NOT_FOUND',
      });
      expect(prisma.payment_requests.findFirst.mock.calls[0][0].where).toEqual({
        public_token_hash: hashPaymentRequestToken('nope'),
      });
    });

    it('reports expired when pending and past expires_at', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow({ expires_at: past() }));
      const out = await service.get('t');
      expect(out.status).toBe('expired');
      expect(out.methods).toEqual([]);
    });

    it('does not expire a request awaiting confirmation (A9)', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(
        baseRow({ status: 'awaiting_confirmation', expires_at: past() }),
      );
      const out = await service.get('t');
      expect(out.status).toBe('awaiting_confirmation');
    });

    it('exposes only what the page needs: no ids, hash or S3 key', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(
        baseRow({ transfer_receipt_s3_key: 'organizations/x/receipt.png' }),
      );
      prisma.store_payment_methods.findMany.mockResolvedValue([
        {
          id: 3,
          display_name: 'Bancolombia',
          min_amount: null,
          max_amount: null,
          custom_config: { bank_name: 'Bancolombia', account_number: '1', api_secret: 's' },
          system_payment_method: { display_name: 'Transferencia', type: 'bank_transfer', provider: 'manual', processing_mode: 'DIRECT', logo_url: null },
        },
        {
          id: 4,
          display_name: null,
          min_amount: null,
          max_amount: null,
          custom_config: { private_key: 'k' },
          system_payment_method: { display_name: 'Wompi', type: 'wompi', provider: 'wompi', processing_mode: 'ONLINE', logo_url: null },
        },
      ]);

      const out = await service.get('t');
      const json = JSON.stringify(out);

      expect(out.amount).toBe(400000);
      expect(out.methods).toEqual([
        expect.objectContaining({ id: 3, kind: 'transfer', payment_instructions: { bank_name: 'Bancolombia', account_number: '1' } }),
        expect.objectContaining({ kind: 'wompi' }),
      ]);
      expect(json).not.toContain('store_id');
      expect(json).not.toContain('public_token_hash');
      expect(json).not.toContain('receipt.png');
      expect(json).not.toContain('api_secret');
      expect(json).not.toContain('private_key');
      expect(out.has_receipt).toBe(true);
    });
  });

  describe('transfer', () => {
    it('rejects a missing file', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow());
      await expect(service.submitTransfer('t', undefined, {})).rejects.toMatchObject({
        errorCode: 'PAYMENT_REQUEST_RECEIPT_REQUIRED',
      });
    });

    it('rejects a file type that is not image or PDF', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow());
      await expect(
        service.submitTransfer('t', file({ mimetype: 'application/zip' }), {}),
      ).rejects.toMatchObject({ errorCode: 'PAYMENT_REQUEST_RECEIPT_TYPE' });
      expect(s3.uploadFile).not.toHaveBeenCalled();
    });

    it('rejects a file over 5 MB', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow());
      await expect(
        service.submitTransfer('t', file({ size: 5 * 1024 * 1024 + 1 }), {}),
      ).rejects.toMatchObject({ errorCode: 'PAYMENT_REQUEST_RECEIPT_SIZE' });
      expect(s3.uploadFile).not.toHaveBeenCalled();
    });

    it.each([
      ['expired', { expires_at: past() }, 'PAYMENT_REQUEST_EXPIRED'],
      ['cancelled', { status: 'cancelled' }, 'PAYMENT_REQUEST_CANCELLED'],
      ['paid', { status: 'paid' }, 'PAYMENT_REQUEST_ALREADY_PAID'],
      ['awaiting', { status: 'awaiting_confirmation' }, 'PAYMENT_REQUEST_AWAITING_CONFIRMATION'],
    ])('refuses a %s request before uploading', async (_n, over, code) => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow(over));
      await expect(service.submitTransfer('t', file(), {})).rejects.toMatchObject({ errorCode: code });
      expect(s3.uploadFile).not.toHaveBeenCalled();
    });

    it('stores the S3 key (not a URL) and moves the request to awaiting_confirmation', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow());

      const out = await service.submitTransfer('t', file(), { reference: ' ABC123 ' });

      const key = s3.uploadFile.mock.calls[0][1] as string;
      expect(key).toMatch(/^organizations\/org-2\/stores\/tienda-7\/receipts\/payment-requests\/\d{4}\/\d{2}\/[0-9a-f-]{36}-comprobante_1\.png$/);
      const call = prisma.payment_requests.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 5, status: 'pending' });
      expect(call.data).toMatchObject({
        status: 'awaiting_confirmation',
        transfer_receipt_s3_key: key,
        transfer_reference: 'ABC123',
        rejection_reason: null,
      });
      expect(out.status).toBe('awaiting_confirmation');
    });

    it('tells the store admin that a receipt is waiting for confirmation', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow());

      await service.submitTransfer('t', file(), {});

      expect(events.emit).toHaveBeenCalledWith('payment_request.receipt_submitted', {
        store_id: 7,
        payment_request_id: 5,
        amount: 400000,
        purpose: 'service_deposit',
        description: 'Anticipo Cava 3',
      });
    });

    it('refuses a transfer method that is not a bank transfer of the store', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow());
      prisma.store_payment_methods.findFirst.mockResolvedValue(null);
      await expect(
        service.submitTransfer('t', file(), { method_id: 99 }),
      ).rejects.toMatchObject({ errorCode: 'PAYMENT_REQUEST_METHOD_INVALID' });
    });

    it('answers awaiting confirmation when a concurrent submit won the claim', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow());
      prisma.payment_requests.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.submitTransfer('t', file(), {})).rejects.toMatchObject({
        errorCode: 'PAYMENT_REQUEST_AWAITING_CONFIRMATION',
      });
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('wompi', () => {
    it('creates the link lazily, stores payment_link_id and returns checkout_url', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow());

      const out = await service.startWompi('t', {});

      const dto = paymentLinks.create.mock.calls[0][0];
      expect(dto).toMatchObject({ single_use: true, collect_shipping: false, amount_in_cents: 40000000, currency: 'COP' });
      expect(prisma.payment_requests.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 5, payment_link_id: null },
        data: { payment_link_id: 11 },
      });
      expect(out).toEqual({ checkout_url: 'https://checkout.wompi.co/l/abc' });
    });

    it('reuses an active link', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow({ payment_link_id: 11 }));
      prisma.payment_links.findFirst.mockResolvedValue({ id: 11, status: 'active', checkout_url: 'https://checkout.wompi.co/l/old', expires_at: null });

      const out = await service.startWompi('t', {});

      expect(paymentLinks.create).not.toHaveBeenCalled();
      expect(out.checkout_url).toBe('https://checkout.wompi.co/l/old');
    });

    it('refuses cancelled, paid and awaiting requests', async () => {
      for (const [status, code] of [
        ['cancelled', 'PAYMENT_REQUEST_CANCELLED'],
        ['paid', 'PAYMENT_REQUEST_ALREADY_PAID'],
        ['awaiting_confirmation', 'PAYMENT_REQUEST_AWAITING_CONFIRMATION'],
      ]) {
        prisma.payment_requests.findFirst.mockResolvedValue(baseRow({ status }));
        await expect(service.startWompi('t', {})).rejects.toMatchObject({ errorCode: code });
      }
      expect(paymentLinks.create).not.toHaveBeenCalled();
    });

    it('keeps a return_url on a store domain and drops one on a foreign host', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow());
      prisma.domain_settings = {
        findMany: jest.fn().mockResolvedValue([{ hostname: 'cavas.vendix.com' }]),
      };

      await service.startWompi('t', { return_url: 'https://cavas.vendix.com/pagar/t' });
      expect(paymentLinks.create.mock.calls[0][0].redirect_url).toBe('https://cavas.vendix.com/pagar/t');
      expect(prisma.domain_settings.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { store_id: 7 } }),
      );

      await service.startWompi('t', { return_url: 'https://evil.example.com/pagar/t' });
      expect(paymentLinks.create.mock.calls[1][0]).not.toHaveProperty('redirect_url');
    });

    it('answers a clear error when Wompi cannot create the link', async () => {
      prisma.payment_requests.findFirst.mockResolvedValue(baseRow());
      paymentLinks.create.mockRejectedValue(new Error('Wompi no está configurado'));
      await expect(service.startWompi('t', {})).rejects.toMatchObject({
        errorCode: 'PAYMENT_REQUEST_WOMPI_UNAVAILABLE',
      });
    });
  });
});
