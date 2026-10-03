import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  SalesByDimensionQueryDto,
  parseIdsCsv,
} from '../dto/sales-by-dimension-query.dto';
import {
  buildLineSalesCte,
  mapCustomerRow,
  mapDimensionSummaryRow,
  mapProductRow,
  mapSummaryRow,
  mapUserRow,
  toNumber,
  NO_ADVISOR_LABEL,
  NO_CUSTOMER_LABEL,
} from './sales-dimension-analytics.service';

/** Same options as the global ValidationPipe in main.ts. */
async function parse(plain: Record<string, unknown>) {
  const dto = plainToInstance(SalesByDimensionQueryDto, plain, {
    enableImplicitConversion: true,
  });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
}

const base = {
  dimension: 'brand' as const,
  storeId: 7,
  organizationId: 3,
  startDate: new Date('2026-01-01T05:00:00.000Z'),
  endDate: new Date('2026-12-31T04:59:59.999Z'),
};

describe('SalesByDimensionQueryDto', () => {
  it('parses CSV ids into number[] and keeps 0', async () => {
    const { dto, errors } = await parse({ dimension: 'supplier', ids: '3,5,0' });
    expect(errors).toHaveLength(0);
    expect(dto.ids).toEqual([3, 5, 0]);
  });

  it('handles a single already-coerced number and arrays', async () => {
    expect(parseIdsCsv(3)).toEqual([3]);
    expect(parseIdsCsv(['3', '4,5'])).toEqual([3, 4, 5]);
    expect(parseIdsCsv('')).toBeUndefined();
    expect(parseIdsCsv(undefined)).toBeUndefined();
    const { dto, errors } = await parse({ dimension: 'brand', ids: '7' });
    expect(errors).toHaveLength(0);
    expect(dto.ids).toEqual([7]);
  });

  it('rejects non-integer / negative ids', async () => {
    expect((await parse({ dimension: 'brand', ids: '3,x' })).errors).toHaveLength(1);
    expect((await parse({ dimension: 'brand', ids: '-1' })).errors).toHaveLength(1);
  });

  it('rejects an invalid dimension and view', async () => {
    const bad = await parse({ dimension: 'foo' });
    expect(bad.errors.map((e) => e.property)).toEqual(['dimension']);
    const badView = await parse({ dimension: 'brand', view: 'zzz' });
    expect(badView.errors.map((e) => e.property)).toEqual(['view']);
  });

  it('requires dimension', async () => {
    const r = await parse({});
    expect(r.errors.map((e) => e.property)).toContain('dimension');
  });

  it('defaults view to product and coerces paging; caps limit at 100', async () => {
    const r = await parse({ dimension: 'brand', page: '2', limit: '50' });
    expect(r.errors).toHaveLength(0);
    expect(r.dto.view).toBe('product');
    expect(r.dto.page).toBe(2);
    expect(r.dto.limit).toBe(50);
    const over = await parse({ dimension: 'brand', limit: '101' });
    expect(over.errors.map((e) => e.property)).toEqual(['limit']);
  });

  it('accepts dates and preset', async () => {
    const r = await parse({
      dimension: 'brand',
      date_from: '2026-01-01',
      date_to: '2026-01-31',
      date_preset: 'custom',
    });
    expect(r.errors).toHaveLength(0);
  });
});

