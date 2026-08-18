import { SubscriptionWebhookService } from './subscription-webhook.service';

/**
 * Unit tests for SubscriptionWebhookService.
 * Covers:
 *  - APPROVED → markPaymentSucceededFromWebhook
 *  - DECLINED / ERROR → markPaymentFailedFromWebhook
 *  - VOIDED → markPaymentFailedFromWebhook
 *  - Missing payment row → no-op (warn log only)
 *  - Missing transaction body → no-op
 *  - Idempotency: payment service receives the call but short-circuits
 *    internally (we test that scenario in subscription-payment.service.spec.ts;
 *    here we only verify the dispatcher always delegates exactly once per
 *    redelivered webhook so accrual cannot promote twice)
 */
describe('SubscriptionWebhookService', () => {
  let service: SubscriptionWebhookService;
  let prismaMock: any;
  let paymentsFindFirst: jest.Mock;
  let subsFindUnique: jest.Mock;
  let executeRaw: jest.Mock;
  let claimQueryRaw: jest.Mock;
  let sealExecuteRaw: jest.Mock;
  let transactionMock: jest.Mock;
  let callOrder: string[];
  let paymentServiceMock: any;
  let fraudServiceMock: any;
  let stateServiceMock: any;
  let eventEmitterMock: any;

  /** Respuesta del CTE de reclamo (ver claimWebhookEvent). */
  function claimRow(claimed: boolean, processedAt: Date | null) {
    return [{ processed_at: processedAt, claimed }];
  }

  beforeEach(() => {
    // The service reaches Prisma exclusively through `withoutScope()`. Payment
    // writes still live inside `$transaction`; el RECLAMO y el SELLO viven
    // FUERA a propósito, así que tienen sus propios mocks: si alguien los
    // devuelve al interior de la transacción, estos tests lo detectan por el
    // orden de invocación.
    paymentsFindFirst = jest.fn();
    subsFindUnique = jest.fn();
    callOrder = [];
    // `$executeRaw` dentro de la tx: sólo lo usa el dedup del chargeback.
    // 1 = primera entrega, 0 = duplicado.
    executeRaw = jest.fn().mockResolvedValue(1);
    // Reclamo fuera de la tx: por defecto, evento nuevo.
    claimQueryRaw = jest.fn(async () => {
      callOrder.push('claim');
      return claimRow(true, null);
    });
    // Sello `processed_at` fuera de la tx.
    sealExecuteRaw = jest.fn(async () => {
      callOrder.push('seal');
      return 1;
    });

    const txMock = {
      $executeRaw: executeRaw,
      subscription_payments: { findFirst: paymentsFindFirst },
      store_subscriptions: { findUnique: subsFindUnique },
    };

    transactionMock = jest.fn(async (cb: any) => {
      callOrder.push('transaction');
      return cb(txMock);
    });

    const unscopedMock = {
      $transaction: transactionMock,
      $queryRaw: claimQueryRaw,
      $executeRaw: sealExecuteRaw,
      subscription_payments: { findFirst: paymentsFindFirst },
      store_subscriptions: { findUnique: subsFindUnique },
    };

    prismaMock = {
      withoutScope: () => unscopedMock,
      subscription_payments: { findFirst: paymentsFindFirst },
      store_subscriptions: { findUnique: subsFindUnique },
    };
    paymentServiceMock = {
      markPaymentSucceededFromWebhook: jest.fn(),
      markPaymentFailedFromWebhook: jest.fn(),
      enqueueCommissionAccrualPostCommit: jest.fn(),
    };
    fraudServiceMock = {
      handleChargeback: jest.fn(),
    };
    stateServiceMock = {
      transition: jest.fn(),
    };
    eventEmitterMock = { emit: jest.fn() };

    service = new SubscriptionWebhookService(
      prismaMock,
      paymentServiceMock,
      fraudServiceMock,
      stateServiceMock,
      eventEmitterMock,
    );
  });

  function approvedBody(overrides: any = {}) {
    return {
      data: {
        transaction: {
          id: 'wompi_txn_1',
          reference: 'vendix_saas_42_99_1700000000000',
          status: 'APPROVED',
          status_message: 'OK',
          ...overrides,
        },
      },
    };
  }

  it('routes APPROVED to markPaymentSucceededFromWebhook with txn metadata', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue({
      id: 7,
      invoice_id: 99,
      state: 'pending',
    });
    paymentServiceMock.markPaymentSucceededFromWebhook.mockResolvedValue({
      id: 7,
      state: 'succeeded',
    });

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody(),
    });

    expect(
      paymentServiceMock.markPaymentSucceededFromWebhook,
    ).toHaveBeenCalledTimes(1);
    const succArg =
      paymentServiceMock.markPaymentSucceededFromWebhook.mock.calls[0][0];
    expect(succArg.paymentId).toBe(7);
    expect(succArg.invoiceId).toBe(99);
    expect(succArg.transactionId).toBe('wompi_txn_1');
    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).not.toHaveBeenCalled();

    // succeeded path emits an observability event
    expect(eventEmitterMock.emit).toHaveBeenCalledTimes(1);
    const [eventName, eventPayload] = eventEmitterMock.emit.mock.calls[0];
    expect(eventName).toBe('subscription.payment.succeeded');
    expect(eventPayload.invoiceId).toBe(99);
    expect(eventPayload.paymentId).toBe(7);
    expect(eventPayload.source).toBe('webhook');
  });

  it('routes DECLINED to markPaymentFailedFromWebhook with status_message reason', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue({
      id: 7,
      invoice_id: 99,
      state: 'pending',
    });

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody({
        status: 'DECLINED',
        status_message: 'insufficient funds',
      }),
    });

    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).toHaveBeenCalledTimes(1);
    const failArg =
      paymentServiceMock.markPaymentFailedFromWebhook.mock.calls[0][0];
    expect(failArg.paymentId).toBe(7);
    expect(failArg.invoiceId).toBe(99);
    expect(failArg.reason).toBe('insufficient funds');
    expect(
      paymentServiceMock.markPaymentSucceededFromWebhook,
    ).not.toHaveBeenCalled();
  });

  it('routes ERROR to markPaymentFailedFromWebhook', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue({
      id: 7,
      invoice_id: 99,
      state: 'pending',
    });

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody({ status: 'ERROR', status_message: undefined }),
    });

    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).toHaveBeenCalledTimes(1);
    const failArg =
      paymentServiceMock.markPaymentFailedFromWebhook.mock.calls[0][0];
    expect(failArg.paymentId).toBe(7);
    // status_message is undefined, so reason falls back to the wompi status
    expect(failArg.reason).toBe('ERROR');
  });

  it('routes VOIDED to markPaymentFailedFromWebhook with reason=voided', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue({
      id: 7,
      invoice_id: 99,
      state: 'pending',
    });

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody({ status: 'VOIDED' }),
    });

    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).toHaveBeenCalledTimes(1);
    const failArg =
      paymentServiceMock.markPaymentFailedFromWebhook.mock.calls[0][0];
    expect(failArg.reason).toBe('voided');
  });

  it('is no-op when no payment row exists for the invoice', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue(null);

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody(),
    });

    expect(
      paymentServiceMock.markPaymentSucceededFromWebhook,
    ).not.toHaveBeenCalled();
    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).not.toHaveBeenCalled();
  });

  it('is no-op when body lacks transaction', async () => {
    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: { data: {} },
    });

    expect(prismaMock.subscription_payments.findFirst).not.toHaveBeenCalled();
    expect(
      paymentServiceMock.markPaymentSucceededFromWebhook,
    ).not.toHaveBeenCalled();
    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).not.toHaveBeenCalled();
  });

  /**
   * RECLAMO + CONFIRMACIÓN sobre `webhook_event_dedup`.
   *
   * El incidente del 17/08/2026: el INSERT del dedup era el paso 1 DENTRO de
   * la transacción de negocio, así que cualquier throw posterior hacía
   * rollback y borraba la única evidencia de que el evento había llegado.
   * Estos tests fijan las tres propiedades que lo impiden: el reclamo se
   * escribe antes de abrir la transacción, un reclamo sin sellar significa
   * REPROCESAR (no descartar), y sólo el sello convierte la fila en duplicado.
   */
  describe('dedup: reclamo + confirmación', () => {
    beforeEach(() => {
      paymentsFindFirst.mockResolvedValue({
        id: 7,
        invoice_id: 99,
        state: 'pending',
      });
      paymentServiceMock.markPaymentSucceededFromWebhook.mockResolvedValue({
        id: 7,
        state: 'succeeded',
      });
    });

    it('reclama ANTES de abrir la transacción de negocio y sella DESPUÉS del commit', async () => {
      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: approvedBody(),
      });

      // El orden es la propiedad, no un detalle: un reclamo dentro de la
      // transacción es un reclamo que el rollback puede borrar.
      expect(callOrder).toEqual(['claim', 'transaction', 'seal']);
      expect(claimQueryRaw).toHaveBeenCalledTimes(1);
      expect(sealExecuteRaw).toHaveBeenCalledTimes(1);
    });

    it('fila existente con processed_at NULL → REPROCESA (intento previo que no terminó)', async () => {
      claimQueryRaw.mockImplementation(async () => {
        callOrder.push('claim');
        return claimRow(false, null);
      });

      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: approvedBody(),
      });

      // Descartarlo sería repetir el fallo del incidente: dar por procesado un
      // evento que nadie procesó.
      expect(
        paymentServiceMock.markPaymentSucceededFromWebhook,
      ).toHaveBeenCalledTimes(1);
      expect(sealExecuteRaw).toHaveBeenCalledTimes(1);
    });

    it('fila existente con processed_at puesto → duplicado, se descarta', async () => {
      claimQueryRaw.mockImplementation(async () => {
        callOrder.push('claim');
        return claimRow(false, new Date('2026-08-17T14:47:48Z'));
      });

      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: approvedBody(),
      });

      expect(transactionMock).not.toHaveBeenCalled();
      expect(
        paymentServiceMock.markPaymentSucceededFromWebhook,
      ).not.toHaveBeenCalled();
      expect(sealExecuteRaw).not.toHaveBeenCalled();
      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
    });

    it('si el negocio lanza, el reclamo queda SIN sellar (reprocesable) y la excepción sube', async () => {
      paymentServiceMock.markPaymentSucceededFromWebhook.mockRejectedValue(
        new Error('P2028 transaction timeout'),
      );

      await expect(
        service.handleWompiEvent({
          subscriptionId: 42,
          invoiceId: 99,
          body: approvedBody(),
        }),
      ).rejects.toThrow('P2028 transaction timeout');

      // El reclamo se escribió (vive en otra conexión, el rollback no lo
      // alcanza) y NO se selló: la reentrega de Wompi o el reconciliador lo
      // vuelven a intentar, y además queda constancia de que el evento llegó.
      expect(claimQueryRaw).toHaveBeenCalledTimes(1);
      expect(sealExecuteRaw).not.toHaveBeenCalled();
    });

    it('no sella cuando no hay fila de pago: el evento quedó sin aplicar, no terminado', async () => {
      paymentsFindFirst.mockResolvedValue(null);

      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: approvedBody(),
      });

      expect(claimQueryRaw).toHaveBeenCalledTimes(1);
      expect(sealExecuteRaw).not.toHaveBeenCalled();
    });

    it('si el reclamo falla se procesa igual: perder un evento genuino es peor que reprocesarlo', async () => {
      claimQueryRaw.mockRejectedValue(new Error('connection terminated'));

      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: approvedBody(),
      });

      expect(
        paymentServiceMock.markPaymentSucceededFromWebhook,
      ).toHaveBeenCalledTimes(1);
    });

    it('cero filas del CTE (carrera con otra entrega) → reprocesa, que es el lado seguro', async () => {
      claimQueryRaw.mockResolvedValue([]);

      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: approvedBody(),
      });

      expect(
        paymentServiceMock.markPaymentSucceededFromWebhook,
      ).toHaveBeenCalledTimes(1);
    });

    it('un fallo al sellar no tumba el turno: el negocio ya commiteó', async () => {
      sealExecuteRaw.mockRejectedValue(new Error('deadlock detected'));

      await expect(
        service.handleWompiEvent({
          subscriptionId: 42,
          invoiceId: 99,
          body: approvedBody(),
        }),
      ).resolves.toBeUndefined();

      expect(eventEmitterMock.emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('chargeback → lock_reason', () => {
    function chargebackBody(overrides: any = {}) {
      return {
        event: 'nu.dispute.created',
        id: 'evt_dispute_1',
        data: {
          transaction: {
            id: 'wompi_txn_1',
            status: 'REFUNDED',
            status_message: 'chargeback recibido',
            amount_in_cents: 500000,
            ...overrides,
          },
        },
      };
    }

    beforeEach(() => {
      subsFindUnique.mockResolvedValue({
        id: 42,
        store_id: 10,
        state: 'active',
        store: { organization_id: 5 },
      });
    });

    it("suspends with lockReason='chargeback' so the column is not left at the 'admin_manual' default", async () => {
      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: chargebackBody(),
      });

      expect(stateServiceMock.transition).toHaveBeenCalledTimes(1);
      const [storeId, toState, opts] =
        stateServiceMock.transition.mock.calls[0];
      expect(storeId).toBe(10);
      expect(toState).toBe('suspended');

      // `lockReason` is the value persisted to `store_subscriptions.lock_reason`.
      // SubscriptionStateService applies `opts.lockReason ?? 'admin_manual'` for
      // suspended/blocked, so omitting it silently mislabels a real chargeback
      // as a manual admin action. Passing `reason` alone is NOT enough — it only
      // lands in `subscription_events.payload.reason`.
      expect(opts.lockReason).toBe('chargeback');
      expect(opts.lockReason).not.toBe('admin_manual');
      expect(opts.reason).toBe('chargeback');
    });

    it('still bumps the org chargeback counter after suspending', async () => {
      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: chargebackBody(),
      });

      expect(fraudServiceMock.handleChargeback).toHaveBeenCalledTimes(1);
      const [orgId, args] = fraudServiceMock.handleChargeback.mock.calls[0];
      expect(orgId).toBe(5);
      expect(args.storeId).toBe(10);
      expect(args.invoiceId).toBe(99);
    });

    it('does not re-transition a subscription already suspended', async () => {
      subsFindUnique.mockResolvedValue({
        id: 42,
        store_id: 10,
        state: 'suspended',
        store: { organization_id: 5 },
      });

      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: chargebackBody(),
      });

      expect(stateServiceMock.transition).not.toHaveBeenCalled();
      // bookkeeping must still run
      expect(fraudServiceMock.handleChargeback).toHaveBeenCalledTimes(1);
    });

    it('skips entirely on a duplicate chargeback delivery', async () => {
      executeRaw.mockResolvedValue(0); // dedup row already present

      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: chargebackBody(),
      });

      expect(stateServiceMock.transition).not.toHaveBeenCalled();
      expect(fraudServiceMock.handleChargeback).not.toHaveBeenCalled();
    });

    it('conserva la semántica vieja: la fila sola ya descarta, sin consultar processed_at', async () => {
      executeRaw.mockResolvedValue(0);

      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: chargebackBody(),
      });

      // Decisión deliberada: `fraudService.handleChargeback` incrementa
      // `organizations.chargeback_count`, un contador NO idempotente con
      // umbral de bloqueo (RNC-30). Reprocesar aquí podría bloquear a un
      // cliente por un contracargo que ocurrió una sola vez, así que este
      // camino NO usa el reclamo con `processed_at`.
      expect(claimQueryRaw).not.toHaveBeenCalled();
    });

    it('sella processed_at al cerrar el turno, como observabilidad', async () => {
      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: chargebackBody(),
      });

      // El sello no cambia la decisión de duplicado de este camino; sirve para
      // distinguir en la base un contracargo que terminó de uno que murió a
      // mitad.
      expect(sealExecuteRaw).toHaveBeenCalledTimes(1);
    });
  });

  it('treats PENDING transaction as a no-op (no state transition)', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue({
      id: 7,
      invoice_id: 99,
      state: 'pending',
    });

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody({ status: 'PENDING' }),
    });

    expect(
      paymentServiceMock.markPaymentSucceededFromWebhook,
    ).not.toHaveBeenCalled();
    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).not.toHaveBeenCalled();
  });
});
