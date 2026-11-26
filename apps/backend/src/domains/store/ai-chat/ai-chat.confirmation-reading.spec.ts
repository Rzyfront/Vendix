import { Logger } from '@nestjs/common';
import {
  AIChatService,
  VEX_CONFIRMATION_READING_KEY,
} from './ai-chat.service';

function build(opts: {
  batch?: { id: string; goal: string; step_count: number } | null;
  verdict?: unknown;
  classifierThrows?: boolean;
  metadata?: Record<string, unknown> | null;
  withClassifier?: boolean;
}) {
  const update = jest.fn().mockResolvedValue({});
  const findBatch = jest.fn().mockResolvedValue(
    opts.batch === undefined
      ? { id: 'b-1', goal: 'Subir 10 % a 12 productos', step_count: 12 }
      : opts.batch,
  );
  const readConfirmation = opts.classifierThrows
    ? jest.fn().mockRejectedValue(new Error('boom'))
    : jest.fn().mockResolvedValue(
        opts.verdict ?? {
          value: 'accept',
          confidence: 0.95,
          criteria_version: 'v1',
          latency_ms: 120,
        },
      );
  const prisma = {
    ai_agent_write_batches: { findFirst: findBatch },
    ai_conversations: {
      findFirst: jest.fn().mockResolvedValue({
        metadata:
          opts.metadata === undefined ? { agent_key: 'vex' } : opts.metadata,
      }),
      update,
    },
  };
  // Assign onto a typed instance: `Object.assign`'s return type intersects the
  // class's private members with the literal and collapses to `never`.
  const service = Object.create(AIChatService.prototype) as AIChatService;
  Object.assign(service, {
    prisma,
    logger: new Logger('spec'),
    classifier:
      opts.withClassifier === false ? undefined : { readConfirmation },
  });
  return { service, update, findBatch, readConfirmation };
}

describe('Vex: lectura del «sí/no» con una tarjeta de lote pendiente', () => {
  it('guarda la lectura junto al id del lote, sin tocar el resto de la metadata', async () => {
    const { service, update, findBatch, readConfirmation } = build({});
    await service.readPendingBatchReply(42, 'dale, hágale');
    expect(findBatch.mock.calls[0][0].where).toMatchObject({
      conversation_id: 42,
      status: 'proposed',
    });
    expect(readConfirmation).toHaveBeenCalledWith(
      'dale, hágale',
      '¿Aplico el lote «Subir 10 % a 12 productos» (12 cambio(s))?',
    );
    const data = update.mock.calls[0][0];
    expect(data.where).toEqual({ id: 42 });
    expect(data.data.metadata.agent_key).toBe('vex');
    expect(data.data.metadata[VEX_CONFIRMATION_READING_KEY]).toMatchObject({
      batch_id: 'b-1',
      verdict: 'accept',
      criteria_version: 'v1',
    });
  });

  it('unavailable se guarda con su motivo y no cambia nada más', async () => {
    const { service, update } = build({
      verdict: { value: 'unavailable', reason: 'inactive', latency_ms: 1 },
    });
    await service.readPendingBatchReply(42, 'sí');
    expect(update.mock.calls[0][0].data.metadata[VEX_CONFIRMATION_READING_KEY]).toMatchObject({
      batch_id: 'b-1',
      verdict: 'unavailable',
      reason: 'inactive',
    });
  });

  it('sin tarjeta pendiente no consulta al clasificador ni escribe', async () => {
    const { service, update, readConfirmation } = build({ batch: null });
    await service.readPendingBatchReply(42, 'sí');
    expect(readConfirmation).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('sin clasificador no hace nada', async () => {
    const { service, update, findBatch } = build({ withClassifier: false });
    await service.readPendingBatchReply(42, 'sí');
    expect(findBatch).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('nunca lanza hacia el turno (clasificador o DB fallan)', async () => {
    const a = build({ classifierThrows: true });
    await expect(a.service.readPendingBatchReply(42, 'sí')).resolves.toBeUndefined();
    expect(a.update).not.toHaveBeenCalled();
    const b = build({});
    b.update.mockRejectedValue(new Error('db down'));
    await expect(b.service.readPendingBatchReply(42, 'sí')).resolves.toBeUndefined();
  });
});
