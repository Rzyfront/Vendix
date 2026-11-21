jest.mock('../../../../common/utils/store-timezone.util', () => ({
  ...jest.requireActual('../../../../common/utils/store-timezone.util'),
  resolveStoreTimezone: jest.fn(async () => 'America/Bogota'),
}));

import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  buildVexSuggestions,
  VEX_SUGGESTIONS_MAX,
  VexStoreSnapshot,
  VexSuggestionsService,
} from './vex-suggestions.service';

const quiet: VexStoreSnapshot = {
  has_inventory: true,
  low_stock_count: 0,
  open_cash_sessions: 0,
  reminders_due_today: 0,
};

const ids = (snapshot: VexStoreSnapshot) =>
  buildVexSuggestions(snapshot).map((suggestion) => suggestion.id);

describe('buildVexSuggestions (welcome suggestions follow the store)', () => {
  it('offers «restock» to a store with stock under its minimum, with the count', () => {
    const suggestions = buildVexSuggestions({ ...quiet, low_stock_count: 3 });
    expect(suggestions).toContainEqual({ id: 'restock', count: 3 });
  });

  it('does not offer «restock» when no stock is under its minimum', () => {
    expect(ids(quiet)).not.toContain('restock');
  });

  it('never offers stock questions to a store without inventory', () => {
    const result = ids({ ...quiet, has_inventory: false, low_stock_count: 5 });
    expect(result).not.toContain('restock');
    expect(result).not.toContain('top_products');
    expect(result).toEqual(['sales_today', 'overdue_receivables']);
  });

  it('puts real pending work first: reminders, open cash register, low stock', () => {
    expect(
      ids({
        has_inventory: true,
        low_stock_count: 2,
        open_cash_sessions: 1,
        reminders_due_today: 4,
      }),
    ).toEqual(['reminders_today', 'cash_close', 'restock', 'sales_today']);
  });

  it('never returns more than the welcome screen shows', () => {
    const all = buildVexSuggestions({
      has_inventory: true,
      low_stock_count: 1,
      open_cash_sessions: 1,
      reminders_due_today: 1,
    });
    expect(all).toHaveLength(VEX_SUGGESTIONS_MAX);
  });

  it('falls back to the evergreen questions for a quiet store', () => {
    expect(ids(quiet)).toEqual(['sales_today', 'top_products', 'overdue_receivables']);
  });
});

describe('VexSuggestionsService.readSnapshot', () => {
  const reorderField = { name: 'reorder_point' };

  function makePrisma(counts: { stock: number; low: number; cash: number; reminders: number }) {
    return {
      stock_levels: {
        fields: { reorder_point: reorderField },
        count: jest.fn(async (args?: { where?: unknown }) =>
          args?.where ? counts.low : counts.stock,
        ),
      },
      cash_register_sessions: { count: jest.fn(async () => counts.cash) },
      user_reminders: { count: jest.fn(async () => counts.reminders) },
    };
  }

  function withContext<T>(context: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    return RequestContextService.asyncLocalStorage.run(context as never, run);
  }

  it('reads the four counts for the caller and compares stock against its own reorder point', async () => {
    const prisma = makePrisma({ stock: 40, low: 3, cash: 1, reminders: 2 });
    const service = new VexSuggestionsService(prisma as never);

    const snapshot = await withContext({ store_id: 7, user_id: 21 }, () =>
      service.readSnapshot(),
    );

    expect(snapshot).toEqual({
      has_inventory: true,
      low_stock_count: 3,
      open_cash_sessions: 1,
      reminders_due_today: 2,
    });
    expect(prisma.stock_levels.count).toHaveBeenCalledWith({
      where: {
        reorder_point: { not: null },
        quantity_available: { lte: reorderField },
      },
    });
    expect(prisma.cash_register_sessions.count).toHaveBeenCalledWith({
      where: { status: 'open' },
    });
    const reminderWhere = prisma.user_reminders.count.mock.calls[0] as unknown as [
      { where: { user_id: number; status: string; remind_at: { lt: Date } } },
    ];
    expect(reminderWhere[0].where.user_id).toBe(21);
    expect(reminderWhere[0].where.status).toBe('pending');
    expect(reminderWhere[0].where.remind_at.lt.getTime()).toBeGreaterThan(Date.now());
  });

  it('degrades a failed count to zero instead of breaking the welcome screen', async () => {
    const prisma = makePrisma({ stock: 10, low: 0, cash: 0, reminders: 0 });
    prisma.cash_register_sessions.count.mockRejectedValueOnce(new Error('boom'));
    const service = new VexSuggestionsService(prisma as never);

    const snapshot = await withContext({ store_id: 7, user_id: 21 }, () =>
      service.readSnapshot(),
    );

    expect(snapshot.open_cash_sessions).toBe(0);
    expect(snapshot.has_inventory).toBe(true);
  });

  it('returns only evergreen questions when there is no store in context', async () => {
    const prisma = makePrisma({ stock: 10, low: 4, cash: 1, reminders: 1 });
    const service = new VexSuggestionsService(prisma as never);

    const suggestions = await withContext({}, () => service.getSuggestions());

    expect(suggestions.map((s) => s.id)).toEqual(['sales_today', 'overdue_receivables']);
    expect(prisma.stock_levels.count).not.toHaveBeenCalled();
  });
});
