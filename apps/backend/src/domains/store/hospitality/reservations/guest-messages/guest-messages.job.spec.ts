import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { LodgingGuestMessagesJob } from './guest-messages.job';
import { guestMessageEmail, guestMessageSettings, preArrivalDue } from './guest-messages-text';

/**
 * H8.2 — the guest gets the confirmation, the reminder with the online
 * check-in link before arrival and the thank-you after check-out, each once,
 * and only the ones the store left on.
 */
describe('LodgingGuestMessagesJob', () => {
  const reservation = (over: Record<string, unknown> = {}) => ({
    id: 7,
    reservation_number: 'H-0007',
    arrival_date: new Date('2026-11-12T00:00:00.000Z'),
    departure_date: new Date('2026-11-14T00:00:00.000Z'),
    precheckin_completed_at: null,
    customer: { email: 'guest@example.com', first_name: 'Ana' },
    store: { name: 'Hotel Roku' },
    rooms: [{ unit_type: { name: 'Doble' } }],
    ...over,
  });

  const build = (opts: {
    hospitality?: Record<string, unknown>;
    byStatus?: Record<string, unknown[]>;
    sendOk?: boolean;
    duplicate?: boolean;
  }) => {
    const byStatus = opts.byStatus ?? {};
    const findMany = jest.fn(async (args: { where: { status: string } }) => byStatus[args.where.status] ?? []);
    const create = jest.fn(async () => {
      if (opts.duplicate) {
        throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
      }
      return { id: 99 };
    });
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      withoutScope: () => ({ lodging_reservations: { findMany: jest.fn(async () => [{ store_id: 5 }]) } }),
      store_settings: {
        findFirst: jest.fn(async () => ({
          settings: { hospitality: opts.hospitality ?? {} },
          stores: { timezone: 'America/Bogota' },
        })),
      },
      stores: { findFirst: jest.fn(async () => ({ timezone: 'America/Bogota' })) },
      lodging_reservations: { findMany },
      lodging_guest_message_logs: { create, deleteMany },
    };
    const email = {
      sendEmail: jest.fn(async (_to: string, _subject: string, _html: string, _text?: string) =>
        opts.sendOk === false ? { success: false, error: 'smtp' } : { success: true },
      ),
    };
    const precheckin = {
      getLink: jest.fn(async () => ({ url: 'https://roku.example/pre-registro/tok' })),
      hasGuestDomain: jest.fn(async () => true),
    };
    const stayReview = { linkFor: jest.fn(async () => 'https://roku.example/calificar-estadia/tok') };
    const runner = { runInStoreContext: jest.fn(async (_id: number, fn: () => Promise<number>) => fn()) };
    const job = new LodgingGuestMessagesJob(
      prisma as any,
      email as any,
      precheckin as any,
      stayReview as any,
      runner as any,
    );
    return { job, findMany, create, deleteMany, email, precheckin, stayReview };
  };

  // 2026-11-10 10:00 Bogotá: 53 h before a 15:00 check-in on 2026-11-12.
  const BEFORE_WINDOW = new Date('2026-11-10T15:00:00Z');
  // 2026-11-10 16:00 Bogotá: 47 h before arrival → inside the 48 h window.
  const IN_WINDOW = new Date('2026-11-10T21:00:00Z');

  it('envía la confirmación de una reserva de recepción y excluye las reservas web pagadas', async () => {
    const { job, findMany, email, create } = build({ byStatus: { confirmed: [reservation()] } });
    const total = await job.run(BEFORE_WINDOW);

    const confirmationQuery = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(confirmationQuery.where).toEqual(
      expect.objectContaining({
        online_payments: { none: {} },
        guest_message_logs: { none: { message_key: 'confirmation', channel: 'email' } },
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { store_id: 5, reservation_id: 7, message_key: 'confirmation', channel: 'email' } }),
    );
    // Same candidate also comes back for the reminder, but 53 h ahead it is not due yet.
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0]).toBe('guest@example.com');
    expect(email.sendEmail.mock.calls[0][1]).toBe('Reserva H-0007 confirmada · Hotel Roku');
    expect(total).toBe(1);
  });

  it('el recordatorio sale 48 h antes de la llegada con el enlace de pre-registro', async () => {
    const { job, email, precheckin } = build({
      hospitality: { guest_email_confirmation: false, guest_email_post_stay: false },
      byStatus: { confirmed: [reservation()] },
    });
    await job.run(IN_WINDOW);

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const [, subject, html, text] = email.sendEmail.mock.calls[0];
    expect(subject).toBe('Te esperamos pronto · Hotel Roku');
    expect(text).toContain('Hacer el pre-registro: https://roku.example/pre-registro/tok');
    expect(html).toContain('href="https://roku.example/pre-registro/tok"');
    expect(precheckin.getLink).toHaveBeenCalledWith(7);
  });

  it('las horas del recordatorio se configuran por tienda', async () => {
    const { job, email } = build({
      hospitality: { guest_email_confirmation: false, guest_email_pre_arrival_hours: 24 },
      byStatus: { confirmed: [reservation()] },
    });
    await job.run(IN_WINDOW); // 47 h before: outside a 24 h window
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('envía el agradecimiento después del check-out', async () => {
    const { job, email } = build({ byStatus: { checked_out: [reservation()] } });
    await job.run(IN_WINDOW);
    expect(email.sendEmail).toHaveBeenCalledWith(
      'guest@example.com',
      'Gracias por hospedarte en Hotel Roku',
      expect.any(String),
      expect.any(String),
    );
  });

  it('H8.5: el agradecimiento pide calificar la estadía con el enlace privado', async () => {
    const { job, email, stayReview } = build({ byStatus: { checked_out: [reservation()] } });
    await job.run(IN_WINDOW);
    const [, , html, text] = email.sendEmail.mock.calls[0];
    expect(stayReview.linkFor).toHaveBeenCalledWith(7);
    expect(text).toContain('Califica tu estadía en un minuto');
    expect(text).toContain('Calificar mi estadía: https://roku.example/calificar-estadia/tok');
    expect(html).toContain('href="https://roku.example/calificar-estadia/tok"');
  });

  it('H8.5: con la calificación apagada el agradecimiento sale sin enlace', async () => {
    const { job, email, stayReview } = build({
      hospitality: { guest_email_post_stay_review: false },
      byStatus: { checked_out: [reservation()] },
    });
    await job.run(IN_WINDOW);
    expect(stayReview.linkFor).not.toHaveBeenCalled();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const [, , html, text] = email.sendEmail.mock.calls[0];
    expect(text).not.toContain('Calificar');
    expect(html).not.toContain('href=');
  });

  it('H8.5: si el enlace de calificación falla el agradecimiento sale igual', async () => {
    const { job, email, stayReview } = build({ byStatus: { checked_out: [reservation()] } });
    stayReview.linkFor.mockRejectedValueOnce(new Error('sin dominio'));
    await expect(job.run(IN_WINDOW)).resolves.toBe(1);
    expect(email.sendEmail.mock.calls[0][3]).not.toContain('Calificar');
  });

  it('no repite: si el log ya existe (otra corrida lo reclamó) no envía', async () => {
    const { job, email } = build({ duplicate: true, byStatus: { checked_out: [reservation()] } });
    await expect(job.run(IN_WINDOW)).resolves.toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('si el email falla libera el log para reintentar en la siguiente corrida', async () => {
    const { job, deleteMany } = build({ sendOk: false, byStatus: { checked_out: [reservation()] } });
    await expect(job.run(IN_WINDOW)).resolves.toBe(0);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 99 } });
  });

  it('con los tres mensajes apagados no consulta reservas ni envía', async () => {
    const { job, findMany, email } = build({
      hospitality: { guest_email_confirmation: false, guest_email_pre_arrival: false, guest_email_post_stay: false },
      byStatus: { confirmed: [reservation()], checked_out: [reservation()] },
    });
    await job.run(IN_WINDOW);
    expect(findMany).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('sin email del huésped no reclama log ni envía', async () => {
    const { job, create, email } = build({
      byStatus: { checked_out: [reservation({ customer: { email: null, first_name: 'Ana' } })] },
    });
    await job.run(IN_WINDOW);
    expect(create).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  describe('H9.4: pre check-in a pedido de recepción (Vexi)', () => {
    let contextSpy: jest.SpyInstance;
    beforeEach(() => {
      contextSpy = jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 5 } as any);
    });
    afterEach(() => contextSpy.mockRestore());

    it('lista las llegadas confirmadas de mañana (zona de la tienda) con correo, pre-registro y recordatorio', async () => {
      const { job, findMany } = build({
        byStatus: {
          confirmed: [
            reservation({
              guest_message_logs: [{ id: 1 }],
              customer: { email: ' ana@x.co ', first_name: 'Ana', last_name: 'Ruiz' },
            }),
            reservation({
              id: 8,
              reservation_number: 'H-0008',
              precheckin_completed_at: new Date(),
              guest_message_logs: [],
              customer: { email: null, first_name: 'Luis', last_name: null },
            }),
          ],
        },
      });
      jest.useFakeTimers().setSystemTime(new Date('2026-11-11T04:00:00Z')); // 10-nov 23:00 Bogotá
      try {
        const result = await job.precheckinArrivals();
        expect(findMany.mock.calls[0][0].where).toEqual({
          status: 'confirmed',
          arrival_date: new Date('2026-11-11T00:00:00.000Z'),
        });
        expect(result).toEqual({
          today: '2026-11-10',
          arrival_date: '2026-11-11',
          has_link: true,
          arrivals: [
            {
              reservation_id: 7,
              reservation_number: 'H-0007',
              guest_name: 'Ana Ruiz',
              email: 'ana@x.co',
              precheckin_done: false,
              reminder_sent: true,
            },
            {
              reservation_id: 8,
              reservation_number: 'H-0008',
              guest_name: 'Luis',
              email: null,
              precheckin_done: true,
              reminder_sent: false,
            },
          ],
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('envía el recordatorio con el enlace aunque el automático esté apagado o ya enviado, y no borra el log existente', async () => {
      const { job, email, create, deleteMany } = build({
        duplicate: true,
        hospitality: { guest_email_pre_arrival: false },
        byStatus: { confirmed: [reservation()] },
      });
      await expect(job.sendPrecheckinNow([7])).resolves.toEqual({ sent: ['H-0007'], failed: [] });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { store_id: 5, reservation_id: 7, message_key: 'pre_arrival', channel: 'email' },
        }),
      );
      expect(email.sendEmail).toHaveBeenCalledTimes(1);
      expect(email.sendEmail.mock.calls[0][0]).toBe('guest@example.com');
      expect(email.sendEmail.mock.calls[0][2]).toContain('https://roku.example/pre-registro/tok');
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it('solo confirmadas sin pre-registro; sin enlace queda como no enviado y libera su log', async () => {
      const { job, findMany, precheckin, deleteMany, email } = build({ byStatus: { confirmed: [reservation()] } });
      precheckin.getLink.mockRejectedValueOnce(new Error('no domain'));
      await expect(job.sendPrecheckinNow([7])).resolves.toEqual({ sent: [], failed: ['H-0007'] });
      expect(findMany.mock.calls[0][0].where).toEqual({
        id: { in: [7] },
        status: 'confirmed',
        precheckin_completed_at: null,
      });
      expect(email.sendEmail).not.toHaveBeenCalled();
      expect(deleteMany).toHaveBeenCalledWith({ where: { id: 99 } });
      await expect(job.sendPrecheckinNow([])).resolves.toEqual({ sent: [], failed: [] });
    });
  });
});

describe('guest messages rules', () => {
  it('preArrivalDue: desde N horas antes de la hora de llegada hasta la llegada', () => {
    const tz = 'America/Bogota';
    expect(preArrivalDue('2026-11-12', '15:00', 48, new Date('2026-11-10T19:59:00Z'), tz)).toBe(false);
    expect(preArrivalDue('2026-11-12', '15:00', 48, new Date('2026-11-10T20:00:00Z'), tz)).toBe(true);
    expect(preArrivalDue('2026-11-12', '15:00', 48, new Date('2026-11-12T19:59:00Z'), tz)).toBe(true);
    expect(preArrivalDue('2026-11-12', '15:00', 48, new Date('2026-11-12T20:00:00Z'), tz)).toBe(false);
  });

  it('guestMessageSettings: todo encendido y 48 h por defecto; horas fuera de rango vuelven a 48', () => {
    expect(guestMessageSettings(undefined)).toEqual({
      confirmation: true,
      pre_arrival: true,
      pre_arrival_hours: 48,
      post_stay: true,
      post_stay_review: true,
      check_in_time: '15:00',
      check_out_time: '12:00',
    });
    expect(guestMessageSettings({ guest_email_pre_arrival_hours: 500 }).pre_arrival_hours).toBe(48);
    expect(guestMessageSettings({ guest_email_post_stay: false }).post_stay).toBe(false);
  });

  it('el recordatorio con pre-registro completo no muestra el enlace y escapa el HTML', () => {
    const email = guestMessageEmail('pre_arrival', {
      guest_name: '<b>Ana</b>',
      store_name: 'Hotel',
      reservation_number: 'H-1',
      arrival_date: '2026-11-12',
      departure_date: '2026-11-14',
      nights: 2,
      room_type: 'Doble',
      check_in_time: '15:00',
      check_out_time: '12:00',
      precheckin_done: true,
      precheckin_url: null,
    });
    expect(email.text).toContain('Tu pre-registro ya está completo');
    expect(email.html).not.toContain('href=');
    expect(email.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
  });
});
