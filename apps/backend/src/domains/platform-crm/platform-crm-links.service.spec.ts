import { PlatformCrmLinksService } from './platform-crm-links.service';
import { PlatformCrmContext } from './platform-store.guard';

/**
 * Varias cuentas Vendix por cliente (odd/tasks/cuenta-vendix-multi-movimientos.md §2, D2).
 *
 * Como comercial de Vendix en la tienda Vendix Platform, quiero enlazar a un
 * cliente con todas las organizaciones y tiendas que maneja, para ver en su
 * ficha del CRM cada comercio que paga, sin que una tienda quede con dos dueños.
 *
 * Doble en memoria de `platform_crm_links` y de las tablas que lee el servicio.
 * Las reglas de unicidad que respalda la base (únicos parciales, triggers) las
 * prueba `platform-crm-links.postgres.integration.spec.ts` contra Postgres real.
 */

const ctx: PlatformCrmContext = { store_id: 10, organization_id: 1, user_id: 100 };

type Row = {
  id: number;
  store_id: number;
  customer_id: number;
  organization_id: number;
  linked_store_id: number | null;
  status: 'linked' | 'unlinked';
  note: string | null;
  linked_at: Date;
  linked_by_user_id: number;
  unlinked_by_user_id: number | null;
  unlinked_at: Date | null;
};

const ORGS: Record<number, { id: number; name: string; state: string; stores: number[] }> = {
  20: { id: 20, name: 'Panadería La Espiga', state: 'active', stores: [201, 202] },
  30: { id: 30, name: 'Ferretería El Clavo', state: 'active', stores: [301] },
  40: { id: 40, name: 'Café Arábigo', state: 'active', stores: [401] },
};
const STORES: Record<number, { id: number; name: string; organization_id: number }> = {
  201: { id: 201, name: 'Espiga Centro', organization_id: 20 },
  202: { id: 202, name: 'Espiga Norte', organization_id: 20 },
  301: { id: 301, name: 'Clavo Principal', organization_id: 30 },
  401: { id: 401, name: 'Arábigo Parque', organization_id: 40 },
};
/** Clientes del CRM plataforma. */
const CUSTOMERS = new Set([5, 6]);

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') {
      return (value as Record<string, unknown>[]).some((w) => matches(row, w));
    }
    return row[key] === value;
  });
}

function createDb() {
  let rows: Row[] = [];
  let seq = 0;
  const view = (r: Row) => ({
    ...r,
    linked_by: { id: r.linked_by_user_id, first_name: 'Ana', last_name: null },
    linked_store: r.linked_store_id
      ? { id: r.linked_store_id, name: STORES[r.linked_store_id].name }
      : null,
  });
  const sorted = () =>
    [...rows].sort((a, b) => a.linked_at.getTime() - b.linked_at.getTime() || a.id - b.id);

  const links = {
    findMany: jest.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
      sorted()
        .filter((r) => matches(r, where))
        .slice(0, take ?? Infinity)
        .map(view),
    ),
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = sorted().find((r) => matches(r, where));
      return row ? view(row) : null;
    }),
    create: jest.fn(async ({ data }: { data: Partial<Row> }) => {
      const row: Row = {
        id: ++seq,
        status: 'linked',
        note: null,
        linked_store_id: null,
        unlinked_by_user_id: null,
        unlinked_at: null,
        linked_at: new Date(Date.UTC(2026, 10, 1, 0, seq)),
        ...(data as Partial<Row>),
      } as Row;
      rows.push(row);
      return { id: row.id };
    }),
    updateMany: jest.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = rows.filter((r) => matches(r, where));
        rows = rows.map((r) => (hit.includes(r) ? { ...r, ...data } : r));
        return { count: hit.length };
      },
    ),
  };

  const db = {
    platform_crm_links: links,
    users: {
      findFirst: jest.fn(async ({ where }: { where: { id: number } }) =>
        CUSTOMERS.has(where.id) ? { id: where.id } : null,
      ),
    },
    stores: {
      findFirst: jest.fn(async ({ where }: { where: { id: number } }) => {
        const store = STORES[where.id];
        if (!store) return null;
        const org = ORGS[store.organization_id];
        return { id: store.id, name: store.name, organizations: { id: org.id, name: org.name } };
      }),
    },
    organizations: {
      findFirst: jest.fn(
        async ({
          where,
          select,
        }: {
          where: { id: number };
          select: { stores?: { where?: { id: number } } };
        }) => {
          const org = ORGS[where.id];
          if (!org) return null;
          const only = select.stores?.where?.id;
          return {
            id: org.id,
            name: org.name,
            state: org.state,
            tax_id: '900123', // No debe salir en la respuesta.
            stores: org.stores
              .filter((id) => only === undefined || id === only)
              .map((id) => ({
                name: STORES[id].name,
                subscription: {
                  state: 'active',
                  current_period_end: new Date('2026-12-15T17:00:00Z'),
                  trial_ends_at: null,
                  plan: { name: 'Plan Pro' },
                },
              })),
          };
        },
      ),
    },
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    rows: () => rows,
  };
  return db;
}

