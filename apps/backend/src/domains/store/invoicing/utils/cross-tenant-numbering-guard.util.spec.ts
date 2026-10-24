import { VendixHttpException } from 'src/common/errors';
import {
  assertNoCrossTenantNumberingOverlap,
  normalizeIssuerNit,
  rangesOverlap,
} from './cross-tenant-numbering-guard.util';

type Entity = {
  id: number;
  tax_id: string | null;
  nits: string[];
  name: string;
  organization_id: number;
};
type Row = {
  id: number;
  accounting_entity_id: number;
  document_type: string;
  prefix: string;
  range_from: number;
  range_to: number;
  resolution_number: string;
  current_number: number;
  archived_at?: Date | null;
  is_active: boolean;
};

const SENTINEL_NAME = 'SENTINEL-ORG-NAME';
const SENTINEL_NUMBER = 'SENTINEL-RES-18760000999';
const SENTINEL_CURRENT = 987654321;

function buildPrisma(entities: Entity[], rows: Row[]) {
  const shape = (e: Entity) => ({
    id: e.id,
    tax_id: e.tax_id,
    dian_configurations: e.nits.map((nit) => ({ nit })),
  });
  return {
    $executeRaw: jest.fn(async () => 1),
    accounting_entities: {
      findFirst: jest.fn(async ({ where }: any) => {
        const e = entities.find((x) => x.id === where.id);
        return e ? shape(e) : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        entities
          .filter((e) =>
            where.OR.some(
              (c: any) =>
                (c.tax_id &&
                  (e.tax_id ?? '').startsWith(c.tax_id.startsWith)) ||
                (c.dian_configurations &&
                  e.nits.some((n) =>
                    n.startsWith(c.dian_configurations.some.nit.startsWith),
                  )),
            ),
          )
          .map(shape),
      ),
    },
    invoice_resolutions: {
      findMany: jest.fn(async ({ where }: any) =>
        rows
          .filter(
            (r) =>
              where.accounting_entity_id.in.includes(r.accounting_entity_id) &&
              r.document_type === where.document_type &&
              r.prefix.toLowerCase() === where.prefix.equals.toLowerCase() &&
              r.range_from <= where.range_from.lte &&
              r.range_to >= where.range_to.gte &&
              (where.id === undefined || r.id !== where.id.not),
          )
          .map((r) => ({
            prefix: r.prefix,
            range_from: r.range_from,
            range_to: r.range_to,
          })),
      ),
    },
  };
}

const target: Entity = {
  id: 1,
  tax_id: '900123456-7',
  nits: [],
  name: 'mine',
  organization_id: 10,
};
const other: Entity = {
  id: 2,
  tax_id: '900123456',
  nits: [],
  name: SENTINEL_NAME,
  organization_id: 999,
};
const foreign_row = (over: Partial<Row> = {}): Row => ({
  id: 50,
  accounting_entity_id: 2,
  document_type: 'sales_invoice',
  prefix: 'SETP',
  range_from: 990000000,
  range_to: 990999999,
  resolution_number: SENTINEL_NUMBER,
  current_number: SENTINEL_CURRENT,
  is_active: true,
  ...over,
});
const params = {
  accounting_entity_id: 1,
  document_type: 'sales_invoice',
  prefix: 'SETP',
  range_from: 990000000,
  range_to: 990000100,
};

async function capture(promise: Promise<void>): Promise<VendixHttpException> {
  try {
    await promise;
  } catch (e) {
    return e as VendixHttpException;
  }
  throw new Error('expected rejection');
}

describe('normalizeIssuerNit', () => {
  it('strips DV after the last dash', () => {
    expect(normalizeIssuerNit('900123456-7')).toBe('900123456');
  });
  it('keeps digits only without DV', () => {
    expect(normalizeIssuerNit(' 900.123.456 ')).toBe('900123456');
  });
  it('returns null for empty values', () => {
    expect(normalizeIssuerNit(null)).toBeNull();
    expect(normalizeIssuerNit(undefined)).toBeNull();
    expect(normalizeIssuerNit('  ')).toBeNull();
    expect(normalizeIssuerNit('-')).toBeNull();
  });
});

describe('rangesOverlap', () => {
  it('is inclusive', () => {
    expect(rangesOverlap(1, 10, 10, 20)).toBe(true);
    expect(rangesOverlap(1, 9, 10, 20)).toBe(false);
  });
});

describe('assertNoCrossTenantNumberingOverlap', () => {
  it('rejects overlap with another tenant sharing the NIT via tax_id', async () => {
    const prisma = buildPrisma([target, other], [foreign_row()]);
    const err = await capture(
      assertNoCrossTenantNumberingOverlap(prisma, params),
    );
    expect(err).toBeInstanceOf(VendixHttpException);
    expect((err.getResponse() as any).error_code).toBe(
      'INVOICING_RESOLUTION_017',
    );
  });

  it('rejects when the NIT matches only via dian_configurations.nit', async () => {
    const seeded_target: Entity = {
      ...target,
      tax_id: '900123456-7', // semilla
      nits: ['902056589'],
    };
    const seeded_other: Entity = {
      ...other,
      tax_id: '111111111',
      nits: ['902056589-1'],
    };
    const prisma = buildPrisma([seeded_target, seeded_other], [foreign_row()]);
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, params),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('rejects when the other tenant stores the NIT with thousands dots', async () => {
    const dotted: Entity = { ...other, tax_id: '900.123.456-7' };
    const prisma = buildPrisma([target, dotted], [foreign_row()]);
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, params),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('takes the advisory lock only when lock_in_transaction is true', async () => {
    const prisma = buildPrisma([target, other], []);
    await assertNoCrossTenantNumberingOverlap(prisma, params);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    await assertNoCrossTenantNumberingOverlap(prisma, {
      ...params,
      lock_in_transaction: true,
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const call = (prisma.$executeRaw as jest.Mock).mock.calls[0] as any[];
    expect(call[0].join('?')).toContain('pg_advisory_xact_lock');
    expect(call[1]).toBe('numbering:900123456:setp:sales_invoice');
  });

  it('accepts a disjoint range', async () => {
    const prisma = buildPrisma([target, other], [foreign_row()]);
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, {
        ...params,
        range_from: 994000000,
        range_to: 994999999,
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts same range with a different prefix or document type', async () => {
    const prisma = buildPrisma([target, other], [foreign_row()]);
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, { ...params, prefix: 'FE' }),
    ).resolves.toBeUndefined();
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, {
        ...params,
        document_type: 'credit_note',
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts same range under a different NIT', async () => {
    const stranger: Entity = { ...other, tax_id: '800999888-1', nits: [] };
    const prisma = buildPrisma([target, stranger], [foreign_row()]);
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, params),
    ).resolves.toBeUndefined();
  });

  it('excludes the row being updated', async () => {
    const own = foreign_row({ id: 7, accounting_entity_id: 1 });
    const prisma = buildPrisma([target, other], [own]);
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, {
        ...params,
        exclude_resolution_id: 7,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, params),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('includes archived and inactive rows', async () => {
    const prisma = buildPrisma(
      [target, other],
      [foreign_row({ archived_at: new Date(), is_active: false })],
    );
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, params),
    ).rejects.toBeInstanceOf(VendixHttpException);
    const where = prisma.invoice_resolutions.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('is_active');
    expect(where).not.toHaveProperty('archived_at');
  });

  it('matches the prefix case-insensitively and trimmed', async () => {
    const prisma = buildPrisma(
      [target, other],
      [foreign_row({ prefix: 'setp' })],
    );
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, {
        ...params,
        prefix: ' SETP ',
      }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('does not leak foreign identifiers in message or details', async () => {
    const prisma = buildPrisma([target, other], [foreign_row()]);
    const err = await capture(
      assertNoCrossTenantNumberingOverlap(prisma, params),
    );
    const body = err.getResponse() as any;
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SENTINEL_NAME);
    expect(serialized).not.toContain(SENTINEL_NUMBER);
    expect(serialized).not.toContain(String(SENTINEL_CURRENT));
    const details = body.details;
    expect(Object.keys(details).sort()).toEqual([
      'document_type',
      'occupied_ranges',
      'prefix',
      'requested_range_from',
      'requested_range_to',
    ]);
    expect(details.occupied_ranges).toEqual([
      { from: 990000000, to: 990999999 },
    ]);
    // the select requested only what the message needs
    const select = prisma.invoice_resolutions.findMany.mock.calls[0][0].select;
    expect(select).toEqual({ prefix: true, range_from: true, range_to: true });
  });

  it('adds the sub-range example for SETP only', async () => {
    const prisma = buildPrisma(
      [target, other],
      [foreign_row(), foreign_row({ id: 51, prefix: 'FE' })],
    );
    const setp = await capture(
      assertNoCrossTenantNumberingOverlap(prisma, params),
    );
    expect(JSON.stringify(setp.getResponse())).toContain('994000000–994999999');
    const fe = await capture(
      assertNoCrossTenantNumberingOverlap(prisma, { ...params, prefix: 'FE' }),
    );
    expect(JSON.stringify(fe.getResponse())).not.toContain('994000000');
  });
});

describe('D10: series internas de notas sin guarda entre cuentas', () => {
  it.each([
    ['credit_note', 'NCVS'],
    ['debit_note', 'NDVS'],
    ['support_adjustment_note', 'NASVS'],
    ['equivalent_adjustment_note', 'NAEVS'],
  ])(
    '%s no consulta ni lanza aunque otra cuenta del mismo NIT solape',
    async (document_type, prefix) => {
      const prisma = buildPrisma(
        [target, other],
        [
          foreign_row({
            document_type,
            prefix,
            range_from: 1,
            range_to: 10000000,
          }),
        ],
      );
      await expect(
        assertNoCrossTenantNumberingOverlap(prisma, {
          ...params,
          document_type,
          prefix,
          range_from: 1,
          range_to: 10000000,
          lock_in_transaction: true,
        }),
      ).resolves.toBeUndefined();
      expect(prisma.invoice_resolutions.findMany).not.toHaveBeenCalled();
      expect(prisma.accounting_entities.findFirst).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it('sales_invoice sigue lanzando con solape', async () => {
    const prisma = buildPrisma([target, other], [foreign_row()]);
    await expect(
      assertNoCrossTenantNumberingOverlap(prisma, params),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });
});
