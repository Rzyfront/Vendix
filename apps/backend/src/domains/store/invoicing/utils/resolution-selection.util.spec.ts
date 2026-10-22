import {
  ACTIVE_RESOLUTION_ORDER_BY,
  activeResolutionWhere,
  deactivateOtherActiveSeries,
  dormantInternalSeriesWhere,
  isSingleActiveDocumentType,
  lockResolutionSeries,
} from './resolution-selection.util';
import { buildResolutionsInUse } from './resolutions-in-use.util';
import {
  InvoiceNumberGenerator,
  INTERNAL_SERIES_INITIAL_RANGE,
} from './invoice-number-generator';
import { FISCAL_DOCUMENT_TYPES } from '../fiscal-document-requirements';

const VALID_CLTEC = 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c';

/** Evalúa un `where` de Prisma (subconjunto usado por la regla) sobre una fila. */
const matches = (row: any, where: any): boolean =>
  Object.entries(where).every(([key, cond]: [string, any]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('lte' in cond && !(row[key] <= cond.lte)) return false;
      if ('gte' in cond && !(row[key] >= cond.gte)) return false;
      if ('not' in cond && row[key] === cond.not) return false;
      if ('in' in cond && !cond.in.includes(row[key])) return false;
      return true;
    }
    return row[key] === cond;
  });

/** Tabla `invoice_resolutions` en memoria que respeta `where`/`orderBy`. */
const createTable = (initial: any[]) => {
  const rows = initial.map((r) => ({ ...r }));
  let seq = 1000;
  const table = {
    findFirst: jest.fn(async ({ where, orderBy }: any) => {
      const found = rows.filter((r) => matches(r, where));
      if (orderBy?.created_at === 'desc') {
        found.sort((a, b) => b.created_at - a.created_at);
      }
      return found[0] ?? null;
    }),
    findMany: jest.fn(async ({ where }: any) =>
      rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    ),
    count: jest.fn(
      async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
    ),
    findUnique: jest.fn(
      async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    ),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: ++seq, created_at: Date.now(), ...data };
      rows.push(row);
      return row;
    }),
  };
  return { rows, table };
};

