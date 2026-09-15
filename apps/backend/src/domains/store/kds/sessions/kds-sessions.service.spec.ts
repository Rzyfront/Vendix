import { RequestContextService } from '@common/context/request-context.service';
import { KdsSessionsService } from './kds-sessions.service';

/**
 * Regresión — "el primer ticket que entra al KDS no registra consumo".
 *
 * Cadena del bug (verificada en código, sin DB):
 *  - El fire consume stock SIEMPRE, pero si la estación no tiene sesión
 *    abierta estampa `kds_session_id = NULL`
 *    (`kitchen-fire.service.ts:753-764 openSessionByKds`, `:812-815
 *    itemKdsSessionId`, `:848 kds_session_id: itemKdsSessionId`).
 *  - Actuar sobre el ticket sin sesión está permitido
 *    (`assertCanMutateStationTicket` caso 1: `if (!session) return`), pero
 *    el imputador por acción devuelve 0 sin sesión abierta
 *    (`attributeOpenSessionToTicketConsumption`: `if (!openSession)
 *    return 0`).
 *  - `open()` no hacía backfill (rediseño QUI-760, commit 9feb96896), así
 *    que el consumo disparado + cocinado sin sesión quedaba huérfano para
 *    siempre y el detalle/resumen del turno (filtran por
 *    `kds_session_id`) no lo mostraba.
 *
 * El fix: `open()` reclama en `backfillOrphanConsumption` las
 * `inventory_transactions` con `kds_session_id IS NULL` de tickets de SU
 * estación (`ticket.kds_id = dto.kds_id`). Estos tests lo cubren con un
 * fake en memoria que interpreta el `where` REAL que el servicio pasa al
 * `updateMany` — si el servicio olvidara el filtro por kds_id, el fake
 * estamparía la estación vecina y el test 2 fallaría.
 */

type FakeTicket = { id: number; kds_id: number; store_id: number };
type FakeOrderItem = {
  id: number;
  inventory_consumed_at_fire: boolean;
  /** Join `kitchen_ticket_items`: tickets a los que pertenece el item. */
  ticketIds: number[];
};
type FakeTxn = {
  id: number;
  kds_session_id: number | null;
  order_item_id: number | null;
};
type FakeSession = {
  id: number;
  kds_id: number;
  store_id: number;
  opened_by: number;
  status: string;
};

const STORE_ID = 10;
const USER_ID = 5;

