import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { Prisma } from '@prisma/client';
import { lockOrderLifecycle } from './order-lifecycle-lock.util';
import {
  getCancellationBlocker,
  OrderCancellationSnapshot,
} from './order-cancellation-policy.util';

/**
 * PostgreSQL integration of the REAL lock + cancellation-policy contract.
 * The small SQL actions below are FIXTURE DRIVERS, not OrderFlowService /
 * WebhookHandlerService / StockLevelManager E2E. They prove actual exclusion,
 * authoritative reads and rollback, not Nest wiring or domain orchestration.
 *
 * Opt-in: VENDIX_LOCAL_RACE_TEST=1 and VENDIX_LOCAL_RACE_DATABASE_URL (or
 * DATABASE_URL) pointing to loopback development PostgreSQL. An opted-in run
 * FAILS when its environment is unavailable; skipped runs are not evidence.
 * Only generated qa_cancel_* schema objects are touched. search_path never
 * contains public, so a missing fixture table fails instead of hitting stock.
 */
const describeLocalRace = process.env.VENDIX_LOCAL_RACE_TEST === '1'
  ? describe
  : describe.skip;

const ORDER_ID = 1;
const STORE_ID = 101;
const PAYMENT_ID = 1;
const STOCK_BLOCKER = 'ORD_CANCEL_STOCK_COMMITTED_001';
const PAYMENT_BLOCKER = 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001';

function localDatabaseUrl(): string {
  const value = process.env.VENDIX_LOCAL_RACE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error('Local race test requires an explicit local database URL.');
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) ||
    process.env.NODE_ENV === 'production' ||
    /prod/i.test(decodeURIComponent(url.pathname)) ||
    (url.port && url.port !== '5432')
  ) {
    throw new Error('Refusing race test: only loopback development PostgreSQL on port 5432 is allowed.');
  }
  // Neither Prisma parameters nor pg host/options overrides are accepted:
  // '?host=remote' must not defeat the authority validated above.
  url.search = '';
  return url.toString();
}

/** Adapt only tagged $queryRaw; the lock's parameterized SQL is unchanged. */
function rawTransaction(client: Client, trace: string[] = []): Prisma.TransactionClient {
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.reduce(
        (text, fragment, index) => text + (index ? `$${index}` : '') + fragment,
        '',
      );
      trace.push(sql.replace(/\s+/g, ' ').trim());
      return (await client.query(sql, values)).rows;
    },
  } as unknown as Prisma.TransactionClient;
}

async function transaction<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function readSnapshot(client: Client): Promise<OrderCancellationSnapshot> {
  const order = (await client.query('SELECT state FROM orders WHERE id=$1', [ORDER_ID])).rows[0];
  const items = (await client.query(
    'SELECT inventory_committed, inventory_consumed_at_fire, delivered_at FROM order_items WHERE order_id=$1',
    [ORDER_ID],
  )).rows;
  const payments = (await client.query(
    'SELECT state, processing_mode, method_type FROM payments WHERE order_id=$1 ORDER BY id',
    [ORDER_ID],
  )).rows.map((row) => ({
    state: row.state,
    store_payment_method: {
      system_payment_method: { processing_mode: row.processing_mode, type: row.method_type },
    },
  }));
  return { ...order, order_items: items, payments };
}

async function cancelFixture(client: Client): Promise<string> {
  await lockOrderLifecycle(rawTransaction(client), ORDER_ID, STORE_ID);
  const order = await readSnapshot(client);
  const blocker = getCancellationBlocker(order);
  if (blocker) throw new Error(blocker);
  await client.query('UPDATE orders SET state=$1 WHERE id=$2', ['cancelled', ORDER_ID]);
  await client.query('UPDATE payments SET state=$1 WHERE order_id=$2', ['cancelled', ORDER_ID]);
  return 'cancelled';
}

async function approveFixture(client: Client): Promise<string> {
  const order = await lockOrderLifecycle(rawTransaction(client), ORDER_ID, STORE_ID);
  const payment = (await client.query('SELECT state FROM payments WHERE id=$1', [PAYMENT_ID])).rows[0];
  if (payment.state === 'succeeded') return 'replay';
  const late = order.state === 'cancelled' || payment.state === 'cancelled';
  await client.query(
    'UPDATE payments SET state=$1, reconciliation_required=$2 WHERE id=$3',
    ['succeeded', late, PAYMENT_ID],
  );
  if (!late) await client.query('UPDATE orders SET state=$1 WHERE id=$2', ['processing', ORDER_ID]);
  return late ? 'reconciliation' : 'approved';
}