describe('PlatformCrmLinksService · varias cuentas por cliente (D2)', () => {
  let db: ReturnType<typeof createDb>;
  let audit: { log: jest.Mock };
  let service: PlatformCrmLinksService;

  beforeEach(() => {
    db = createDb();
    audit = { log: jest.fn() };
    service = new PlatformCrmLinksService(
      { withoutScope: () => db } as never,
      audit as never,
    );
  });

  it('enlaza dos organizaciones al mismo cliente y las lista en orden de enlace', async () => {
    await service.link(ctx, 5, { organization_id: 20 });
    await service.link(ctx, 5, { organization_id: 30 });

    const { links } = await service.listLinks(ctx, 5);
    expect(links.map((l) => [l.organization?.name, l.scope])).toEqual([
      ['Panadería La Espiga', 'organization'],
      ['Ferretería El Clavo', 'organization'],
    ]);
    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('org entera + tienda de otra org: cada tarjeta trae solo lo suyo y el conjunto exacto de llaves (candado 7)', async () => {
    await service.link(ctx, 5, { organization_id: 20 });
    await service.link(ctx, 5, { linked_store_id: 301, note: 'sede principal' });

    const result = await service.listLinks(ctx, 5);
    expect(Object.keys(result)).toEqual(['links']);
    const [org, store] = result.links;
    for (const item of result.links) {
      expect(Object.keys(item).sort()).toEqual([
        'id',
        'linked_at',
        'linked_by',
        'linked_store',
        'note',
        'organization',
        'scope',
        'status',
      ]);
      expect(Object.keys(item.organization!).sort()).toEqual(['id', 'name', 'state', 'subscriptions']);
      for (const sub of item.organization!.subscriptions) {
        expect(Object.keys(sub).sort()).toEqual([
          'current_period_end',
          'plan_name',
          'state',
          'store_name',
          'trial_ends_at',
        ]);
      }
    }
    expect(org.scope).toBe('organization');
    expect(org.organization!.subscriptions.map((s) => s.store_name)).toEqual([
      'Espiga Centro',
      'Espiga Norte',
    ]);
    expect(store).toMatchObject({
      scope: 'store',
      note: 'sede principal',
      linked_store: { id: 301, name: 'Clavo Principal' },
    });
    expect(store.organization!.subscriptions.map((s) => s.store_name)).toEqual(['Clavo Principal']);
    expect(JSON.stringify(result)).not.toContain('900123');
  });

  it('la misma cuenta otra vez al mismo cliente → 009 (org repetida, tienda repetida o tienda ya cubierta por su org)', async () => {
    await service.link(ctx, 5, { organization_id: 20 });
    await service.link(ctx, 5, { linked_store_id: 301 });

    for (const dto of [{ organization_id: 20 }, { linked_store_id: 201 }, { linked_store_id: 301 }]) {
      await expect(service.link(ctx, 5, dto)).rejects.toMatchObject({
        errorCode: 'PLATFORM_CRM_009',
      });
    }
    expect(db.rows()).toHaveLength(2);
  });

  it('la org entera de una tienda que el cliente ya tiene suelta → 013 (desenlazar la tienda primero)', async () => {
    await service.link(ctx, 5, { linked_store_id: 201 });
    await expect(service.link(ctx, 5, { organization_id: 20 })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_013',
    });
    // Otra tienda suelta de la misma org sí entra.
    await service.link(ctx, 5, { linked_store_id: 202 });
    expect(db.rows().filter((r) => r.status === 'linked')).toHaveLength(2);
  });

  it('otro cliente sobre una cuenta ajena → los conflictos de siempre (004, 007, 008)', async () => {
    await service.link(ctx, 5, { organization_id: 20 });
    await service.link(ctx, 5, { linked_store_id: 301 });

    // Tienda dentro de la org entera de otro cliente.
    await expect(service.link(ctx, 6, { linked_store_id: 201 })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_004',
    });
    // La misma org entera.
    await expect(service.link(ctx, 6, { organization_id: 20 })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_004',
    });
    // La misma tienda suelta.
    await expect(service.link(ctx, 6, { linked_store_id: 301 })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_007',
    });
    // La org entera cuando una de sus tiendas es de otro.
    await expect(service.link(ctx, 6, { organization_id: 30 })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_008',
    });
  });

  it('tope de 25 enlaces activos por cliente → 010', async () => {
    for (let i = 0; i < 25; i++) {
      db.rows().push({
        id: 1000 + i,
        store_id: ctx.store_id,
        customer_id: 5,
        organization_id: 900 + i,
        linked_store_id: null,
        status: 'linked',
        note: null,
        linked_at: new Date(),
        linked_by_user_id: ctx.user_id,
        unlinked_by_user_id: null,
        unlinked_at: null,
      });
    }
    await expect(service.link(ctx, 5, { organization_id: 40 })).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_010',
    });
    expect(db.platform_crm_links.create).not.toHaveBeenCalled();
  });

  it('los candados de la transacción van cliente → org', async () => {
    await service.link(ctx, 5, { organization_id: 20 });
    const keys = db.$executeRaw.mock.calls.map((call) => (call as unknown[])[1]);
    expect(keys).toEqual(['platform_crm_link_customer:5', 'platform_crm_link_org:20']);
  });

  it('desenlazar por id deja las demás y conserva la fila; un id de otro cliente → 404 sin escribir', async () => {
    const a = await service.link(ctx, 5, { organization_id: 20 });
    const b = await service.link(ctx, 5, { linked_store_id: 301 });
    const foreign = await service.link(ctx, 6, { organization_id: 40 });

    await expect(service.unlinkById(ctx, 5, foreign.link!.id, {})).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_012',
    });
    await expect(service.unlinkById(ctx, 5, 9999, {})).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_012',
    });
    expect(db.platform_crm_links.updateMany).not.toHaveBeenCalled();

    const rest = await service.unlinkById(ctx, 5, a.link!.id, { reason: 'vendió el negocio' });
    expect(rest.links.map((l) => l.id)).toEqual([b.link!.id]);
    expect(db.rows().find((r) => r.id === a.link!.id)).toMatchObject({
      status: 'unlinked',
      unlinked_by_user_id: ctx.user_id,
    });
    expect(audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resourceId: a.link!.id,
        metadata: { action: 'platform_crm_unlink', customer_id: 5, reason: 'vendió el negocio' },
      }),
    );
    // Ya desenlazado: un segundo intento no lo encuentra.
    await expect(service.unlinkById(ctx, 5, a.link!.id, {})).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_012',
    });
  });

  it('compatibilidad: GET viejo devuelve el más antiguo; DELETE viejo con varios → 011 y con uno desenlaza', async () => {
    const first = await service.link(ctx, 5, { organization_id: 20 });
    const second = await service.link(ctx, 5, { linked_store_id: 301 });

    expect((await service.getLink(ctx, 5)).link?.id).toBe(first.link!.id);
    await expect(service.unlink(ctx, 5, {})).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_011',
    });

    await service.unlinkById(ctx, 5, first.link!.id, {});
    expect(await service.unlink(ctx, 5, {})).toEqual({ link: null, organization: null });
    expect(db.rows().find((r) => r.id === second.link!.id)?.status).toBe('unlinked');
    await expect(service.unlink(ctx, 5, {})).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_005',
    });
  });

  it('POST devuelve el enlace recién creado, no el más antiguo', async () => {
    await service.link(ctx, 5, { organization_id: 20 });
    const created = await service.link(ctx, 5, { linked_store_id: 301 });
    expect(created.link?.linked_store).toEqual({ id: 301, name: 'Clavo Principal' });
  });

  it('cliente que no es del CRM plataforma → 404 en todas las operaciones', async () => {
    await expect(service.listLinks(ctx, 99)).rejects.toMatchObject({ errorCode: 'PLATFORM_CRM_001' });
    await expect(service.unlinkById(ctx, 99, 1, {})).rejects.toMatchObject({
      errorCode: 'PLATFORM_CRM_001',
    });
  });
});
