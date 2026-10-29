import { LodgingTraService, TraRetryableError } from './tra-submissions.service';
import { TraProvider, TraResult } from './tra.provider';

/**
 * H4.1 — idempotency of the TRA queue: one log row per guest and event, one
 * job per row, and a row already sent (or reported by hand) is never sent
 * again. Nothing reaches the desk as an error (D14).
 */
interface Options {
  settings?: Record<string, unknown>;
  row?: Record<string, unknown> | null;
  credential?: boolean;
  sendResult?: TraResult;
  moved?: number;
}

function build(options: Options = {}) {
  const row =
    options.row === undefined
      ? { id: 70, store_id: 3, status: 'pending', event: 'check_in', guest_id: 5, reservation_id: 1 }
      : options.row;
  const client = {
    store_settings: {
      findFirst: jest.fn(async () => ({
        settings: { hospitality: { rnt_number: '12345', ...(options.settings ?? {}) } },
      })),
    },
    lodging_guests: {
      findMany: jest.fn(async () => [
        { id: 5, first_name: 'Ana', last_name: 'Pérez' },
        { id: 6, first_name: 'Luis', last_name: 'Gómez' },
      ]),
      findFirst: jest.fn(async () => ({
        is_primary: true,
        document_type: 'CC',
        document_number: '1020304050',
        first_name: 'Ana',
        last_name: 'Pérez',
        nationality_country_code: 'CO',
        residence_city: 'Medellín',
        origin_city: 'Bogotá',
        travel_purpose: 'vacation',
        reservation_room_id: 11,
      })),
    },
    lodging_reservation_rooms: {
      findMany: jest.fn(async () => [
        {
          id: 11,
          total_amount: { toString: () => '300000' },
          arrival_date: new Date('2026-11-10T00:00:00Z'),
          departure_date: new Date('2026-11-12T00:00:00Z'),
          unit_type: { name: 'Doble' },
          unit: { code: '201' },
        },
      ]),
    },
    lodging_compliance_submissions: {
      createMany: jest.fn(async () => ({ count: 2 })),
      findMany: jest.fn(async () => [{ id: 70 }, { id: 71 }]),
      findUnique: jest.fn(async () => row),
      updateMany: jest.fn(async () => ({ count: options.moved ?? 1 })),
    },
    lodging_compliance_credentials: {
      findUnique: jest.fn(async () =>
        options.credential === false ? null : { secret_encrypted: 'enc:token-abc' },
      ),
    },
  };
  const prisma = { withoutScope: () => client };
  const encryption = { decrypt: jest.fn((v: string) => v.replace('enc:', '')), encrypt: jest.fn() };
  const provider: TraProvider & { send: jest.Mock; test: jest.Mock } = {
    automatic: true,
    send: jest.fn(async (): Promise<TraResult> => options.sendResult ?? { ok: true, reference: 'TRA-9' }),
    test: jest.fn(),
  };
  const queue = { add: jest.fn(async () => ({})) };
  const service = new LodgingTraService(prisma as any, encryption as any, provider, queue as any);
  return { service, client, provider, queue };
}

describe('LodgingTraService — cola TRA idempotente (H4.1)', () => {
  it('el check-in registra una fila por huésped y acompañante, sin duplicar, y encola un trabajo por fila', async () => {
    const { service, client, queue } = build();

    await expect(service.record(3, 1, ['check_in'])).resolves.toBe(2);

    expect(client.lodging_compliance_submissions.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ store_id: 3, reservation_id: 1, guest_id: 5, authority: 'tra', event: 'check_in', guest_name: 'Ana Pérez' }),
        expect.objectContaining({ guest_id: 6, authority: 'tra', event: 'check_in', guest_name: 'Luis Gómez' }),
      ],
      skipDuplicates: true,
    });
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith('send', { submission_id: 70 }, expect.objectContaining({ jobId: 'tra-70', attempts: 5 }));
    expect(queue.add).toHaveBeenCalledWith('send', { submission_id: 71 }, expect.objectContaining({ jobId: 'tra-71' }));
  });

  it('con la TRA apagada en Configuración no registra nada', async () => {
    const { service, client, queue } = build({ settings: { tra_enabled: false } });

    await expect(service.record(3, 1, ['check_in'])).resolves.toBe(0);

    expect(client.lodging_compliance_submissions.createMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('envía la fila pendiente y la marca "Enviado" solo si nadie la envió antes', async () => {
    const { service, client, provider } = build();

    await expect(service.deliver(70)).resolves.toBe('sent');

    expect(provider.send).toHaveBeenCalledWith(
      'token-abc',
      expect.objectContaining({ evento: 'check_in', prestador: { rnt: '12345' } }),
    );
    expect(client.lodging_compliance_submissions.updateMany).toHaveBeenCalledWith({
      where: { id: 70, status: { in: ['pending', 'failed'] } },
      data: expect.objectContaining({ status: 'sent', sent_at: expect.any(Date), error_code: null }),
    });
  });

  it('una fila ya enviada o reportada en el portal no se envía dos veces', async () => {
    for (const status of ['sent', 'manual']) {
      const { service, provider, client } = build({ row: { id: 70, store_id: 3, status, event: 'check_in', guest_id: 5, reservation_id: 1 } });

      await expect(service.deliver(70)).resolves.toBe('skipped');

      expect(provider.send).not.toHaveBeenCalled();
      expect(client.lodging_compliance_submissions.updateMany).not.toHaveBeenCalled();
    }
  });

  it('dos trabajos a la vez: el que llega tarde no pisa el "Enviado" del primero', async () => {
    const { service } = build({ moved: 0 });

    await expect(service.deliver(70)).resolves.toBe('skipped');
  });

  it('token vencido: queda "Pendiente" con el aviso y sin reintento automático', async () => {
    const { service, client } = build({
      sendResult: { ok: false, code: 'token_expired', message: 'Token TRA vencido: renueva en pms.mincit.gov.co' },
    });

    await expect(service.deliver(70)).resolves.toBe('pending');

    expect(client.lodging_compliance_submissions.updateMany).toHaveBeenCalledWith({
      where: { id: 70, status: { in: ['pending', 'failed'] } },
      data: expect.objectContaining({
        status: 'pending',
        error_code: 'token_expired',
        last_error: 'Token TRA vencido: renueva en pms.mincit.gov.co',
      }),
    });
  });

  it('sin token guardado no llama al portal y deja la fila "Pendiente"', async () => {
    const { service, client, provider } = build({ credential: false });

    await expect(service.deliver(70)).resolves.toBe('pending');

    expect(provider.send).not.toHaveBeenCalled();
    expect(client.lodging_compliance_submissions.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending', error_code: 'token_missing' }) }),
    );
  });

  it('portal caído: guarda el error y lanza para que la cola reintente con espera', async () => {
    const { service, client } = build({
      sendResult: { ok: false, code: 'unavailable', message: 'El portal de la TRA no respondió. Se reintentará.' },
    });

    await expect(service.deliver(70)).rejects.toBeInstanceOf(TraRetryableError);

    expect(client.lodging_compliance_submissions.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending', error_code: 'unavailable' }) }),
    );
  });

  it('faltan datos (sin RNT): no envía, nombra lo que falta y queda "Pendiente"', async () => {
    const { service, provider, client } = build({ settings: { rnt_number: '' } });

    await expect(service.deliver(70)).resolves.toBe('pending');

    expect(provider.send).not.toHaveBeenCalled();
    expect(client.lodging_compliance_submissions.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error_code: 'missing_data', last_error: 'Faltan datos para la TRA: RNT del hotel.' }),
      }),
    );
  });
});
