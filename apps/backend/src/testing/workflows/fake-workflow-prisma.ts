/**
 * In-memory stand-in for the Prisma calls the Flujos engine uses (no DB).
 *
 * Honours what the engine relies on: `updateMany` count semantics (CAS),
 * unique constraints (`P2002` with `meta.target`), the automatic store scope of
 * `StorePrismaService` (where + create), `{ increment }`, and a per-transaction
 * undo log so a thrown error rolls back that transaction's own writes.
 */
import { RequestContextService } from '@common/context/request-context.service';

type Row = Record<string, any>;

const SCOPED = new Set([
  'workflow_definitions',
  'workflow_versions',
  'work_groups',
  'work_group_members',
  'workflow_instances',
  'workflow_tasks',
  'workflow_task_votes',
  'workflow_instance_events',
  'workflow_outbox',
  'store_users',
]);

const UNIQUES: Record<string, string[][]> = {
  workflow_instance_events: [
    ['instance_id', 'seq'],
    ['store_id', 'idempotency_key'],
  ],
  workflow_task_votes: [['task_id', 'user_id']],
  workflow_instances: [['store_id', 'reference']],
  workflow_definitions: [['store_id', 'key']],
  workflow_versions: [['definition_id', 'version']],
  work_groups: [['store_id', 'key']],
  work_group_members: [['work_group_id', 'user_id']],
};

const DEFAULTS: Record<string, Row> = {
  workflow_tasks: {
    status: 'open',
    assignee_user_id: null,
    assignee_role_id: null,
    assignee_group_id: null,
    claimed_at: null,
    due_at: null,
    outcome: null,
    outcome_comment: null,
    completed_by_user_id: null,
    completed_at: null,
  },
  workflow_instances: {
    status: 'active',
    stage_due_at: null,
    stage_entry_seq: 1,
    stage_last_reminded_at: null,
    stage_escalated_at: null,
    cancel_reason: null,
    subject_type: null,
    subject_id: null,
    completed_at: null,
    row_version: 0,
    data: {},
  },
  workflow_outbox: {
    status: 'pending',
    attempts: 0,
    last_error: null,
    instance_id: null,
  },
  workflow_instance_events: {
    from_stage_key: null,
    to_stage_key: null,
    actor_id: null,
    idempotency_key: null,
    payload: {},
  },
  work_group_members: { is_lead: false, is_available: true },
  work_groups: { is_active: true },
};

/** Columns Prisma fills with `now()` when the caller omits them. */
const TIMESTAMPS: Record<string, string[]> = {
  workflow_definitions: ['created_at', 'updated_at'],
  workflow_instances: ['created_at'],
  workflow_versions: ['published_at'],
  workflow_instance_events: ['occurred_at'],
};

function eq(a: any, b: any): boolean {
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as any).getTime() === new Date(b as any).getTime();
  }
  return a === b;
}

function cmp(a: any, b: any): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

function matchValue(actual: any, cond: any): boolean {
  if (
    cond !== null &&
    typeof cond === 'object' &&
    !(cond instanceof Date) &&
    !Array.isArray(cond)
  ) {
    return Object.entries(cond).every(([op, v]) => {
      switch (op) {
        case 'in':
          return (v as any[]).some((x) => eq(x, actual));
        case 'notIn':
          return !(v as any[]).some((x) => eq(x, actual));
        case 'not':
          return !matchValue(actual, v);
        case 'equals':
          return eq(actual, v);
        case 'contains':
          return (
            typeof actual === 'string' &&
            actual.toLowerCase().includes(String(v).toLowerCase())
          );
        case 'mode':
          return true;
        case 'lte':
          return actual != null && cmp(actual, v) <= 0;
        case 'lt':
          return actual != null && cmp(actual, v) < 0;
        case 'gte':
          return actual != null && cmp(actual, v) >= 0;
        case 'gt':
          return actual != null && cmp(actual, v) > 0;
        default:
          throw new Error(`fake prisma: unsupported operator ${op}`);
      }
    });
  }
  if (cond === null) return actual === null || actual === undefined;
  return eq(actual, cond);
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (Array.isArray(v) ? v : [v]).every((w) => matches(row, w));
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (k === 'NOT') return !(Array.isArray(v) ? v : [v]).some((w) => matches(row, w));
    return matchValue(row[k], v);
  });
}

type UndoFn = () => void;

