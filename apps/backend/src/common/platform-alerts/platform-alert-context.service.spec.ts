import { PlatformAlertContextService } from './platform-alert-context.service';
import type { PlatformAlertRow } from './platform-alert.types';

type AlertLike = Pick<
  PlatformAlertRow,
  'id' | 'organization_id' | 'store_id' | 'affected_store_ids' | 'details'
>;

const alert = (over: Partial<AlertLike> = {}): AlertLike => ({
  id: 41,
  organization_id: 82,
  store_id: 105,
  affected_store_ids: [105],
  details: {
    _context: {
      userId: 7,
      module: 'Productos',
      action: 'indexar el producto para la búsqueda con IA',
      entityType: 'product',
      entityId: 123,
    },
  },
  ...over,
});

const planLimitAlert = (): AlertLike =>
  alert({
    details: {
      _context: {
        category: 'plan_limit',
        planLimitCode: 'SUBSCRIPTION_006',
        aiFeature: 'rag_embeddings',
        period: '202611',
      },
    },
  });

function fakePrisma() {
  return {
    stores: {
      findMany: jest.fn(async () => [{ id: 105, name: 'Vendix Granizzo', slug: 'testbalmes' }]),
    },
    organizations: { findMany: jest.fn(async () => [{ id: 82, name: 'Demo Vendix' }]) },
    users: {
      findMany: jest.fn(async () => [
        { id: 7, first_name: 'Ana', last_name: 'Pérez', username: 'ana', email: 'ana.perez@vendix.test' },
      ]),
      findFirst: jest.fn(),
    },
    products: { findFirst: jest.fn(async () => ({ name: 'Kit de freno NKD' })) },
    store_subscriptions: {
      findFirst: jest.fn(async () => ({ state: 'active', plan: { name: 'Pro', code: 'pro' } })),
    },
  };
}

describe('PlatformAlertContextService (QUI-1031)', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let usage: { getAIUsageSnapshot: jest.Mock };
  let env: Record<string, string>;

  const build = () =>
    new PlatformAlertContextService(
      prisma as never,
      { get: (key: string) => env[key] } as never,
      { get: jest.fn(() => usage) } as never,
    );

  beforeEach(() => {
    prisma = fakePrisma();
    env = { FRONTEND_URL: 'https://vendix.com/' };
    usage = {
      getAIUsageSnapshot: jest.fn(async () => ({
        rag_embeddings: { used: 1000, cap: 1000, period: 'monthly' },
        text_generation: { used: 3, cap: 500, period: 'monthly' },
      })),
    };
  });

  it('nombra tienda (nombre + slug), organización, usuario (nombre + correo) y registro, con el id al final, y enlaza a Superadmin', async () => {
    const resolved = await build().resolve(alert());
    expect(resolved.lines).toEqual([
      { label: 'Tienda', value: 'Vendix Granizzo (testbalmes, id 105)' },
      { label: 'Organización', value: 'Demo Vendix (id 82)' },
      { label: 'Usuario', value: 'Ana Pérez · ana.perez@vendix.test (id 7)' },
      { label: 'Módulo', value: 'Productos' },
      { label: 'Acción', value: 'indexar el producto para la búsqueda con IA' },
      { label: 'Registro', value: 'producto «Kit de freno NKD» (id 123)' },
    ]);
    expect(resolved.scopeLabel).toBe('Vendix Granizzo (testbalmes, id 105)');
    expect(resolved.superadminUrl).toBe('https://vendix.com/super-admin/monitoring/alerts?alert=41');
  });

  it('caché corta: la segunda alerta de la misma tienda no vuelve a consultar; la lista usa una consulta por tipo', async () => {
    const service = build();
    await service.resolve(alert());
    await service.resolve(alert({ id: 42 }));
    expect(prisma.stores.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.products.findFirst).toHaveBeenCalledTimes(1);

    const fresh = build();
    await fresh.resolveMany([alert(), alert({ id: 43, store_id: 106, affected_store_ids: [106] })]);
    expect(prisma.stores.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.stores.findMany.mock.calls[1][0].where.id.in.sort()).toEqual([105, 106]);
  });

  it('si la base falla, la alerta sale con ids y el fallo no queda en caché', async () => {
    prisma.stores.findMany.mockRejectedValueOnce(new Error('db caída'));
    prisma.products.findFirst.mockRejectedValueOnce(new Error('db caída'));
    const service = build();
    const resolved = await service.resolve(alert());
    expect(resolved.lines[0]).toEqual({ label: 'Tienda', value: 'id 105' });
    expect(resolved.lines.find((l) => l.label === 'Registro')?.value).toBe('producto (id 123)');
    expect(resolved.lines.find((l) => l.label === 'Organización')?.value).toBe('Demo Vendix (id 82)');

    const retried = await service.resolve(alert());
    expect(retried.lines[0].value).toBe('Vendix Granizzo (testbalmes, id 105)');
  });

  it('una base colgada no detiene la alerta: a los 1,5 s sale con ids', async () => {
    jest.useFakeTimers();
    try {
      prisma.stores.findMany.mockImplementationOnce(() => new Promise(() => undefined));
      const pending = build().resolve(alert());
      await jest.advanceTimersByTimeAsync(1_600);
      const resolved = await pending;
      expect(resolved.lines[0]).toEqual({ label: 'Tienda', value: 'id 105' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('«Límite de plan»: plan de la tienda y cupo consumido de la funcionalidad agotada', async () => {
    const resolved = await build().resolve(planLimitAlert());
    expect(resolved.lines.slice(-2)).toEqual([
      { label: 'Plan', value: 'Pro (pro) · estado active' },
      { label: 'Cupo', value: '1.000 de 1.000 indexación para la búsqueda con IA (este mes)' },
    ]);
    expect(usage.getAIUsageSnapshot).toHaveBeenCalledWith(105);
  });

  it('sin servicio de cupo ni suscripción, el plan se informa igual y el cupo se omite', async () => {
    prisma.store_subscriptions.findFirst.mockResolvedValueOnce(null as never);
    const service = new PlatformAlertContextService(
      prisma as never,
      { get: () => undefined } as never,
      {
        get: jest.fn(() => {
          throw new Error('no registrado');
        }),
      } as never,
    );
    const resolved = await service.resolve(planLimitAlert());
    expect(resolved.lines.at(-1)).toEqual({ label: 'Plan', value: 'sin suscripción' });
    expect(resolved.superadminUrl).toBeNull();
  });
});
