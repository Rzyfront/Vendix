import { RequestContextService } from '@common/context/request-context.service';
import { ServicePlansService } from './service-plans.service';
import { assertPlanDurationKeepsActivities } from './service-plan-duration.util';
import { buildPublicItinerary } from './service-plan-itinerary.util';

/**
 * QUI-1060 F2 · Itinerario del plan. Base en memoria con el aislamiento del
 * cliente de tienda: cada delegado solo ve filas de la tienda del contexto.
 */
let ctxStoreId = 1;
(RequestContextService.getContext as jest.Mock) = jest.fn(() => ({
  store_id: ctxStoreId,
  user_id: 1,
  organization_id: 1,
}));

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond) return row[key] !== cond.not;
      if ('gt' in cond) return row[key] > cond.gt;
      if ('gte' in cond) return row[key] >= cond.gte;
      if ('lte' in cond) return row[key] <= cond.lte;
      return true;
    }
    return row[key] instanceof Date && cond instanceof Date
      ? row[key].getTime() === cond.getTime()
      : row[key] === cond;
  });
}

function buildDb() {
  const products: Row[] = [
    { id: 10, store_id: 1, state: 'active', product_type: 'service', service_pricing_type: 'package', plan_duration_days: 3, plan_duration_nights: 2, plan_departure_mode: 'both', plan_min_pax: 1, plan_max_pax: 8 },
    { id: 11, store_id: 1, state: 'active', product_type: 'service', service_pricing_type: 'per_hour', plan_duration_days: null },
    { id: 20, store_id: 2, state: 'active', product_type: 'service', service_pricing_type: 'package', plan_duration_days: 2, plan_departure_mode: 'fixed' },
  ];
  const providers: Row[] = [
    { id: 5, store_id: 1 },
    { id: 7, store_id: 2 },
  ];
  const activities: Row[] = [
    { id: 900, store_id: 2, product_id: 20, day_number: 1, start_time: null, title: 'Ajena', description: null, sort_order: 0, provider_id: null, supplier_name: null, supplier_contact: null, cost: null, creates_task: false, is_public: true },
  ];
  const bookings: Row[] = [
    { id: 1, store_id: 1, product_id: 10, date: new Date('2099-03-10T00:00:00.000Z'), end_date: new Date('2099-03-12T00:00:00.000Z'), departure_id: 2, pax_adults: 2, pax_children: 1 },
    { id: 2, store_id: 1, product_id: 11, date: new Date('2099-03-10T00:00:00.000Z'), end_date: null, departure_id: null, pax_adults: null, pax_children: null },
  ];
  let nextId = 1000;

  const scoped = (rows: Row[]) => rows.filter((r) => r.store_id === ctxStoreId);
  const sortRows = (rows: Row[], orderBy?: Row) => {
    if (!orderBy || Array.isArray(orderBy)) return rows;
    const [[key, dir]] = Object.entries(orderBy);
    return [...rows].sort((a, b) => (dir === 'desc' ? b[key] - a[key] : a[key] - b[key]));
  };
  const delegate = (rows: Row[]) => ({
    findFirst: jest.fn(async ({ where, orderBy }: Row) => {
      const found = sortRows(scoped(rows).filter((r) => matches(r, where)), orderBy)[0];
      return found ? { ...found } : null;
    }),
    findMany: jest.fn(async ({ where }: Row = {}) =>
      scoped(rows).filter((r) => matches(r, where)).map((r) => ({ ...r })),
    ),
    count: jest.fn(async ({ where }: Row) => scoped(rows).filter((r) => matches(r, where)).length),
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: nextId++, ...data };
      rows.push(row);
      return { ...row };
    }),
    deleteMany: jest.fn(async ({ where }: Row) => {
      const doomed = scoped(rows).filter((r) => matches(r, where));
      for (const d of doomed) rows.splice(rows.indexOf(d), 1);
      return { count: doomed.length };
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hits = scoped(rows).filter((r) => matches(r, where));
      for (const h of hits) Object.assign(h, data);
      return { count: hits.length };
    }),
  });

  const prisma: any = {
    products: delegate(products),
    service_providers: delegate(providers),
    service_plan_activities: delegate(activities),
    service_plan_pax_prices: delegate([]),
    service_plan_departures: delegate([]),
    store_settings: { findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })) },
  };
  // El comprobante lee la reserva con su producto.
  prisma.bookings = {
    findFirst: jest.fn(async ({ where }: Row) => {
      const b = scoped(bookings).find((r) => matches(r, where));
      if (!b) return null;
      const product = products.find((p) => p.id === b.product_id && p.store_id === b.store_id);
      return { ...b, product: product ? { ...product } : null };
    }),
  };
  prisma.$transaction = jest.fn(async (cb: (tx: any) => unknown) => cb(prisma));

  return { prisma, activities, products, service: new ServicePlansService(prisma) };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ errorCode: code });
}