describe('resolution-selection.util', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  describe('regla pura', () => {
    it('activeResolutionWhere arma activa + vigente y fija id solo si viene', () => {
      expect(
        activeResolutionWhere({
          accounting_entity_id: 5,
          document_type: 'sales_invoice',
          now,
        }),
      ).toEqual({
        accounting_entity_id: 5,
        document_type: 'sales_invoice',
        is_active: true,
        valid_from: { lte: now },
        valid_to: { gte: now },
      });
      expect(
        activeResolutionWhere({
          accounting_entity_id: 5,
          document_type: 'sales_invoice',
          now,
          resolution_id: 9,
        }),
      ).toEqual(expect.objectContaining({ id: 9 }));
    });

    it('orderBy y búsqueda dormida', () => {
      expect(ACTIVE_RESOLUTION_ORDER_BY).toEqual({ created_at: 'desc' });
      expect(
        dormantInternalSeriesWhere({
          accounting_entity_id: 5,
          document_type: 'credit_note',
        }),
      ).toEqual({ accounting_entity_id: 5, document_type: 'credit_note' });
    });

    it('isSingleActiveDocumentType: solo los 4 tipos de nota', () => {
      const single = FISCAL_DOCUMENT_TYPES.filter(isSingleActiveDocumentType);
      expect([...single].sort()).toEqual(
        [
          'credit_note',
          'debit_note',
          'support_adjustment_note',
          'equivalent_adjustment_note',
        ].sort(),
      );
      expect(isSingleActiveDocumentType('sales_invoice')).toBe(false);
    });
  });

  describe('lockResolutionSeries', () => {
    it('usa la llave y el SQL del generador', async () => {
      const tx = { $executeRawUnsafe: jest.fn() };
      await lockResolutionSeries(tx, {
        accounting_entity_id: 5,
        document_type: 'credit_note',
      });
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        'invoice_resolution:5:credit_note',
      );
    });
  });

  describe('deactivateOtherActiveSeries', () => {
    it('apaga las otras activas del mismo tipo y entidad, nada más', async () => {
      const { table, rows } = createTable([
        { id: 1, accounting_entity_id: 5, document_type: 'credit_note', is_active: true },
        { id: 2, accounting_entity_id: 5, document_type: 'credit_note', is_active: true },
        { id: 3, accounting_entity_id: 5, document_type: 'debit_note', is_active: true },
        { id: 4, accounting_entity_id: 6, document_type: 'credit_note', is_active: true },
      ]);
      const ids = await deactivateOtherActiveSeries(
        { invoice_resolutions: table },
        { accounting_entity_id: 5, document_type: 'credit_note', keep_id: 2 },
      );
      expect(ids).toEqual([1]);
      expect(rows.map((r) => r.is_active)).toEqual([false, true, true, true]);
    });

    it('no hace nada para sales_invoice', async () => {
      const { table } = createTable([]);
      const ids = await deactivateOtherActiveSeries(
        { invoice_resolutions: table },
        { accounting_entity_id: 5, document_type: 'sales_invoice', keep_id: 1 },
      );
      expect(ids).toEqual([]);
      expect(table.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('generador y endpoint comparten la regla', () => {
    const DAY = 86_400_000;
    const base = {
      accounting_entity_id: 5,
      prefix: 'FE',
      range_from: 1,
      range_to: 1000,
      current_number: 10,
      resolution_number: '18764000001234',
      technical_key: VALID_CLTEC,
      technical_key_encrypted: null,
    };
    const valid = {
      valid_from: new Date(now.getTime() - 100 * DAY),
      valid_to: new Date(now.getTime() + 100 * DAY),
    };

    const setup = (rows: any[]) => {
      const { table, rows: mem } = createTable(rows);
      const tx = {
        $executeRawUnsafe: jest.fn(),
        invoice_resolutions: table,
      };
      const client = {
        invoice_resolutions: table,
        $transaction: async (cb: any) => cb(tx),
      };
      const generator = new InvoiceNumberGenerator(
        { withoutScope: () => client } as any,
        { resolveAccountingEntityForFiscal: jest.fn() } as any,
        {
          reveal: (s: any) => s?.technical_key_encrypted ?? s?.technical_key,
        } as any,
      );
      return { generator, client, table, mem };
    };

    it('asigna sobre la MISMA fila que el endpoint reporta (inactiva y vencida descartadas, gana la activa más reciente)', async () => {
      const { generator, client } = setup([
        // Inactiva y la más nueva: no debe ganar.
        { ...base, ...valid, id: 1, document_type: 'sales_invoice', prefix: 'A', is_active: false, created_at: 400 },
        // Vencida.
        { ...base, ...valid, id: 2, document_type: 'sales_invoice', prefix: 'B', is_active: true, created_at: 300, valid_to: new Date(now.getTime() - DAY) },
        // Dos activas vigentes: gana la de created_at mayor (id 4).
        { ...base, ...valid, id: 3, document_type: 'sales_invoice', prefix: 'C', is_active: true, created_at: 100 },
        { ...base, ...valid, id: 4, document_type: 'sales_invoice', prefix: 'D', is_active: true, created_at: 200 },
      ]);
      jest.useFakeTimers().setSystemTime(now);
      try {
        const inUse = await buildResolutionsInUse(client, {
          accounting_entity_id: 5,
          now: new Date(),
        });
        const generated = await generator.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 5,
          document_type: 'sales_invoice',
        });

        const item = inUse.items.find((i) => i.document_type === 'sales_invoice')!;
        expect(item.source).toBe('resolution');
        expect(item.resolution_id).toBe(4);
        expect(item.active_count).toBe(2);
        expect(item.next_number).toBe('D11');
        expect(generated.resolution_id).toBe(item.resolution_id);
        expect(generated.invoice_number).toBe(item.next_number);
        expect(inUse.items.map((i) => i.document_type)).toEqual([
          ...FISCAL_DOCUMENT_TYPES,
        ]);
        expect(JSON.stringify(inUse)).not.toContain('technical_key');
      } finally {
        jest.useRealTimers();
      }
    });

    it('nota sin fila: el endpoint proyecta exactamente la serie que el generador abre', async () => {
      const { generator, client, table } = setup([]);
      jest.useFakeTimers().setSystemTime(now);
      try {
        const inUse = await buildResolutionsInUse(client, {
          accounting_entity_id: 5,
          now: new Date(),
        });
        const item = inUse.items.find((i) => i.document_type === 'credit_note')!;
        expect(item).toEqual(
          expect.objectContaining({
            source: 'internal_series_projected',
            resolution_id: null,
            prefix: 'NCVS',
            next_number: 'NCVS1',
            is_internal_series: true,
            single_active_enforced: true,
            active_count: 0,
          }),
        );

        const generated = await generator.generateNextNumber({
          organization_id: 1,
          accounting_entity_id: 5,
          document_type: 'credit_note',
        });
        const created = table.create.mock.calls[0][0].data;
        expect(created.prefix).toBe(item.prefix);
        expect(created.range_from).toBe(1);
        expect(created.range_to).toBe(INTERNAL_SERIES_INITIAL_RANGE);
        expect(new Date(created.valid_to).toISOString()).toBe(item.valid_to);
        expect(generated.invoice_number).toBe(item.next_number);
      } finally {
        jest.useRealTimers();
      }
    });

    it('tipo sin fila ni serie interna -> none', async () => {
      const { client } = setup([]);
      const inUse = await buildResolutionsInUse(client, {
        accounting_entity_id: 5,
        now,
      });
      const item = inUse.items.find((i) => i.document_type === 'sales_invoice')!;
      expect(item).toEqual(
        expect.objectContaining({ source: 'none', resolution_id: null, next_number: null }),
      );
    });

    it('plataforma: sales_invoice toma la configurada, no la más reciente; sin configurar -> none', async () => {
      const { client } = setup([
        { ...base, ...valid, id: 3, document_type: 'sales_invoice', prefix: 'C', is_active: true, created_at: 100 },
        { ...base, ...valid, id: 4, document_type: 'sales_invoice', prefix: 'D', is_active: true, created_at: 200 },
      ]);
      const configured = await buildResolutionsInUse(client, {
        accounting_entity_id: 5,
        now,
        sales_invoice_resolution_id: 3,
      });
      expect(
        configured.items.find((i) => i.document_type === 'sales_invoice')!.resolution_id,
      ).toBe(3);
      const unset = await buildResolutionsInUse(client, {
        accounting_entity_id: 5,
        now,
        sales_invoice_resolution_id: null,
      });
      expect(
        unset.items.find((i) => i.document_type === 'sales_invoice')!.source,
      ).toBe('none');
    });
  });
});
