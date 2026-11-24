import { RequestContextService } from '@common/context/request-context.service';
import { ServicePlanPublicService } from './service-plan-public.service';

/**
 * QUI-1060 F2 · Ficha pública del plan. El cliente de ecommerce filtra por la
 * tienda del dominio; aquí cada delegado solo ve las filas de esa tienda.
 */
let domainStoreId = 1;
(RequestContextService.getContext as jest.Mock) = jest.fn(() => ({ store_id: domainStoreId }));
(RequestContextService.getStoreId as jest.Mock) = jest.fn(() => domainStoreId);

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('gte' in cond) return row[key] >= cond.gte;
      return true;
    }
    return row[key] instanceof Date && cond instanceof Date
      ? row[key].getTime() === cond.getTime()
      : row[key] === cond;
  });
}

const PLAN = {
  state: 'active',
  available_for_ecommerce: true,
  is_sellable: true,
  product_type: 'service',
  service_pricing_type: 'package',
  plan_departure_mode: 'both',
  plan_min_pax: 2,
  plan_max_pax: 8,
  plan_includes: 'Hotel y desayunos',
  plan_excludes: 'Vuelos',
  plan_recommendations: 'Bloqueador',
};

function build() {
  const products: Row[] = [
    { ...PLAN, id: 10, store_id: 1, plan_duration_days: 3, plan_duration_nights: 2 },
    { ...PLAN, id: 11, store_id: 1, service_pricing_type: 'per_hour', plan_duration_days: null },
    { ...PLAN, id: 12, store_id: 1, plan_duration_days: 2, available_for_ecommerce: false },
    { ...PLAN, id: 20, store_id: 2, plan_duration_days: 2 },
  ];
  const tiers: Row[] = [
    { store_id: 1, product_id: 10, min_pax: 2, max_pax: 4, price: 1_800_000 },
    { store_id: 2, product_id: 10, min_pax: 1, max_pax: 99, price: 1 },
  ];
  const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
  const departures: Row[] = [
    { id: 1, store_id: 1, product_id: 10, departure_date: day('2000-01-10'), capacity: 10, seats_sold: 0, price_override: null, status: 'open' },
    { id: 2, store_id: 1, product_id: 10, departure_date: day('2099-02-10'), capacity: 10, seats_sold: 4, price_override: 1_500_000, status: 'open', notes: 'interna' },
    { id: 3, store_id: 1, product_id: 10, departure_date: day('2099-03-10'), capacity: 10, seats_sold: 0, price_override: null, status: 'closed' },
    { id: 4, store_id: 1, product_id: 10, departure_date: day('2099-04-10'), capacity: 10, seats_sold: 0, price_override: null, status: 'cancelled' },
    { id: 5, store_id: 1, product_id: 10, departure_date: day('2099-05-10'), capacity: 6, seats_sold: 6, price_override: null, status: 'open' },
    { id: 9, store_id: 2, product_id: 20, departure_date: day('2099-01-10'), capacity: 10, seats_sold: 0, price_override: null, status: 'open' },
  ];
  const activities: Row[] = [
    { id: 1, store_id: 1, product_id: 10, day_number: 1, sort_order: 0, start_time: '07:00', title: 'Salida', description: 'Desde el hotel', is_public: true, provider_id: 5, supplier_name: null, supplier_contact: null, cost: 43_210 },
    { id: 2, store_id: 1, product_id: 10, day_number: 2, sort_order: 0, start_time: null, title: 'Lancha', description: null, is_public: true, provider_id: null, supplier_name: 'Lanchas SAS', supplier_contact: '300 111', cost: 80_000 },
    { id: 3, store_id: 1, product_id: 10, day_number: 2, sort_order: 1, start_time: null, title: 'Pago al guía', description: null, is_public: false, provider_id: null, supplier_name: null, supplier_contact: null, cost: 10_000 },
    { id: 9, store_id: 2, product_id: 10, day_number: 1, sort_order: 0, start_time: null, title: 'Ajena', description: null, is_public: true },
  ];

  const scoped = (rows: Row[]) => rows.filter((r) => r.store_id === domainStoreId);
  /** Proyecta `select` como Prisma: solo lo pedido sale de la base. */
  const project = (row: Row, select?: Row) =>
    select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]])) : { ...row };
  const delegate = (rows: Row[]) => ({
    findFirst: jest.fn(async ({ where, select }: Row) => {
      const found = scoped(rows).find((r) => matches(r, where));
      return found ? project(found, select) : null;
    }),
    findMany: jest.fn(async ({ where, select }: Row = {}) =>
      scoped(rows).filter((r) => matches(r, where)).map((r) => project(r, select)),
    ),
  });
  const prisma: any = {
    products: delegate(products),
    service_plan_pax_prices: delegate(tiers),
    service_plan_departures: delegate(departures),
    service_plan_activities: delegate(activities),
  };
  const storePrisma: any = {
    store_settings: { findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })) },
  };
  return new ServicePlanPublicService(prisma, storePrisma);
}

describe('ServicePlanPublicService (QUI-1060 F2)', () => {
  beforeEach(() => {
    domainStoreId = 1;
  });

  it('devuelve la ficha del plan de la tienda del dominio', async () => {
    const plan = await build().getPublicPlan(10);
    expect(plan).toEqual({
      product_id: 10,
      duration_days: 3,
      duration_nights: 2,
      departure_mode: 'both',
      min_pax: 2,
      max_pax: 8,
      includes: 'Hotel y desayunos',
      excludes: 'Vuelos',
      recommendations: 'Bloqueador',
      pax_prices: [{ min_pax: 2, max_pax: 4, price: 1_800_000 }],
      departures: [{ departure_date: '2099-02-10', seats_available: 6, price: 1_500_000 }],
      itinerary: [
        { day_number: 1, date: null, activities: [{ start_time: '07:00', title: 'Salida', description: 'Desde el hotel' }] },
        { day_number: 2, date: null, activities: [{ start_time: null, title: 'Lancha', description: null }] },
      ],
    });
  });

  it('no expone costo, proveedor, contacto, actividades no públicas ni datos internos del evento', async () => {
    const text = JSON.stringify(await build().getPublicPlan(10));
    for (const leaked of ['cost', '43210', 'Lanchas SAS', '300 111', 'supplier', 'provider', 'Pago al guía', 'interna', 'seats_sold', 'capacity', 'Ajena']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('eventos pasados, cerrados, cancelados o sin cupos no salen', async () => {
    const plan = await build().getPublicPlan(10);
    expect(plan.departures.map((d) => d.departure_date)).toEqual(['2099-02-10']);
  });

  it('solo el plan de esa tienda: otro dominio no lo ve', async () => {
    domainStoreId = 2;
    await expect(build().getPublicPlan(10)).rejects.toMatchObject({ errorCode: 'PROD_FIND_001' });
  });

  it('un servicio que no es plan o no está publicado no tiene ficha de plan', async () => {
    await expect(build().getPublicPlan(11)).rejects.toMatchObject({ errorCode: 'PROD_FIND_001' });
    await expect(build().getPublicPlan(12)).rejects.toMatchObject({ errorCode: 'PROD_FIND_001' });
  });
});
