/**
 * In-memory `scheduled_reminders` for the reminder engine specs
 * (`ReminderScheduler`, `ScheduledRemindersJob`). It keeps the table rules the
 * engine relies on: the unique key (source_type, source_id, kind, fire_at)
 * with `skipDuplicates`, and `updateMany` that only touches matching rows.
 * The job's raw claim is simulated by `claim()` with the same filter as the
 * SQL (pending, fire_at in [now - lookback, now], attempts and lease).
 * Lives under `src/testing/`, excluded from the production build.
 */
export interface FakeReminderRow {
  id: number;
  store_id: number;
  source_type: string;
  source_id: number;
  kind: string;
  fire_at: Date;
  status: 'pending' | 'sent' | 'cancelled' | 'skipped';
  attempts: number;
  last_error: string | null;
  updated_at: Date;
}

type Where = Record<string, any>;

function matchesValue(value: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
    const c = condition as Record<string, any>;
    if ('in' in c) return (c.in as unknown[]).includes(value);
    if ('lt' in c && !((value as Date).getTime() < (c.lt as Date).getTime())) return false;
    if ('lte' in c && !((value as Date).getTime() <= (c.lte as Date).getTime())) return false;
    if ('gte' in c && typeof c.gte === 'number' && !((value as number) >= c.gte)) return false;
    return true;
  }
  if (value instanceof Date && condition instanceof Date) {
    return value.getTime() === condition.getTime();
  }
  return value === condition;
}

function matches(row: FakeReminderRow, where: Where = {}): boolean {
  return Object.entries(where).every(([key, condition]) =>
    matchesValue(row[key as keyof FakeReminderRow], condition),
  );
}

export function createScheduledRemindersFake(clock: () => Date = () => new Date()) {
  const rows: FakeReminderRow[] = [];
  let nextId = 1;
  const key = (r: Pick<FakeReminderRow, 'source_type' | 'source_id' | 'kind' | 'fire_at'>) =>
    `${r.source_type}|${r.source_id}|${r.kind}|${r.fire_at.getTime()}`;

  const table = {
    findMany: jest.fn(async ({ where }: { where?: Where } = {}) =>
      rows.filter((row) => matches(row, where)).map((row) => ({ ...row })),
    ),
    createMany: jest.fn(
      async ({ data }: { data: Array<Partial<FakeReminderRow>>; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const input of data) {
          const candidate = input as FakeReminderRow;
          if (rows.some((row) => key(row) === key(candidate))) continue;
          rows.push({
            id: nextId++,
            store_id: candidate.store_id,
            source_type: candidate.source_type,
            source_id: candidate.source_id,
            kind: candidate.kind,
            fire_at: candidate.fire_at,
            status: 'pending',
            attempts: 0,
            last_error: null,
            updated_at: clock(),
          });
          count++;
        }
        return { count };
      },
    ),
    updateMany: jest.fn(
      async ({ where, data }: { where: Where; data: Partial<FakeReminderRow> }) => {
        let count = 0;
        for (const row of rows) {
          if (!matches(row, where)) continue;
          Object.assign(row, data, { updated_at: clock() });
          count++;
        }
        return { count };
      },
    ),
  };

  /** Same filter and side effects as `ScheduledRemindersJob.claim` SQL. */
  function claim(
    now: Date,
    options: { lookbackMs: number; maxAttempts: number; leaseMs: number; batch: number },
  ) {
    const oldest = now.getTime() - options.lookbackMs;
    const leaseCutoff = now.getTime() - options.leaseMs;
    const due = rows
      .filter(
        (row) =>
          row.status === 'pending' &&
          row.fire_at.getTime() <= now.getTime() &&
          row.fire_at.getTime() >= oldest &&
          row.attempts < options.maxAttempts &&
          (row.attempts === 0 || row.updated_at.getTime() <= leaseCutoff),
      )
      .sort((a, b) => a.fire_at.getTime() - b.fire_at.getTime() || a.id - b.id)
      .slice(0, options.batch);
    for (const row of due) {
      row.attempts += 1;
      row.updated_at = now;
    }
    return due.map(({ id, store_id, source_type, source_id, kind, fire_at, attempts }) => ({
      id,
      store_id,
      source_type,
      source_id,
      kind,
      fire_at,
      attempts,
    }));
  }

  return { rows, table, claim };
}
