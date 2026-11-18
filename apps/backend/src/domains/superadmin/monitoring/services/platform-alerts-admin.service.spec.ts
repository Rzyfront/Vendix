import {
  contextLines,
  scopeLabelOf,
  type AlertNames,
} from '../../../../common/platform-alerts/platform-alert-format';
import { PlatformAlertsAdminService } from './platform-alerts-admin.service';

const NAMES: AlertNames = {
  stores: new Map([[9, { name: 'Vendix Granizzo', slug: 'testbalmes' }]]),
  organizations: new Map([[3, 'Demo Vendix']]),
  users: new Map([[7, { name: 'Ana Pérez', email: 'ana.perez@vendix.test' }]]),
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  fingerprint: 'f',
  source: 'http',
  process: 'POST /store/orders/:id',
  error_type: 'HTTP_500',
  severity: 'critical',
  status: 'open',
  title: 'Error 500 en ventas',
  message: 'Error: boom',
  details: { 'Código HTTP': 500 },
  organization_id: 3,
  store_id: 9,
  affected_store_ids: [9],
  occurrences: 4,
  notified_occurrences: 4,
  first_seen_at: new Date('2026-11-17T10:00:00Z'),
  last_seen_at: new Date('2026-11-17T10:05:00Z'),
  escalated_at: null,
  resolved_at: null,
  resolution: null,
  resolved_by_user_id: null,
  ticket_number: 'INC-1',
  telegram_message_id: '55',
  ...over,
});

describe('PlatformAlertsAdminService (S5: vista en Superadmin)', () => {
  let prisma: any;
  let alerts: { resolve: jest.Mock; sendTestAlert: jest.Mock };
  let resolveMany: jest.Mock;
  const build = () =>
    new PlatformAlertsAdminService(
      prisma,
      alerts as never,
      { isEnabled: () => true } as never,
      { resolveRecipients: jest.fn().mockResolvedValue(['a@b.co', 'c@d.co']) } as never,
      { resolveMany } as never,
    );

  beforeEach(() => {
    prisma = {
      platform_alerts: {
        findMany: jest.fn().mockResolvedValue([row()]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(row()),
        groupBy: jest.fn().mockResolvedValue([
          { severity: 'critical', _count: { _all: 2 } },
          { severity: 'warning', _count: { _all: 5 } },
        ]),
      },
      support_tickets: {
        findMany: jest.fn().mockResolvedValue([{ ticket_number: 'INC-1', status: 'IN_PROGRESS' }]),
      },
    };
    resolveMany = jest.fn(async (rows: any[]) =>
      rows.map((r) => ({
        lines: contextLines(r, NAMES),
        scopeLabel: scopeLabelOf(r, NAMES),
        superadminUrl: null,
      })),
    );
    alerts = {
      resolve: jest.fn().mockResolvedValue(row({ status: 'resolved', resolution: 'manual' })),
      sendTestAlert: jest.fn().mockResolvedValue({ alert: row({ id: 8, ticket_number: 'INC-9', occurrences: 2 }), opened: false }),
    };
  });

  it('lista con filtros, paginación y el estado del ticket', async () => {
    const result = await build().list({ status: 'open', severity: 'critical', source: 'http', search: ' orders ', page: 2, limit: 10 });
    const args = prisma.platform_alerts.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ status: 'open', severity: 'critical', source: 'http' });
    expect(args.where.OR[0]).toEqual({ title: { contains: 'orders', mode: 'insensitive' } });
    expect(args).toMatchObject({ skip: 10, take: 10 });
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({ ticket_number: 'INC-1', ticket_status: 'IN_PROGRESS', telegram_sent: true });
    expect(result.data[0]).not.toHaveProperty('fingerprint');
    expect(result.data[0]).not.toHaveProperty('telegram_message_id');
  });

  it('status=all no filtra por estado', async () => {
    await build().list({ status: 'all' });
    expect(prisma.platform_alerts.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('stats: abiertas por gravedad, últimas 24 h, Telegram y destinatarios', async () => {
    expect(await build().stats()).toEqual({
      open_critical: 2,
      open_warning: 5,
      open_info: 0,
      last_24h: 1,
      telegram_enabled: true,
      email_recipients: 2,
    });
  });

  it('detalle inexistente → SYS_NOT_FOUND_001', async () => {
    prisma.platform_alerts.findUnique.mockResolvedValue(null);
    await expect(build().findOne(99)).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
  });

  it('resolver a mano pasa el usuario y devuelve la alerta resuelta', async () => {
    const view = await build().resolve(1, 7);
    expect(alerts.resolve).toHaveBeenCalledWith(1, 'manual', 7);
    expect(view).toMatchObject({ status: 'resolved', resolution: 'manual' });
  });

  it('alerta de prueba devuelve id, conteo, ticket y si salió a Telegram', async () => {
    expect(await build().sendTest({ severity: 'critical' }, 7)).toEqual({
      alert_id: 8,
      occurrences: 2,
      ticket_number: 'INC-9',
      telegram_sent: true,
    });
    expect(alerts.sendTestAlert).toHaveBeenCalledWith('critical', 7);
  });

  it('QUI-1031: el detalle trae las mismas líneas que Telegram, la clase «Límite de plan» y los detalles sin el contexto interno', async () => {
    prisma.platform_alerts.findUnique.mockResolvedValue(
      row({
        severity: 'info',
        source: 'job',
        error_type: 'SUBSCRIPTION_006',
        ticket_number: null,
        details: {
          'Error original': 'Error: AI quota exceeded for this billing period',
          _context: { userId: 7, module: 'Productos', category: 'plan_limit', planLimitCode: 'SUBSCRIPTION_006' },
        },
      }),
    );
    const view = await build().findOne(1);
    expect(view).toMatchObject({
      scope_label: 'Vendix Granizzo (testbalmes, id 9)',
      category: 'plan_limit',
      kind_label: 'Límite de plan',
      details: { 'Error original': 'Error: AI quota exceeded for this billing period' },
    });
    expect(view.details).not.toHaveProperty('_context');
    expect(view.context.slice(0, 4)).toEqual([
      { label: 'Tienda', value: 'Vendix Granizzo (testbalmes, id 9)' },
      { label: 'Organización', value: 'Demo Vendix (id 3)' },
      { label: 'Usuario', value: 'Ana Pérez · ana.perez@vendix.test (id 7)' },
      { label: 'Módulo', value: 'Productos' },
    ]);
  });

  it('QUI-1031: si el resolutor de nombres falla, la lista sale igual con ids', async () => {
    resolveMany.mockRejectedValue(new Error('db lenta'));
    const result = await build().list({});
    expect(result.data[0]).toMatchObject({ scope_label: 'id 9', category: null, kind_label: 'Petición fallida' });
    expect(result.data[0].context[0]).toEqual({ label: 'Tienda', value: 'id 9' });
  });
});
