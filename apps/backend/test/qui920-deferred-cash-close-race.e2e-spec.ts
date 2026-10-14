import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { MovementsService } from '../src/domains/store/cash-registers/movements/movements.service';

/**
 * PostgreSQL integration for the F-006 close lock + durable signal contract.
 * SQL below is a fixture driver for the close guard, not SessionsService E2E;
 * unit tests cover the service branch. Only generated qa_qui920_* objects are
 * created, and this suite refuses any database URL outside loopback.
 *
 * This manual PostgreSQL integration suite is not part of CI unit tests. Run it
 * explicitly from apps/backend with:
 * VENDIX_LOCAL_RACE_TEST=1 VENDIX_LOCAL_RACE_DATABASE_URL=... npx jest --config test/jest-qui920-race.json --runInBand
 * It was not executed as part of this change.
 */
function localDatabaseUrl(): string {
  if (process.env.VENDIX_LOCAL_RACE_TEST !== '1') {
    throw new Error('Set VENDIX_LOCAL_RACE_TEST=1 to opt in to the manual local race test.');
  }
  const value = process.env.VENDIX_LOCAL_RACE_DATABASE_URL;
  if (!value) throw new Error('Local race test requires an explicit local database URL.');
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) ||
    (url.port && url.port !== '5432') ||
    process.env.NODE_ENV === 'production' ||
    /prod/i.test(decodeURIComponent(url.pathname))
  ) {
    throw new Error('Refusing race test: only loopback development PostgreSQL on port 5432 is allowed.');
  }
  url.search = '';
  return url.toString();
}

function rawTransaction(client: Client): any {
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      let sql = strings[0];
      for (let index = 0; index < values.length; index++) {
        sql += `$${index + 1}${strings[index + 1]}`;
      }
      return (await client.query(sql, values)).rows;
    },
    accounting_entry_failures: {
      create: async ({ data }: any) => {
        const result = await client.query(
          `INSERT INTO accounting_entry_failures
            (organization_id, store_id, handler_key, source_type, source_id, event_payload, error_message)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`,
          [data.organization_id, data.store_id, data.handler_key, data.source_type,
            data.source_id, JSON.stringify(data.event_payload), data.error_message],
        );
        return result.rows[0];
      },
    },
    cash_register_sessions: {
      findFirst: async ({ where }: any) => {
        const result = await client.query(
          'SELECT id, status FROM cash_register_sessions WHERE id=$1 AND store_id=$2',
          [where.id, where.store_id],
        );
        return result.rows[0] ?? null;
      },
    },
  };
}

