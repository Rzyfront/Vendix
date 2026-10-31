import {
  SEGMENT_MAX_RULES,
  SegmentCompileContext,
  SegmentFilterError,
  collectSegmentRequirements,
  compileSegmentFilter,
  parseSegmentFilter,
  segmentCustomersFrom,
} from './segment-filter.compiler';

const ctx = (overrides: Partial<SegmentCompileContext> = {}): SegmentCompileContext => ({
  store_id: 7,
  now: new Date('2026-10-31T15:00:00Z'),
  timezone: 'America/Bogota',
  meta_fields: new Map([
    ['ciudad', { id: 41, field_type: 'select' }],
    ['hijos', { id: 42, field_type: 'number' }],
    ['cumple', { id: 43, field_type: 'date' }],
    ['acepta_visita', { id: 44, field_type: 'checkbox' }],
  ]),
  rfm_members: new Map([
    ['Campeones', [3, 5]],
    ['En riesgo', [9]],
  ]),
  ...overrides,
});

const one = (field: string, cmp: string, value: unknown) => ({
  op: 'and',
  rules: [{ field, cmp, value }],
});

const compile = (raw: unknown, context = ctx()) =>
  compileSegmentFilter(parseSegmentFilter(raw), context);

const rejects = (raw: unknown, message?: RegExp) => {
  let error: unknown;
  try {
    compile(raw);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(SegmentFilterError);
  if (message) expect((error as Error).message).toMatch(message);
};

describe('segment filter compiler', () => {
  describe('allowed', () => {
    it.each([
      ['tag', 'eq', 4, 'ct."store_id" = su."store_id" AND ct."customer_id" = su."user_id" AND ct."tag_id" = $1::int', [4]],
      ['tag', 'in', [4, 5, 4], 'ct."tag_id" = ANY($1::int[])', [[4, 5]]],
      ['tag', 'neq', 4, 'NOT EXISTS', [4]],
      ['source', 'in', ['pos', 'whatsapp'], 'su."crm_source" = ANY($1::text[])', [['pos', 'whatsapp']]],
      ['stage', 'eq', 12, 'su."crm_stage_id" = $1::int', [12]],
      ['owner', 'exists', false, 'su."crm_owner_user_id" IS NULL', []],
      ['orders_count', 'gte', 3, 'COALESCE(os."orders_count", 0) >= $1::int', [3]],
      ['total_spent', 'between', [100, 500.5], 'COALESCE(os."total_spent", 0) BETWEEN $1::numeric AND $2::numeric', [100, 500.5]],
      ['consent.whatsapp', 'eq', 'opted_in', 'su."whatsapp_consent"::text = $1::text', ['opted_in']],
      ['last_order_at', 'exists', true, 'os."last_order_at" IS NOT NULL', []],
    ])('%s %s', (field, cmp, value, fragment, values) => {
      const sql = compile(one(field, cmp, value));
      expect(sql.text).toContain(fragment);
      expect(sql.values).toEqual(values);
    });

    it('compares date-only bounds as store-local days', () => {
      const sql = compile(one('last_order_at', 'gte', '2026-01-01'));
      expect(sql.text).toContain(`((os."last_order_at" AT TIME ZONE 'UTC') AT TIME ZONE $1)::date >= $2::date`);
      expect(sql.values).toEqual(['America/Bogota', '2026-01-01']);
    });

    it('counts relative days from now', () => {
      const sql = compile(one('last_order_at', 'older_than_days', 90));
      expect(sql.text).toContain(`os."last_order_at" < ($1::timestamptz AT TIME ZONE 'UTC')`);
      expect(sql.values).toEqual(['2026-08-02T15:00:00.000Z']);
    });

    it('binds RFM membership from the shared scorer as an id list', () => {
      const sql = compile(one('rfm', 'in', ['Campeones', 'En riesgo']));
      expect(sql.text).toBe('(su."user_id" = ANY($1::int[]))');
      expect(sql.values).toEqual([[3, 5, 9]]);
      expect(compile(one('rfm', 'neq', 'Campeones')).text).toContain('NOT (su."user_id"');
    });

    it('types custom fields by their store definition', () => {
      const select = compile(one('meta.ciudad', 'eq', 'Cali'));
      expect(select.text).toContain('emv."store_id" = su."store_id" AND');
      expect(select.text).toContain('emv."field_id" = $1::int AND emv."value_text" = $2::text');
      expect(select.values).toEqual([41, 'Cali']);

      const number = compile(one('meta.hijos', 'gte', 2));
      expect(number.text).toContain('emv."value_number" >= $2::numeric');

      const checkbox = compile(one('meta.acepta_visita', 'eq', true));
      expect(checkbox.text).toContain('emv."value_bool" = $2::boolean');

      const relative = compile(one('meta.cumple', 'within_days', 30));
      expect(relative.values).toEqual([43, '2026-10-01']);
    });

    it('nests and/or groups', () => {
      const sql = compile({
        op: 'and',
        rules: [
          { field: 'tag', cmp: 'eq', value: 4 },
          {
            op: 'or',
            rules: [
              { field: 'total_spent', cmp: 'gte', value: 500000 },
              { field: 'orders_count', cmp: 'gte', value: 5 },
            ],
          },
        ],
      });
      expect(sql.text).toMatch(/^\(EXISTS .* AND \(COALESCE.* OR COALESCE.*\)\)$/);
      expect(sql.values).toEqual([4, 500000, 5]);
    });

    it('lists what the service must resolve', () => {
      const filter = parseSegmentFilter({
        op: 'or',
        rules: [
          { field: 'tag', cmp: 'in', value: [1, 2] },
          { field: 'tag', cmp: 'exists', value: true },
          { field: 'stage', cmp: 'eq', value: 3 },
          { field: 'owner', cmp: 'neq', value: 8 },
          { field: 'rfm', cmp: 'eq', value: 'Leales' },
          { field: 'meta.ciudad', cmp: 'exists', value: true },
        ],
      });
      expect(collectSegmentRequirements(filter)).toEqual({
        tag_ids: [1, 2],
        stage_ids: [3],
        owner_ids: [8],
        meta_keys: ['ciudad'],
        rfm_segments: ['Leales'],
      });
    });

    it('always scopes the customers query to the given store', () => {
      const from = segmentCustomersFrom(7, compile(one('orders_count', 'gte', 1)));
      expect(from.text).toContain('o."store_id" = $1');
      expect(from.text).toContain('su."store_id" = $2');
      expect(from.text).toContain(`r."name" = 'customer'`);
      expect(from.values).toEqual([7, 7, 1]);
    });
  });

  describe('rejected', () => {
    it.each([
      ['an unknown field', one('users.password', 'eq', 'x'), /Campo no permitido/],
      ['a prototype key as field', one('constructor', 'eq', 1), /Campo no permitido/],
      ['__proto__ as field', one('__proto__', 'eq', 1), /Campo no permitido/],
      ['SQL in the field name', one('tag"; DROP TABLE users; --', 'eq', 1), /Campo no permitido/],
      ['SQL in a custom field key', one('meta.x"; DELETE FROM orders', 'eq', 1), /Clave de campo/],
      ['an operator outside the field catalog', one('total_spent', 'eq', 10), /Operador no permitido/],
      ['an unknown operator', one('orders_count', 'like', 1), /Operador no permitido/],
      ['a source outside the catalog', one('source', 'eq', 'tiktok'), /Valor no permitido/],
      ['an RFM segment that does not exist', one('rfm', 'eq', 'VIP'), /Valor no permitido/],
      ['a consent value outside the enum', one('consent.sms', 'eq', 'yes'), /Valor no permitido/],
      ['a non-integer id', one('tag', 'eq', '4 OR 1=1'), /entero/],
      ['a negative order count', one('orders_count', 'gte', -1), /entero/],
      ['an impossible date', one('created_at', 'gte', '2026-02-30'), /fecha/],
      ['a reversed range', one('total_spent', 'between', [500, 100]), /desde/],
      ['a malformed range', one('orders_count', 'between', [1]), /between/],
      ['an empty in-list', one('tag', 'in', []), /lista/],
      ['exists without a boolean', one('tag', 'exists', 'yes'), /exists/],
      ['too many relative days', one('last_order_at', 'within_days', 99999), /entero/],
      ['an unknown group operator', { op: 'xor', rules: [{ field: 'tag', cmp: 'eq', value: 1 }] }, /op debe/],
      ['an empty filter', { op: 'and', rules: [] }, /lista no vacía/],
      ['extra keys in a rule', { op: 'and', rules: [{ field: 'tag', cmp: 'eq', value: 1, sql: 'x' }] }, /Claves no permitidas/],
      ['extra keys in a group', { op: 'and', rules: [{ field: 'tag', cmp: 'eq', value: 1 }], raw: '1=1' }, /Claves no permitidas/],
      ['a non-object filter', 'tag = 1', /grupo/],
    ])('rejects %s', (_name, raw, message) => rejects(raw, message));

    it('rejects more than the maximum number of rules', () => {
      const rules = Array.from({ length: SEGMENT_MAX_RULES + 1 }, () => ({
        field: 'tag',
        cmp: 'eq',
        value: 1,
      }));
      rejects({ op: 'or', rules }, /Máximo/);
    });

    it('rejects groups nested too deep', () => {
      const leaf = { field: 'tag', cmp: 'eq', value: 1 };
      rejects(
        { op: 'and', rules: [{ op: 'or', rules: [{ op: 'and', rules: [{ op: 'or', rules: [leaf] }] }] }] },
        /niveles/,
      );
    });

    it('rejects a custom field the store does not have', () => {
      rejects(one('meta.color_favorito', 'eq', 'azul'), /no existe/);
    });

    it('rejects an operator that does not fit the custom field type', () => {
      rejects(one('meta.ciudad', 'gte', 3), /Operador no permitido/);
      rejects(one('meta.acepta_visita', 'in', [true]), /Operador no permitido/);
      rejects(one('meta.hijos', 'eq', 'dos'), /número/);
    });

    it('never inlines user text into the SQL', () => {
      const attack = "Cali'); DELETE FROM users; --";
      const sql = compile(one('meta.ciudad', 'eq', attack));
      expect(sql.text).not.toContain('DELETE');
      expect(sql.values).toContain(attack);
    });
  });
});
