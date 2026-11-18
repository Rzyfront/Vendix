import { PlatformAlertService } from './platform-alert.service';
import type { PlatformAlertRow } from './platform-alert.types';

type Row = PlatformAlertRow & { created_at?: Date; updated_at?: Date };

/** `platform_alerts` en memoria con el índice único parcial (una abierta por huella). */
function fakePrisma() {
  const rows: Row[] = [];
  let seq = 0;
  const match = (row: Row, where: Record<string, any> = {}) =>
    Object.entries(where).every(([key, cond]) => {
      const value = (row as any)[key];
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        if ('lt' in cond) return typeof value === 'number' || value instanceof Date ? value < cond.lt : false;
        if ('in' in cond) return cond.in.includes(value);
        if ('not' in cond) return value !== cond.not;
      }
      return value === cond;
    });
  const apply = (row: Row, data: Record<string, any>) => {
    for (const [key, value] of Object.entries(data)) {
      (row as any)[key] =
        value && typeof value === 'object' && 'increment' in value
          ? (row as any)[key] + value.increment
          : value;
    }
    return { ...row };
  };
  const tickets = new Map<string, { id: number; ticket_number: string; description: string; status: string }>();
  return {
    rows,
    tickets,
    platform_alerts: {
      findFirst: jest.fn(async ({ where }) => {
        const row = rows.find((r) => match(r, where));
        return row ? { ...row } : null;
      }),
      findUnique: jest.fn(async ({ where }) => {
        const row = rows.find((r) => r.id === where.id);
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async ({ where }) => rows.filter((r) => match(r, where)).map((r) => ({ ...r }))),
      create: jest.fn(async ({ data }) => {
        if (rows.some((r) => r.status === 'open' && r.fingerprint === data.fingerprint)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = {
          id: ++seq,
          details: null,
          escalated_at: null,
          resolved_at: null,
          resolution: null,
          resolved_by_user_id: null,
          telegram_message_id: null,
          notified_occurrences: 0,
          ...data,
        } as Row;
        rows.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }) => apply(rows.find((r) => r.id === where.id)!, data)),
      updateMany: jest.fn(async ({ where, data }) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => apply(r, data));
        return { count: hit.length };
      }),
    },
    support_tickets: {
      findUnique: jest.fn(async ({ where }) => tickets.get(where.ticket_number) ?? null),
      update: jest.fn(async ({ where, data }) => {
        const t = [...tickets.values()].find((x) => x.id === where.id)!;
        Object.assign(t, data);
        return t;
      }),
      findMany: jest.fn(async ({ where }) =>
        [...tickets.values()].filter(
          (t) => where.ticket_number.in.includes(t.ticket_number) && where.status.in.includes(t.status),
        ),
      ),
    },
  };
}