describe('KdsSessionsService — backfill de huérfanos al abrir turno', () => {
  let service: KdsSessionsService;
  let prismaMock: any;
  let tickets: Map<number, FakeTicket>;
  let orderItems: Map<number, FakeOrderItem>;
  let txns: FakeTxn[];
  let sessions: FakeSession[];
  let nextSessionId: number;

  /** Emula la semántica del `where` anidado sobre el fake en memoria. */
  function matchTxn(t: FakeTxn, where: any): boolean {
    if (where?.kds_session_id === null && t.kds_session_id !== null) {
      return false;
    }
    if (where?.order_item_id?.not === null && t.order_item_id == null) {
      return false;
    }
    const oi = where?.order_items;
    if (oi) {
      const item = orderItems.get(t.order_item_id!);
      if (!item) return false;
      if (
        oi.inventory_consumed_at_fire === true &&
        item.inventory_consumed_at_fire !== true
      ) {
        return false;
      }
      const ticketFilter = oi.kitchen_ticket_items?.some?.kitchen_ticket;
      if (ticketFilter) {
        const ok = item.ticketIds.some((tid) => {
          const tk = tickets.get(tid);
          return (
            tk &&
            (ticketFilter.kds_id === undefined ||
              tk.kds_id === ticketFilter.kds_id) &&
            (ticketFilter.store_id === undefined ||
              tk.store_id === ticketFilter.store_id)
          );
        });
        if (!ok) return false;
      }
    }
    return true;
  }

  beforeEach(() => {
    tickets = new Map();
    orderItems = new Map();
    txns = [];
    sessions = [];
    nextSessionId = 100;

    prismaMock = {
      kds: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      kds_sessions: {
        findFirst: jest.fn(async ({ where }: any) =>
          sessions.find(
            (s) =>
              (where?.kds_id === undefined || s.kds_id === where.kds_id) &&
              (where?.status === undefined || s.status === where.status),
          ),
        ),
        create: jest.fn(async ({ data }: any) => {
          const session: FakeSession = {
            id: nextSessionId++,
            kds_id: data.kds_id,
            store_id: data.store_id,
            opened_by: data.opened_by,
            status: 'open',
          };
          sessions.push(session);
          return {
            ...session,
            kds: { id: data.kds_id, name: 'Cocina', code: 'K1' },
            opened_by_user: {
              id: data.opened_by,
              first_name: 'Ana',
              last_name: 'Cocina',
            },
          };
        }),
      },
      kitchen_tickets: {
        findFirst: jest.fn(async ({ where }: any) => {
          const tk = tickets.get(where?.id);
          return tk && tk.store_id === where?.store_id ? tk : null;
        }),
      },
      inventory_transactions: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const t of txns) {
            if (!matchTxn(t, where)) continue;
            t.kds_session_id = data.kds_session_id;
            count++;
          }
          return { count };
        }),
      },
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID, user_id: USER_ID, roles: [] } as any);

    service = new KdsSessionsService(prismaMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sin sesión abierta, el imputador devuelve 0 y el huérfano sigue NULL (condición que crea el fire sin sesión)', async () => {
    // El fire sin sesión abierta estampa NULL (kitchen-fire consume igual,
    // solo deja la fila sin dueño). Semilla directa de esa condición.
    tickets.set(11, { id: 11, kds_id: 1, store_id: STORE_ID });
    orderItems.set(21, {
      id: 21,
      inventory_consumed_at_fire: true,
      ticketIds: [11],
    });
    txns.push({ id: 31, kds_session_id: null, order_item_id: 21 });

    const stamped =
      await service.attributeOpenSessionToTicketConsumption(11);

    expect(stamped).toBe(0);
    expect(txns[0].kds_session_id).toBeNull();
  });

  it('open() imputa huérfanos de SU estación y NO los de otra (ni ventas ni ya imputados)', async () => {
    tickets.set(11, { id: 11, kds_id: 1, store_id: STORE_ID });
    tickets.set(12, { id: 12, kds_id: 2, store_id: STORE_ID });
    orderItems.set(21, {
      id: 21,
      inventory_consumed_at_fire: true,
      ticketIds: [11],
    });
    orderItems.set(22, {
      id: 22,
      inventory_consumed_at_fire: true,
      ticketIds: [12],
    });
    // Venta normal (nunca pasó por cocina): no elegible aunque el flag
    // falte, el join por ticket tampoco la alcanza.
    orderItems.set(23, {
      id: 23,
      inventory_consumed_at_fire: false,
      ticketIds: [],
    });
    txns.push(
      { id: 31, kds_session_id: null, order_item_id: 21 }, // huérfano KDS 1
      { id: 32, kds_session_id: null, order_item_id: 22 }, // huérfano KDS 2
      { id: 33, kds_session_id: 9, order_item_id: 21 }, // ya imputado
      { id: 34, kds_session_id: null, order_item_id: 23 }, // venta, no cocina
    );

    const logSpy = jest.spyOn((service as any).logger, 'log');
    const session = await service.open({ kds_id: 1 } as any);

    // El contrato del POST open no cambia: devuelve la sesión.
    expect(session.kds_id).toBe(1);
    expect(session.status).toBe('open');

    // Solo el huérfano de la estación 1 queda firmado con la sesión nueva.
    expect(txns[0].kds_session_id).toBe(session.id);
    expect(txns[1].kds_session_id).toBeNull();
    expect(txns[2].kds_session_id).toBe(9);
    expect(txns[3].kds_session_id).toBeNull();

    // El conteo del backfill va a logs, no al contrato.
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('backfilled 1 orphan'),
    );

    // El `where` lleva el filtro estricto por kds_id del ticket + tienda,
    // la guarda IS NULL, el flag de fire y NINGÚN filtro por `type`
    // (invariante documentada en el servicio).
    const { where, data } =
      prismaMock.inventory_transactions.updateMany.mock.calls[0][0];
    expect(data).toEqual({ kds_session_id: session.id });
    expect(where).toEqual(
      expect.objectContaining({
        kds_session_id: null,
        order_item_id: { not: null },
        order_items: expect.objectContaining({
          inventory_consumed_at_fire: true,
          kitchen_ticket_items: expect.objectContaining({
            some: expect.objectContaining({
              kitchen_ticket: expect.objectContaining({
                kds_id: 1,
                store_id: STORE_ID,
              }),
            }),
          }),
        }),
      }),
    );
    expect(where).not.toHaveProperty('type');
  });

  it('idempotente: tras el backfill, la primera acción ya no estampa nada (0 filas) y reabrir es imposible con sesión abierta', async () => {
    tickets.set(11, { id: 11, kds_id: 1, store_id: STORE_ID });
    orderItems.set(21, {
      id: 21,
      inventory_consumed_at_fire: true,
      ticketIds: [11],
    });
    txns.push({ id: 31, kds_session_id: null, order_item_id: 21 });

    const session = await service.open({ kds_id: 1 } as any);
    expect(txns[0].kds_session_id).toBe(session.id);

    // Segunda llamada (la que haría `start`/`ready`/`delivered` vía el
    // imputador): la guarda IS NULL la deja en 0 filas.
    const second = await service.attributeOpenSessionToTicketConsumption(11);
    expect(second).toBe(0);
    expect(txns[0].kds_session_id).toBe(session.id);

    // Y no se puede abrir dos veces: el índice parcial + guard lo impiden,
    // así que ningún segundo turno puede reclamar lo ya firmado.
    await expect(service.open({ kds_id: 1 } as any)).rejects.toThrow();
  });
});