async function commitStockFixture(client: Client, failAfterStock = false): Promise<boolean> {
  const order = await lockOrderLifecycle(rawTransaction(client), ORDER_ID, STORE_ID);
  if (['cancelled', 'refunded'].includes(order.state)) throw new Error('ORD_STOCK_COMMIT_STATE_001');
  const claim = await client.query(
    'UPDATE order_items SET inventory_committed=true WHERE id=1 AND inventory_committed=false RETURNING id',
  );
  if (!claim.rowCount) return false;
  // This is ONLY the isolated QA fixture table, never production inventory.
  await client.query('UPDATE stock_levels SET quantity_on_hand=quantity_on_hand-1 WHERE id=1');
  if (failAfterStock) throw new Error('injected fixture failure after stock mutation');
  return true;
}

describeLocalRace('Order lifecycle PostgreSQL lock + policy contract (NOT service E2E)', () => {
  jest.setTimeout(20000);
  const schema = `qa_cancel_${process.pid}_${randomBytes(6).toString('hex')}`;
  let first: Client | undefined;
  let second: Client | undefined;
  let firstPid: number;
  let secondPid: number;
  let schemaCreated = false;
  let firstConnected = false;
  let secondConnected = false;

  beforeAll(async () => {
    const connectionString = localDatabaseUrl();
    first = new Client({ connectionString, application_name: `${schema}_a`, connectionTimeoutMillis: 3000 });
    second = new Client({ connectionString, application_name: `${schema}_b`, connectionTimeoutMillis: 3000 });
    await first.connect();
    firstConnected = true;
    await second.connect();
    secondConnected = true;
    // Identifiers are generated here, not accepted from the environment.
    if (!/^qa_cancel_\d+_[a-f0-9]{12}$/.test(schema)) throw new Error('Invalid QA schema identifier.');
    await first.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    for (const client of [first, second]) {
      await client.query(`SET search_path TO "${schema}"`);
      await client.query("SET statement_timeout TO '6000ms'");
      await client.query("SET lock_timeout TO '5000ms'");
    }
    firstPid = Number((await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    secondPid = Number((await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    await first.query(`
      CREATE TABLE orders (id integer PRIMARY KEY, store_id integer NOT NULL, state text NOT NULL);
      CREATE TABLE payments (id integer PRIMARY KEY, order_id integer NOT NULL REFERENCES orders(id),
        state text NOT NULL, processing_mode text, method_type text, reconciliation_required boolean NOT NULL DEFAULT false);
      CREATE TABLE order_items (id integer PRIMARY KEY, order_id integer NOT NULL REFERENCES orders(id),
        inventory_committed boolean NOT NULL DEFAULT false,
        inventory_consumed_at_fire boolean NOT NULL DEFAULT false, delivered_at timestamptz);
      CREATE TABLE stock_levels (id integer PRIMARY KEY, quantity_on_hand integer NOT NULL);
      INSERT INTO orders VALUES (1,101,'pending_payment');
      INSERT INTO payments (id,order_id,state,processing_mode,method_type) VALUES (1,1,'pending','ONLINE','wompi');
      INSERT INTO order_items (id,order_id) VALUES (1,1);
      INSERT INTO stock_levels VALUES (1,10);
    `);
  });

  beforeEach(async () => {
    await first!.query('UPDATE orders SET state=$1 WHERE id=$2', ['pending_payment', ORDER_ID]);
    await first!.query('UPDATE payments SET state=$1, reconciliation_required=false WHERE id=$2', ['pending', PAYMENT_ID]);
    await first!.query('UPDATE order_items SET inventory_committed=false WHERE id=1');
    await first!.query('UPDATE stock_levels SET quantity_on_hand=10 WHERE id=1');
  });

  afterEach(async () => {
    if (firstConnected) await first!.query('ROLLBACK');
    if (secondConnected) await second!.query('ROLLBACK');
  });

  afterAll(async () => {
    // Release the second session before removing ONLY this run's schema.
    try {
      if (secondConnected) await second!.end();
      if (schemaCreated && firstConnected) {
        await first!.query('ROLLBACK');
        if (!/^qa_cancel_\d+_[a-f0-9]{12}$/.test(schema)) throw new Error('Refusing unsafe cleanup.');
        await first!.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally {
      if (firstConnected) await first!.end();
    }
  });

  /** A real lock-wait is the barrier; elapsed sleep is never the assertion. */
  async function waitForBlocker(): Promise<void> {
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      const blockers = (await first!.query(
        'SELECT pg_blocking_pids($1::integer) AS blockers', [secondPid],
      )).rows[0].blockers as number[];
      if (blockers.includes(firstPid)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected second PostgreSQL connection to wait for the first order lifecycle lock.');
  }

  async function releaseToWaiter<T>(work: () => Promise<T>): Promise<{ value?: T; error?: Error }> {
    // Attach error handling immediately so a deliberate conflict is never an
    // unhandled rejection while the holder checks pg_blocking_pids.
    const pending = transaction(second!, work).then(
      (value) => ({ value }),
      (error: Error) => ({ error }),
    );
    try {
      await waitForBlocker();
      await first!.query('COMMIT');
      return await pending;
    } finally {
      await first!.query('ROLLBACK');
      await pending;
    }
  }

  async function facts() {
    return (await first!.query(`SELECT o.state AS order_state, p.state AS payment_state,
      p.reconciliation_required, i.inventory_committed, s.quantity_on_hand
      FROM orders o JOIN payments p ON p.order_id=o.id
      JOIN order_items i ON i.order_id=o.id CROSS JOIN stock_levels s
      WHERE o.id=$1 AND s.id=1`, [ORDER_ID])).rows[0];
  }

  it('takes the order lock before waiting for payment rows, on two real connections', async () => {
    const trace: string[] = [];
    await first!.query('BEGIN');
    await first!.query('SELECT id FROM payments WHERE id=$1 FOR UPDATE', [PAYMENT_ID]);
    const pending = transaction(second!, () => lockOrderLifecycle(rawTransaction(second!, trace), ORDER_ID, STORE_ID))
      .then((value) => ({ value }), (error: Error) => ({ error }));
    try {
      await waitForBlocker();
      expect(trace).toHaveLength(2);
      expect(trace[0]).toMatch(/FROM orders .*FOR UPDATE/);
      expect(trace[1]).toMatch(/FROM payments .*ORDER BY id FOR UPDATE/);
      // Second holds the order row while blocked at the payment row. NOWAIT
      // proves it without risking a deadlock on the deliberately inverted fixture.
      await first!.query('SAVEPOINT verify_order_lock');
      await expect(first!.query('SELECT id FROM orders WHERE id=1 FOR UPDATE NOWAIT'))
        .rejects.toMatchObject({ code: '55P03' });
      await first!.query('ROLLBACK TO SAVEPOINT verify_order_lock');
      await first!.query('COMMIT');
      expect(await pending).toEqual({ value: { id: ORDER_ID, state: 'pending_payment' } });
    } finally {
      await first!.query('ROLLBACK');
      await pending;
    }
  });

  it('cancel-first: waiting approval sees cancellation and requires reconciliation without stock', async () => {
    await first!.query('BEGIN');
    await cancelFixture(first!);
    const outcome = await releaseToWaiter(() => approveFixture(second!));
    expect(outcome).toEqual({ value: 'reconciliation' });
    expect(await facts()).toEqual({
      order_state: 'cancelled', payment_state: 'succeeded', reconciliation_required: true,
      inventory_committed: false, quantity_on_hand: 10,
    });
  });

  it('approve-first: waiting cancellation reads settled money and rejects before stock has committed', async () => {
    await first!.query('BEGIN');
    await approveFixture(first!);
    const outcome = await releaseToWaiter(() => cancelFixture(second!));
    expect(outcome.error?.message).toBe(PAYMENT_BLOCKER);
    expect(await facts()).toEqual({
      order_state: 'processing', payment_state: 'succeeded', reconciliation_required: false,
      inventory_committed: false, quantity_on_hand: 10,
    });
  });

  it('stock-first: waiting cancellation sees committed inventory, not its prior pending snapshot', async () => {
    await first!.query('BEGIN');
    await commitStockFixture(first!);
    const outcome = await releaseToWaiter(() => cancelFixture(second!));
    expect(outcome.error?.message).toBe(STOCK_BLOCKER);
    expect(await facts()).toMatchObject({ order_state: 'pending_payment', inventory_committed: true, quantity_on_hand: 9 });
  });

  it('cancel-first: waiting stock driver rejects rather than delivering a cancelled order', async () => {
    await first!.query('BEGIN');
    await cancelFixture(first!);
    const outcome = await releaseToWaiter(() => commitStockFixture(second!));
    expect(outcome.error?.message).toBe('ORD_STOCK_COMMIT_STATE_001');
    expect(await facts()).toMatchObject({ order_state: 'cancelled', inventory_committed: false, quantity_on_hand: 10 });
  });

  it('rolls back claim plus stock, then permits one retry and makes the replay a no-op', async () => {
    await expect(transaction(first!, () => commitStockFixture(first!, true)))
      .rejects.toThrow('injected fixture failure');
    expect(await facts()).toMatchObject({ inventory_committed: false, quantity_on_hand: 10 });
    expect(await transaction(second!, () => commitStockFixture(second!))).toBe(true);
    expect(await transaction(first!, () => commitStockFixture(first!))).toBe(false);
    expect(await facts()).toMatchObject({ inventory_committed: true, quantity_on_hand: 9 });
  });

  it('rejects a wrong store at the real lock boundary without changing the fixture', async () => {
    await expect(transaction(first!, () => lockOrderLifecycle(rawTransaction(first!), ORDER_ID, STORE_ID + 1)))
      .rejects.toThrow('not found');
    expect(await facts()).toEqual({
      order_state: 'pending_payment', payment_state: 'pending', reconciliation_required: false,
      inventory_committed: false, quantity_on_hand: 10,
    });
  });
});
