/**
 * Test-only SQL transport for REAL repository/session/hook wiring. It is NOT a
 * PostgreSQL implementation or proof of DB lock/isolation/migration correctness.
 * Transactions serialize deterministically and rollback map snapshots on failure.
 */
import type { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import type {
  AgentObjective,
  AgentToolResult,
  AgentEffect,
  ObjectiveScope,
} from '../interfaces/agent-objective.interface';

type Sql = { sql: string; values: unknown[] };
type RecordRow = Record<string, unknown>;
const JSON_FIELDS = new Set([
  'plan',
  'entities',
  'step_hashes',
  'budget',
  'authority_snapshot',
  'metadata',
  'receipt',
  'data',
  'pagination',
  'resource_ids',
  'evidence_refs',
  'domain_receipt',
  'history',
]);
const decode = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const clone = <T>(value: T): T => structuredClone(value);
const at = (q: Sql, index: number): unknown =>
  q.values[(q.sql.slice(0, index).match(/\?/g) ?? []).length];
function where(q: Sql, key: string): unknown {
  const start = q.sql.lastIndexOf(' WHERE ');
  if (start < 0) return undefined;
  const part = q.sql.slice(start);
  const match = new RegExp(`(?:^|[^a-z_])${key}\\s*=\\s*\\?`, 'i').exec(part);
  if (!match) return undefined;
  return at(q, start + match.index + match[0].lastIndexOf('?'));
}
function assignments(q: Sql, row: RecordRow): RecordRow {
  const start = q.sql.indexOf(' SET ') + 5;
  const end = q.sql.lastIndexOf(' WHERE ');
  const text = q.sql.slice(start, end);
  // Split assignments only at top level; COALESCE commas stay in their expression.
  let depth = 0;
  let offset = 0;
  const parts: Array<{ text: string; index: number }> = [];
  for (let i = 0; i <= text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') depth--;
    if (i === text.length || (text[i] === ',' && depth === 0)) {
      parts.push({ text: text.slice(offset, i).trim(), index: start + offset });
      offset = i + 1;
    }
  }
  const result = { ...row };
  for (const part of parts) {
    const split = part.text.indexOf('=');
    if (split < 0) continue;
    const key = part.text.slice(0, split).trim();
    const expr = part.text.slice(split + 1).trim();
    const actualIndex = q.sql.indexOf(part.text, part.index);
    const value = expr.includes('?')
      ? at(q, actualIndex + part.text.indexOf('?'))
      : undefined;
    if (expr.includes('CURRENT_TIMESTAMP') && key === 'lease_until')
      result[key] = new Date(Date.now() + Number(value));
    else if (expr === 'CURRENT_TIMESTAMP') result[key] = new Date();
    else if (expr.startsWith(`${key}+`))
      result[key] =
        Number(row[key]) + Number(value ?? expr.slice(key.length + 1));
    else if (expr.startsWith(`${key}||`))
      result[key] = [
        ...((row[key] as unknown[]) ?? []),
        ...(decode(value) as unknown[]),
      ];
    else if (expr.startsWith('COALESCE')) {
      if (value !== null && value !== undefined)
        result[key] = JSON_FIELDS.has(key) ? decode(value) : value;
    } else if (expr === 'NULL') result[key] = null;
    else if (expr === key) continue;
    else if (expr.startsWith("'")) result[key] = expr.slice(1, -1);
    else if (expr === 'true' || expr === 'false') result[key] = expr === 'true';
    else if (expr.includes('?'))
      result[key] = JSON_FIELDS.has(key) ? decode(value) : value;
    else throw new Error(`Unsupported test UPDATE: ${part.text}`);
  }
  return result;
}
function insert(q: Sql): RecordRow {
  const columns = /INSERT INTO \w+\s*\(([^)]+)\)\s*VALUES\s*\(/i.exec(q.sql);
  if (!columns) throw new Error('Unsupported insert');
  const valueStart = columns.index + columns[0].length;
  let depth = 1;
  let end = valueStart;
  while (end < q.sql.length && depth) {
    if (q.sql[end] === '(') depth++;
    if (q.sql[end] === ')') depth--;
    end++;
  }
  const expressions = q.sql.slice(valueStart, end - 1).split(',');
  let index = 0;
  const result: RecordRow = {};
  columns[1].split(',').forEach((column, i) => {
    const expression = expressions[i].trim();
    result[column.trim()] = expression.includes('?')
      ? JSON_FIELDS.has(column.trim())
        ? decode(q.values[index++])
        : q.values[index++]
      : expression.startsWith("'")
        ? expression.slice(1, -1)
        : null;
  });
  return result;
}

export class ObjectiveMemoryDatabase {
  conversations = new Map<number, RecordRow>();
  objectives = new Map<string, AgentObjective>();
  results = new Map<string, AgentToolResult>();
  effects = new Map<string, AgentEffect>();
  tasks = new Map<number, RecordRow>();
  readonly statements: Sql[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  readonly prisma = {
    ai_conversations: {
      findFirst: async (args: { where?: RecordRow; select?: RecordRow }) => {
        const row = [...this.conversations.values()].find((item) =>
          Object.entries(args.where ?? {}).every(
            ([key, value]) => item[key] === value,
          ),
        );
        if (!row) return null;
        return clone(
          args.select
            ? Object.fromEntries(
                Object.keys(args.select)
                  .filter((key) => args.select![key])
                  .map((key) => [key, row[key]]),
              )
            : row,
        );
      },
      updateMany: async (args: { where: RecordRow; data: RecordRow }) => {
        const rows = [...this.conversations.values()].filter((item) =>
          Object.entries(args.where).every(
            ([key, value]) => item[key] === value,
          ),
        );
        for (const row of rows)
          this.conversations.set(Number(row.id), {
            ...row,
            ...clone(args.data),
          });
        return { count: rows.length };
      },
    },
    $transaction: <T>(
      fn: (tx: {
        $queryRaw: (q: Sql) => Promise<unknown>;
        $executeRaw: (q: Sql) => Promise<number>;
      }) => Promise<T>,
    ): Promise<T> => {
      const next = this.tail.then(async () => {
        const snapshot = clone({
          conversations: this.conversations,
          objectives: this.objectives,
          results: this.results,
          effects: this.effects,
          tasks: this.tasks,
        });
        const tx = {
          $queryRaw: async (q: Sql) => this.query(q),
          $executeRaw: async (q: Sql) => this.query(q, true) as number,
        };
        try {
          return await fn(tx);
        } catch (error) {
          Object.assign(this, snapshot);
          throw error;
        }
      });
      this.tail = next.catch(() => undefined);
      return next;
    },
  } as unknown as StorePrismaService;

  seedConversation(
    id: number,
    scope: ObjectiveScope,
    metadata: unknown = null,
  ): void {
    this.conversations.set(id, { id, ...scope, metadata });
  }
  private owns(q: Sql, row: RecordRow): boolean {
    return ['store_id', 'organization_id', 'user_id'].every(
      (key) => where(q, key) === undefined || where(q, key) === row[key],
    );
  }
  private matches(q: Sql, row: RecordRow): boolean {
    if (!this.owns(q, row)) return false;
    for (const key of [
      'id',
      'objective_id',
      'conversation_id',
      'legacy_plan_id',
      'tool_call_id',
      'tool_name',
      'operation_id',
      'step_id',
      'proposal_hash',
      'version',
      'lease_generation',
    ]) {
      const value = where(q, key);
      if (value !== undefined && row[key] !== value) return false;
    }
    if (
      q.sql.includes('AND status=') &&
      where(q, 'status') !== undefined &&
      row.status !== where(q, 'status')
    )
      return false;
    if (
      q.sql.includes('lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP') &&
      row.lease_until &&
      new Date(row.lease_until as Date).getTime() > Date.now()
    )
      return false;
    if (
      q.sql.includes('lease_until > CURRENT_TIMESTAMP') &&
      (!row.lease_until ||
        new Date(row.lease_until as Date).getTime() <= Date.now())
    )
      return false;
    if (
      q.sql.includes('expires_at>CURRENT_TIMESTAMP') &&
      new Date(row.expires_at as Date).getTime() <= Date.now()
    )
      return false;
    if (
      q.sql.includes('semantic_status NOT IN') &&
      [
        'superseded',
        'cancelled',
        'completed_verified',
        'unknown_effect',
      ].includes(String(row.semantic_status))
    )
      return false;
    return true;
  }
  private query(q: Sql, execute = false): unknown {
    this.statements.push({ sql: q.sql, values: clone(q.values) });
    const table = /(?:FROM|INTO|UPDATE) (ai_\w+)/i.exec(q.sql)?.[1];
    const map: Map<string | number, unknown> =
      table === 'ai_conversations'
        ? this.conversations
        : table === 'ai_agent_objectives'
          ? this.objectives
          : table === 'ai_agent_tool_results'
            ? this.results
            : table === 'ai_agent_effects'
              ? this.effects
              : table === 'ai_agent_tasks'
                ? this.tasks
                : (null as never);
    if (!map) throw new Error(`Unsupported test SQL table: ${q.sql}`);
    if (
      q.sql.includes(
        "AND stale_lease=false ORDER BY (data->>'checkpoint_version')::bigint DESC",
      )
    ) {
      return [...this.results.values()]
        .filter(
          (row) =>
            this.matches(q, row as unknown as RecordRow) && !row.stale_lease,
        )
        .sort(
          (a, b) =>
            Number((b.data as RecordRow).checkpoint_version ?? 0) -
              Number((a.data as RecordRow).checkpoint_version ?? 0) ||
            Number(b.created_at) - Number(a.created_at) ||
            b.id.localeCompare(a.id),
        )
        .slice(0, 1);
    }
    if (q.sql.includes("DISTINCT ON (data->>'id')")) {
      const latest = [...this.results.values()]
        .filter(
          (row) =>
            this.matches(q, row as unknown as RecordRow) &&
            row.tool_name === 'load_playbook' &&
            row.receipt.status === 'ok' &&
            !row.stale_lease &&
            row.freshness === 'observed' &&
            row.data &&
            typeof row.data === 'object' &&
            !Array.isArray(row.data) &&
            typeof (row.data as RecordRow).id === 'string',
        )
        .sort(
          (a, b) =>
            Number(b.created_at) - Number(a.created_at) ||
            b.tool_call_id.localeCompare(a.tool_call_id),
        );
      const seen = new Set<string>();
      return latest
        .filter((row) => {
          const id = String((row.data as RecordRow).id);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .slice(0, 2)
        .map((row) => {
          const data = row.data as RecordRow;
          return {
            id: data.id,
            version: data.version,
            hash: data.hash,
            section: (data.section as RecordRow | undefined)?.id ?? null,
          };
        });
    }
    if (q.sql.startsWith('INSERT')) {
      const data = insert(q);
      const duplicate = [...map.values()].find((r) => {
        const row = r as RecordRow;
        return table === 'ai_agent_objectives'
          ? row.conversation_id === data.conversation_id &&
              row.legacy_plan_id === data.legacy_plan_id &&
              row.store_id === data.store_id &&
              row.organization_id === data.organization_id &&
              row.user_id === data.user_id
          : table === 'ai_agent_tool_results'
            ? row.objective_id === data.objective_id &&
              row.tool_call_id === data.tool_call_id
            : row.operation_id === data.operation_id ||
              (row.objective_id === data.objective_id &&
                row.step_id === data.step_id &&
                row.proposal_hash === data.proposal_hash);
      });
      if (duplicate) return execute ? 0 : [];
      const row = {
        version: 1,
        lease_generation: 0,
        lease_until: null,
        entities: [],
        next_step: null,
        requires_revalidation: true,
        created_at: new Date(),
        updated_at: new Date(),
        domain_receipt: null,
        domain_reference: null,
        evidence_result_id: null,
        ...data,
      };
      map.set(String(data.id), row);
      return execute ? 1 : [clone(row)];
    }
    let selected = [...map.values()]
      .map((r) => r as RecordRow)
      .filter((r) => this.matches(q, r));
    if (q.sql.includes("status='applied'"))
      selected = selected.filter((r) => r.status === 'applied');
    if (
      q.sql.includes("status IN ('proposed','approved','applying','unknown')")
    )
      selected = selected.filter((r) =>
        ['proposed', 'approved', 'applying', 'unknown'].includes(
          String(r.status),
        ),
      );
    if (q.sql.includes('AND (created_at>=? OR updated_at>=?)')) {
      const created = q.values[q.values.length - 2] as Date;
      const updated = q.values[q.values.length - 1] as Date;
      selected = selected.filter(
        (r) =>
          Number(new Date(r.created_at as Date)) >= Number(created) ||
          Number(new Date(r.updated_at as Date)) >= Number(updated),
      );
    }
    if (q.sql.includes("status IN ('proposed','approved')"))
      selected = selected.filter((r) =>
        ['proposed', 'approved'].includes(String(r.status)),
      );
    if (q.sql.includes("status IN ('applying','unknown')"))
      selected = selected.filter((r) =>
        ['applying', 'unknown'].includes(String(r.status)),
      );
    if (q.sql.includes('tool_call_id IN (')) {
      const start = q.sql.indexOf('tool_call_id IN (');
      const values = q.values.slice(
        (q.sql.slice(0, start).match(/\?/g) ?? []).length,
      );
      selected = selected.filter((r) => values.includes(r.tool_call_id));
    }
    if (q.sql.startsWith('UPDATE')) {
      for (const row of selected) {
        const next = assignments(q, row);
        map.set(row.id as string | number, next);
      }
      return execute
        ? selected.length
        : selected.map((r) => clone(map.get(r.id as string | number)));
    }
    if (q.sql.includes("tool_name <> 'agent_recovery_checkpoint'"))
      selected = selected.filter(
        (r) => r.tool_name !== 'agent_recovery_checkpoint',
      );
    if (q.sql.includes('ORDER BY created_at,id')) {
      selected.sort(
        (a, b) =>
          Number(new Date(a.created_at as Date)) -
            Number(new Date(b.created_at as Date)) ||
          String(a.id).localeCompare(String(b.id)),
      );
      if (q.sql.includes('AND (created_at,id)>')) {
        const cursor = q.values[q.values.length - 2];
        const position = selected.findIndex((r) => r.id === cursor);
        selected = selected.slice(position + 1);
      }
      selected = selected.slice(0, Number(q.values[q.values.length - 1]));
      selected = selected.map((r) => {
        const omitted =
          Buffer.byteLength(JSON.stringify(r.data ?? null)) > 1500;
        return { ...r, data: omitted ? null : r.data, data_omitted: omitted };
      });
    }
    if (q.sql.includes('ORDER BY created_at DESC,id DESC'))
      selected = selected
        .sort(
          (a, b) =>
            Number(new Date(b.created_at as Date)) -
              Number(new Date(a.created_at as Date)) ||
            String(b.id).localeCompare(String(a.id)),
        )
        .slice(0, Number(q.values[q.values.length - 1]));
    if (q.sql.includes('ORDER BY updated_at DESC,id DESC'))
      selected = selected
        .sort(
          (a, b) =>
            Number(new Date(b.updated_at as Date)) -
              Number(new Date(a.updated_at as Date)) ||
            String(b.id).localeCompare(String(a.id)),
        )
        .slice(0, 1);
    return execute ? selected.length : clone(selected);
  }
}