describe('buildLineSalesCte', () => {
  it('contains state, cancelled and store filters, with parameters', () => {
    const sql = buildLineSalesCte({ ...base, ids: undefined });
    expect(sql.sql).toContain("o.state IN ('delivered', 'finished')");
    expect(sql.sql).toContain('oi.cancelled_at IS NULL');
    expect(sql.sql).toContain('o.store_id = ?');
    expect(sql.values[0]).toBe(7);
    expect(sql.values).toContain(base.startDate);
    expect(sql.values).toContain(base.endDate);
    expect(sql.sql).not.toContain('COALESCE(d.id, 0) IN');
    expect(sql.sql).toContain('LEFT JOIN brands d');
    expect(sql.sql).not.toContain('product_supplier');
  });

  it('adds the ids filter (0 = null dimension) as parameters', () => {
    const sql = buildLineSalesCte({ ...base, ids: [3, 5, 0] });
    expect(sql.sql).toContain('COALESCE(d.id, 0) IN (?,?,?)');
    expect(sql.values.slice(-3)).toEqual([3, 5, 0]);
  });

  it('supplier dimension attributes preferred -> first -> last committed PO', () => {
    const sql = buildLineSalesCte({ ...base, dimension: 'supplier' });
    expect(sql.sql).toContain('ORDER BY sp.is_preferred DESC, sp.id ASC');
    expect(sql.sql).toContain("po.status IN ('approved', 'partial', 'received')");
    expect(sql.sql).toContain('ORDER BY po.created_at DESC, po.id DESC');
    expect(sql.sql).toContain('LEFT JOIN suppliers d');
    expect(sql.sql).not.toContain("s.state = 'active'");
    expect(sql.values).toContain(3);
  });

  it('spreads only the residual order discount over NULL-discount lines', () => {
    const sql = buildLineSalesCte(base).sql;
    expect(sql).toContain('GREATEST(b.order_discount - b.order_line_discounts, 0)');
    expect(sql).toContain('NULLIF(b.order_null_lines_total, 0)');
  });
});

describe('row mapping', () => {
  it('converts bigint / Decimal-like / string to number and rounds money', () => {
    expect(toNumber(BigInt(12))).toBe(12);
    expect(toNumber('10.50')).toBe(10.5);
    expect(toNumber({ toString: () => '7.25' })).toBe(7.25);
    expect(toNumber(null)).toBe(0);
  });

  it('maps summary', () => {
    expect(
      mapSummaryRow({
        net_sales: '1234.5678',
        units: BigInt(10),
        orders: BigInt(4),
        customers: BigInt(3),
        refs: BigInt(6),
      }),
    ).toEqual({
      net_sales: 1234.57,
      units: 10,
      orders: 4,
      impacted_customers: 3,
      distinct_references: 6,
    });
    expect(mapSummaryRow(undefined)).toEqual({
      net_sales: 0,
      units: 0,
      orders: 0,
      impacted_customers: 0,
      distinct_references: 0,
    });
  });

  it('maps null dimension to the right label per dimension', () => {
    const raw = { dimension_id: null, dimension_name: null, units: 1, net_sales: 1, orders: 1, customers: 0, refs: 1 };
    expect(mapDimensionSummaryRow(raw, 'supplier').dimension_name).toBe('Sin proveedor');
    expect(mapDimensionSummaryRow(raw, 'brand').dimension_name).toBe('Sin marca');
    expect(mapDimensionSummaryRow(raw, 'brand').dimension_id).toBeNull();
  });

  it('maps a product row', () => {
    expect(
      mapProductRow(
        {
          dimension_id: 4,
          dimension_name: 'Alpina',
          product_id: 9,
          product_variant_id: null,
          product_name: 'Leche',
          variant_name: null,
          sku: 'L-1',
          units: BigInt(3),
          net_sales: '90.004',
          orders: BigInt(2),
          customers: BigInt(1),
        },
        'brand',
      ),
    ).toEqual({
      dimension_id: 4,
      dimension_name: 'Alpina',
      product_id: 9,
      product_variant_id: null,
      product_name: 'Leche',
      variant_name: null,
      sku: 'L-1',
      units: 3,
      net_sales: 90,
      orders: 2,
      customers: 1,
    });
  });

  it('maps null advisor and null customer to their labels', () => {
    const u = mapUserRow(
      { dimension_id: 0, dimension_name: null, user_id: null, user_name: null, units: 1, net_sales: 5, orders: 1, customers: 0, refs: 1 },
      'supplier',
    );
    expect(u.user_name).toBe(NO_ADVISOR_LABEL);
    expect(u.user_id).toBeNull();
    const c = mapCustomerRow(
      { dimension_id: 2, dimension_name: 'ACME', customer_id: null, customer_name: null, customer_document: null, units: 2, net_sales: 8, orders: 1, refs: 2 },
      'supplier',
    );
    expect(c.customer_name).toBe(NO_CUSTOMER_LABEL);
    expect(c.customer_id).toBeNull();
    expect(c.references).toBe(2);
    expect(c.dimension_name).toBe('ACME');
  });
});
