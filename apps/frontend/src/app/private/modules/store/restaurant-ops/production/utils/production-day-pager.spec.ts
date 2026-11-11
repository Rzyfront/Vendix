import { Observable, Subject, of } from 'rxjs';
import { ProductionDayCard, ProductionDayResponse } from '../interfaces';
import { ProductionDayPager, mergeDayCards, sortDayCards } from './production-day-pager';

const card = (
  key: string,
  due_at: string | null,
  extra: Partial<ProductionDayCard> = {},
): ProductionDayCard => ({
  key,
  kind: 'sale',
  order_id: null,
  sale_order_number: null,
  customer_name: null,
  due_at,
  status: 'waiting',
  carried_over: false,
  production_orders: [],
  ...extra,
});

const page = (
  cards: ProductionDayCard[],
  next_cursor: string | null,
  summary = { waiting: 7, in_progress: 0, completed: 0 },
): ProductionDayResponse => ({
  date: '2026-11-10',
  timezone: 'America/Bogota',
  summary,
  cards,
  next_cursor,
});

describe('production day merge (S20)', () => {
  it('ordena con carried_over primero y luego due_at ascendente, sin hora al final', () => {
    const sorted = sortDayCards([
      card('b', '2026-11-10T15:00:00Z'),
      card('none', null),
      card('a', '2026-11-10T13:00:00Z'),
      card('old', '2026-11-10T20:00:00Z', { carried_over: true }),
    ]);
    expect(sorted.map((c) => c.key)).toEqual(['old', 'a', 'b', 'none']);
  });

  it('una key que vuelve en una página posterior se reemplaza, no se duplica, y el orden se conserva', () => {
    const first = [card('sale-1', '2026-11-10T13:00:00Z'), card('sale-2', '2026-11-10T14:00:00Z')];
    const updated = card('sale-2', '2026-11-10T14:00:00Z', { status: 'completed' });
    const merged = mergeDayCards(first, [updated, card('sale-3', '2026-11-10T13:30:00Z')]);
    expect(merged.map((c) => c.key)).toEqual(['sale-1', 'sale-3', 'sale-2']);
    expect(merged.find((c) => c.key === 'sale-2')?.status).toBe('completed');
  });
});

describe('ProductionDayPager (S20)', () => {
  it('sigue next_cursor, une por key y conserva el summary del día completo', () => {
    const calls: Array<string | null> = [];
    const pages: Record<string, ProductionDayResponse> = {
      first: page([card('sale-1', '2026-11-10T13:00:00Z')], 'c1', { waiting: 3, in_progress: 0, completed: 0 }),
      c1: page(
        [card('sale-1', '2026-11-10T13:00:00Z', { status: 'in_progress' }), card('sale-2', '2026-11-10T14:00:00Z')],
        null,
        { waiting: 3, in_progress: 0, completed: 0 },
      ),
    };
    const pager = new ProductionDayPager((_d, cursor) => {
      calls.push(cursor);
      return of(pages[cursor ?? 'first']);
    }, 'error');

    pager.load('2026-11-10', true);
    expect(pager.data()?.cards.length).toBe(1);
    pager.loadMore();
    expect(calls).toEqual([null, 'c1']);
    expect(pager.data()?.cards.map((c) => c.key)).toEqual(['sale-1', 'sale-2']);
    expect(pager.data()?.cards[0].status).toBe('in_progress');
    expect(pager.data()?.summary.waiting).toBe(3);
    expect(pager.data()?.next_cursor).toBeNull();

    pager.loadMore();
    expect(calls).toEqual([null, 'c1']);
  });

  it('cambiar de día reinicia en la página 1 y una respuesta vieja no pisa la nueva', () => {
    const slow = new Subject<ProductionDayResponse>();
    const pager = new ProductionDayPager((date): Observable<ProductionDayResponse> => {
      if (date === 'old') return slow;
      return of(page([card('new-1', '2026-11-11T13:00:00Z')], null));
    }, 'error');

    pager.load('old', true);
    pager.load('new', true);
    slow.next(page([card('old-1', '2026-11-10T13:00:00Z')], null));

    expect(pager.data()?.cards.map((c) => c.key)).toEqual(['new-1']);
  });

  it('un refresco en vivo vuelve a pedir el tramo cargado y no recorta la lista', () => {
    const calls: Array<{ cursor: string | null; limit: number }> = [];
    const pager = new ProductionDayPager((_d, cursor, limit) => {
      calls.push({ cursor, limit });
      if (cursor) return of(page([card('sale-2', '2026-11-10T14:00:00Z')], 'c2'));
      return of(
        limit > 100
          ? page([card('sale-1', '2026-11-10T13:00:00Z'), card('sale-2', '2026-11-10T14:00:00Z')], 'c2')
          : page([card('sale-1', '2026-11-10T13:00:00Z')], 'c1'),
      );
    }, 'error');
    pager.load('2026-11-10', true);
    pager.loadMore();
    expect(pager.data()?.cards.length).toBe(2);

    pager.load('2026-11-10', false);
    expect(calls[2]).toEqual({ cursor: null, limit: 200 });
    expect(pager.data()?.cards.map((c) => c.key)).toEqual(['sale-1', 'sale-2']);
    expect(pager.data()?.next_cursor).toBe('c2');
  });

  it('cambiar de día o recargar desde cero vuelve a una página de 100', () => {
    const limits: number[] = [];
    const pager = new ProductionDayPager((_d, cursor, limit) => {
      limits.push(limit);
      return of(page([card(cursor ? 'sale-2' : 'sale-1', '2026-11-10T13:00:00Z')], cursor ? null : 'c1'));
    }, 'error');
    pager.load('2026-11-10', true);
    pager.loadMore();
    pager.load('2026-11-11', false);
    pager.load('2026-11-11', true);
    expect(limits).toEqual([100, 100, 100, 100]);
  });

  it('el refresco nunca pide más de 500 (tope del backend)', () => {
    const limits: number[] = [];
    let n = 0;
    const pager = new ProductionDayPager((_d, cursor, limit) => {
      limits.push(limit);
      n += 1;
      return of(page([card(`sale-${n}`, '2026-11-10T13:00:00Z')], `c${n}`));
    }, 'error');
    pager.load('2026-11-10', true);
    for (let i = 0; i < 6; i++) pager.loadMore();
    pager.load('2026-11-10', false);
    expect(limits[limits.length - 1]).toBe(500);
  });
});
