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
import { SubscriptionPaymentService } from '../domains/store/subscriptions/services/subscription-payment.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';
import { PlatformGatewayEnvironmentEnum } from '../domains/superadmin/subscriptions/gateway/dto/upsert-gateway.dto';

describe('SubscriptionWebhookReconcilerJob', () => {
  let job: SubscriptionWebhookReconcilerJob;
  let invoicesFindMany: jest.Mock;
  let getActiveCredentials: jest.Mock;
  let getTransactionByReferenceWithConfig: jest.Mock;
  let handleWompiEvent: jest.Mock;
  let syncInvoiceFromGateway: jest.Mock;

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
    syncInvoiceFromGateway = jest.fn().mockResolvedValue({ status: 'paid' });

    const prismaMock = {
      withoutScope: () => ({
        subscription_invoices: { findMany: invoicesFindMany },
      }),
    };
    const wompiMock = { getTransactionByReferenceWithConfig };
    const platformMock = { getActiveCredentials };
    const webhookMock = { handleWompiEvent };
    const paymentMock = { syncInvoiceFromGateway };
    const gateConfigMock = { isCronDryRun: () => false };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionWebhookReconcilerJob,
        { provide: GlobalPrismaService, useValue: prismaMock },
        { provide: WompiProcessor, useValue: wompiMock },
        { provide: PlatformGatewayService, useValue: platformMock },
        { provide: SubscriptionWebhookService, useValue: webhookMock },
        { provide: SubscriptionPaymentService, useValue: paymentMock },
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
        state: 'issued',
        store_subscription_id: 7,
        store_id: 5,
        payments: [
          { id: 1, gateway_reference: 'vendix_saas_ref_1', metadata: null },
        ],
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
          transaction: expect.objectContaining({
            id: 'wompi_txn_999',
            status: 'APPROVED',
          }),
        },
      },
    });
  });

  it('skips PENDING transactions (no webhook synthesis)', async () => {
    invoicesFindMany.mockResolvedValue([
      {
        id: 101,
        state: 'issued',
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
        state: 'issued',
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

  // ───────────────────────────────────────────────────────────────────────
  // Incidente 17/08/2026 — el destructor corre cada 5 min y el reparador
  // cada 30, así que en cuanto la factura pasaba a `void` desaparecía del
  // barrido y el pago aprobado quedaba irrecuperable por cron.
  // ───────────────────────────────────────────────────────────────────────

  const facturaAnulada = {
    id: 300,
    state: 'void',
    store_subscription_id: 11,
    store_id: 5,
    payments: [
      { id: 9, gateway_reference: 'vendix_saas_ref_ever', metadata: null },
    ],
  };

  it('incluye las facturas void en la consulta, sin perder el filtro temporal', async () => {
    invoicesFindMany.mockResolvedValue([]);

    await job.runOnce();

    const where = invoicesFindMany.mock.calls[0][0].where;
    expect(where.state).toEqual({ in: ['issued', 'void'] });
    expect(where.issued_at.gte).toBeInstanceOf(Date);
    expect(where.payments).toEqual({ some: { state: 'pending' } });
  });

  it('reabre una factura void vía syncInvoiceFromGateway cuando Wompi dice APPROVED', async () => {
    invoicesFindMany.mockResolvedValue([facturaAnulada]);
    getTransactionByReferenceWithConfig.mockResolvedValue({
      id: 'wompi_txn_ever',
      reference: 'vendix_saas_ref_ever',
      status: 'APPROVED',
    });

    const result = await job.runOnce();

    expect(result).toBe(1);
    // El seam de reapertura, no la síntesis de webhook: `handleWompiEvent`
    // promovería la suscripción pero dejaría los `pending_*` en NULL.
    expect(syncInvoiceFromGateway).toHaveBeenCalledWith(300);
    expect(handleWompiEvent).not.toHaveBeenCalled();
  });

  it('emite RECONCILER_REOPENED_VOID_INVOICE al reabrir una anulada', async () => {
    invoicesFindMany.mockResolvedValue([facturaAnulada]);
    getTransactionByReferenceWithConfig.mockResolvedValue({
      id: 'wompi_txn_ever',
      reference: 'vendix_saas_ref_ever',
      status: 'APPROVED',
    });
    const warn = jest
      .spyOn((job as any).logger, 'warn')
      .mockImplementation(() => undefined);

    await job.runOnce();

    const eventos = warn.mock.calls
      .map(([linea]) => {
        try {
          return JSON.parse(linea as string);
        } catch {
          return {};
        }
      })
      .filter((e) => e.event === 'RECONCILER_REOPENED_VOID_INVOICE');

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      invoice_id: 300,
      transaction_id: 'wompi_txn_ever',
    });
  });

  it('no reabre una factura void cuando la transacción está DECLINED', async () => {
    invoicesFindMany.mockResolvedValue([facturaAnulada]);
    getTransactionByReferenceWithConfig.mockResolvedValue({
      id: 'wompi_txn_declined',
      reference: 'vendix_saas_ref_ever',
      status: 'DECLINED',
    });

    const result = await job.runOnce();

    expect(result).toBe(0);
    expect(syncInvoiceFromGateway).not.toHaveBeenCalled();
    // Tampoco se sintetiza el webhook: quemaría la clave de dedup sin
    // cambiar ningún estado.
    expect(handleWompiEvent).not.toHaveBeenCalled();
  });

  it('no cuenta como recuperada una reapertura que el sync no logró cerrar', async () => {
    invoicesFindMany.mockResolvedValue([facturaAnulada]);
    getTransactionByReferenceWithConfig.mockResolvedValue({
      id: 'wompi_txn_ever',
      reference: 'vendix_saas_ref_ever',
      status: 'APPROVED',
    });
    // Caso real posible: la referencia vive sólo en `gateway_reference` y
    // `syncInvoiceFromGateway` la busca en `metadata.reference`.
    syncInvoiceFromGateway.mockResolvedValue({ status: 'pending' });

    const result = await job.runOnce();

    expect(result).toBe(0);
    expect(syncInvoiceFromGateway).toHaveBeenCalledWith(300);
  });

  it('sigue usando handleWompiEvent para las facturas issued (sin regresión)', async () => {
    invoicesFindMany.mockResolvedValue([
      {
        id: 400,
        state: 'issued',
        store_subscription_id: 12,
        store_id: 5,
        payments: [{ id: 10, gateway_reference: 'ref_issued', metadata: null }],
      },
    ]);
    getTransactionByReferenceWithConfig.mockResolvedValue({
      id: 'wompi_txn_issued',
      reference: 'ref_issued',
      status: 'APPROVED',
    });

    const result = await job.runOnce();

    expect(result).toBe(1);
    expect(handleWompiEvent).toHaveBeenCalledTimes(1);
    expect(syncInvoiceFromGateway).not.toHaveBeenCalled();
  });
});
