import { Prisma } from '@prisma/client';
import { PlatformCrmAccountService } from './platform-crm-account.service';
import { PlatformCoveredStore } from './platform-crm-links.service';
import { PlatformCrmContext } from './platform-store.guard';

/**
 * Cuenta Vendix · movimientos de la suscripción y actividad por comercio
 * (odd/tasks/cuenta-vendix-multi-movimientos.md §3-§5, D1/D3/D4).
 *
 * Como comercial de Vendix en la tienda Vendix Platform, quiero ver en la ficha
 * del cliente las facturas, pagos y cambios de plan de todas sus cuentas, con
 * lo que ha pagado, lo que debe y cuándo renueva, y la gráfica de actividad de
 * cada comercio, para darle seguimiento sin entrar a Superadmin y sin ver nada
 * más de su negocio.
 *
 * Doble de la base: el spec comprueba qué se pide (`where`/`select`) y qué se
 * responde (conjunto exacto de llaves, candado 7 ampliado).
 */

const ctx: PlatformCrmContext = { store_id: 10, organization_id: 1, user_id: 100 };
const D = (iso: string) => new Date(iso);
const dec = (value: number) => new Prisma.Decimal(value);

const COVERED: PlatformCoveredStore[] = [
  { store_id: 201, store_name: 'Espiga Centro', organization_name: 'Panadería La Espiga', link_id: 1 },
  { store_id: 301, store_name: 'Clavo Principal', organization_name: 'Ferretería El Clavo', link_id: 2 },
];

const MOVEMENT_KEYS = [
  'amount',
  'amount_paid',
  'change_kind',
  'currency',
  'date',
  'due_at',
  'event_type',
  'failure_reason',
  'from_plan_name',
  'from_state',
  'invoice_number',
  'key',
  'payment_method',
  'state',
  'store_id',
  'store_name',
  'to_plan_name',
  'to_state',
  'total',
  'type',
];
const METRIC_KEYS = [
  'last_payment',
  'monthly_value',
  'next_renewal_at',
  'overdue_balance',
  'overdue_count',
  'total_paid',
];
const FORBIDDEN = /metadata|line_items|split_breakdown|gateway_reference|payload|partner|commission|refund_amount|SECRETO/;

