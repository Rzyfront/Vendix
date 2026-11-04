/**
 * Tiny in-memory stand-in for a Prisma client, for specs that must assert on
 * stored rows (not on mock calls). Supports the subset the store/domain
 * bootstrap flows use: equality, `in`, `notIn` and `not` filters, compound
 * unique selectors (`a_b: { a, b }`), and `$transaction(cb)` with rollback
 * (a failing callback restores every table as it was).
 *
 * Not a Prisma emulator: unknown operators throw so a spec never passes on
 * a filter the fake silently ignored.
 */
export type Row = Record<string, any>;

export interface InMemoryDb {
  tables: Record<string, Row[]>;
  client: Record<string, any>;
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (
    expected === null ||
    typeof expected !== 'object' ||
    expected instanceof Date
  ) {
    return actual === expected;
  }
  const ops = expected as Record<string, unknown>;
  return Object.entries(ops).every(([op, value]) => {
    switch (op) {
      case 'in':
        return (value as unknown[]).includes(actual);
      case 'notIn':
        return !(value as unknown[]).includes(actual);
      case 'not':
        return actual !== value;
      case 'equals':
        return actual === value;
      default:
        throw new Error(`in-memory-db: unsupported operator "${op}"`);
    }
  });
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (key in row || expected === null || typeof expected !== 'object') {
      return matchesValue(row[key], expected);
    }
    if (
      key.includes('_') &&
      typeof expected === 'object' &&
      !Array.isArray(expected)
    ) {
      // Compound unique selector, e.g. store_id_kind: { store_id, kind }.
      return matches(row, expected as Row);
    }
    return matchesValue(row[key], expected);
  });
}

function project(row: Row | undefined, select: Row | undefined): Row | null {
  if (!row) return null;
  if (!select) return { ...row };
  const out: Row = {};
  for (const [key, on] of Object.entries(select)) {
    if (on === true) out[key] = row[key];
  }
  return out;
}

function table(db: InMemoryDb, name: string) {
  const rows = () => (db.tables[name] ??= []);
  let nextId = 1;
  const newId = () => {
    const ids = rows().map((r) => Number(r.id) || 0);
    nextId = Math.max(nextId, ...ids, 0) + 1;
    return nextId;
  };

  const assertUnique = (data: Row) => {
    if (name === 'store_apps') {
      const dup = rows().some(
        (r) =>
          r.store_id === data.store_id &&
          r.kind === data.kind &&
          r.id !== data.id,
      );
      if (dup)
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    }
  };

  return {
    findFirst: async ({ where, select }: Row = {}) =>
      project(
        rows().find((r) => matches(r, where)),
        select,
      ),
    findUnique: async ({ where, select }: Row = {}) =>
      project(
        rows().find((r) => matches(r, where)),
        select,
      ),
    findMany: async ({ where, select }: Row = {}) =>
      rows()
        .filter((r) => matches(r, where))
        .map((r) => project(r, select)),
    count: async ({ where }: Row = {}) =>
      rows().filter((r) => matches(r, where)).length,
    create: async ({ data, select }: Row) => {
      const row = { id: newId(), ...data };
      assertUnique(row);
      rows().push(row);
      return project(row, select);
    },
    update: async ({ where, data, select }: Row) => {
      const row = rows().find((r) => matches(r, where));
      if (!row) throw new Error(`in-memory-db: ${name}.update found no row`);
      Object.assign(row, data);
      assertUnique(row);
      return project(row, select);
    },
    updateMany: async ({ where, data }: Row) => {
      const hit = rows().filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    upsert: async ({ where, create, update }: Row) => {
      const row = rows().find((r) => matches(r, where));
      if (row) {
        Object.assign(row, update);
        return { ...row };
      }
      const created = { id: newId(), ...create };
      rows().push(created);
      return { ...created };
    },
  };
}

/**
 * Builds the fake. `client.<model>` is created on first access, so any model
 * name works; `client.withoutScope()` returns the same client.
 */
export function createInMemoryDb(seed: Record<string, Row[]> = {}): InMemoryDb {
  const db: InMemoryDb = {
    tables: Object.fromEntries(
      Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
    ),
    client: {},
  };
  const models = new Map<string, ReturnType<typeof table>>();

  db.client = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return undefined;
        if (prop === 'withoutScope') return () => db.client;
        if (prop === '$transaction') {
          return async (cb: (tx: unknown) => Promise<unknown>) => {
            const snapshot = JSON.stringify(db.tables);
            try {
              return await cb(db.client);
            } catch (err) {
              const restored = JSON.parse(snapshot) as Record<string, Row[]>;
              for (const key of Object.keys(db.tables)) delete db.tables[key];
              Object.assign(db.tables, restored);
              throw err;
            }
          };
        }
        if (!models.has(prop)) models.set(prop, table(db, prop));
        return models.get(prop);
      },
    },
  );
  return db;
}
