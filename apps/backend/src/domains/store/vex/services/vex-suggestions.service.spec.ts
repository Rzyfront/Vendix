jest.mock('../../../../common/utils/store-timezone.util', () => ({
  ...jest.requireActual('../../../../common/utils/store-timezone.util'),
  resolveStoreTimezone: jest.fn(async () => 'America/Bogota'),
}));

import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  buildVexSuggestions,
  buildVexVisibility,
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

describe('welcome suggestions follow role, industry and visible modules', () => {
  const busy: VexStoreSnapshot = {
    has_inventory: true,
    low_stock_count: 2,
    open_cash_sessions: 1,
    reminders_due_today: 1,
  };
  const idsFor = (input: Parameters<typeof buildVexVisibility>[0]) =>
    buildVexSuggestions(busy, buildVexVisibility(input)).map((s) => s.id);
  const owner = { isOwner: true, roles: ['owner'] };
  const admin = { isOwner: false, roles: ['admin'] };

  it('keeps the previous suggestions when nothing is hidden', () => {
    expect(idsFor({ ...owner, industries: ['retail'] })).toEqual(
      buildVexSuggestions(busy).map((s) => s.id),
    );
  });

  it('hides the module of a suggestion the admin was denied in their own panel_ui', () => {
    const result = idsFor({ ...admin, userPanelUi: { inventory: false } });
    expect(result).toEqual(['reminders_today', 'cash_close', 'sales_today', 'top_products']);
  });

  it('lets the owner bypass their own panel_ui', () => {
    expect(idsFor({ ...owner, userPanelUi: { inventory: false } })).toContain('restock');
  });

  it('does not offer module suggestions to a role that is not privileged unless its panel_ui allows them', () => {
    const result = idsFor({
      isOwner: false,
      roles: ['cashier'],
      userPanelUi: { orders_sales: true },
    });
    expect(result).toEqual(['reminders_today', 'sales_today']);
  });

  it('hides the module of a suggestion hidden for the store', () => {
    const result = idsFor({ ...owner, storePanelUi: { settings_cash_registers: false } });
    expect(result).not.toContain('cash_close');
    expect(result).toEqual(['reminders_today', 'restock', 'sales_today', 'top_products']);
  });

  it('does not offer receivables when cartera is hidden for the store', () => {
    const quiet2 = buildVexSuggestions(
      { ...busy, open_cash_sessions: 0, low_stock_count: 0, reminders_due_today: 0 },
      buildVexVisibility({ ...owner, storePanelUi: { cartera_receivables: false } }),
    ).map((s) => s.id);
    expect(quiet2).toEqual(['sales_today', 'top_products']);
  });

  it('applies the industry map (today every gated module is enabled for all industries, so none is hidden)', () => {
    const visible = buildVexVisibility({ ...owner, industries: ['administration'] });
    expect(visible('reminders_today')).toBe(true);
    expect(visible('sales_today')).toBe(true);
  });

  it('does not throw nor restrict when settings are missing', () => {
    const visible = buildVexVisibility({ ...owner, industries: null });
    expect(buildVexSuggestions(busy, visible).map((s) => s.id)).toEqual(
      buildVexSuggestions(busy).map((s) => s.id),
    );
  });
});

describe('VexSuggestionsService.readVisibility (scoped to the context store and user)', () => {
  function withContext<T>(context: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    return RequestContextService.asyncLocalStorage.run(context as never, run);
  }

  function makePrisma() {
    return {
      stores: { findUnique: jest.fn(async () => ({ industries: ['retail'] })) },
      store_settings: {
        findFirst: jest.fn(async () => ({
          settings: { panel_ui: { STORE_ADMIN: { inventory: false } } },
        })),
      },
      user_settings: {
        findFirst: jest.fn(async () => ({
          config: { panel_ui: { STORE_ADMIN: { cartera_receivables: false } } },
        })),
      },
    };
  }

  it('reads industry and panel_ui by the context store and user, never another', async () => {
    const prisma = makePrisma();
    const service = new VexSuggestionsService(prisma as never);

    const isVisible = await withContext(
      { store_id: 7, user_id: 21, roles: ['admin'], is_owner: false },
      () => service.readVisibility(),
    );

    expect(prisma.stores.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { industries: true },
    });
    expect(prisma.store_settings.findFirst).toHaveBeenCalledWith({
      where: { store_id: 7 },
      select: { settings: true },
    });
    expect(prisma.user_settings.findFirst).toHaveBeenCalledWith({
      where: { user_id: 21 },
      select: { config: true },
    });
    expect(isVisible('restock')).toBe(false);
    expect(isVisible('overdue_receivables')).toBe(false);
    expect(isVisible('sales_today')).toBe(true);
  });

  it('a setting of store B never hides a suggestion of store A', async () => {
    const prisma = makePrisma();
    prisma.store_settings.findFirst.mockImplementation((async (args: {
      where: { store_id: number };
    }) =>
      args.where.store_id === 8
        ? { settings: { panel_ui: { STORE_ADMIN: { inventory: false } } } }
        : { settings: {} }) as never);
    const service = new VexSuggestionsService(prisma as never);

    const isVisible = await withContext(
      { store_id: 7, user_id: 21, roles: ['owner'], is_owner: true },
      () => service.readVisibility(),
    );

    expect(isVisible('restock')).toBe(true);
  });

  it('answers with every suggestion when settings cannot be read', async () => {
    const prisma = makePrisma();
    prisma.stores.findUnique.mockRejectedValue(new Error('boom'));
    prisma.store_settings.findFirst.mockRejectedValue(new Error('boom'));
    prisma.user_settings.findFirst.mockRejectedValue(new Error('boom'));
    const service = new VexSuggestionsService(prisma as never);

    const isVisible = await withContext(
      { store_id: 7, user_id: 21, roles: ['admin'], is_owner: false },
      () => service.readVisibility(),
    );

    expect(isVisible('restock')).toBe(true);
    expect(isVisible('cash_close')).toBe(true);
  });
});
