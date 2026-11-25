import { RequestContextService } from '../context/request-context.service';
import { withJobOrigin } from '../queue/job-origin';
import { contextLines, scopeLabelOf, type AlertNames } from './platform-alert-format';
import { jobContext } from './platform-alert-job-watcher.service';
import { PlatformAlertService } from './platform-alert.service';
import type { PlatformAlertRow, PlatformAlertEvent } from './platform-alert.types';

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
        if ('notIn' in cond) return !cond.notIn.includes(value);
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

/**
 * Redis con `SET NX` real solo para la llave del «Límite de plan»; el resto
 * (ventana de edición de Telegram) siempre gana, como antes.
 */
function fakeRedis() {
  const keys = new Set<string>();
  return {
    keys,
    set: jest.fn(async (key: string) => {
      if (!key.startsWith('monitor:plan-limit:')) return 'OK';
      if (keys.has(key)) return null;
      keys.add(key);
      return 'OK';
    }),
  };
}

/** Resolutor de nombres de prueba: los nombres de `names`, el resto con ids. */
function fakeContext(names: AlertNames) {
  return {
    resolve: jest.fn(async (alert: PlatformAlertRow) => ({
      lines: contextLines(alert, names),
      scopeLabel: scopeLabelOf(alert, names),
      superadminUrl: `https://vendix.com/super-admin/monitoring/alerts?alert=${alert.id}`,
    })),
  };
}

const NAMES: AlertNames = {
  stores: new Map([[105, { name: 'Vendix Granizzo', slug: 'testbalmes' }]]),
  organizations: new Map([[82, 'Demo Vendix']]),
  users: new Map([[7, { name: 'Ana Pérez', email: 'ana.perez@vendix.test' }]]),
  entityName: 'Kit de freno NKD',
  plan: 'Pro (pro) · estado active',
  quota: '1.000 de 1.000 indexación para la búsqueda con IA (este mes)',
};

