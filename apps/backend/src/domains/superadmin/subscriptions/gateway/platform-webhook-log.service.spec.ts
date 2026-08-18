import { PlatformWebhookLogService } from './platform-webhook-log.service';

/**
 * Los tres invariantes de la bitácora, uno por bloque:
 *  1. Escribe FUERA de cualquier $transaction (por eso sobrevive al rollback).
 *  2. No puede tumbar el ACK: sus errores se tragan y devuelve null.
 *  3. raw_body va saneado: nunca PAN, CVV, tokens ni firmas completas.
 */
describe('PlatformWebhookLogService', () => {
  let service: PlatformWebhookLogService;
  let create: jest.Mock;
  let update: jest.Mock;
  let transaction: jest.Mock;
  let prismaMock: any;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({ id: 7 });
    update = jest.fn().mockResolvedValue({ id: 7 });
    transaction = jest.fn();

    prismaMock = {
      platform_webhook_log: { create, update },
      // Si algún día alguien mete la bitácora dentro de una transacción, este
      // mock lo delata: no debe llamarse nunca.
      $transaction: transaction,
      withoutScope: () => ({ $transaction: transaction }),
    };

    service = new PlatformWebhookLogService(prismaMock);
  });

  function body(overrides: any = {}) {
    return {
      event: 'transaction.updated',
      signature: {
        checksum:
          'c1a2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        properties: ['transaction.id', 'transaction.status'],
      },
      data: {
        transaction: {
          id: 'wompi_txn_1',
          reference: 'vendix_saas_42_99_1700000000000',
          status: 'APPROVED',
          amount_in_cents: 6990000,
          payment_method: {
            type: 'CARD',
            installments: 1,
            extra: {
              bin: '424242',
              last_four: '4242',
              exp_year: '29',
              exp_month: '12',
              external_identifier: 'tok_live_super_secreto',
            },
          },
          ...overrides,
        },
      },
    };
  }

  describe('fuera de la transacción', () => {
    it('record() escribe por el cliente directo, nunca por $transaction', async () => {
      const id = await service.record({
        processor: 'wompi_platform',
        body: body(),
        outcome: 'acked_error',
        signatureValid: true,
      });

      expect(id).toBe(7);
      expect(create).toHaveBeenCalledTimes(1);
      // Esta es la propiedad que arregla el incidente: si la escritura viajara
      // dentro de la transacción de negocio, el rollback se la llevaría.
      expect(transaction).not.toHaveBeenCalled();
    });

    it('finalize() sella la misma fila, también fuera de transacción', async () => {
      await service.finalize(7, { outcome: 'processed' });

      expect(update).toHaveBeenCalledTimes(1);
      const args = update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 7 });
      expect(args.data.outcome).toBe('processed');
      expect(args.data.processed_at).toBeInstanceOf(Date);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('finalize(null) no intenta escribir', async () => {
      await service.finalize(null, { outcome: 'processed' });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('nunca tumba el ACK', () => {
    it('record() devuelve null si el INSERT falla, sin propagar', async () => {
      create.mockRejectedValue(new Error('connection terminated'));

      await expect(
        service.record({
          processor: 'wompi_platform',
          body: body(),
          outcome: 'acked_error',
        }),
      ).resolves.toBeNull();
    });

    it('finalize() no propaga si el UPDATE falla', async () => {
      update.mockRejectedValue(new Error('deadlock detected'));

      await expect(
        service.finalize(7, { outcome: 'processed' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('saneado de raw_body', () => {
    it('redacta payment_method.extra y el checksum de la firma', async () => {
      await service.record({
        processor: 'wompi_platform',
        body: body(),
        outcome: 'acked_error',
      });

      const raw = create.mock.calls[0][0].data.raw_body;

      expect(raw.data.transaction.payment_method.extra).toBe('[redacted]');
      expect(raw.signature.checksum).toBe('[redacted]');

      // El token de fuente de pago no puede quedar en ningún sitio.
      expect(JSON.stringify(raw)).not.toContain('tok_live_super_secreto');
      expect(JSON.stringify(raw)).not.toContain('424242');

      // Lo que sí es forense se conserva.
      expect(raw.event).toBe('transaction.updated');
      expect(raw.data.transaction.id).toBe('wompi_txn_1');
      expect(raw.data.transaction.status).toBe('APPROVED');
      expect(raw.data.transaction.amount_in_cents).toBe(6990000);
      expect(raw.data.transaction.payment_method.type).toBe('CARD');
      expect(raw.signature.properties).toEqual([
        'transaction.id',
        'transaction.status',
      ]);
    });

    it('no muta el cuerpo original que sigue circulando por el handler', async () => {
      const original = body();

      await service.record({
        processor: 'wompi_platform',
        body: original,
        outcome: 'acked_error',
      });

      // El controlador entrega el mismo objeto a handleWompiEvent después de
      // registrarlo: sanear in-place le robaría datos al negocio.
      expect(original.data.transaction.payment_method.extra.last_four).toBe(
        '4242',
      );
      expect(original.signature.checksum).toContain('c1a2b3d4');
    });

    it('redacta claves sensibles a cualquier profundidad, no sólo en su sitio conocido', async () => {
      await service.record({
        processor: 'wompi_platform',
        body: {
          data: { transaction: { id: 'x', nested: { cvv: '123' } } },
        },
        outcome: 'acked_error',
      });

      const raw = create.mock.calls[0][0].data.raw_body;
      expect(raw.data.transaction.nested.cvv).toBe('[redacted]');
    });
  });

  describe('columnas', () => {
    it('extrae event_type, reference, transaction_id y status del cuerpo', async () => {
      await service.record({
        processor: 'wompi_platform',
        body: body(),
        outcome: 'acked_invalid',
        signatureValid: false,
        validationReason: 'bad_signature',
      });

      const data = create.mock.calls[0][0].data;
      expect(data.processor).toBe('wompi_platform');
      expect(data.event_type).toBe('transaction.updated');
      expect(data.reference).toBe('vendix_saas_42_99_1700000000000');
      expect(data.transaction_id).toBe('wompi_txn_1');
      expect(data.status).toBe('APPROVED');
      expect(data.signature_valid).toBe(false);
      expect(data.validation_reason).toBe('bad_signature');
      expect(data.outcome).toBe('acked_invalid');
    });

    it('registra igual un cuerpo irreconocible — es justo el caso a capturar', async () => {
      const id = await service.record({
        processor: 'wompi_platform',
        body: { hola: 'mundo' },
        outcome: 'acked_invalid',
        validationReason: 'no_reference',
      });

      expect(id).toBe(7);
      const data = create.mock.calls[0][0].data;
      expect(data.event_type).toBeNull();
      expect(data.reference).toBeNull();
      expect(data.transaction_id).toBeNull();
      expect(data.status).toBeNull();
      expect(data.raw_body).toEqual({ hola: 'mundo' });
    });

    it('recorta los textos al ancho de columna en vez de perder la fila por un 22001', async () => {
      const largo = 'x'.repeat(600);

      await service.record({
        processor: 'wompi_platform',
        body: body({ reference: largo, id: largo }),
        outcome: 'acked_error',
      });

      const data = create.mock.calls[0][0].data;
      expect(data.reference).toHaveLength(255);
      expect(data.transaction_id).toHaveLength(255);
    });
  });
});
