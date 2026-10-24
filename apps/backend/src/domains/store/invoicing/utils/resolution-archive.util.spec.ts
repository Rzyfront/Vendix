import {
  IN_FLIGHT_TRANSMISSION_STATUSES,
  archiveResolutionInTx,
  assertResolutionArchivable,
} from './resolution-archive.util';
import {
  PLATFORM_FISCAL_SETTINGS_KEY,
  VENDOR_SUPPORT_FISCAL_SETTINGS_KEY,
} from '../../../../common/constants/platform-fiscal.constants';

const now = new Date('2026-06-01T12:00:00Z');

/**
 * Cliente en memoria mínimo. `rows` = filas de invoice_resolutions; el resto de
 * contadores se fijan por opción. `findActiveResolution` / `count` reales
 * (resolution-selection.util) se ejercitan contra `rows`.
 */
const createClient = (
  rows: any[],
  opts: {
    invoices?: number;
    retries?: number;
    settings?: any[];
    testing?: number;
  } = {},
) => {
  const matches = (row: any, where: any): boolean =>
    Object.entries(where).every(([k, c]: [string, any]) => {
      if (c && typeof c === 'object' && !(c instanceof Date)) {
        if ('lte' in c && !(row[k] <= c.lte)) return false;
        if ('gte' in c && !(row[k] >= c.gte)) return false;
        if ('not' in c && row[k] === c.not) return false;
        return true;
      }
      return (row[k] ?? null) === c;
    });
  let seq = 500;
  const invoice_resolutions = {
    findFirst: jest.fn(async ({ where }: any) =>
      rows
        .filter((r) => matches(r, where))
        .sort((a, b) => b.created_at - a.created_at)[0] ?? null,
    ),
    findUnique: jest.fn(
      async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    ),
    count: jest.fn(
      async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
    ),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: ++seq, created_at: Date.now(), archived_at: null, ...data };
      rows.push(row);
      return row;
    }),
  };
  return {
    $executeRawUnsafe: jest.fn(),
    invoice_resolutions,
    invoices: { count: jest.fn().mockResolvedValue(opts.invoices ?? 0) },
    invoice_retry_queue: { count: jest.fn().mockResolvedValue(opts.retries ?? 0) },
    platform_settings: {
      findMany: jest.fn().mockResolvedValue(opts.settings ?? []),
    },
    dian_configurations: {
      count: jest.fn().mockResolvedValue(opts.testing ?? 0),
    },
  };
};

const noteRow = (over: any = {}) => ({
  id: 1,
  accounting_entity_id: 5,
  organization_id: 1,
  document_type: 'credit_note',
  prefix: 'NCVS',
  is_active: true,
  archived_at: null,
  created_at: 100,
  valid_from: new Date(now.getTime() - 1000),
  valid_to: new Date(now.getTime() + 100000),
  ...over,
});

const invoiceRow = (over: any = {}) =>
  noteRow({ id: 2, document_type: 'sales_invoice', prefix: 'FE', ...over });

