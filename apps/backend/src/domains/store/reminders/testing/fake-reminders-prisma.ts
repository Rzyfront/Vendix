/**
 * In-memory tables for the QUI-580 isolation specs. They honour the `where`
 * the code sends (equality, `null`, `lt/lte/gte`, `in`, `not`, `contains`,
 * `AND`/`OR`, relation filters and `some`) and apply NO tenant scope of their
 * own, so a spec passes only when the code itself filters by store and user.
 * `select` is ignored: rows come back whole.
 */
type Row = Record<string, any>;

const OPERATORS = new Set(['lt', 'lte', 'gte', 'in', 'not', 'contains', 'mode', 'some', 'none']);

const isOperatorObject = (condition: Row) =>
  Object.keys(condition).every((key) => OPERATORS.has(key));

function matchesValue(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date) {
    return value instanceof Date && value.getTime() === condition.getTime();
  }
  if (typeof condition === 'object') {
    const ops = condition as Row;
    // A relation filter: the nested `where` applies to the related row.
    if (!isOperatorObject(ops)) {
      return !!value && typeof value === 'object' && matchesWhere(value as Row, ops);
    }
    if ('some' in ops) {
      return Array.isArray(value) && value.some((item) => matchesWhere(item, ops.some));
    }
    if ('none' in ops) {
      return !Array.isArray(value) || !value.some((item) => matchesWhere(item, ops.none));
    }
    if ('not' in ops && matchesValue(value, ops.not)) return false;
    if ('in' in ops && !(ops.in as unknown[]).includes(value)) return false;
    if ('contains' in ops) {
      if (typeof value !== 'string') return false;
      const insensitive = ops.mode === 'insensitive';
      const haystack = insensitive ? value.toLowerCase() : value;
      const needle = insensitive ? String(ops.contains).toLowerCase() : String(ops.contains);
      if (!haystack.includes(needle)) return false;
    }
    if ('lt' in ops || 'lte' in ops || 'gte' in ops) {
      if (value === null || value === undefined) return false;
      const v = value instanceof Date ? value.getTime() : (value as number);
      const at = (x: any) => (x instanceof Date ? x.getTime() : x);
      if ('lt' in ops && !(v < at(ops.lt))) return false;
      if ('lte' in ops && !(v <= at(ops.lte))) return false;
      if ('gte' in ops && !(v >= at(ops.gte))) return false;
    }
    return true;
  }
  return value === condition;
}

export function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') {
      return (condition as Row[]).every((part) => matchesWhere(row, part));
    }
    if (key === 'OR') {
      return (condition as Row[]).some((part) => matchesWhere(row, part));
    }
    return matchesValue(row[key], condition);
  });
}

/** A read-only table: `findMany`/`findFirst`/`findUnique` over seeded rows. */
export function fakeTable(seed: Row[] = []) {
  const rows = seed.map((row) => ({ ...row }));
  return {
    rows,
    findMany: jest.fn(async ({ where, take }: Row = {}) =>
      rows
        .filter((r) => matchesWhere(r, where))
        .slice(0, take ?? undefined)
        .map((r) => ({ ...r })),
    ),
    findFirst: jest.fn(async ({ where }: Row = {}) => {
      const row = rows.find((r) => matchesWhere(r, where));
      return row ? { ...row } : null;
    }),
    findUnique: jest.fn(async ({ where }: Row = {}) => {
      const row = rows.find((r) => matchesWhere(r, where));
      return row ? { ...row } : null;
    }),
  };
}

/** Records a reminder can link to, per table (all optional). */
export interface FakeLinkRecords {
  products?: Row[];
  orders?: Row[];
  store_users?: Row[];
  suppliers?: Row[];
  purchase_orders?: Row[];
  quotations?: Row[];
  invoices?: Row[];
  fiscal_obligations?: Row[];
}

/** Store 1 sells "Coca-Cola 1.5L" (id 501), the product the specs link to. */
const DEFAULT_RECORDS: FakeLinkRecords = {
  products: [{ id: 501, store_id: 1, name: 'Coca-Cola 1.5L', sku: 'CC15', state: 'active' }],
};

export function createFakeRemindersPrisma(
  seed: Row[] = [],
  records: FakeLinkRecords = DEFAULT_RECORDS,
) {
  const rows: Row[] = seed.map((row) => ({ ...row }));
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
  const base = {
    note: null,
    remind_at: null,
    status: 'pending',
    link_type: null,
    link_id: null,
    link_label: null,
    source: 'manual',
    notified_at: null,
    completed_at: null,
  };
  rows.forEach((row, i) => {
    rows[i] = {
      ...base,
      created_at: new Date('2026-11-01T00:00:00Z'),
      updated_at: new Date('2026-11-01T00:00:00Z'),
      ...row,
    };
  });

  const user_reminders = {
    findMany: jest.fn(async ({ where, take }: Row = {}) =>
      rows.filter((r) => matchesWhere(r, where)).slice(0, take ?? undefined).map((r) => ({ ...r })),
    ),
    findFirst: jest.fn(async ({ where }: Row = {}) => {
      const row = rows.find((r) => matchesWhere(r, where));
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: Row) => {
      const now = new Date();
      const row = { ...base, ...data, id: nextId++, created_at: now, updated_at: now };
      rows.push(row);
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hits = rows.filter((r) => matchesWhere(r, where));
      hits.forEach((r) => Object.assign(r, data, { updated_at: new Date() }));
      return { count: hits.length };
    }),
    deleteMany: jest.fn(async ({ where }: Row) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchesWhere(rows[i], where)) {
          rows.splice(i, 1);
          count++;
        }
      }
      return { count };
    }),
  };

  return {
    rows,
    user_reminders,
    store_settings: {
      findFirst: jest.fn(async () => ({
        settings: {},
        stores: { timezone: 'America/Bogota' },
      })),
    },
    products: fakeTable(records.products),
    orders: fakeTable(records.orders),
    store_users: fakeTable(records.store_users),
    suppliers: fakeTable(records.suppliers),
    purchase_orders: fakeTable(records.purchase_orders),
    quotations: fakeTable(records.quotations),
    invoices: fakeTable(records.invoices),
    fiscal_obligations: fakeTable(records.fiscal_obligations),
  };
}
