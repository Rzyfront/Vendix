import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { SmsSpendService } from './sms-spend.service';

/**
 * Concurrency of the SMS spend cap against a real Postgres (PLAN-CRM §5.2):
 * each reservation runs the service's exact SQL on its own connection, so
 * Postgres row locking is what is under test, not a mock.
 *
 * Needs a disposable database: it creates its own schema with a minimal
 * `social_channels` table and drops it at the end.
 *
 *   CRM_SPEND_TEST_DATABASE_URL=postgresql://… npm run test:path -- \
 *     src/messaging/spend/sms-spend.service.concurrency.spec.ts
 *
 * Without the variable the suite is skipped.
 */
const DATABASE_URL = process.env.CRM_SPEND_TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const SCHEMA = `crm_spend_test_${process.pid}_${Date.now()}`;
const OCT = new Date('2026-10-15T12:00:00Z');

describeDb('SmsSpendService · concurrency on Postgres', () => {
  let admin: Pool;
  let pool: Pool;
  let service: SmsSpendService;
  const events = { emit: jest.fn() };

  beforeAll(async () => {
    admin = new Pool({ connectionString: DATABASE_URL, max: 1 });
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    await admin.query(`
      CREATE TABLE "${SCHEMA}"."social_channels" (
        id INTEGER PRIMARY KEY,
        store_id INTEGER NOT NULL,
        monthly_spend_limit DECIMAL(12,2),
        monthly_spend_used DECIMAL(12,4) NOT NULL DEFAULT 0,
        spend_period_start DATE,
        updated_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
      )`);

    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 20,
      options: `-c search_path="${SCHEMA}"`,
    });
    const prisma = {
      $queryRaw: async (sql: Prisma.Sql) =>
        (await pool.query(sql.text, sql.values as unknown[])).rows,
      social_channels: {
        findFirst: async ({ where }: { where: { id: number } }) =>
          (
            await pool.query(
              'SELECT monthly_spend_limit, monthly_spend_used, spend_period_start FROM social_channels WHERE id = $1',
              [where.id],
            )
          ).rows[0] ?? null,
      },
    };
    const redis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn() };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new SmsSpendService(
      prisma as never,
      redis as never,
      audit as never,
      events as never,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    }
  });

  async function channel(id: number, limit: string, used = '0', period: string | null = '2026-10-01') {
    await admin.query(
      `INSERT INTO "${SCHEMA}"."social_channels" (id, store_id, monthly_spend_limit, monthly_spend_used, spend_period_start) VALUES ($1, 10, $2, $3, $4)`,
      [id, limit, used, period],
    );
  }

  async function used(id: number): Promise<string> {
    const { rows } = await admin.query(
      `SELECT monthly_spend_used::text AS used FROM "${SCHEMA}"."social_channels" WHERE id = $1`,
      [id],
    );
    return rows[0].used;
  }

  it('two simultaneous sends never exceed the cap: only one fits in the last budget', async () => {
    await channel(1, '1.00', '0.9900');

    const results = await Promise.all([
      service.reserve({ id: 1, store_id: 10 }, 0.0075, OCT),
      service.reserve({ id: 1, store_id: 10 }, 0.0075, OCT),
    ]);

    expect(results.filter((r) => r.reserved)).toHaveLength(1);
    expect(results.filter((r) => !r.reserved)).toHaveLength(1);
    expect(await used(1)).toBe('0.9975');
  });

  it('fifty simultaneous sends stop exactly at the cap', async () => {
    await channel(2, '0.10');

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        service.reserve({ id: 2, store_id: 10 }, 0.0075, OCT),
      ),
    );

    // 13 × 0.0075 = 0.0975 ≤ 0.10 < 14 × 0.0075
    expect(results.filter((r) => r.reserved)).toHaveLength(13);
    expect(await used(2)).toBe('0.0975');
  });

  it('a new month resets the counter in the same statement', async () => {
    await channel(3, '1.00', '1.0000', '2026-09-01');

    const result = await service.reserve({ id: 3, store_id: 10 }, 0.0075, OCT);

    expect(result).toMatchObject({ reserved: true, used: 0.0075, period_start: '2026-10-01' });
  });

  it('a channel without a cap, or of another store, never reserves', async () => {
    await channel(4, null as unknown as string);
    await channel(5, '5.00');

    expect((await service.reserve({ id: 4, store_id: 10 }, 0.0075, OCT)).reserved).toBe(false);
    expect((await service.reserve({ id: 5, store_id: 99 }, 0.0075, OCT)).reserved).toBe(false);
    expect(await used(5)).toBe('0.0000');
  });

  it('release gives the reservation back within the month, never below 0', async () => {
    await channel(6, '1.00', '0.0075');

    await service.release(6, 0.0075, '2026-10-01');
    expect(await used(6)).toBe('0.0000');
    await service.release(6, 0.0075, '2026-10-01');
    expect(await used(6)).toBe('0.0000');
    await channel(7, '1.00', '0.5000', '2026-11-01');
    await service.release(7, 0.0075, '2026-10-01');
    expect(await used(7)).toBe('0.5000');
  });
});
