import { Prisma } from '@prisma/client';
import { SubscriptionPaymentService } from './subscription-payment.service';

/**
 * Unit tests for SubscriptionPaymentService.
 * Focus: charge happy path, gateway failure, and partner commission side-effect
 * on handleChargeSuccess.
 */
describe('SubscriptionPaymentService', () => {
  let service: SubscriptionPaymentService;
  let prismaMock: any;
  let gatewayMock: any;
  let billingMock: any;
  let commissionsMock: any;
  let configMock: any;
  let eventEmitterMock: any;

  beforeEach(() => {
    prismaMock = {
      subscription_invoices: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      subscription_payments: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      partner_commissions: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    };

    gatewayMock = {
      processPayment: jest.fn(),
      refundPayment: jest.fn(),
      getPaymentStatus: jest.fn(),
    };
    billingMock = {};
    commissionsMock = {};
    configMock = { get: jest.fn() };
    eventEmitterMock = { emit: jest.fn() };

    service = new SubscriptionPaymentService(
      prismaMock,
      gatewayMock,
      billingMock,
      commissionsMock,
      configMock,
      eventEmitterMock,
    );
  });

  function invoiceFixture(overrides: any = {}) {
    return {
      id: 500,
      store_id: 10,
      invoice_number: 'SAAS-20260423-00001',
      state: 'issued',
      total: new Prisma.Decimal(100),
      currency: 'USD',
      partner_organization_id: null,
      split_breakdown: null,
      store_subscription: {
        store: {
          store_payment_methods: [
            {
              id: 1,
              state: 'enabled',
              system_payment_method: { type: 'credit_card' },
            },
          ],
        },
      },
      ...overrides,
    };
  }

  it('charge happy path → creates subscription_payment state=succeeded', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(invoiceFixture());
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 77 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 77,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    gatewayMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_abc',
      gatewayResponse: { foo: 'bar' },
    });

    const result = await service.charge(500);

    expect(gatewayMock.processPayment).toHaveBeenCalled();
    const updateArg = prismaMock.subscription_payments.update.mock.calls[0][0];
    expect(updateArg.where.id).toBe(77);
    expect(updateArg.data.state).toBe('succeeded');
    expect(updateArg.data.gateway_reference).toBe('tx_abc');
    expect(result.state).toBe('succeeded');
  });

  it('gateway failure → payment state=failed with failure_reason + event emitted', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(invoiceFixture());
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 78 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 78,
      state: 'failed',
    });
    gatewayMock.processPayment.mockResolvedValue({
      success: false,
      message: 'Insufficient funds',
    });

    const result = await service.charge(500);

    const updateArg = prismaMock.subscription_payments.update.mock.calls[0][0];
    expect(updateArg.data.state).toBe('failed');
    expect(updateArg.data.failure_reason).toBe('Insufficient funds');

    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      'subscription.payment.failed',
      { invoiceId: 500, paymentId: 78, reason: 'Insufficient funds' },
    );
    expect(result.state).toBe('failed');
  });

  it('handleChargeSuccess creates partner_commissions (pending_payout) when invoice has partner_organization_id', async () => {
    const invoiceWithPartner = invoiceFixture({
      partner_organization_id: 42,
      split_breakdown: {
        vendix_share: '100.00',
        partner_share: '20.00',
        margin_pct_used: '20.00',
        partner_org_id: 42,
      },
    });
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(invoiceWithPartner);
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 79 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 79,
      state: 'succeeded',
    });
    prismaMock.partner_commissions.findUnique.mockResolvedValue(null); // no existing
    gatewayMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_xyz',
    });

    await service.charge(500);

    const commArg = prismaMock.partner_commissions.create.mock.calls[0][0];
    expect(commArg.data.partner_organization_id).toBe(42);
    expect(commArg.data.invoice_id).toBe(500);
    expect(commArg.data.state).toBe('pending_payout');
  });

  it('transitions existing accrued commission to pending_payout on success', async () => {
    const invoiceWithPartner = invoiceFixture({
      partner_organization_id: 42,
      split_breakdown: {
        vendix_share: '100.00',
        partner_share: '20.00',
        margin_pct_used: '20.00',
        partner_org_id: 42,
      },
    });
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(invoiceWithPartner);
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 80 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 80,
      state: 'succeeded',
    });
    prismaMock.partner_commissions.findUnique.mockResolvedValue({
      id: 1001,
      state: 'accrued',
    });
    gatewayMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_next',
    });

    await service.charge(500);

    const updArg = prismaMock.partner_commissions.update.mock.calls[0][0];
    expect(updArg.where.id).toBe(1001);
    expect(updArg.data.state).toBe('pending_payout');
    expect(prismaMock.partner_commissions.create).not.toHaveBeenCalled();
  });
});
