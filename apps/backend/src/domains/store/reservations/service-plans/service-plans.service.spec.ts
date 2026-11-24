import { RequestContextService } from '@common/context/request-context.service';
import { ServicePlansService, type PlanBookingProduct } from './service-plans.service';
import { releasePlanSeatsForBookingInTx } from './service-plan-seats.util';

/**
 * QUI-1060 modo Plan. Base en memoria con el mismo aislamiento que el cliente
 * de tienda: cada lectura/escritura del delegado solo ve filas de la tienda del
 * contexto. `$executeRaw` replica la actualización condicional de cupos: se
 * evalúa de forma atómica (como el bloqueo de fila de Postgres) después de ceder
 * el turno, así dos reservas simultáneas compiten de verdad por el último cupo.
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
  const departures: Row[] = [
    { id: 1, store_id: 1, product_id: 10, departure_date: new Date('2099-01-10T00:00:00.000Z'), capacity: 10, seats_sold: 9, price_override: null, status: 'open', notes: null },
    { id: 2, store_id: 1, product_id: 10, departure_date: new Date('2099-02-10T00:00:00.000Z'), capacity: 10, seats_sold: 0, price_override: 1_500_000, status: 'open', notes: null },
    { id: 3, store_id: 1, product_id: 10, departure_date: new Date('2099-03-10T00:00:00.000Z'), capacity: 10, seats_sold: 0, price_override: null, status: 'closed', notes: null },
    { id: 4, store_id: 1, product_id: 10, departure_date: new Date('2099-04-10T00:00:00.000Z'), capacity: 10, seats_sold: 0, price_override: null, status: 'cancelled', notes: null },
    { id: 9, store_id: 2, product_id: 20, departure_date: new Date('2099-01-10T00:00:00.000Z'), capacity: 10, seats_sold: 0, price_override: null, status: 'open', notes: null },
  ];
  const tiers: Row[] = [
    { id: 1, store_id: 1, product_id: 10, min_pax: 1, max_pax: 2, price: 1_000_000 },
    { id: 2, store_id: 1, product_id: 10, min_pax: 3, max_pax: 4, price: 1_800_000 },
    { id: 9, store_id: 2, product_id: 10, min_pax: 1, max_pax: 99, price: 1 },
  ];
  const bookings: Row[] = [];

  const scoped = (rows: Row[]) => rows.filter((r) => r.store_id === ctxStoreId);
  const delegate = (rows: Row[]) => ({
    findFirst: jest.fn(async ({ where }: Row) => {
      const found = scoped(rows).find((r) => matches(r, where));
      return found ? { ...found } : null;
    }),
    findMany: jest.fn(async ({ where }: Row = {}) =>
      scoped(rows)
        .filter((r) => matches(r, where))
        .map((r) => ({ ...r })),
    ),
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: rows.length + 100, seats_sold: 0, status: 'open', ...data };
      rows.push(row);
      return { ...row };
    }),
    createMany: jest.fn(async ({ data }: Row) => {
      for (const d of data) rows.push({ id: rows.length + 100, ...d });
      return { count: data.length };
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
    service_plan_departures: delegate(departures),
    service_plan_pax_prices: delegate(tiers),
    bookings: delegate(bookings),
    store_settings: { findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })) },
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
      await Promise.resolve();
      const sql = strings.join('?');
      if (sql.includes('GREATEST')) {
        const [pax, departureId, storeId] = values;
        const d = departures.find((r) => r.id === departureId && r.store_id === storeId);
        if (!d) return 0;
        d.seats_sold = Math.max(d.seats_sold - pax, 0);
        return 1;
      }
      const [pax, departureId, storeId, productId, today] = values;
      const d = departures.find(
        (r) =>
          r.id === departureId &&
          r.store_id === storeId &&
          r.product_id === productId &&
          r.status === 'open' &&
          r.departure_date.toISOString().slice(0, 10) >= today &&
          r.seats_sold + pax <= r.capacity,
      );
      if (!d) return 0;
      d.seats_sold += pax;
      return 1;
    }),
  };
  prisma.$transaction = jest.fn(async (cb: (tx: any) => unknown) => cb(prisma));

  return { prisma, products, departures, tiers, bookings, service: new ServicePlansService(prisma) };
}

const planProduct: PlanBookingProduct = {
  id: 10,
  service_pricing_type: 'package',
  plan_duration_days: 3,
  plan_departure_mode: 'both',
  plan_min_pax: 1,
  plan_max_pax: 8,
};

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ errorCode: code });
}

describe('ServicePlansService (QUI-1060)', () => {
  beforeEach(() => {
    ctxStoreId = 1;
  });

  describe('tramos de precio', () => {
    it('rechaza tramos solapados sin escribir nada', async () => {
      const { service, tiers } = buildDb();
      await expectCode(
        service.replacePaxPrices(10, [
          { min_pax: 1, max_pax: 4, price: 1 },
          { min_pax: 4, max_pax: 6, price: 2 },
        ]),
        'SERVICE_PLAN_002',
      );
      expect(tiers.filter((t) => t.store_id === 1)).toHaveLength(2);
    });

    it('rechaza un tramo con mínimo mayor que máximo', async () => {
      const { service } = buildDb();
      await expectCode(service.replacePaxPrices(10, [{ min_pax: 5, max_pax: 2, price: 1 }]), 'SERVICE_PLAN_003');
    });

    it('reemplaza los tramos del plan y no toca los de otra tienda', async () => {
      const { service, tiers } = buildDb();
      const saved = await service.replacePaxPrices(10, [
        { min_pax: 1, max_pax: 2, price: 900_000 },
        { min_pax: 3, max_pax: 6, price: 1_700_000 },
      ]);
      expect(saved.map((t) => [t.min_pax, t.max_pax, t.price])).toEqual([
        [1, 2, 900_000],
        [3, 6, 1_700_000],
      ]);
      expect(tiers.find((t) => t.store_id === 2)).toMatchObject({ min_pax: 1, max_pax: 99 });
    });

    it('un servicio que no es paquete no admite tramos ni salidas', async () => {
      const { service } = buildDb();
      await expectCode(service.replacePaxPrices(11, []), 'SERVICE_PLAN_001');
      await expectCode(service.createDeparture(11, { departure_date: '2099-05-01', capacity: 5 }), 'SERVICE_PLAN_001');
    });
  });

  describe('salidas', () => {
    it('no crea salidas en el pasado', async () => {
      const { service } = buildDb();
      await expectCode(service.createDeparture(10, { departure_date: '2020-01-01', capacity: 5 }), 'SERVICE_PLAN_004');
    });

    it('crea una salida futura abierta con cupo y vendidos en cero', async () => {
      const { service } = buildDb();
      const created = await service.createDeparture(10, { departure_date: '2099-06-01', capacity: 12, price_override: 2_000_000 });
      expect(created).toMatchObject({ departure_date: '2099-06-01', capacity: 12, seats_sold: 0, seats_available: 12, price_override: 2_000_000, status: 'open' });
    });

    it('el cupo no puede quedar por debajo de lo vendido', async () => {
      const { service, departures } = buildDb();
      await expectCode(service.updateDeparture(10, 1, { capacity: 5 }), 'SERVICE_PLAN_005');
      expect(departures.find((d) => d.id === 1)!.capacity).toBe(10);
    });

    it('no cancela una salida con cupos vendidos', async () => {
      const { service } = buildDb();
      await expectCode(service.updateDeparture(10, 1, { status: 'cancelled' }), 'SERVICE_PLAN_013');
    });
  });

  describe('resolveBooking', () => {
    it('plan a fecha libre: precio por tramo y regreso = salida + días - 1', async () => {
      const { service } = buildDb();
      const result = await service.resolveBooking(
        { ...planProduct, plan_departure_mode: 'on_demand' },
        { date: '2099-07-01', pax_adults: 2, pax_children: 1 },
      );
      expect(result).toMatchObject({ date: '2099-07-01', endDate: '2099-07-03', departureId: null, totalPax: 3, price: 1_800_000, priceSource: 'tier' });
    });

    it('el override de la salida reemplaza al tramo', async () => {
      const { service } = buildDb();
      const result = await service.resolveBooking(planProduct, { date: '2099-02-10', departure_id: 2, pax_adults: 2 });
      expect(result).toMatchObject({ departureId: 2, price: 1_500_000, priceSource: 'departure_override', endDate: '2099-02-12' });
    });

    it('sin tramo para el grupo responde un error claro', async () => {
      const { service } = buildDb();
      await expect(
        service.resolveBooking({ ...planProduct, plan_departure_mode: 'on_demand' }, { date: '2099-07-01', pax_adults: 6 }),
      ).rejects.toMatchObject({ errorCode: 'SERVICE_PLAN_009', message: 'No hay una tarifa del plan para 6 personas.' });
    });

    it('fuera del mínimo/máximo del plan', async () => {
      const { service } = buildDb();
      await expectCode(
        service.resolveBooking({ ...planProduct, plan_departure_mode: 'on_demand', plan_min_pax: 2 }, { date: '2099-07-01', pax_adults: 1 }),
        'SERVICE_PLAN_010',
      );
    });

    it('un grupo sin adultos no se reserva', async () => {
      const { service } = buildDb();
      await expect(
        service.resolveBooking({ ...planProduct, plan_departure_mode: 'on_demand' }, { date: '2099-07-01', pax_adults: 0, pax_children: 2 }),
      ).rejects.toMatchObject({ errorCode: 'SERVICE_PLAN_010', message: 'Indica al menos un adulto en el grupo.' });
    });

    it('modo fijo exige salida; modo fecha libre no la admite', async () => {
      const { service } = buildDb();
      await expectCode(service.resolveBooking({ ...planProduct, plan_departure_mode: 'fixed' }, { date: '2099-07-01' }), 'SERVICE_PLAN_011');
      await expectCode(
        service.resolveBooking({ ...planProduct, plan_departure_mode: 'on_demand' }, { date: '2099-01-10', departure_id: 1 }),
        'SERVICE_PLAN_012',
      );
    });

    it('una salida cerrada o cancelada no se puede reservar', async () => {
      const { service } = buildDb();
      await expectCode(service.resolveBooking(planProduct, { date: '2099-03-10', departure_id: 3 }), 'SERVICE_PLAN_007');
      await expectCode(service.resolveBooking(planProduct, { date: '2099-04-10', departure_id: 4 }), 'SERVICE_PLAN_007');
    });

    it('la fecha de regreso enviada debe coincidir con la calculada', async () => {
      const { service } = buildDb();
      await expectCode(
        service.resolveBooking({ ...planProduct, plan_departure_mode: 'on_demand' }, { date: '2099-07-01', end_date: '2099-07-05' }),
        'SERVICE_PLAN_015',
      );
    });
  });

  describe('cupos', () => {
    it('dos reservas simultáneas por el último cupo: solo una pasa', async () => {
      const { service, prisma, departures } = buildDb();
      const take = () => service.reserveSeatsInTx(prisma, { storeId: 1, productId: 10, departureId: 1, pax: 1 });
      const results = await Promise.allSettled([take(), take()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ errorCode: 'SERVICE_PLAN_008', message: 'No quedan cupos suficientes en este evento: quedan 0 cupos.' });
      expect(departures.find((d) => d.id === 1)!.seats_sold).toBe(10);
    });

    it('una salida cerrada no vende cupos', async () => {
      const { service, prisma } = buildDb();
      await expectCode(service.reserveSeatsInTx(prisma, { storeId: 1, productId: 10, departureId: 3, pax: 1 }), 'SERVICE_PLAN_007');
    });

    it('cancelar devuelve los cupos de la reserva y nunca baja de cero', async () => {
      const { prisma, departures, bookings } = buildDb();
      bookings.push({ id: 50, store_id: 1, departure_id: 1, pax_adults: 2, pax_children: 1 });
      await releasePlanSeatsForBookingInTx(prisma, 50);
      expect(departures.find((d) => d.id === 1)!.seats_sold).toBe(6);
      departures.find((d) => d.id === 1)!.seats_sold = 1;
      await releasePlanSeatsForBookingInTx(prisma, 50);
      expect(departures.find((d) => d.id === 1)!.seats_sold).toBe(0);
    });

    it('una reserva sin salida no toca cupos', async () => {
      const { prisma, bookings } = buildDb();
      bookings.push({ id: 51, store_id: 1, departure_id: null, pax_adults: null, pax_children: null });
      await releasePlanSeatsForBookingInTx(prisma, 51);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('aislamiento por tienda', () => {
    it('la tienda A no ve ni usa la salida ni los tramos de la tienda B', async () => {
      const { service, prisma } = buildDb();
      const plan = await service.getPlan(10);
      expect(plan.departures.map((d) => d.id)).not.toContain(9);
      expect(plan.pax_prices.map((t) => t.max_pax)).not.toContain(99);
      await expectCode(service.resolveBooking(planProduct, { date: '2099-01-10', departure_id: 9 }), 'SERVICE_PLAN_006');
      await expectCode(service.updateDeparture(10, 9, { capacity: 20 }), 'SERVICE_PLAN_006');
      await expectCode(service.reserveSeatsInTx(prisma, { storeId: 1, productId: 10, departureId: 9, pax: 1 }), 'SERVICE_PLAN_006');
    });

    it('la tienda B no ve el plan de la tienda A', async () => {
      ctxStoreId = 2;
      const { service } = buildDb();
      await expectCode(service.getPlan(10), 'PROD_FIND_001');
    });
  });
});