describe('Itinerario del plan (QUI-1060 F2)', () => {
  beforeEach(() => {
    ctxStoreId = 1;
  });

  describe('CRUD de actividades', () => {
    it('agrega al final del día con responsable interno de la tienda', async () => {
      const { service } = buildDb();
      const first = await service.createActivity(10, { day_number: 1, title: '  Llegada  ', start_time: '08:00', provider_id: 5 });
      const second = await service.createActivity(10, { day_number: 1, title: 'Almuerzo', cost: 25000 });
      expect(first).toMatchObject({ day_number: 1, title: 'Llegada', sort_order: 0, provider_id: 5, is_public: true, creates_task: false });
      expect(second).toMatchObject({ sort_order: 1, cost: 25000, provider_id: null });
    });

    it('rechaza días fuera de la duración del plan', async () => {
      const { service } = buildDb();
      await expectCode(service.createActivity(10, { day_number: 4, title: 'Extra' }), 'SERVICE_PLAN_019');
      await expectCode(service.createActivity(10, { day_number: 0, title: 'Extra' }), 'SERVICE_PLAN_019');
      const ok = await service.createActivity(10, { day_number: 3, title: 'Regreso' });
      await expectCode(service.updateActivity(10, ok.id, { day_number: 5 }), 'SERVICE_PLAN_019');
    });

    it('exige título', async () => {
      const { service } = buildDb();
      await expectCode(service.createActivity(10, { day_number: 1, title: '   ' }), 'SERVICE_PLAN_025');
      const ok = await service.createActivity(10, { day_number: 1, title: 'Caminata' });
      await expectCode(service.updateActivity(10, ok.id, { title: null as unknown as string }), 'SERVICE_PLAN_025');
    });

    it('responsable interno XOR tercero, también al editar sobre lo guardado', async () => {
      const { service } = buildDb();
      await expectCode(
        service.createActivity(10, { day_number: 1, title: 'Lancha', provider_id: 5, supplier_name: 'Lanchas SAS' }),
        'SERVICE_PLAN_020',
      );
      const third = await service.createActivity(10, { day_number: 1, title: 'Lancha', supplier_name: 'Lanchas SAS', supplier_contact: '300 000 0000' });
      await expectCode(service.updateActivity(10, third.id, { provider_id: 5 }), 'SERVICE_PLAN_020');
      const switched = await service.updateActivity(10, third.id, { provider_id: 5, supplier_name: null, supplier_contact: null });
      expect(switched).toMatchObject({ provider_id: 5, supplier_name: null, supplier_contact: null });
    });

    it('rechaza un responsable de otra tienda', async () => {
      const { service } = buildDb();
      await expectCode(service.createActivity(10, { day_number: 1, title: 'Guía', provider_id: 7 }), 'SERVICE_PLAN_021');
    });

    it('solo en servicios tipo paquete', async () => {
      const { service } = buildDb();
      await expectCode(service.createActivity(11, { day_number: 1, title: 'X' }), 'SERVICE_PLAN_001');
    });

    it('cambiar de día la manda al final del nuevo día; eliminar la quita', async () => {
      const { service, activities } = buildDb();
      await service.createActivity(10, { day_number: 2, title: 'A' });
      const moving = await service.createActivity(10, { day_number: 1, title: 'B' });
      const moved = await service.updateActivity(10, moving.id, { day_number: 2 });
      expect(moved).toMatchObject({ day_number: 2, sort_order: 1 });
      await service.deleteActivity(10, moving.id);
      expect(activities.some((a) => a.id === moving.id)).toBe(false);
      await expectCode(service.deleteActivity(10, moving.id), 'SERVICE_PLAN_022');
    });

    it('reordena dentro del día y exige exactamente las actividades del día', async () => {
      const { service } = buildDb();
      const a = await service.createActivity(10, { day_number: 1, title: 'A' });
      const b = await service.createActivity(10, { day_number: 1, title: 'B' });
      const other = await service.createActivity(10, { day_number: 2, title: 'C' });
      const reordered = await service.reorderActivities(10, 1, [b.id, a.id]);
      expect(reordered.map((r) => r.title)).toEqual(['B', 'A']);
      await expectCode(service.reorderActivities(10, 1, [b.id]), 'SERVICE_PLAN_024');
      await expectCode(service.reorderActivities(10, 1, [b.id, other.id]), 'SERVICE_PLAN_024');
      await expectCode(service.reorderActivities(10, 1, [a.id, a.id]), 'SERVICE_PLAN_024');
    });

    it('getPlan devuelve el itinerario ordenado por día y orden', async () => {
      const { service } = buildDb();
      await service.createActivity(10, { day_number: 2, title: 'D2' });
      await service.createActivity(10, { day_number: 1, title: 'D1a' });
      await service.createActivity(10, { day_number: 1, title: 'D1b' });
      const plan = await service.getPlan(10);
      expect(plan.activities.map((a) => a.title)).toEqual(['D1a', 'D1b', 'D2']);
    });
  });

  describe('aislamiento por tienda', () => {
    it('la tienda A no ve ni edita actividades de la tienda B', async () => {
      const { service, activities } = buildDb();
      // Producto 20 es de la tienda 2: desde la 1 no existe.
      await expectCode(service.createActivity(20, { day_number: 1, title: 'X' }), 'PROD_FIND_001');
      await expectCode(service.updateActivity(20, 900, { title: 'Hack' }), 'PROD_FIND_001');
      await expectCode(service.deleteActivity(20, 900), 'PROD_FIND_001');
      // Ni siquiera apuntando la actividad ajena desde un plan propio.
      await expectCode(service.updateActivity(10, 900, { title: 'Hack' }), 'SERVICE_PLAN_022');
      expect(activities.find((a) => a.id === 900)?.title).toBe('Ajena');
      const plan = await service.getPlan(10);
      expect(plan.activities).toEqual([]);
    });
  });

  describe('reducir la duración', () => {
    it('rechaza si quedan actividades fuera del nuevo rango y permite si no', async () => {
      const { service, prisma } = buildDb();
      await service.createActivity(10, { day_number: 3, title: 'Regreso' });
      await expectCode(assertPlanDurationKeepsActivities(prisma, 10, 2), 'SERVICE_PLAN_023');
      await expect(assertPlanDurationKeepsActivities(prisma, 10, 3)).resolves.toBeUndefined();
    });
  });

  describe('comprobante de la reserva', () => {
    it('reserva de plan: evento, ida/regreso, pax e itinerario público con fechas reales', async () => {
      const { service } = buildDb();
      await service.createActivity(10, { day_number: 1, title: 'Salida del hotel', start_time: '07:00', provider_id: 5, cost: 1000 });
      await service.createActivity(10, { day_number: 3, title: 'Regreso', supplier_name: 'Bus SAS', supplier_contact: '311' });
      await service.createActivity(10, { day_number: 2, title: 'Interna', is_public: false });
      const result = await service.getBookingItinerary(1);
      expect(result).toEqual({
        booking_id: 1,
        product_id: 10,
        departure_id: 2,
        start_date: '2099-03-10',
        end_date: '2099-03-12',
        duration_days: 3,
        duration_nights: 2,
        pax_adults: 2,
        pax_children: 1,
        total_pax: 3,
        itinerary: [
          { day_number: 1, date: '2099-03-10', activities: [{ start_time: '07:00', title: 'Salida del hotel', description: null }] },
          { day_number: 3, date: '2099-03-12', activities: [{ start_time: null, title: 'Regreso', description: null }] },
        ],
      });
      const text = JSON.stringify(result);
      expect(text).not.toContain('Bus SAS');
      expect(text).not.toContain('311');
      expect(text).not.toContain('Interna');
      expect(text).not.toContain('cost');
    });

    it('reserva normal: null (el comprobante queda igual)', async () => {
      const { service } = buildDb();
      await expect(service.getBookingItinerary(2)).resolves.toBeNull();
    });

    it('reserva de otra tienda no existe', async () => {
      const { service } = buildDb();
      ctxStoreId = 2;
      await expectCode(service.getBookingItinerary(1), 'SERVICE_PLAN_026');
    });
  });
});