describe('PlatformAlertService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let report: jest.Mock;
  let send: jest.Mock;
  let edit: jest.Mock;
  let env: Record<string, string>;
  let ticketSeq: number;

  const build = () =>
    new PlatformAlertService(
      prisma as never,
      { report } as never,
      { getPlatformOrganizationId: jest.fn().mockResolvedValue(1) } as never,
      { send, edit, isEnabled: () => true } as never,
      { get: (k: string) => env[k] } as never,
      { set: jest.fn().mockResolvedValue('OK') } as never,
    );

  const http500 = (route = '/api/store/orders/:id', over: Record<string, unknown> = {}) => ({
    method: 'POST',
    route,
    status: 500,
    error: new Error('db exploded for ana@correo.com password=xyz'),
    ...over,
  });

  beforeEach(() => {
    prisma = fakePrisma();
    ticketSeq = 0;
    env = { MONITOR_ENV_LABEL: 'staging' };
    report = jest.fn(async (input) => {
      const ticketNumber = `INC-TEST-${++ticketSeq}`;
      prisma.tickets.set(ticketNumber, {
        id: ticketSeq,
        ticket_number: ticketNumber,
        description: `x\nRepeticiones: ${input.details.Repeticiones}\ny`,
        status: 'OPEN',
      });
      return { ticketNumber, created: true, emailed: 1 };
    });
    send = jest.fn().mockResolvedValue('555');
    edit = jest.fn().mockResolvedValue(true);
  });

  it('falla leve: registra con proceso, tipo y gravedad y avisa solo por Telegram (sin ticket ni correo)', async () => {
    const service = build();
    service.captureHttpFailure(http500('/api/store/products/:id'));
    await service.flush();

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toMatchObject({
      source: 'http',
      process: 'POST /store/products/:id',
      error_type: 'HTTP_500',
      severity: 'warning',
      status: 'open',
      occurrences: 1,
      telegram_message_id: '555',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain('LEVE');
    expect(report).not.toHaveBeenCalled();
  });

  it('falla grave: Telegram + un ticket/correo por PlatformIncidentService, con el número en la alerta', async () => {
    const service = build();
    service.captureHttpFailure(http500());
    await service.flush();

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({
      source: 'api_monitor',
      severity: 'critical',
      organizationId: 1,
    });
    expect(prisma.rows[0]).toMatchObject({ severity: 'critical', ticket_number: 'INC-TEST-1' });
    expect(send.mock.calls[0][0]).toContain('GRAVE');
  });

  it('la misma falla grave repetida: una sola alerta, un solo ticket, conteo en la alerta, en el ticket y en Telegram', async () => {
    const service = build();
    service.captureHttpFailure(http500());
    await service.flush();
    for (let i = 0; i < 4; i++) service.captureHttpFailure(http500());
    await service.flush();
    service.captureHttpFailure(http500());
    await service.flush();

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].occurrences).toBe(6);
    expect(report).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalled();
    expect(edit.mock.calls.at(-1)[1]).toContain('Veces:</b> 6');
    expect(prisma.tickets.get('INC-TEST-1')!.description).toContain('Repeticiones: 6');
  });

  it('nunca guarda ni envía correos ni contraseñas del mensaje de error', async () => {
    const service = build();
    service.captureHttpFailure(http500());
    await service.flush();
    const stored = JSON.stringify(prisma.rows[0]);
    expect(stored).not.toContain('ana@correo.com');
    expect(stored).not.toContain('xyz');
    expect(send.mock.calls[0][0]).not.toContain('ana@correo.com');
    expect(JSON.stringify(report.mock.calls[0][0])).not.toContain('ana@correo.com');
  });

  it('una leve que se repite MONITOR_ESCALATE_AFTER veces sube a grave: aviso, ticket y correo una vez', async () => {
    env.MONITOR_ESCALATE_AFTER = '3';
    const service = build();
    for (let i = 0; i < 5; i++) {
      service.captureHttpFailure(http500('/api/store/products/:id'));
      await service.flush();
    }
    expect(prisma.rows[0]).toMatchObject({ severity: 'critical', occurrences: 5 });
    expect(prisma.rows[0].escalated_at).toBeInstanceOf(Date);
    expect(report).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.some(([text]) => text.includes('SUBIÓ A GRAVE'))).toBe(true);
  });

  it('incidente de QUI-1009/1020: registra y manda a Telegram sin abrir otro ticket', async () => {
    const service = build();
    service.onIncidentReported({
      input: {
        dedupeKey: 'bulk-upload-job:7',
        source: 'bulk_upload_job',
        severity: 'critical',
        title: 'Carga masiva falló',
        summary: 'Lote 2 falló',
        organizationId: 3,
        storeId: 9,
        userId: 1,
      },
      result: { ticketNumber: 'INC-BULK', created: true, emailed: 1 },
    });
    await service.flush();
    expect(report).not.toHaveBeenCalled();
    expect(prisma.rows[0]).toMatchObject({
      source: 'incident',
      severity: 'critical',
      ticket_number: 'INC-BULK',
      store_id: 9,
      organization_id: 3,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('ignora el evento de los incidentes que abrió el propio bot', async () => {
    const service = build();
    service.onIncidentReported({
      input: { source: 'api_monitor' } as never,
      result: { ticketNumber: 'X', created: true, emailed: 0 },
    });
    await service.flush();
    expect(prisma.rows).toHaveLength(0);
  });

  it('latencia: informativa solo por encima del umbral', async () => {
    env.MONITOR_SLOW_REQUEST_MS = '1000';
    const service = build();
    service.captureSlowRequest({ method: 'GET', route: '/api/store/reports', durationMs: 900 });
    service.captureSlowRequest({ method: 'GET', route: '/api/store/reports', durationMs: 1500 });
    await service.flush();
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toMatchObject({ severity: 'info', error_type: 'slow_request' });
    expect(report).not.toHaveBeenCalled();
  });

  it('S6: una grave que deja de repetirse se cierra sola y avisa la resolución en Telegram', async () => {
    const service = build();
    service.captureHttpFailure(http500());
    await service.flush();
    await service.sweepOpenAlerts(new Date(Date.now() + 31 * 60_000));
    expect(prisma.rows[0]).toMatchObject({ status: 'resolved', resolution: 'auto_quiet' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toContain('RESUELTA');
    expect(send.mock.calls[1][1]).toEqual({ replyToMessageId: '555' });
  });

  it('se cierra cuando soporte resuelve su ticket, y una nueva falla abre otro episodio', async () => {
    const service = build();
    service.captureHttpFailure(http500());
    await service.flush();
    prisma.tickets.get('INC-TEST-1')!.status = 'RESOLVED';
    await service.sweepOpenAlerts();
    expect(prisma.rows[0]).toMatchObject({ status: 'resolved', resolution: 'ticket_closed' });

    service.captureHttpFailure(http500());
    await service.flush();
    expect(prisma.rows).toHaveLength(2);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('resolución manual avisa también las leves y solo la primera vez', async () => {
    const service = build();
    service.captureHttpFailure(http500('/api/store/products/:id'));
    await service.flush();
    await service.resolve(1, 'manual', 9);
    await service.resolve(1, 'manual', 9);
    expect(prisma.rows[0]).toMatchObject({ status: 'resolved', resolved_by_user_id: 9 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('dos procesos abren la misma huella a la vez: el índice único deja una sola alerta', async () => {
    const service = build();
    const original = prisma.platform_alerts.findFirst.getMockImplementation()!;
    prisma.platform_alerts.findFirst.mockImplementationOnce(async () => {
      await prisma.platform_alerts.create({
        data: { fingerprint: (await import('./platform-alert-sanitize')).fingerprintOf('http|POST /store/orders/:id|HTTP_500'), status: 'open', occurrences: 1, affected_store_ids: [], last_seen_at: new Date(0), severity: 'critical', source: 'http' },
      });
      return null;
    });
    service.captureHttpFailure(http500());
    await service.flush();
    prisma.platform_alerts.findFirst.mockImplementation(original);
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].occurrences).toBe(2);
  });

  it('alerta de prueba grave: queda registrada, con ticket y Telegram', async () => {
    const result = await build().sendTestAlert('critical', 4);
    expect(result.opened).toBe(true);
    expect(result.alert).toMatchObject({
      source: 'test',
      severity: 'critical',
      ticket_number: 'INC-TEST-1',
      telegram_message_id: '555',
    });
  });

  it('MONITOR_ENABLED=false no captura nada', async () => {
    env.MONITOR_ENABLED = 'false';
    const service = build();
    service.captureHttpFailure(http500());
    await service.flush();
    expect(prisma.rows).toHaveLength(0);
  });

  it('nunca lanza aunque la base falle', async () => {
    prisma.platform_alerts.findFirst.mockRejectedValue(new Error('db down'));
    const service = build();
    expect(() => service.captureHttpFailure(http500())).not.toThrow();
    await expect(service.flush()).resolves.toBeUndefined();
  });
});
