import { Pool } from 'pg';
import {
  SegmentCompileContext,
  compileSegmentFilter,
  parseSegmentFilter,
  segmentCustomersFrom,
} from './segment-filter.compiler';

/**
 * The compiled segment SQL against a real Postgres: it must be valid for
 * every field and operator, and it must never return a customer, tag, order
 * or custom field of another store (PLAN-CRM §6, tests A/B).
 *
 * Needs a disposable database; the suite creates its own schema with the
 * tables the query reads and drops it at the end:
 *
 *   CRM_SEGMENT_TEST_DATABASE_URL=postgresql://… npm run test:path -- \
 *     src/domains/store/customers/crm/segments/segment-filter.postgres.spec.ts
 *
 * Without the variable the suite is skipped.
 */
const DATABASE_URL = process.env.CRM_SEGMENT_TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const SCHEMA = `crm_segment_test_${process.pid}_${Date.now()}`;
const NOW = new Date('2026-10-31T15:00:00Z');
const A = 1;
const B = 2;

describeDb('segment filter · Postgres', () => {
  let admin: Pool;
  let pool: Pool;

  const ctx = (storeId: number): SegmentCompileContext => ({
    store_id: storeId,
    now: NOW,
    timezone: 'America/Bogota',
    meta_fields: new Map([
      ['ciudad', { id: storeId === A ? 41 : 51, field_type: 'select' }],
      ['hijos', { id: 42, field_type: 'number' }],
      ['cumple', { id: 43, field_type: 'date' }],
      ['visita', { id: 44, field_type: 'checkbox' }],
    ]),
    rfm_members: new Map([['Campeones', [1, 4]]]),
  });

  const ids = async (storeId: number, filter: unknown, context = ctx(storeId)) => {
    const condition = compileSegmentFilter(parseSegmentFilter(filter), context);
    const sql = segmentCustomersFrom(storeId, condition);
    const { rows } = await pool.query(
      `SELECT u."id" ${sql.text} ORDER BY u."id"`,
      sql.values as unknown[],
    );
    return rows.map((row: { id: number }) => row.id);
  };
  const one = (field: string, cmp: string, value: unknown) => ({ op: 'and', rules: [{ field, cmp, value }] });

  beforeAll(async () => {
    admin = new Pool({ connectionString: DATABASE_URL, max: 1 });
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: `-c search_path="${SCHEMA}"` });
    await pool.query(`
      CREATE TABLE roles (id INT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE users (id INT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, phone TEXT, state TEXT NOT NULL);
      CREATE TABLE user_roles (id SERIAL PRIMARY KEY, user_id INT, role_id INT);
      CREATE TABLE store_users (
        id SERIAL PRIMARY KEY, store_id INT NOT NULL, user_id INT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        crm_owner_user_id INT, crm_source TEXT, crm_stage_id INT,
        whatsapp_consent TEXT NOT NULL DEFAULT 'unknown', sms_consent TEXT NOT NULL DEFAULT 'unknown',
        email_consent TEXT NOT NULL DEFAULT 'unknown'
      );
      CREATE TABLE orders (id SERIAL PRIMARY KEY, store_id INT NOT NULL, customer_id INT, state TEXT NOT NULL,
        grand_total DECIMAL(12,2) NOT NULL DEFAULT 0, created_at TIMESTAMP(6));
      CREATE TABLE crm_customer_tags (store_id INT, customer_id INT, tag_id INT);
      CREATE TABLE entity_metadata_values (id SERIAL PRIMARY KEY, store_id INT, entity_type TEXT, entity_id INT, field_id INT,
        value_text TEXT, value_number DECIMAL(12,4), value_date DATE, value_bool BOOLEAN);

      INSERT INTO roles VALUES (1, 'customer'), (2, 'owner');
      INSERT INTO users VALUES
        (1, 'Ana', 'A', 'ana@a.co', '3000000001', 'active'),
        (2, 'Beto', 'A', 'beto@a.co', '3000000002', 'active'),
        (3, 'Archivado', 'A', NULL, NULL, 'archived'),
        (4, 'Bruno', 'B', 'bruno@b.co', '3000000004', 'active'),
        (5, 'Dueña', 'A', 'owner@a.co', NULL, 'active'),
        (6, 'Compartida', 'AB', 'shared@x.co', '3000000006', 'active');
      INSERT INTO user_roles (user_id, role_id) VALUES (1,1),(2,1),(3,1),(4,1),(5,2),(6,1);
      INSERT INTO store_users (store_id, user_id, crm_source, crm_stage_id, crm_owner_user_id, whatsapp_consent, sms_consent, "createdAt") VALUES
        (${A}, 1, 'pos', 7, 5, 'opted_in', 'unknown', '2026-01-10'),
        (${A}, 2, 'whatsapp', NULL, NULL, 'unknown', 'opted_out', '2026-10-30'),
        (${A}, 3, 'pos', NULL, NULL, 'unknown', 'unknown', '2026-01-10'),
        (${A}, 5, NULL, NULL, NULL, 'unknown', 'unknown', '2026-01-10'),
        (${A}, 6, NULL, NULL, NULL, 'unknown', 'unknown', '2026-01-10'),
        (${B}, 4, 'pos', 7, 5, 'opted_in', 'unknown', '2026-01-10'),
        (${B}, 6, 'landing', 8, NULL, 'opted_in', 'unknown', '2026-01-10');
      INSERT INTO orders (store_id, customer_id, state, grand_total, created_at) VALUES
        (${A}, 1, 'finished', 200, '2026-10-20 12:00'),
        (${A}, 1, 'finished', 200, '2026-09-01 12:00'),
        (${A}, 1, 'finished', 200, '2026-05-01 12:00'),
        (${A}, 2, 'finished', 50, '2026-01-01 02:00'),
        (${A}, 2, 'cancelled', 1000, '2026-10-29 12:00'),
        (${B}, 6, 'finished', 9999, '2026-10-30 12:00'),
        (${B}, 4, 'finished', 10, '2026-10-30 12:00');
      INSERT INTO crm_customer_tags VALUES (${A}, 1, 10), (${B}, 6, 20), (${B}, 4, 10);
      INSERT INTO entity_metadata_values (store_id, entity_type, entity_id, field_id, value_text, value_number, value_date, value_bool) VALUES
        (${A}, 'customer', 2, 41, 'Cali', NULL, NULL, NULL),
        (${A}, 'customer', 1, 42, NULL, 3, NULL, NULL),
        (${A}, 'customer', 1, 43, NULL, NULL, '2026-10-15', NULL),
        (${A}, 'customer', 2, 44, NULL, NULL, NULL, TRUE),
        (${B}, 'customer', 6, 51, 'Cali', NULL, NULL, NULL);
    `);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin?.end();
  });

  it('only returns active customers of the store (no staff, no archived, no other store)', async () => {
    expect(await ids(A, one('orders_count', 'gte', 0))).toEqual([1, 2, 6]);
    expect(await ids(B, one('orders_count', 'gte', 0))).toEqual([4, 6]);
  });

  it('counts only finished orders of the store', async () => {
    expect(await ids(A, one('orders_count', 'gte', 1))).toEqual([1, 2]);
    expect(await ids(A, one('total_spent', 'gte', 500))).toEqual([1]);
    // Customer 6 spent 9 999 in store B, nothing in A.
    expect(await ids(A, one('total_spent', 'between', [0, 0]))).toEqual([6]);
    expect(await ids(B, one('total_spent', 'gte', 500))).toEqual([6]);
  });

  it('never matches a tag, custom field or stage of another store', async () => {
    expect(await ids(A, one('tag', 'in', [20]))).toEqual([]);
    expect(await ids(A, one('tag', 'eq', 10))).toEqual([1]);
    expect(await ids(B, one('tag', 'eq', 10))).toEqual([4]);
    expect(await ids(A, one('meta.ciudad', 'eq', 'Cali'))).toEqual([2]);
    expect(await ids(B, one('meta.ciudad', 'eq', 'Cali'))).toEqual([6]);
    // Store B's field id in store A's query finds nothing of B, even for the
    // customer of both stores, and even with a mismatched compile context.
    expect(await ids(A, one('meta.ciudad', 'eq', 'Cali'), { ...ctx(A), meta_fields: ctx(B).meta_fields })).toEqual([]);
    expect(await ids(A, one('meta.ciudad', 'eq', 'Cali'), ctx(B))).toEqual([]);
    expect(await ids(A, one('tag', 'eq', 20), ctx(B))).toEqual([]);
    expect(await ids(A, one('stage', 'eq', 8))).toEqual([]);
  });

  it('RFM ids of another store cannot pull its customers in', async () => {
    expect(await ids(A, one('rfm', 'eq', 'Campeones'))).toEqual([1]);
  });

  it('evaluates last purchase dates as store-local days and relative windows', async () => {
    // 2026-01-01 02:00 UTC is 2025-12-31 in Bogotá.
    expect(await ids(A, one('last_order_at', 'lte', '2025-12-31'))).toEqual([2]);
    expect(await ids(A, one('last_order_at', 'within_days', 30))).toEqual([1]);
    expect(await ids(A, one('last_order_at', 'older_than_days', 90))).toEqual([2]);
    expect(await ids(A, one('last_order_at', 'exists', false))).toEqual([6]);
    expect(await ids(A, one('created_at', 'gte', '2026-10-01'))).toEqual([2]);
  });

  it('filters consent, source, owner and typed custom fields', async () => {
    expect(await ids(A, one('consent.whatsapp', 'eq', 'opted_in'))).toEqual([1]);
    expect(await ids(A, one('consent.sms', 'neq', 'opted_out'))).toEqual([1, 6]);
    expect(await ids(A, one('source', 'in', ['pos', 'whatsapp']))).toEqual([1, 2]);
    expect(await ids(A, one('source', 'exists', false))).toEqual([6]);
    expect(await ids(A, one('owner', 'eq', 5))).toEqual([1]);
    expect(await ids(A, one('meta.hijos', 'between', [2, 4]))).toEqual([1]);
    expect(await ids(A, one('meta.cumple', 'within_days', 30))).toEqual([1]);
    expect(await ids(A, one('meta.visita', 'eq', true))).toEqual([2]);
    expect(await ids(A, one('meta.ciudad', 'neq', 'Cali'))).toEqual([1, 6]);
  });

  it('combines nested and/or groups', async () => {
    const filter = {
      op: 'or',
      rules: [
        { field: 'tag', cmp: 'eq', value: 10 },
        { op: 'and', rules: [{ field: 'source', cmp: 'eq', value: 'whatsapp' }, { field: 'orders_count', cmp: 'gte', value: 1 }] },
      ],
    };
    expect(await ids(A, filter)).toEqual([1, 2]);
  });

  it('treats hostile text as a plain value', async () => {
    expect(await ids(A, one('meta.ciudad', 'eq', "Cali' OR '1'='1"))).toEqual([]);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    expect(rows[0].n).toBe(6);
  });
});