export class FakeWorkflowDb {
  /** Row locks held by an open transaction (identified by its undo log). */
  private locks = new Map<Row, UndoFn[]>();
  tables: Record<string, Row[]> = {};
  private seq: Record<string, number> = {};
  /** Resolves `select: { roles: { select: { name } } }` on user_roles. */
  rawHandlers: Array<(text: string, values: any[]) => any | undefined> = [];

  table(name: string): Row[] {
    return (this.tables[name] ??= []);
  }

  insert(name: string, row: Row): Row {
    const t = this.table(name);
    const full: Row = { ...(DEFAULTS[name] ?? {}), ...row };
    for (const col of TIMESTAMPS[name] ?? []) {
      if (full[col] === undefined) full[col] = new Date();
    }
    if (full.id === undefined) {
      this.seq[name] = (this.seq[name] ?? 0) + 1;
      full.id = this.seq[name];
    } else {
      this.seq[name] = Math.max(this.seq[name] ?? 0, full.id);
    }
    this.checkUnique(name, full, t);
    t.push(full);
    return full;
  }

  private checkUnique(name: string, row: Row, t: Row[], self?: Row) {
    for (const cols of UNIQUES[name] ?? []) {
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
      const clash = t.find(
        (o) => o !== self && cols.every((c) => eq(o[c], row[c])),
      );
      if (clash) {
        throw Object.assign(new Error(`Unique constraint failed on ${cols}`), {
          code: 'P2002',
          meta: { target: cols },
        });
      }
    }
  }

  private scopeStore(): number | undefined {
    return RequestContextService.getContext()?.store_id;
  }