describe('resolution-archive.util', () => {
  describe('assertResolutionArchivable', () => {
    it('016: ya archivada', async () => {
      const row = noteRow({ archived_at: new Date() });
      const client = createClient([row]);
      await expect(
        assertResolutionArchivable(client, row, { now }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_016' });
    });

    it('012: facturas en vuelo (filtra por los estados en vuelo)', async () => {
      const row = invoiceRow();
      const client = createClient([row], { invoices: 2 });
      await expect(
        assertResolutionArchivable(client, row, { now }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_012' });
      expect(client.invoices.count).toHaveBeenCalledWith({
        where: {
          resolution_id: 2,
          transmission_status: { in: [...IN_FLIGHT_TRANSMISSION_STATUSES] },
        },
      });
    });

    it('012: cola de reintentos pendiente', async () => {
      const row = invoiceRow();
      const client = createClient([row], { retries: 1 });
      await expect(
        assertResolutionArchivable(client, row, { now }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_012' });
      expect(client.invoice_retry_queue.count).toHaveBeenCalledWith({
        where: { status: 'pending', invoice: { resolution_id: 2 } },
      });
    });

    it('013: cableada a la configuración fiscal de plataforma', async () => {
      const row = invoiceRow();
      const client = createClient([row], {
        settings: [
          { key: PLATFORM_FISCAL_SETTINGS_KEY, value: { invoice_resolution_id: 99 } },
          { key: VENDOR_SUPPORT_FISCAL_SETTINGS_KEY, value: { invoice_resolution_id: 2 } },
        ],
      });
      await expect(
        assertResolutionArchivable(client, row, { now }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_013' });
    });

    it('014: set de pruebas DIAN en curso', async () => {
      const row = invoiceRow();
      const client = createClient([row], { testing: 1 });
      await expect(
        assertResolutionArchivable(client, row, { now }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_014' });
      expect(client.dian_configurations.count).toHaveBeenCalledWith({
        where: {
          accounting_entity_id: 5,
          configuration_type: expect.any(String),
          enablement_status: 'testing',
        },
      });
    });

    it('015: serie de notas en uso sin reemplazo', async () => {
      const row = noteRow();
      const client = createClient([row]);
      await expect(
        assertResolutionArchivable(client, row, { now }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_015' });
      await expect(
        assertResolutionArchivable(client, row, { now, replacement_prefix: '  ' }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_015' });
    });

    it('serie de notas en uso CON reemplazo: requires_replacement', async () => {
      const row = noteRow();
      const client = createClient([row]);
      await expect(
        assertResolutionArchivable(client, row, { now, replacement_prefix: 'NCX' }),
      ).resolves.toEqual({ requires_replacement: true });
    });

    it('sales_invoice activa NO exige reemplazo', async () => {
      const row = invoiceRow();
      const client = createClient([row]);
      await expect(
        assertResolutionArchivable(client, row, { now }),
      ).resolves.toEqual({ requires_replacement: false });
    });

    it('nota que no es la serie en uso (hay otra activa) no exige reemplazo', async () => {
      const older = noteRow({ id: 1, created_at: 50 });
      const newer = noteRow({ id: 3, prefix: 'NCZ', created_at: 200 });
      const client = createClient([older, newer]);
      await expect(
        assertResolutionArchivable(client, older, { now }),
      ).resolves.toEqual({ requires_replacement: false });
    });
  });

  describe('archiveResolutionInTx', () => {
    const params = (resolution: any, over: any = {}) => ({
      resolution,
      user_id: 42,
      now,
      organization_id: 1,
      ...over,
    });

    it('feliz: archiva con archived_at, user y is_active=false, bajo el lock', async () => {
      const row = invoiceRow();
      const tx = createClient([row]);
      const { archived, replacement } = await archiveResolutionInTx(
        tx,
        params(row),
      );
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        'invoice_resolution:5:sales_invoice',
      );
      expect(archived).toEqual(
        expect.objectContaining({
          is_active: false,
          archived_at: now,
          archived_by_user_id: 42,
        }),
      );
      expect(replacement).toBeNull();
    });

    it('en uso CON reemplazo: archiva la vieja y crea la nueva (prefijo normalizado)', async () => {
      const row = noteRow();
      const tx = createClient([row]);
      const { archived, replacement } = await archiveResolutionInTx(
        tx,
        params(row, { replacement_prefix: ' ncx ' }),
      );
      expect(archived.archived_at).toBe(now);
      expect(replacement).toEqual(
        expect.objectContaining({
          prefix: 'NCX',
          document_type: 'credit_note',
          accounting_entity_id: 5,
          organization_id: 1,
          store_id: null,
          current_number: 0,
          range_from: 1,
          is_active: true,
          technical_key: null,
        }),
      );
      expect(tx.invoice_resolutions.create).toHaveBeenCalledTimes(1);
    });

    it('reemplazo con prefijo ocupado (incluso archivado): 015 sin escribir', async () => {
      const row = noteRow();
      const taken = noteRow({ id: 9, prefix: 'NCX', is_active: false, archived_at: new Date() });
      const tx = createClient([row, taken]);
      await expect(
        archiveResolutionInTx(tx, params(row, { replacement_prefix: 'NCX' })),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_015' });
      expect(tx.invoice_resolutions.update).not.toHaveBeenCalled();
      expect(tx.invoice_resolutions.create).not.toHaveBeenCalled();
    });

    it('reemplazo con forma inválida: 015 sin escribir', async () => {
      const row = noteRow();
      const tx = createClient([row]);
      await expect(
        archiveResolutionInTx(tx, params(row, { replacement_prefix: 'N-C!' })),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_015' });
      expect(tx.invoice_resolutions.update).not.toHaveBeenCalled();
    });

    it('relee la fila dentro del lock: una ya archivada por otra transacción da 016', async () => {
      const stale = invoiceRow();
      const tx = createClient([{ ...stale, archived_at: new Date() }]);
      await expect(
        archiveResolutionInTx(tx, params(stale)),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_RESOLUTION_016' });
    });
  });
});
