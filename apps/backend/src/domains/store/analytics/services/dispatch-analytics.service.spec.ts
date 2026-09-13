import {
  pickActiveStop,
  resolveCarrier,
  DispatchAnalyticsService,
} from './dispatch-analytics.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * CP-despachos-reportes B.1: helpers puros compartidos por pantalla y export
 * (ADR-01 cascada del portador, ADR-02 grano una-línea-por-orden). Sin DB.
 */

describe('pickActiveStop (ADR-02)', () => {
  it('sin paradas → null y no reasignada', () => {
    expect(pickActiveStop([])).toEqual({ stop: null, reasignada: false });
  });

  it('una parada → esa, no reasignada', () => {
    const s = { id: 1, status: 'pending', settled_at: null };
    expect(pickActiveStop([s])).toEqual({ stop: s, reasignada: false });
  });

  it('terminal gana a pendiente aunque sea más vieja', () => {
    const pending = { id: 2, status: 'pending', settled_at: null };
    const delivered = {
      id: 1,
      status: 'delivered',
      settled_at: new Date('2026-06-19T06:00:00Z'),
    };
    expect(pickActiveStop([pending, delivered]).stop).toBe(delivered);
  });

  it('released solo cuando no hay otra + marca reasignada', () => {
    const released = { id: 5, status: 'released', settled_at: null };
    const r = pickActiveStop([released, { ...released, id: 6 }]);
    expect(r.stop?.id).toBe(6);
    expect(r.reasignada).toBe(true);
  });
});

describe('resolveCarrier (ADR-01)', () => {
  const note = { courier_name: null, delivered_by_name: null, settled_by_name: null };

  it('conductor externo primario', () => {
    expect(
      resolveCarrier(
        {
          is_primary_driver_external: true,
          external_driver_name: 'Carlos Conductor',
          driver_name: null,
          assistant_names: [],
        },
        note,
      ),
    ).toEqual({ nombre: 'Carlos Conductor', tipo: 'conductor_externo' });
  });

  it('conductor interno', () => {
    expect(
      resolveCarrier(
        {
          is_primary_driver_external: false,
          external_driver_name: null,
          driver_name: 'Ana Interna',
          assistant_names: [],
        },
        note,
      ),
    ).toEqual({ nombre: 'Ana Interna', tipo: 'conductor_interno' });
  });

  it('auxiliar cuando la ruta no tiene conductor', () => {
    expect(
      resolveCarrier(
        {
          is_primary_driver_external: false,
          external_driver_name: null,
          driver_name: null,
          assistant_names: [null, 'Pedro Aux'],
        },
        note,
      ),
    ).toEqual({ nombre: 'Pedro Aux', tipo: 'auxiliar' });
  });

  it('domiciliario sin ruta', () => {
    expect(
      resolveCarrier(null, { ...note, courier_name: 'Domi Rápido' }),
    ).toEqual({ nombre: 'Domi Rápido', tipo: 'domiciliario' });
  });

  it('fallbacks registrado_por y null total', () => {
    expect(
      resolveCarrier(null, { ...note, delivered_by_name: 'Carlos Rodríguez' }),
    ).toEqual({ nombre: 'Carlos Rodríguez', tipo: 'registrado_por' });
    expect(resolveCarrier(null, note)).toEqual({ nombre: null, tipo: null });
  });
});

/**
 * PLAN-analytics-despachos-2026-09-12 Paso 2 — agregados KPI. Mock de
 * `StorePrismaService` siguiendo el patrón ya establecido en
 * `customers-analytics.service.spec.ts` (delegates como `jest.fn()`,
 * `RequestContextService.getContext` espiado en vez de `.run()`/ALS).
 *
 * `dispatch_notes.findMany` se mockea con una implementación que SÍ filtra
 * por `where.store_id` y `where.emission_date` (simula el comportamiento
 * real de Postgres para esos dos predicados) para poder probar la fuga de
 * F-001 a nivel de RESULTADO, no solo de forma del `where`.
 */