describe('buildPublicItinerary', () => {
  const base = { description: null, is_public: true };
  it('agrupa por día, ordena por orden manual y hora, y omite lo no público o fuera de rango', () => {
    const days = buildPublicItinerary(
      [
        { ...base, id: 1, day_number: 2, sort_order: 0, start_time: '09:00', title: 'D2' },
        { ...base, id: 2, day_number: 1, sort_order: 1, start_time: '07:00', title: 'D1 segunda' },
        { ...base, id: 3, day_number: 1, sort_order: 0, start_time: '10:00', title: 'D1 primera' },
        { ...base, id: 4, day_number: 1, sort_order: 0, start_time: null, title: 'D1 sin hora', is_public: true },
        { ...base, id: 5, day_number: 1, sort_order: 0, start_time: '06:00', title: 'Oculta', is_public: false },
        { ...base, id: 6, day_number: 4, sort_order: 0, start_time: null, title: 'Fuera' },
      ],
      3,
      '2099-12-31',
    );
    expect(days).toEqual([
      {
        day_number: 1,
        date: '2099-12-31',
        activities: [
          { start_time: '10:00', title: 'D1 primera', description: null },
          { start_time: null, title: 'D1 sin hora', description: null },
          { start_time: '07:00', title: 'D1 segunda', description: null },
        ],
      },
      { day_number: 2, date: '2100-01-01', activities: [{ start_time: '09:00', title: 'D2', description: null }] },
    ]);
  });

  it('sin fecha de inicio los días no llevan fecha', () => {
    const days = buildPublicItinerary([{ ...base, id: 1, day_number: 1, sort_order: 0, start_time: null, title: 'A' }], 2);
    expect(days[0].date).toBeNull();
  });
});