function createDb() {
  const invoices = [
    {
      id: 11,
      store_id: 201,
      invoice_number: 'VX-0011',
      state: 'paid',
      total: dec(119000),
      amount_paid: dec(119000),
      currency: 'COP',
      due_at: D('2026-10-05T00:00:00Z'),
      change_kind: 'renewal',
      issued_at: D('2026-10-01T10:00:00Z'),
      created_at: D('2026-09-30T10:00:00Z'),
    },
    {
      id: 12,
      store_id: 301,
      invoice_number: 'VX-0012',
      state: 'overdue',
      total: dec(50),
      amount_paid: dec(10),
      currency: 'USD',
      due_at: D('2026-11-05T00:00:00Z'),
      change_kind: null,
      issued_at: null,
      created_at: D('2026-11-01T10:00:00Z'),
    },
  ];
  const payments = [
    {
      id: 21,
      state: 'succeeded',
      amount: dec(119000),
      currency: 'COP',
      payment_method: 'card',
      failure_reason: null,
      paid_at: D('2026-10-02T10:00:00Z'),
      created_at: D('2026-10-02T09:00:00Z'),
      invoice: { store_id: 201 },
    },
    {
      id: 22,
      state: 'refunded',
      amount: dec(119000),
      currency: 'COP',
      payment_method: 'card',
      failure_reason: null,
      paid_at: D('2026-08-02T10:00:00Z'),
      created_at: D('2026-08-02T09:00:00Z'),
      invoice: { store_id: 201 },
    },
    {
      id: 23,
      state: 'partial_refund',
      amount: dec(40),
      currency: 'USD',
      payment_method: 'card',
      failure_reason: null,
      paid_at: D('2026-09-15T10:00:00Z'),
      created_at: D('2026-09-15T09:00:00Z'),
      invoice: { store_id: 301 },
    },
    {
      id: 24,
      state: 'failed',
      amount: dec(119000),
      currency: 'COP',
      payment_method: 'card',
      failure_reason: 'x'.repeat(500),
      paid_at: null,
      created_at: D('2026-11-10T09:00:00Z'),
      invoice: { store_id: 201 },
    },
  ];
  const events = [
    {
      id: 31,
      type: 'plan_changed',
      from_state: 'active',
      to_state: 'active',
      payload: { from_plan_id: 7, to_plan_id: 8, reference: 'SECRETO', notes: 'SECRETO' },
      created_at: D('2026-11-12T09:00:00Z'),
      store_subscription: { store_id: 301 },
    },
    {
      id: 32,
      type: 'trial_ended',
      from_state: 'trial',
      to_state: 'active',
      payload: null,
      created_at: D('2026-07-01T09:00:00Z'),
      store_subscription: { store_id: 201 },
    },
  ];
  const subscriptions = [
    {
      store_id: 201,
      state: 'active',
      effective_price: dec(1200000),
      currency: 'COP',
      next_billing_at: D('2027-01-01T00:00:00Z'),
      current_period_end: D('2026-12-31T00:00:00Z'),
      plan: { name: 'Plan Pro Anual', billing_cycle: 'annual' },
    },
    {
      store_id: 301,
      state: 'grace_soft',
      effective_price: dec(30),
      currency: 'USD',
      next_billing_at: null,
      current_period_end: D('2026-11-30T00:00:00Z'),
      plan: { name: 'Plan Básico', billing_cycle: 'monthly' },
    },
  ];
  const db = {
    subscription_invoices: {
      findMany: jest.fn(async ({ where }: { where: { state?: unknown } }) =>
        where.state === 'overdue'
          ? invoices
              .filter((i) => i.state === 'overdue')
              .map(({ store_id, total, amount_paid, currency }) => ({
                store_id,
                total,
                amount_paid,
                currency,
              }))
          : invoices,
      ),
    },
    subscription_payments: {
      findMany: jest.fn(async ({ select }: { select: Record<string, unknown> }) =>
        select.metadata
          ? [{ id: 23, metadata: { refund_amount: 15, refund_result: 'success' } }]
          : payments,
      ),
    },
    subscription_events: { findMany: jest.fn(async () => events) },
    subscription_plans: {
      findMany: jest.fn(async () => [
        { id: 7, name: 'Plan Básico' },
        { id: 8, name: 'Plan Pro' },
      ]),
    },
    store_subscriptions: { findMany: jest.fn(async () => subscriptions) },
  };
  return db;
}