type MockDispatchPrisma = {
  dispatch_notes: { findMany: jest.Mock };
  dispatch_routes: { findMany: jest.Mock };
  store_settings: { findFirst: jest.Mock };
  withoutScope: jest.Mock;
};

/** Nota de despacho con una única parada entregada y pagada en efectivo. */
function makeAggNote(overrides: {
  id: number;
  store_id: number;
  emission_date?: Date;
}) {
  return {
    id: overrides.id,
    store_id: overrides.store_id,
    emission_date: overrides.emission_date ?? new Date('2026-07-15T15:00:00Z'),
    status: 'delivered',
    subtype: 'customer_delivery',
    grand_total: 100000,
    courier_name: null,
    delivered_by_user: null,
    dispatch_route_stops: [
      {
        id: overrides.id * 10,
        status: 'delivered',
        settled_at: new Date('2026-07-15T18:00:00Z'),
        is_prepaid: false,
        payment_method: 'cash',
        collected_amount: 100000,
        anticipo_amount: 0,
        withholding_amount: 0,
        withholding_breakdown: null,
        route: {
          id: overrides.id * 100,
          is_carrier_route: false,
          is_primary_driver_external: false,
          external_driver_name: null,
          driver_user: { first_name: 'Ana', last_name: 'Interna' },
          assistants: [],
        },
        settled_by_user: null,
      },
    ],
  };
}

