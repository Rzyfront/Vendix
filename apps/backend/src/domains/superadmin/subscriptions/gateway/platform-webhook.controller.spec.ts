import { PlatformWebhookController } from './platform-webhook.controller';

/**
 * Tests del contrato de BITÁCORA del endpoint de webhooks de plataforma.
 *
 * Lo que se está protegiendo aquí no es el enrutado del evento (eso lo cubre
 * subscription-webhook.service.spec.ts) sino la propiedad que faltó el
 * 17/08/2026: que NINGÚN camino de este handler pueda responder ACK sin dejar
 * fila, y que la fila no dependa del éxito del negocio.
 */
describe('PlatformWebhookController — bitácora', () => {
  let controller: PlatformWebhookController;
  let validatorMock: any;
  let subscriptionWebhookMock: any;
  let webhookLogMock: any;
  let envBackup: string | undefined;

  /** Orden real de invocación, para probar «la fila se escribe ANTES». */
  let callOrder: string[];

  beforeEach(() => {
    envBackup = process.env.SAAS_WEBHOOK_ENABLED;
    delete process.env.SAAS_WEBHOOK_ENABLED;
    callOrder = [];

    validatorMock = {
      validate: jest
        .fn()
        .mockResolvedValue({ valid: true, subscriptionId: 42, invoiceId: 99 }),
    };
    subscriptionWebhookMock = {
      handleWompiEvent: jest.fn(async () => {
        callOrder.push('handleWompiEvent');
      }),
    };
    webhookLogMock = {
      record: jest.fn(async () => {
        callOrder.push('record');
        return 7;
      }),
      finalize: jest.fn(async () => {
        callOrder.push('finalize');
      }),
    };

    controller = new PlatformWebhookController(
      validatorMock,
      subscriptionWebhookMock,
      webhookLogMock,
    );
  });

  afterEach(() => {
    if (envBackup === undefined) {
      delete process.env.SAAS_WEBHOOK_ENABLED;
    } else {
      process.env.SAAS_WEBHOOK_ENABLED = envBackup;
    }
  });

  function wompiBody(overrides: any = {}) {
    return {
      event: 'transaction.updated',
      data: {
        transaction: {
          id: 'wompi_txn_1',
          reference: 'vendix_saas_42_99_1700000000000',
          status: 'APPROVED',
          amount_in_cents: 6990000,
          ...overrides,
        },
      },
    };
  }

  it('firma inválida → fila con outcome acked_invalid y ACK 200', async () => {
    validatorMock.validate.mockResolvedValue({
      valid: false,
      reason: 'bad_signature',
    });

    const res = await controller.handleWompi(wompiBody(), {});

    // El ACK se mantiene: una firma inválida nunca reintenta con éxito, así
    // que un 4xx sólo penalizaría la salud del endpoint.
    expect(res).toEqual({ received: true });

    expect(webhookLogMock.record).toHaveBeenCalledTimes(1);
    const recorded = webhookLogMock.record.mock.calls[0][0];
    expect(recorded.outcome).toBe('acked_invalid');
    expect(recorded.processor).toBe('wompi_platform');
    expect(recorded.validationReason).toBe('bad_signature');
    // `bad_signature` es el ÚNICO motivo que prueba firma inválida.
    expect(recorded.signatureValid).toBe(false);

    expect(webhookLogMock.finalize).toHaveBeenCalledWith(7, {
      outcome: 'acked_invalid',
    });
    expect(subscriptionWebhookMock.handleWompiEvent).not.toHaveBeenCalled();
  });

  it('referencia no-SaaS → acked_invalid con signatureValid null (la firma nunca se comprobó)', async () => {
    validatorMock.validate.mockResolvedValue({
      valid: false,
      reason: 'reference_not_saas',
    });

    await controller.handleWompi(wompiBody(), {});

    const recorded = webhookLogMock.record.mock.calls[0][0];
    expect(recorded.outcome).toBe('acked_invalid');
    expect(recorded.validationReason).toBe('reference_not_saas');
    // Afirmar `false` aquí sería inventar un hallazgo: la validación abortó
    // antes de llegar a la firma.
    expect(recorded.signatureValid).toBeNull();
  });

  it('SAAS_WEBHOOK_ENABLED=false → fila con outcome acked_disabled sin tocar el negocio', async () => {
    process.env.SAAS_WEBHOOK_ENABLED = 'false';
    const body = wompiBody();

    const res = await controller.handleWompi(body, {});

    expect(res).toEqual({ received: true });
    expect(webhookLogMock.record).toHaveBeenCalledTimes(1);
    const recorded = webhookLogMock.record.mock.calls[0][0];
    expect(recorded.outcome).toBe('acked_disabled');
    expect(recorded.signatureValid).toBeNull();
    // El descarte deliberado es el camino que MÁS necesita rastro: Wompi no
    // reentrega a petición, así que el cuerpo completo tiene que quedar
    // guardado para poder reconstruir después qué se tiró.
    expect(recorded.body).toBe(body);
    expect(webhookLogMock.finalize).toHaveBeenCalledWith(7, {
      outcome: 'acked_disabled',
    });
    expect(validatorMock.validate).not.toHaveBeenCalled();
    expect(subscriptionWebhookMock.handleWompiEvent).not.toHaveBeenCalled();
  });

  it('camino feliz → la fila nace pesimista y se sella a processed', async () => {
    const res = await controller.handleWompi(wompiBody(), {});

    expect(res).toEqual({ received: true });

    // Nace `acked_error` a propósito: si el proceso muriera a mitad, la fila
    // diría la verdad en vez de mentir con un `processed` no confirmado.
    const recorded = webhookLogMock.record.mock.calls[0][0];
    expect(recorded.outcome).toBe('acked_error');
    expect(recorded.signatureValid).toBe(true);

    expect(webhookLogMock.finalize).toHaveBeenCalledWith(7, {
      outcome: 'processed',
    });
    // La fila se escribe ANTES de entrar al negocio.
    expect(callOrder).toEqual(['record', 'handleWompiEvent', 'finalize']);
  });

  it('handleWompiEvent lanza → la fila ya existía y se sella como acked_error; el ACK se mantiene', async () => {
    subscriptionWebhookMock.handleWompiEvent.mockImplementation(async () => {
      callOrder.push('handleWompiEvent');
      throw new Error('rollback de la transacción de negocio');
    });

    const res = await controller.handleWompi(wompiBody(), {});

    expect(res).toEqual({ received: true });

    // ESTA es la garantía del incidente: la fila se escribió antes de abrir el
    // negocio, así que el fallo (y su rollback, que vive en otra conexión) no
    // puede borrarla.
    expect(webhookLogMock.record).toHaveBeenCalledTimes(1);
    expect(callOrder.indexOf('record')).toBeLessThan(
      callOrder.indexOf('handleWompiEvent'),
    );

    expect(webhookLogMock.finalize).toHaveBeenCalledTimes(1);
    const [logId, finalized] = webhookLogMock.finalize.mock.calls[0];
    expect(logId).toBe(7);
    expect(finalized.outcome).toBe('acked_error');
    expect(finalized.errorMessage).toContain(
      'rollback de la transacción de negocio',
    );
  });

  it('si la bitácora falla (record devuelve null) el ACK sigue saliendo', async () => {
    // `record` nunca lanza —se traga sus errores y devuelve null—, pero el
    // controlador tampoco puede asumir que hubo fila.
    webhookLogMock.record.mockResolvedValue(null);

    const res = await controller.handleWompi(wompiBody(), {});

    expect(res).toEqual({ received: true });
    expect(subscriptionWebhookMock.handleWompiEvent).toHaveBeenCalledTimes(1);
    expect(webhookLogMock.finalize).toHaveBeenCalledWith(null, {
      outcome: 'processed',
    });
  });
});