describe('PlatformAlertService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let report: jest.Mock;
  let send: jest.Mock;
  let edit: jest.Mock;
  let env: Record<string, string>;
  let ticketSeq: number;
  let redis: ReturnType<typeof fakeRedis>;
  let alertContext: { resolve: jest.Mock };

  const build = () =>
    new PlatformAlertService(
      prisma as never,
      { report } as never,
      { getPlatformOrganizationId: jest.fn().mockResolvedValue(1) } as never,
      { send, edit, isEnabled: () => true } as never,
      { get: (k: string) => env[k] } as never,
      redis as never,
      alertContext as never,
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
    redis = fakeRedis();
    alertContext = fakeContext({});
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

  it('una respuesta lenta de tienda lleva tienda, usuario, petición y parámetros aunque el ALS esté vacío', async () => {
    alertContext = fakeContext(NAMES);
    const service = build();

    service.captureSlowRequest({
      method: 'POST',
      route: '/api/store/invoicing/orders/:orderId/emit',
      durationMs: 60_990,
      statusCode: 200,
      organizationId: 82,
      storeId: 105,
      userId: 7,
      requestId: 'req-slow-1',
      params: { orderId: '987' },
    });
    await service.flush();

    const stored = prisma.rows[0] as unknown as {
      store_id: number;
      organization_id: number;
      details: Record<string, unknown>;
    };
    expect(stored.store_id).toBe(105);
    expect(stored.organization_id).toBe(82);
    expect(stored.details['Parámetros']).toBe('orderId=987');
    expect(stored.details['Petición (id)']).toBe('req-slow-1');
    expect(JSON.stringify(stored.details)).toContain('"userId":7');
    // El mensaje ya resuelve nombres: tienda y ejecutor visibles.
    const text = send.mock.calls[0][0] as string;
    expect(text).toContain('Vendix Granizzo');
    expect(text).toContain('Ana Pérez');
    expect(text).toContain('orderId=987');
  });

  it('un 5xx de tienda usa la identidad explícita del request', async () => {
    const service = build();
    service.captureHttpFailure(
      http500('/api/store/invoicing/orders/:orderId/emit', {
        organizationId: 82,
        storeId: 105,
        userId: 7,
        params: { orderId: '987' },
      }),
    );
    await service.flush();
    const stored = prisma.rows[0] as unknown as { store_id: number; details: Record<string, unknown> };
    expect(stored.store_id).toBe(105);
    expect(stored.details['Parámetros']).toBe('orderId=987');
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

  it('al apagar vacía también lo capturado durante un vaciado en curso', async () => {
    const service = build();
    service.captureHttpFailure(http500('/api/store/products/:id'));
    const inFlight = service.flush();
    service.captureHttpFailure(http500('/api/store/customers/:id'));
    await service.onModuleDestroy();
    await inFlight;
    expect(prisma.rows.map((r) => r.process).sort()).toEqual([
      'POST /store/customers/:id',
      'POST /store/products/:id',
    ]);
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
  describe('QUI-1031: contexto legible y «Límite de plan»', () => {
    /** El trabajo real del ticket: ai-embedding/embed de un producto, tienda 105, sin cupo. */
    const quotaJob = (over: Partial<PlatformAlertEvent> = {}, data: Record<string, unknown> = {}): PlatformAlertEvent => {
      const jobData = withJobOrigin(
        { store_id: 105, organization_id: 82, entity_type: 'product', entity_id: 123, ...data },
        'event:product.updated',
        7,
      );
      return {
        source: 'job',
        process: 'cola ai-embedding · embed',
        errorType: 'job_failed',
        severity: 'warning',
        title: 'Trabajo fallido en la cola ai-embedding',
        message: 'Error: AI quota exceeded for this billing period',
        details: { Cola: 'ai-embedding', Trabajo: 'embed' },
        storeId: 105,
        organizationId: 82,
        context: jobContext('ai-embedding', { name: 'embed', data: jobData }),
        occurredAt: new Date('2026-11-10T15:00:00Z'),
        ...over,
      };
    };

    it('el cupo de IA agotado llega como «Límite de plan» informativo, con nombres, módulo, registro, plan y cupo; sin ticket', async () => {
      alertContext = fakeContext(NAMES);
      const service = build();
      service.capture(quotaJob());
      await service.flush();

      expect(prisma.rows).toHaveLength(1);
      expect(prisma.rows[0]).toMatchObject({
        severity: 'info',
        error_type: 'SUBSCRIPTION_006',
        title: 'Límite de plan: la tienda agotó el cupo de IA de su plan en el periodo',
      });
      expect(report).not.toHaveBeenCalled();
      const text: string = send.mock.calls[0][0];
      expect(text).toContain('<b>LÍMITE DE PLAN</b> · Informativa');
      expect(text).not.toContain('LEVE');
      expect(text).toContain('<b>Tienda:</b> Vendix Granizzo (testbalmes, id 105)');
      expect(text).toContain('<b>Organización:</b> Demo Vendix (id 82)');
      expect(text).toContain('<b>Usuario:</b> Ana Pérez · ana.perez@vendix.test (id 7)');
      expect(text).toContain('<b>Módulo:</b> Productos');
      expect(text).toContain('<b>Acción:</b> indexar el producto para la búsqueda con IA');
      expect(text).toContain('<b>Registro:</b> producto «Kit de freno NKD» (id 123)');
      expect(text).toContain('<b>Origen:</b> Evento product.updated');
      expect(text).toContain('<b>Plan:</b> Pro (pro) · estado active');
      expect(text).toContain('<b>Cupo:</b> 1.000 de 1.000');
      expect(text).toContain('href="https://vendix.com/super-admin/monitoring/alerts?alert=1"');
      // Solo ids en la base: los nombres se resuelven al mostrar.
      expect(prisma.rows[0].details).toMatchObject({
        _context: {
          userId: 7,
          module: 'Productos',
          entityType: 'product',
          entityId: 123,
          category: 'plan_limit',
          planLimitCode: 'SUBSCRIPTION_006',
          aiFeature: 'rag_embeddings',
          period: '202611',
        },
        'Error original': 'Error: AI quota exceeded for this billing period',
      });
      expect(JSON.stringify(prisma.rows[0])).not.toContain('Granizzo');
    });

    it('una vez por tienda y periodo: no escala, no se cierra a los 30 min, no reavisa al reabrirse; otra tienda u otro mes sí', async () => {
      env.MONITOR_ESCALATE_AFTER = '3';
      const service = build();
      for (let i = 0; i < 5; i++) {
        service.capture(quotaJob({}, { entity_type: i % 2 ? 'customer' : 'product' }));
        await service.flush();
      }
      expect(prisma.rows).toHaveLength(1);
      expect(prisma.rows[0]).toMatchObject({ severity: 'info', occurrences: 5, escalated_at: null });
      expect(send).toHaveBeenCalledTimes(1);
      expect(report).not.toHaveBeenCalled();

      await service.sweepOpenAlerts(new Date('2026-11-10T16:00:00Z'));
      expect(prisma.rows[0].status).toBe('open');

      await service.resolve(1, 'manual', 9);
      service.capture(quotaJob());
      await service.flush();
      expect(prisma.rows).toHaveLength(2);
      expect(send.mock.calls.filter(([text]) => text.includes('LÍMITE DE PLAN'))).toHaveLength(1);

      service.capture(quotaJob({ storeId: 106 }));
      service.capture(quotaJob({ occurredAt: new Date('2026-12-01T00:10:00Z') }));
      await service.flush();
      expect(send.mock.calls.filter(([text]) => text.includes('LÍMITE DE PLAN'))).toHaveLength(3);

      await service.sweepOpenAlerts(new Date('2026-12-02T00:00:00Z'));
      const novemberOpen = prisma.rows.filter(
        (r) => r.status === 'open' && (r.details as any)._context.period === '202611',
      );
      expect(novemberOpen).toHaveLength(0);
      expect(prisma.rows.find((r) => (r.details as any)._context.period === '202612')!.status).toBe('open');
    });

    it('HTTP: usuario de la petición y módulo/acción de la ruta, con el mismo formato en Telegram y en el ticket', async () => {
      alertContext = fakeContext(NAMES);
      const service = build();
      RequestContextService.runIsolated(
        { user_id: 7, store_id: 105, organization_id: 82, is_super_admin: false, is_owner: true },
        () => service.captureHttpFailure(http500('/api/store/orders/:id/payments')),
      );
      await service.flush();

      const text: string = send.mock.calls[0][0];
      for (const line of [
        '<b>Tienda:</b> Vendix Granizzo (testbalmes, id 105)',
        '<b>Usuario:</b> Ana Pérez · ana.perez@vendix.test (id 7)',
        '<b>Módulo:</b> Ventas',
        '<b>Acción:</b> crear pagos',
      ]) {
        expect(text).toContain(line);
      }
      const details = report.mock.calls[0][0].details;
      expect(details).toMatchObject({
        Tienda: 'Vendix Granizzo (testbalmes, id 105)',
        Organización: 'Demo Vendix (id 82)',
        Usuario: 'Ana Pérez · ana.perez@vendix.test (id 7)',
        Módulo: 'Ventas',
        Acción: 'crear pagos',
        'Ver en Superadmin': 'https://vendix.com/super-admin/monitoring/alerts?alert=1',
      });
      expect(Object.keys(details).slice(0, 2)).toEqual(['Tienda', 'Organización']);
      expect(details).not.toHaveProperty('Afecta a');
    });

    it('si la resolución de nombres falla, la alerta sale igual con ids (Telegram y ticket)', async () => {
      alertContext = { resolve: jest.fn().mockRejectedValue(new Error('db lenta')) };
      const service = build();
      RequestContextService.runIsolated(
        { user_id: 7, store_id: 105, organization_id: 82, is_super_admin: false, is_owner: true },
        () => service.captureHttpFailure(http500()),
      );
      await service.flush();

      expect(prisma.rows).toHaveLength(1);
      const text: string = send.mock.calls[0][0];
      expect(text).toContain('<b>Tienda:</b> id 105');
      expect(text).toContain('<b>Usuario:</b> id 7');
      expect(text).toContain('<b>Módulo:</b> Ventas');
      expect(report.mock.calls[0][0].details).toMatchObject({ Tienda: 'id 105', 'Ver en Superadmin': null });
    });

    it('incidente de carga masiva: módulo y usuario del incidente', async () => {
      const service = build();
      service.onIncidentReported({
        input: {
          dedupeKey: 'bulk-upload-job:8',
          source: 'bulk_upload_job',
          severity: 'critical',
          title: 'Carga masiva de productos falló',
          summary: 'x',
          organizationId: 3,
          storeId: 9,
          userId: 11,
          tags: ['bulk_upload', 'products'],
        },
        result: { ticketNumber: 'INC-BULK', created: true, emailed: 1 },
      });
      await service.flush();
      expect(prisma.rows[0].details).toMatchObject({ _context: { userId: 11, module: 'Cargas masivas' } });
    });
  });
});