describe('DispatchAnalyticsService — agregados (PLAN-analytics-despachos-2026-09-12 Paso 2)', () => {
  let service: DispatchAnalyticsService;
  let prisma: MockDispatchPrisma;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      dispatch_notes: { findMany: jest.fn() },
      // `getDispatchSummary` resuelve las métricas de flota (active/closed
      // routes, avg_cycle_hours, cash_variance) con una segunda query contra
      // `dispatch_routes` acotada a las rutas tocadas en el período —
      // default vacío; el test F-001 lo sobreescribe con una fixture.
      dispatch_routes: { findMany: jest.fn().mockResolvedValue([]) },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      withoutScope: jest.fn(),
    };
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 10, is_super_admin: false, is_owner: false });
    service = new DispatchAnalyticsService(prisma as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('F-001: una nota de OTRA tienda no aparece en getDispatchSummary, y el where filtra store_id explícito (nota y ruta anidada)', async () => {
    const fixture = [
      makeAggNote({ id: 1, store_id: 10 }), // tienda del contexto
      makeAggNote({ id: 2, store_id: 99 }), // tienda ajena — NO debe fugar
    ];
    prisma.dispatch_notes.findMany.mockImplementation((args: any) => {
      const { store_id, emission_date } = args.where;
      const rows = fixture.filter((n) => {
        if (store_id !== undefined && n.store_id !== store_id) return false;
        if (emission_date?.gte && n.emission_date < emission_date.gte)
          return false;
        if (emission_date?.lte && n.emission_date > emission_date.lte)
          return false;
        return true;
      });
      return Promise.resolve(rows);
    });

    // Ruta tocada por la nota de la tienda 10 (id = 1 * 100, ver makeAggNote)
    // — cerrada, con ciclo y cash_variance persistido, para ejercitar las
    // métricas de flota nuevas del contrato DispatchSummary.
    prisma.dispatch_routes.findMany.mockResolvedValue([
      {
        id: 100,
        status: 'closed',
        dispatch_started_at: new Date('2026-07-15T14:00:00Z'),
        closed_at: new Date('2026-07-15T20:00:00Z'),
        cash_variance: 500,
        stops: [{ id: 10 }],
      },
    ]);

    const result = await service.getDispatchSummary({
      date_from: '2026-07-01',
      date_to: '2026-07-31',
      route_type: 'all',
    } as any);

    // Resultado: solo la nota de la tienda 10 cuenta — F-001 no se repite.
    // `total_deliveries` es semántico (entregas CUMPLIDAS), no el conteo de
    // remisiones — aquí coinciden (1 nota, 1 parada delivered).
    expect(result.total_dispatch_notes).toBe(1);
    expect(result.total_deliveries).toBe(1);
    expect(result.cash_collected).toBe(100000);

    // Métricas de flota derivadas de la ruta tocada por esa nota.
    expect(result.total_routes).toBe(1);
    expect(result.active_routes).toBe(0);
    expect(result.closed_routes).toBe(1);
    expect(result.avg_stops_per_route).toBe(1);
    expect(result.avg_cycle_hours).toBe(6); // 20:00 - 14:00
    expect(result.cash_variance).toBe(500);

    // Forma del where: store_id explícito en la nota Y en la ruta anidada
    // (dispatch_routes/dispatch_route_stops NO están en store_scoped_models).
    const currentPeriodCall = prisma.dispatch_notes.findMany.mock.calls[0][0];
    expect(currentPeriodCall.where.store_id).toBe(10);
    expect(currentPeriodCall.where.dispatch_route_stops.some.route.store_id).toBe(
      10,
    );
    expect(
      currentPeriodCall.include.dispatch_route_stops.where.route.store_id,
    ).toBe(10);

    // La segunda query (métricas de flota) también repite store_id explícito
    // — misma causa raíz F-001, mismo remedio.
    const routesCall = prisma.dispatch_routes.findMany.mock.calls[0][0];
    expect(routesCall.where.store_id).toBe(10);
    expect(routesCall.where.id.in).toEqual([100]);
  });

  it('cash_collected de getDispatchCollections reconcilia con declared_cash - cash_variance de una ruta cerrada', async () => {
    prisma.dispatch_routes.findMany.mockResolvedValue([
      {
        id: 55,
        route_number: 'PLN260715-0001',
        status: 'closed',
        planned_date: new Date('2026-07-15T10:00:00Z'),
        total_prepaid: 10000,
        declared_cash: 85200,
        cash_variance: 200,
        stops: [
          // cash, no prepaga → cuenta: 50000
          {
            status: 'delivered',
            is_prepaid: false,
            payment_method: 'cash',
            collected_amount: 50000,
            anticipo_amount: 0,
            withholding_amount: 0,
            withholding_breakdown: null,
            dispatch_note: { grand_total: 50000 },
          },
          // payment_method null == efectivo por default conservador → cuenta: 35000
          {
            status: 'delivered',
            is_prepaid: false,
            payment_method: null,
            collected_amount: 30000,
            anticipo_amount: 5000,
            withholding_amount: 0,
            withholding_breakdown: null,
            dispatch_note: { grand_total: 35000 },
          },
          // transferencia → excluida del recaudo en CAJA
          {
            status: 'rejected',
            is_prepaid: false,
            payment_method: 'transfer',
            collected_amount: 20000,
            anticipo_amount: 0,
            withholding_amount: 0,
            withholding_breakdown: null,
            dispatch_note: { grand_total: 20000 },
          },
          // prepagada → excluida del recaudo en caja (ya se cobró antes)
          {
            status: 'delivered',
            is_prepaid: true,
            payment_method: 'cash',
            collected_amount: 10000,
            anticipo_amount: 0,
            withholding_amount: 0,
            withholding_breakdown: null,
            dispatch_note: { grand_total: 10000 },
          },
        ],
      },
    ]);

    const result = await service.getDispatchCollections({
      date_from: '2026-07-01',
      date_to: '2026-07-31',
      route_type: 'all',
    } as any);

    expect(result.routes).toHaveLength(1);
    const row = result.routes[0];

    // 50000 (cash) + 35000 (null == cash) = 85000; transfer y prepagada excluidas.
    expect(row.cash_collected).toBe(85000);

    // Reconciliación exigida por el plan (E2E #2): cash_collected fresco del
    // contrato == declared_cash - cash_variance PERSISTIDOS en el cierre.
    expect(row.declared_cash).toBe(85200);
    expect(row.cash_variance).toBe(200);
    expect(row.cash_collected).toBe(row.declared_cash! - row.cash_variance!);

    const callArgs = prisma.dispatch_routes.findMany.mock.calls[0][0];
    expect(callArgs.where.store_id).toBe(10);
  });
});
