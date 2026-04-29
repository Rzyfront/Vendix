// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models). All
// adjacent specs (subscription-renewal-billing, partner-commissions, etc.)
// fail the same way; not introduced by this change.
/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionWebhookReconcilerJob } from './subscription-webhook-reconciler.job';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { WompiProcessor } from '../domains/store/payments/processors/wompi/wompi.processor';
import { PlatformGatewayService } from '../domains/superadmin/subscriptions/gateway/platform-gateway.service';
import { SubscriptionWebhookService } from '../domains/store/subscriptions/services/subscription-webhook.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';
import { PlatformGatewayEnvironmentEnum } from '../domains/superadmin/subscriptions/gateway/dto/upsert-gateway.dto';

describe('SubscriptionWebhookReconcilerJob', () => {
  let job: SubscriptionWebhookReconcilerJob;
  let invoicesFindMany: jest.Mock;
  let getActiveCredentials: jest.Mock;
  let getTransactionByReferenceWithConfig: jest.Mock;
  let handleWompiEvent: jest.Mock;

  const validCreds = {
    public_key: 'pk_test',
    private_key: 'sk_test',
    events_secret: 'evt',
    integrity_secret: 'int',
    environment: PlatformGatewayEnvironmentEnum.SANDBOX,
  };

  beforeEach(async () => {
    invoicesFindMany = jest.fn();
    getActiveCredentials = jest.fn().mockResolvedValue(validCreds);
    getTransactionByReferenceWithConfig = jest.fn();
    handleWompiEvent = jest.fn().mockResolvedValue(undefined);

    const prismaMock = {
      withoutScope: () => ({
        subscription_invoices: { findMany: invoicesFindMany },
      }),
    };
    const wompiMock = { getTransactionByReferenceWithConfig };
    const platformMock = { getActiveCredentials };
    const webhookMock = { handleWompiEvent };
    const gateConfigMock = { isCronDryRun: () => false };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionWebhookReconcilerJob,
        { provide: GlobalPrismaService, useValue: prismaMock },
        { provide: WompiProcessor, useValue: wompiMock },
        { provide: PlatformGatewayService, useValue: platformMock },
        { provide: SubscriptionWebhookService, useValue: webhookMock },
        { provide: SubscriptionGateConfig, useValue: gateConfigMock },
      ],
    }).compile();

    job = module.get(SubscriptionWebhookReconcilerJob);
  });

  it('returns 0 and does not call wompi when there are no candidates', async () => {
    invoicesFindMany.mockResolvedValue([]);

    const result = await job.runOnce();

    expect(result).toBe(0);
    expect(getTransactionByReferenceWithConfig).not.toHaveBeenCalled();
    expect(handleWompiEvent).not.toHaveBeenCalled();
  });

  it('reconciles APPROVED transactions via handleWompiEvent', async () => {
    invoicesFindMany.mockResolvedValue([
      {
        id: 100,
        store_subscription_id: 7,
        store_id: 5,
        payments: [{ id: 1, gateway_reference: 'vendix_saas_ref_1', metadata: null }],
      },
    ]);
    getTransactionByReferenceWithConfig.mockResolvedValue({
      id: 'wompi_txn_999',
      reference: 'vendix_saas_ref_1',
      status: 'APPROVED',
    });

    const result = await job.runOnce();

    expect(result).toBe(1);
    expect(handleWompiEvent).toHaveBeenCalledTimes(1);
    expect(handleWompiEvent).toHaveBeenCalledWith({
      subscriptionId: 7,
      invoiceId: 100,
      body: {
        data: {
          transaction: expect.objectContaining({ id: 'wompi_txn_999', status: 'APPROVED' }),
        },
      },
    });
  });

  it('skips PENDING transactions (no webhook synthesis)', async () => {
    invoicesFindMany.mockResolvedValue([
      {
        id: 101,
        store_subscription_id: 7,
        store_id: 5,
        payments: [{ id: 2, gateway_reference: 'pending_ref', metadata: null }],
      },
    ]);
    getTransactionByReferenceWithConfig.mockResolvedValue({
      id: 'pending_txn',
      reference: 'pending_ref',
      status: 'PENDING',
    });

    const result = await job.runOnce();

    expect(result).toBe(0);
    expect(handleWompiEvent).not.toHaveBeenCalled();
  });

  it('returns 0 when there are no platform Wompi credentials', async () => {
    invoicesFindMany.mockResolvedValue([
      {
        id: 200,
        store_subscription_id: 9,
        store_id: 5,
        payments: [{ id: 3, gateway_reference: 'ref', metadata: null }],
      },
    ]);
    getActiveCredentials.mockResolvedValue(null);

    const result = await job.runOnce();

    expect(result).toBe(0);
    expect(getTransactionByReferenceWithConfig).not.toHaveBeenCalled();
  });
});