describe('PlatformCrmAccountService', () => {
  let db: ReturnType<typeof createDb>;
  let links: { resolveCoveredStores: jest.Mock };
  let activity: { resolveWindow: jest.Mock; getSummary: jest.Mock; getSeries: jest.Mock };
  let service: PlatformCrmAccountService;

  beforeEach(() => {
    jest.useFakeTimers({ now: D('2026-11-19T15:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    db = createDb();
    links = { resolveCoveredStores: jest.fn().mockResolvedValue(COVERED) };
    activity = {
      resolveWindow: jest.fn((from?: string, to?: string) => {
        const end = to ? new Date(`${to}T00:00:00Z`).getTime() + 86_400_000 : D('2026-11-20T00:00:00Z').getTime();
        const start = from ? new Date(`${from}T00:00:00Z`).getTime() : end - 30 * 86_400_000;
        if (start >= end) throw new Error('Invalid date range');
        return { start: new Date(start), end: new Date(end), days: Math.round((end - start) / 86_400_000) };
      }),
      getSummary: jest.fn().mockResolvedValue({
        score: 12.4,
        orders_count: 9,
        revenue_operating: 450000,
        active_users: 2,
        audit_events: 17,
        last_activity_at: '2026-11-18T20:00:00.000Z',
        // Lo que NO debe pasar al CRM aunque el servicio lo devuelva.
        slug: 'espiga',
        name: 'Espiga Centro',
      }),
      getSeries: jest.fn().mockResolvedValue({
        days: [
          { date: '2026-11-18', orders: 3, revenue_operating: 150000, audit_events: 5, logins: 1, extra: 'x' },
        ],
        by_channel: { pos: 2, ecommerce: 1 },
        by_state: { finished: 3 },
      }),
    };
    service = new PlatformCrmAccountService(
      { withoutScope: () => db } as never,
      links as never,
      activity as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('movimientos de la suscripción', () => {
    it('une facturas, pagos y eventos de todos los comercios en orden de fecha descendente', async () => {
      const view = await service.getSubscriptionMovements(ctx, 5, {});

      expect(links.resolveCoveredStores).toHaveBeenCalledWith(ctx, 5);
      expect(view.items.map((m) => m.key)).toEqual([
        'event:31',
        'payment:24',
        'invoice:12',
        'payment:21',
        'invoice:11',
        'payment:23',
        'payment:22',
        'event:32',
      ]);
      // Factura sin `issued_at` usa `created_at`; pago sin `paid_at`, `created_at`.
      expect(view.items.find((m) => m.key === 'invoice:12')!.date).toEqual(D('2026-11-01T10:00:00Z'));
      expect(view.items.find((m) => m.key === 'payment:24')!.date).toEqual(D('2026-11-10T09:00:00Z'));
      expect(view.pagination).toEqual({ page: 1, limit: 20, total: 8, has_more: false });
    });

    it('cada ítem trae exactamente las llaves fijadas, sin metadata, payload ni datos de partners (candado 7)', async () => {
      const view = await service.getSubscriptionMovements(ctx, 5, {});

      expect(Object.keys(view).sort()).toEqual(['items', 'pagination', 'stores', 'summary', 'window']);
      for (const item of view.items) {
        expect(Object.keys(item).sort()).toEqual(MOVEMENT_KEYS);
      }
      for (const store of view.stores) {
        expect(Object.keys(store).sort()).toEqual([
          'organization_name',
          'plan_name',
          'store_id',
          'store_name',
          'subscription_state',
        ]);
      }
      expect(Object.keys(view.summary).sort()).toEqual(['by_store', 'total']);
      expect(Object.keys(view.summary.total).sort()).toEqual(METRIC_KEYS);
      for (const row of view.summary.by_store) {
        expect(Object.keys(row).sort()).toEqual([...METRIC_KEYS, 'store_id'].sort());
      }
      expect(JSON.stringify(view)).not.toMatch(FORBIDDEN);
    });

    it('las consultas piden solo campos de la lista: nada de line_items, split_breakdown, gateway_reference ni metadata en el listado', async () => {
      await service.getSubscriptionMovements(ctx, 5, {});

      const selects = [
        ...db.subscription_invoices.findMany.mock.calls,
        ...db.subscription_events.findMany.mock.calls,
        ...db.subscription_payments.findMany.mock.calls.filter(
          ([args]) => !(args as { select: { metadata?: boolean } }).select.metadata,
        ),
      ].map(([args]) => Object.keys((args as { select: object }).select).join(','));
      for (const select of selects) {
        expect(select).not.toMatch(/line_items|split_breakdown|gateway_reference|metadata|partner|commission/);
      }
      // El metadata del pago solo se lee para los reembolsos parciales.
      const metadataCalls = db.subscription_payments.findMany.mock.calls.filter(
        ([args]) => (args as { select: { metadata?: boolean } }).select.metadata,
      );
      expect(metadataCalls).toHaveLength(1);
      expect(metadataCalls[0][0]).toEqual({
        where: { id: { in: [23] } },
        select: { id: true, metadata: true },
      });
      // Borradores fuera; eventos solo de la lista cerrada; todo acotado a los comercios cubiertos.
      const [invoiceArgs] = db.subscription_invoices.findMany.mock.calls[0] as [
        { where: { store_id: unknown; state: unknown } },
      ];
      expect(invoiceArgs.where.store_id).toEqual({ in: [201, 301] });
      expect(invoiceArgs.where.state).toEqual({ not: 'draft' });
      const [eventArgs] = db.subscription_events.findMany.mock.calls[0] as unknown as [
        { where: { type: { in: string[] }; store_subscription: unknown } },
      ];
      expect(eventArgs.where.type.in).not.toContain('payment_succeeded');
      expect(eventArgs.where.type.in).not.toContain('partner_commission_accrued');
      expect(eventArgs.where.store_subscription).toEqual({ store_id: { in: [201, 301] } });
    });

    it('cambio de plan: nombres del plan anterior y nuevo, sin exponer el payload', async () => {
      const view = await service.getSubscriptionMovements(ctx, 5, { type: 'event' });

      expect(view.items.map((m) => m.key)).toEqual(['event:31', 'event:32']);
      expect(view.items[0]).toMatchObject({
        type: 'event',
        event_type: 'plan_changed',
        store_name: 'Clavo Principal',
        from_plan_name: 'Plan Básico',
        to_plan_name: 'Plan Pro',
        amount: null,
        invoice_number: null,
      });
      expect(db.subscription_plans.findMany).toHaveBeenCalledWith({
        where: { id: { in: [7, 8] } },
        select: { id: true, name: true },
      });
    });

    it('el motivo de un pago fallido se recorta a texto corto', async () => {
      const view = await service.getSubscriptionMovements(ctx, 5, { type: 'payment' });
      expect(view.items.find((m) => m.key === 'payment:24')!.failure_reason).toHaveLength(140);
    });

    it('métricas: neto de reembolsos por moneda, último pago, próxima renovación, mora y valor mensual normalizado', async () => {
      const { summary } = await service.getSubscriptionMovements(ctx, 5, {});

      expect(summary.total).toEqual({
        // COP: 119000 exitoso (el reembolsado total no suma). USD: 40 − 15 parcial.
        total_paid: [
          { currency: 'COP', amount: 119000 },
          { currency: 'USD', amount: 25 },
        ],
        last_payment: {
          date: D('2026-10-02T10:00:00Z'),
          amount: 119000,
          currency: 'COP',
          store_id: 201,
        },
        // Menor de next_billing_at ?? current_period_end de las facturables.
        next_renewal_at: D('2026-11-30T00:00:00Z'),
        overdue_count: 1,
        overdue_balance: [{ currency: 'USD', amount: 40 }],
        // Anual 1.200.000 → 100.000/mes; mensual 30 USD.
        monthly_value: [
          { currency: 'COP', amount: 100000 },
          { currency: 'USD', amount: 30 },
        ],
      });
      const clavo = summary.by_store.find((s) => s.store_id === 301)!;
      expect(clavo.total_paid).toEqual([{ currency: 'USD', amount: 25 }]);
      expect(clavo.overdue_count).toBe(1);
    });

    it('comercios con su plan y estado para el filtro', async () => {
      const { stores } = await service.getSubscriptionMovements(ctx, 5, {});
      expect(stores).toEqual([
        {
          store_id: 201,
          store_name: 'Espiga Centro',
          organization_name: 'Panadería La Espiga',
          plan_name: 'Plan Pro Anual',
          subscription_state: 'active',
        },
        {
          store_id: 301,
          store_name: 'Clavo Principal',
          organization_name: 'Ferretería El Clavo',
          plan_name: 'Plan Básico',
          subscription_state: 'grace_soft',
        },
      ]);
    });

    it('filtro por comercio y paginación «ver más»', async () => {
      const first = await service.getSubscriptionMovements(ctx, 5, { store_id: 201, limit: 2 });
      expect(first.items.map((m) => m.key)).toEqual(['payment:24', 'payment:21']);
      expect(first.items.every((m) => m.store_id === 201)).toBe(true);
      expect(first.pagination).toEqual({ page: 1, limit: 2, total: 5, has_more: true });

      const last = await service.getSubscriptionMovements(ctx, 5, { store_id: 201, limit: 2, page: 3 });
      expect(last.items.map((m) => m.key)).toEqual(['event:32']);
      expect(last.pagination.has_more).toBe(false);
    });

    it('un store_id que no cubren los enlaces del cliente → 404 sin consultar suscripciones (anti-IDOR)', async () => {
      await expect(
        service.getSubscriptionMovements(ctx, 5, { store_id: 999 }),
      ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_015' });
      expect(db.subscription_invoices.findMany).not.toHaveBeenCalled();
      expect(db.subscription_payments.findMany).not.toHaveBeenCalled();
    });

    it('ventana por defecto: últimos 12 meses en UTC; rango invertido o de más de 24 meses → 400', async () => {
      const view = await service.getSubscriptionMovements(ctx, 5, {});
      expect(view.window).toEqual({ from: '2025-11-20', to: '2026-11-19' });
      const [args] = db.subscription_events.findMany.mock.calls[0] as unknown as [
        { where: { created_at: { gte: Date; lt: Date } } },
      ];
      expect(args.where.created_at).toEqual({
        gte: D('2025-11-20T00:00:00Z'),
        lt: D('2026-11-20T00:00:00Z'),
      });

      for (const query of [
        { from: '2026-11-10', to: '2026-11-01' },
        { from: '2023-01-01', to: '2026-11-01' },
        { from: '2026-02-30' },
      ]) {
        await expect(service.getSubscriptionMovements(ctx, 5, query)).rejects.toMatchObject({
          errorCode: 'PLATFORM_CRM_014',
        });
      }
    });

    it('cliente sin cuentas enlazadas → lista y métricas vacías, sin consultar suscripciones', async () => {
      links.resolveCoveredStores.mockResolvedValue([]);
      const view = await service.getSubscriptionMovements(ctx, 5, {});
      expect(view.items).toEqual([]);
      expect(view.stores).toEqual([]);
      expect(view.summary.total).toEqual({
        total_paid: [],
        last_payment: null,
        next_renewal_at: null,
        overdue_count: 0,
        overdue_balance: [],
        monthly_value: [],
      });
      expect(db.subscription_invoices.findMany).not.toHaveBeenCalled();
    });

    it('el cliente que no es del CRM plataforma propaga el 404 de los enlaces', async () => {
      links.resolveCoveredStores.mockRejectedValue(
        Object.assign(new Error('x'), { errorCode: 'PLATFORM_CRM_001' }),
      );
      await expect(service.getSubscriptionMovements(ctx, 99, {})).rejects.toMatchObject({
        errorCode: 'PLATFORM_CRM_001',
      });
    });
  });

  describe('actividad por comercio', () => {
    it('devuelve resumen y series con llaves fijas, sin timeline ni identidad de la tienda', async () => {
      const view = await service.getStoreActivity(ctx, 5, 301, {});

      expect(activity.getSeries).toHaveBeenCalledWith(301, { from: '2026-10-21', to: '2026-11-19' });
      expect(activity.getSummary).toHaveBeenCalledWith(301, expect.objectContaining({ days: 30 }));
      expect(Object.keys(view).sort()).toEqual(['series', 'store', 'summary', 'window']);
      expect(view.store).toEqual({
        store_id: 301,
        store_name: 'Clavo Principal',
        organization_name: 'Ferretería El Clavo',
      });
      expect(view.window).toEqual({ from: '2026-10-21', to: '2026-11-19', days: 30 });
      expect(Object.keys(view.summary).sort()).toEqual([
        'active_users',
        'audit_events',
        'last_activity_at',
        'orders_count',
        'revenue_operating',
        'score',
      ]);
      expect(Object.keys(view.series).sort()).toEqual(['by_channel', 'by_state', 'days']);
      expect(Object.keys(view.series.days[0]).sort()).toEqual([
        'audit_events',
        'date',
        'logins',
        'orders',
        'revenue_operating',
      ]);
      expect(view.series.by_channel).toEqual({ pos: 2, ecommerce: 1 });
      expect(JSON.stringify(view)).not.toMatch(/timeline|order_number|email|slug|extra/);
    });

    it('comercio que no cubren los enlaces del cliente → 404 sin leer actividad', async () => {
      await expect(service.getStoreActivity(ctx, 5, 999, {})).rejects.toMatchObject({
        errorCode: 'PLATFORM_CRM_015',
      });
      expect(activity.getSeries).not.toHaveBeenCalled();
      expect(activity.getSummary).not.toHaveBeenCalled();
    });

    it('ventana de más de 180 días o rango inválido → 400; 180 justos pasa', async () => {
      await expect(
        service.getStoreActivity(ctx, 5, 201, { from: '2026-01-01', to: '2026-11-19' }),
      ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_014' });
      await expect(
        service.getStoreActivity(ctx, 5, 201, { from: '2026-11-19', to: '2026-11-01' }),
      ).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_014' });
      expect(activity.getSeries).not.toHaveBeenCalled();

      const view = await service.getStoreActivity(ctx, 5, 201, { from: '2026-05-24', to: '2026-11-19' });
      expect(view.window.days).toBe(180);
    });
  });
});
