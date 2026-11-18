import { PlatformIncidentService } from './platform-incident.service';
import type { PlatformIncidentInput } from './platform-incident.types';

const input = (over: Partial<PlatformIncidentInput> = {}): PlatformIncidentInput => ({
  dedupeKey: 'bulk-upload-job:7',
  source: 'bulk_upload_job',
  severity: 'critical',
  title: 'Carga masiva de productos falló',
  summary: 'El lote 2 falló por un error de plataforma.',
  details: { Tienda: 'Tienda Uno', Archivo: 'productos.xlsx' },
  stack: Array.from({ length: 15 }, (_, i) => `at frame${i}`).join('\n'),
  tags: ['bulk_upload', 'products'],
  organizationId: 3,
  storeId: 9,
  userId: 42,
  errorCode: 'BULK_JOB_X',
  correlationId: 'bulk-upload-7',
  ...over,
});

describe('PlatformIncidentService', () => {
  let store: Map<string, string>;
  let redis: { set: jest.Mock; get: jest.Mock; del: jest.Mock };
  let tickets: Array<Record<string, any>>;
  let createTicket: jest.Mock;
  let findUsers: jest.Mock;
  let findFirstUser: jest.Mock;
  let sendEmail: jest.Mock;
  let env: Record<string, string | undefined>;

  const build = () =>
    new PlatformIncidentService(
      {
        support_tickets: { create: createTicket },
        users: { findMany: findUsers, findFirst: findFirstUser },
      } as never,
      { sendEmail } as never,
      { get: (k: string) => env[k] } as never,
      redis as never,
    );

  beforeEach(() => {
    store = new Map();
    tickets = [];
    env = { SUPPORT_INCIDENT_EMAILS: 'soporte@quickss.test' };
    createTicket = jest.fn(async ({ data }) => {
      tickets.push(data);
      return data;
    });
    findUsers = jest.fn().mockResolvedValue([{ email: 'root@quickss.test' }]);
    findFirstUser = jest.fn().mockResolvedValue({ id: 1 });
    sendEmail = jest.fn().mockResolvedValue({ success: true });
    redis = {
      set: jest.fn(async (key: string, value: string, ...rest: unknown[]) => {
        if (rest.includes('NX') && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      del: jest.fn(async (key: string) => void store.delete(key)),
    };
  });

  it('50 concurrent reports with one dedupeKey -> 1 ticket, 1 e-mail, same number for all', async () => {
    const service = build();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => service.report(input())),
    );
    expect(createTicket).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const numbers = new Set(results.map((r) => r.ticketNumber));
    expect(numbers.size).toBe(1);
    expect(results[0].ticketNumber).toMatch(/^INC-\d{8}-[0-9A-Z]{6}$/);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results.find((r) => r.created)).toMatchObject({ emailed: 1 });
    expect(store.get('incidents:dedupe:bulk-upload-job:7')).toBe(results[0].ticketNumber);
    expect(redis.set).toHaveBeenCalledWith(
      'incidents:dedupe:bulk-upload-job:7',
      'pending',
      'EX',
      7 * 24 * 60 * 60,
      'NX',
    );
  });

  it('creates the ticket as INCIDENT with priority, tags and no stack, and mails the stack only', async () => {
    await build().report(input());
    expect(tickets[0]).toMatchObject({
      organization_id: 3,
      store_id: 9,
      created_by_user_id: 42,
      title: 'Carga masiva de productos falló',
      category: 'INCIDENT',
      priority: 'P1',
      status: 'NEW',
      source_channel: 'bulk_upload_job',
      tags: ['incident', 'bulk_upload_job', 'bulk_upload', 'products'],
    });
    expect(tickets[0].description).toContain('Tienda: Tienda Uno');
    expect(tickets[0].description).toContain('Código de error: BULK_JOB_X');
    expect(tickets[0].description).toContain('Correlación: bulk-upload-7');
    expect(tickets[0].description).not.toContain('frame0');
    const [to, subject, html, text] = sendEmail.mock.calls[0];
    expect(to).toBe('soporte@quickss.test');
    expect(subject).toBe('[Vendix] Incidente: Carga masiva de productos falló');
    expect(text).toContain('at frame9');
    expect(text).not.toContain('at frame10');
    expect(html).toContain('at frame0');
    expect(text).toContain(tickets[0].ticket_number);
  });

  it('internalDetails go only into the e-mail, never into the ticket the organization sees', async () => {
    const raw = 'Invalid `prisma.products.upsert()` invocation: connect ECONNREFUSED db-prod.internal:5432';
    await build().report(input({ internalDetails: { Mensaje: raw } }));
    expect(tickets[0].description).toContain('Archivo: productos.xlsx');
    expect(tickets[0].description).not.toContain('Mensaje');
    expect(tickets[0].description).not.toContain('db-prod.internal');
    const [, , html, text] = sendEmail.mock.calls[0];
    expect(text).toContain(`Mensaje: ${raw}`);
    expect(text).toContain('Archivo: productos.xlsx');
    expect(html).toContain('db-prod.internal:5432');
  });

  it('warning severity maps to P2', async () => {
    await build().report(input({ severity: 'warning' }));
    expect(tickets[0].priority).toBe('P2');
  });

  it('parses SUPPORT_INCIDENT_EMAILS (trim, needs @, no duplicates) and skips the super_admin lookup', async () => {
    env.SUPPORT_INCIDENT_EMAILS = ' a@q.test, b@q.test ,A@q.test,,nonsense';
    await build().report(input());
    expect(findUsers).not.toHaveBeenCalled();
    expect(sendEmail.mock.calls.map((c) => c[0])).toEqual(['a@q.test', 'b@q.test']);
  });

  it('falls back to active super_admins when the variable is empty', async () => {
    env.SUPPORT_INCIDENT_EMAILS = '';
    await build().report(input());
    expect(findUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: 'active',
          user_roles: { some: { roles: { name: 'super_admin' } } },
        }),
      }),
    );
    expect(sendEmail.mock.calls.map((c) => c[0])).toEqual(['root@quickss.test']);
  });

  it('uses the first super_admin as ticket owner when the job has no user', async () => {
    await build().report(input({ userId: null }));
    expect(tickets[0].created_by_user_id).toBe(1);
  });

  it('without any owner there is no ticket but the e-mail goes out and the key is kept', async () => {
    findFirstUser.mockResolvedValue(null);
    const result = await build().report(input({ userId: null }));
    expect(createTicket).not.toHaveBeenCalled();
    expect(result).toEqual({ ticketNumber: null, created: true, emailed: 1 });
    expect(store.get('incidents:dedupe:bulk-upload-job:7')).toBe('no-ticket');
  });

  it('retries once with a new number on P2002', async () => {
    createTicket
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
      .mockImplementation(async ({ data }) => {
        tickets.push(data);
        return data;
      });
    const result = await build().report(input());
    expect(createTicket).toHaveBeenCalledTimes(2);
    expect(result.ticketNumber).toBe(tickets[0].ticket_number);
    expect(result.created).toBe(true);
  });

  it('releases the dedupe key when neither ticket nor e-mail happened, and never throws', async () => {
    createTicket.mockRejectedValue(new Error('db down'));
    sendEmail.mockResolvedValue({ success: false, error: 'down' });
    const result = await build().report(input());
    expect(result).toEqual({ ticketNumber: null, created: false, emailed: 0 });
    expect(store.has('incidents:dedupe:bulk-upload-job:7')).toBe(false);
    expect(redis.del).toHaveBeenCalledWith('incidents:dedupe:bulk-upload-job:7');
    // The next failure can try again.
    createTicket.mockImplementation(async ({ data }) => data);
    sendEmail.mockResolvedValue({ success: true });
    expect((await build().report(input())).created).toBe(true);
  });

  it('keeps the key when the ticket failed but the e-mail was delivered', async () => {
    createTicket.mockRejectedValue(new Error('db down'));
    const result = await build().report(input());
    expect(result).toEqual({ ticketNumber: null, created: true, emailed: 1 });
    expect(store.get('incidents:dedupe:bulk-upload-job:7')).toBe('no-ticket');
  });

  it('never throws even when Redis is down', async () => {
    redis.set.mockRejectedValue(new Error('redis down'));
    await expect(build().report(input())).resolves.toEqual({
      ticketNumber: null,
      created: false,
      emailed: 0,
    });
  });
});