  private delegate(name: string, undo: UndoFn[] | null, scoped: boolean) {
    const db = this;
    const scopeWhere = (where: Row | undefined) => {
      if (!scoped || !SCOPED.has(name)) return where;
      const store = db.scopeStore();
      if (store === undefined) throw new Error('fake prisma: no store context');
      return where ? { AND: [where, { store_id: store }] } : { store_id: store };
    };
    const tick = () => new Promise<void>((r) => setImmediate(r));
    const project = (row: Row, args: Row) => {
      if (!args?.select) return { ...row };
      const out: Row = {};
      for (const [k, v] of Object.entries(args.select)) {
        if (!v) continue;
        if (k === 'roles' && name === 'user_roles') {
          const role = db.table('roles').find((r) => r.id === row.role_id);
          out.roles = role
            ? Object.fromEntries(
                Object.keys((v as Row).select ?? { name: true }).map((c) => [c, role[c] ?? null]),
              )
            : null;
        } else out[k] = row[k];
      }
      return out;
    };
    const find = (args: Row = {}) => {
      let rows = db.table(name).filter((r) => matches(r, scopeWhere(args.where)));
      if (args.orderBy) {
        const keys = (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]).flatMap(
          (o: Row) => Object.entries(o) as [string, string][],
        );
        rows = [...rows].sort((a, b) => {
          for (const [k, dir] of keys) {
            const c = cmp(a[k], b[k]) * (dir === 'desc' ? -1 : 1);
            if (c !== 0) return c;
          }
          return 0;
        });
      }
      if (args.skip !== undefined) rows = rows.slice(args.skip);
      if (args.take !== undefined) rows = rows.slice(0, args.take);
      return rows;
    };
    return {
      findFirst: async (args: Row = {}) => {
        await tick();
        const r = find(args)[0];
        return r ? project(r, args) : null;
      },
      findMany: async (args: Row = {}) => {
        await tick();
        return find(args).map((r) => project(r, args));
      },
      count: async (args: Row = {}) => {
        await tick();
        return find(args).length;
      },
      create: async (args: Row) => {
        await tick();
        const data = { ...args.data };
        if (scoped && SCOPED.has(name)) data.store_id = db.scopeStore();
        const row = db.insert(name, data);
        undo?.push(() => {
          const t = db.table(name);
          t.splice(t.indexOf(row), 1);
        });
        return { ...row };
      },
      updateMany: async (args: Row) => {
        await tick();
        // Row-level lock like PostgreSQL: wait for the other transaction to end,
        // then re-evaluate the WHERE on the fresh row (READ COMMITTED).
        let rows = find(args);
        while (undo) {
          const blocked = rows.some((r) => {
            const owner = db.locks.get(r);
            return owner !== undefined && owner !== undo;
          });
          if (!blocked) break;
          await tick();
          rows = find(args);
        }
        if (undo) rows.forEach((r) => db.locks.set(r, undo));
        for (const row of rows) {
          const before = { ...row };
          const next: Row = { ...row };
          for (const [k, v] of Object.entries(args.data)) {
            if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as Row)) {
              next[k] = (row[k] ?? 0) + (v as Row).increment;
            } else next[k] = v;
          }
          db.checkUnique(name, next, db.table(name), row);
          Object.assign(row, next);
          undo?.push(() => {
            for (const k of Object.keys(row)) delete row[k];
            Object.assign(row, before);
          });
        }
        return { count: rows.length };
      },
      deleteMany: async (args: Row = {}) => {
        await tick();
        const rows = find(args);
        const t = db.table(name);
        for (const row of rows) {
          const idx = t.indexOf(row);
          t.splice(idx, 1);
          undo?.push(() => t.splice(idx, 0, row));
        }
        return { count: rows.length };
      },
    };
  }

  private client(undo: UndoFn[] | null, scoped: boolean): any {
    const db = this;
    const cache: Record<string, any> = {};
    return new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === '$queryRaw') {
            return (strings: any, ...values: any[]) => {
              const text = Array.isArray(strings)
                ? strings.join('?')
                : (strings?.sql ?? String(strings));
              return db.raw(text, values);
            };
          }
          if (prop === 'then') return undefined;
          return (cache[prop] ??= db.delegate(prop, undo, scoped));
        },
      },
    );
  }

  /** Emulates the two raw statements the engine issues. */
  private async raw(text: string, values: any[]): Promise<any> {
    await new Promise<void>((r) => setImmediate(r));
    for (const h of this.rawHandlers) {
      const out = h(text, values);
      if (out !== undefined) return out;
    }
    if (text.includes('FOR NO KEY UPDATE')) return [{ id: values[0] }];
    if (text.includes('MAX(CAST(SUBSTRING(reference')) {
      const store = values[0];
      const nums = this.table('workflow_instances')
        .filter((i) => i.store_id === store && /^FLU-\d+$/.test(i.reference))
        .map((i) => Number(i.reference.slice(4)));
      return [{ n: Math.max(0, ...nums) + 1 }];
    }
    if (text.includes('UPDATE workflow_outbox')) {
      const now = Date.now();
      const claimed = this.table('workflow_outbox')
        .filter(
          (r) =>
            (r.status === 'pending' && r.available_at.getTime() <= now) ||
            (r.status === 'processing' && r.available_at.getTime() <= now - 600_000),
        )
        .sort((a, b) => a.available_at - b.available_at || a.id - b.id)
        .slice(0, values[1] ?? 20);
      for (const r of claimed) {
        r.status = 'processing';
        r.attempts += 1;
        r.available_at = new Date(now);
      }
      return claimed.map((r) => ({
        id: BigInt(r.id),
        store_id: r.store_id,
        instance_id: r.instance_id,
        kind: r.kind,
        payload: r.payload,
        attempts: r.attempts,
      }));
    }
    throw new Error(`fake prisma: unsupported raw SQL: ${text.slice(0, 60)}`);
  }

  /** Looks like `StorePrismaService` for the engine. */
  asStorePrisma(opts: { txScoped?: boolean } = {}): any {
    const db = this;
    const scoped = this.client(null, true);
    return new Proxy(scoped, {
      get(target, prop: string) {
        // Like production: `StorePrismaService.$transaction` runs on the scoped
        // client. `txScoped: false` drops the scope so the specs prove every
        // workflow query also carries its own `store_id` predicate.
        if (prop === '$transaction') {
          const txScoped = opts.txScoped !== false;
          return async (fn: (tx: any) => Promise<any>) => {
            const undo: UndoFn[] = [];
            try {
              return await fn(db.client(undo, txScoped));
            } catch (e) {
              for (const u of undo.reverse()) u();
              throw e;
            } finally {
              for (const [row, owner] of db.locks) {
                if (owner === undo) db.locks.delete(row);
              }
            }
          };
        }
        if (prop === 'withoutScope') return () => db.client(null, false);
        if (prop === '$queryRaw') {
          return (sql: any) => db.raw(sql?.sql ?? String(sql), sql?.values ?? []);
        }
        return target[prop];
      },
    });
  }
}
