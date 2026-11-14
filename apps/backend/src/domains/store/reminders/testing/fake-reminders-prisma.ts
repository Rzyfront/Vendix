/**
 * In-memory `user_reminders` table for the QUI-580 isolation specs. It honours
 * the `where` the service sends (equality, `null`, `lt/lte/gte`, `AND`) and
 * applies NO tenant scope of its own, so a spec passes only when the service
 * itself filters by the actor's store AND user.
 */
type Row = Record<string, any>;

function matchesValue(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date) {
    return value instanceof Date && value.getTime() === condition.getTime();
  }
  if (typeof condition === 'object') {
    const ops = condition as Record<string, any>;
    if (value === null || value === undefined) return false;
    const v = value instanceof Date ? value.getTime() : (value as number);
    const at = (x: any) => (x instanceof Date ? x.getTime() : x);
    if ('lt' in ops && !(v < at(ops.lt))) return false;
    if ('lte' in ops && !(v <= at(ops.lte))) return false;
    if ('gte' in ops && !(v >= at(ops.gte))) return false;
    return true;
  }
  return value === condition;
}

export function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') {
      return (condition as Row[]).every((part) => matchesWhere(row, part));
    }
    return matchesValue(row[key], condition);
  });
}

export function createFakeRemindersPrisma(seed: Row[] = []) {
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
    products: {
      findFirst: jest.fn(async ({ where }: Row) =>
        where.id === 501 ? { name: 'Coca-Cola 1.5L' } : null,
      ),
    },
    orders: { findFirst: jest.fn(async () => null) },
    store_users: { findFirst: jest.fn(async () => null) },
    suppliers: { findFirst: jest.fn(async () => null) },
  };
}