describe('QUI-920 deferred cash movement vs close (PostgreSQL, fixture-driver)', () => {
  jest.setTimeout(20000);
  const schema = `qa_qui920_${process.pid}_${randomBytes(6).toString('hex')}`;
  let first: Client;
  let second: Client;
  let createdSchema = false;

  beforeAll(async () => {
    const connectionString = localDatabaseUrl();
    first = new Client({ connectionString, application_name: `${schema}_a`, connectionTimeoutMillis: 3000 });
    second = new Client({ connectionString, application_name: `${schema}_b`, connectionTimeoutMillis: 3000 });
    await first.connect();
    await second.connect();
    if (!/^qa_qui920_\d+_[a-f0-9]{12}$/.test(schema)) throw new Error('Invalid QA schema identifier.');
    await first.query(`CREATE SCHEMA "${schema}"`);
    createdSchema = true;
    for (const client of [first, second]) {
      await client.query(`SET search_path TO "${schema}"`);
      await client.query("SET statement_timeout TO '6000ms'");
      await client.query("SET lock_timeout TO '5000ms'");
    }
    await first.query(`
      CREATE TABLE cash_register_sessions (
        id integer PRIMARY KEY, store_id integer NOT NULL, status text NOT NULL
      );
      CREATE TABLE accounting_entry_failures (
        id serial PRIMARY KEY, organization_id integer NOT NULL, store_id integer,
        handler_key varchar(80) NOT NULL, source_type varchar(50), source_id integer,
        event_payload jsonb NOT NULL, error_message text NOT NULL,
        attempt_count integer NOT NULL DEFAULT 1, resolved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO cash_register_sessions VALUES (20, 10, 'open');
    `);
  });

  afterAll(async () => {
    try {
      await second?.end();
      if (createdSchema) {
        await first.query('ROLLBACK');
        if (!/^qa_qui920_\d+_[a-f0-9]{12}$/.test(schema)) throw new Error('Refusing unsafe QA schema cleanup.');
        await first.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally {
      await first?.end();
    }
  });

  async function waitForBlocker(holder: Client, waiterPid: number): Promise<void> {
    const holderPid = Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      const blockers = (await holder.query(
        'SELECT pg_blocking_pids($1::integer) AS blockers', [waiterPid],
      )).rows[0].blockers as number[];
      if (blockers.includes(holderPid)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected the second PostgreSQL connection to wait on the session lock.');
  }

  it('serializes close after the committed payment signal and rejects close while it is unresolved', async () => {
    const movements = new MovementsService({} as any, { emit: jest.fn() } as any);
    await first.query('BEGIN');
    const signalId = await movements.createDeferredSaleCashMovementSignal(rawTransaction(first), {
      session_id: 20,
      store_id: 10,
      order_id: 91,
      user_id: 7,
      organization_id: 3,
      ready_state: 'finished',
      compensation_state: 'created',
    });

    await second.query('BEGIN');
    const secondPid = Number((await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    const closeLock = second.query(
      "SELECT id FROM cash_register_sessions WHERE id=20 AND store_id=10 AND status='open' FOR UPDATE",
    );
    try {
      await waitForBlocker(first, secondPid);
      const stateWhileWaiting = await first.query(
        'SELECT status FROM cash_register_sessions WHERE id=20',
      );
      expect(stateWhileWaiting.rows[0].status).toBe('open');
      await first.query('COMMIT');
      const locked = await closeLock;
      expect(locked.rowCount).toBe(1);

      const pending = await second.query(
        `SELECT id FROM accounting_entry_failures
         WHERE store_id=10 AND handler_key='deferred_sale_cash_movement_v1'
           AND source_type='order.deferred_cash_movement' AND resolved_at IS NULL
           AND event_payload->>'session_id'='20'`,
      );
      expect(pending.rows.map((row) => row.id)).toContain(signalId);
      // Same transactional guard contract as SessionsService: any pending row
      // rejects before status or closing movements are changed.
      expect(pending.rowCount).toBeGreaterThan(0);
      await second.query('ROLLBACK');
    } finally {
      await first.query('ROLLBACK');
      await second.query('ROLLBACK');
    }
  });

  it('does not allow a payment writer to create a signal after close owns the session lock', async () => {
    const movements = new MovementsService({} as any, { emit: jest.fn() } as any);
    await first.query('BEGIN');
    await first.query("UPDATE cash_register_sessions SET status='closed' WHERE id=20");
    await second.query('BEGIN');
    const secondPid = Number((await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    const signalAttempt = movements.createDeferredSaleCashMovementSignal(rawTransaction(second), {
      session_id: 20,
      store_id: 10,
      order_id: 92,
      user_id: 7,
      organization_id: 3,
      ready_state: 'finished',
      compensation_state: 'created',
    });
    try {
      await waitForBlocker(first, secondPid);
      await first.query('COMMIT');
      await expect(signalAttempt).rejects.toThrow('La sesión de caja ya no está abierta');
      const signals = await second.query('SELECT id FROM accounting_entry_failures');
      expect(signals.rowCount).toBe(0);
      await second.query('ROLLBACK');
    } finally {
      await first.query('ROLLBACK');
      await second.query('ROLLBACK');
    }
  });
});
