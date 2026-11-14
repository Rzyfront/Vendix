import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { BulkUploadLogsService } from './bulk-upload-logs.service';

/**
 * QUI-1004 — aislamiento por tienda del registro de cargas masivas.
 *
 * Cada consulta del servicio pasa por el `applyStoreScoping` REAL de
 * StorePrismaService (el mismo que corre en producción) antes de llegar a una
 * tabla en memoria con filas de dos tiendas. Así se prueba el contrato
 * completo: el servicio no puede ver otra tienda aunque olvide filtrar, y el
 * `store_id` de lo que escribe sale del contexto, nunca del cliente.
 */
const STORE_A = { organization_id: 1, store_id: 10, user_id: 100 };
const STORE_B = { organization_id: 2, store_id: 20, user_id: 200 };
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as any[]).every((w) => matches(row, w));
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { gte?: Date; lte?: Date };
      if (c.gte && row[key] < c.gte) return false;
      if (c.lte && row[key] > c.lte) return false;
      return true;
    }
    return row[key] === cond;
  });
}

function buildHarness() {
  const rows: Row[] = [];
  const queries: Array<{ operation: string; args: any }> = [];
  const store = new StorePrismaService();
  let nextId = 1;

  const users: Record<number, Row> = {
    100: { first_name: 'Ana', last_name: 'Tienda A', username: 'ana' },
    200: { first_name: 'Beto', last_name: 'Tienda B', username: 'beto' },
  };
  const withUser = (row: Row) => ({ ...row, user: users[row.user_id] ?? null });

  const engine: Record<string, (args: any) => any> = {
    findFirst: (args) => {
      const found = rows
        .filter((r) => matches(r, args.where))
        .sort((x, y) => y.created_at - x.created_at)[0];
      return found ? withUser(found) : null;
    },
    findMany: (args) =>
      rows
        .filter((r) => matches(r, args.where))
        .sort((x, y) => y.created_at - x.created_at)
        .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length))
        .map(withUser),
    count: (args) => rows.filter((r) => matches(r, args.where)).length,
    create: (args) => {
      const row = {
        id: nextId++,
        created_at: new Date(Date.now() + nextId),
        ...args.data,
      };
      rows.push(row);
      return row;
    },
    updateMany: (args) => {
      const hit = rows.filter((r) => matches(r, args.where));
      hit.forEach((r) => Object.assign(r, args.data));
      return { count: hit.length };
    },
  };

  const delegate = Object.fromEntries(
    Object.keys(engine).map((operation) => [
      operation,
      (args: any) =>
        (store as any).applyStoreScoping(
          'bulk_upload_logs',
          operation,
          args ?? {},
          async (scoped: any) => {
            queries.push({ operation, args: scoped });
            return engine[operation](scoped);
          },
        ),
    ]),
  );

  const prisma = { bulk_upload_logs: delegate } as unknown as StorePrismaService;
  return { rows, queries, service: new BulkUploadLogsService(prisma) };
}

function asStore(context: typeof STORE_A) {
  jest.spyOn(RequestContextService, 'getContext').mockReturnValue(context as any);
  jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(context.user_id);
  jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(context.store_id);
}

describe('BulkUploadLogsService · aislamiento por tienda', () => {
  afterEach(() => jest.restoreAllMocks());

  async function seedStoreA(h: ReturnType<typeof buildHarness>) {
    asStore(STORE_A);
    return h.service.record({
      upload_type: 'purchase_orders',
      file_name: 'compras.xlsx',
      file_hash: HASH_A,
      counts: { total_rows: 10, successful_rows: 7, failed_rows: 3, skipped_rows: 0 },
      result_reference: 'PO-0001',
    });
  }

  it('crea la fila con la tienda y el usuario del contexto', async () => {
    const h = buildHarness();
    await seedStoreA(h);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      store_id: STORE_A.store_id,
      user_id: STORE_A.user_id,
      status: 'partial',
      total_rows: 10,
      successful_rows: 7,
      failed_rows: 3,
      result_reference: 'PO-0001',
    });
  });

  it('la tienda B no lista las cargas de la tienda A', async () => {
    const h = buildHarness();
    await seedStoreA(h);
    asStore(STORE_B);
    await h.service.record({
      upload_type: 'products',
      file_name: 'productos.xlsx',
      file_hash: HASH_B,
      counts: { total_rows: 2, successful_rows: 2, failed_rows: 0, skipped_rows: 0 },
    });

    const listB = await h.service.list({ page: 1, limit: 20 });
    expect(listB.total).toBe(1);
    expect(listB.data.map((r: any) => r.file_name)).toEqual(['productos.xlsx']);
    // Ni el filtro por tipo de A le devuelve nada.
    const filtered = await h.service.list({ upload_type: 'purchase_orders' });
    expect(filtered.total).toBe(0);
    expect(filtered.data).toEqual([]);
    // Toda consulta de B llegó a la tabla con su store_id.
    h.queries
      .filter((q) => q.operation !== 'create')
      .slice(-4)
      .forEach((q) => expect(JSON.stringify(q.args.where)).toContain('"store_id":20'));
  });

  it('la tienda B no consulta por id una carga de la tienda A: 404', async () => {
    const h = buildHarness();
    const rowA = await seedStoreA(h);
    asStore(STORE_B);
    await expect(h.service.findOne(rowA.id)).rejects.toMatchObject({
      status: 404,
    });
    asStore(STORE_A);
    await expect(h.service.findOne(rowA.id)).resolves.toMatchObject({
      id: rowA.id,
      user_name: 'Ana Tienda A',
    });
  });

  it('la tienda B no recibe aviso de duplicado por un archivo de la tienda A', async () => {
    const h = buildHarness();
    await seedStoreA(h);
    asStore(STORE_B);
    await expect(
      h.service.findDuplicate('purchase_orders', HASH_A),
    ).resolves.toBeNull();
    asStore(STORE_A);
    await expect(
      h.service.findDuplicate('purchase_orders', HASH_A),
    ).resolves.toMatchObject({
      user_name: 'Ana Tienda A',
      result_reference: 'PO-0001',
      file_name: 'compras.xlsx',
    });
  });

  it('el duplicado es por tipo de carga: la misma huella en otro tipo no avisa', async () => {
    const h = buildHarness();
    await seedStoreA(h);
    await expect(h.service.findDuplicate('products', HASH_A)).resolves.toBeNull();
  });

  it('una página de otra tienda con el mismo session_id no suma sobre la fila ajena', async () => {
    const h = buildHarness();
    asStore(STORE_A);
    await h.service.trackSessionPage(
      'products',
      'sess-1',
      { file_name: 'p.xlsx', file_hash: HASH_A },
      { total: 200, successful: 100, failed: 0 },
    );
    asStore(STORE_B);
    await h.service.trackSessionPage(
      'products',
      'sess-1',
      { file_name: 'p.xlsx', file_hash: HASH_A },
      { total: 200, successful: 50, failed: 0 },
    );
    expect(h.rows).toHaveLength(2);
    expect(h.rows.find((r) => r.store_id === 10)?.successful_rows).toBe(100);
    expect(h.rows.find((r) => r.store_id === 20)?.successful_rows).toBe(50);
  });

  it('sin tienda en el contexto no lista nada: rechaza', async () => {
    const h = buildHarness();
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 1 } as any);
    await expect(h.service.list({})).rejects.toThrow(/store context required/);
  });
});

describe('BulkUploadLogsService · conteos y estado', () => {
  afterEach(() => jest.restoreAllMocks());

  it('las páginas de una sesión suman en UNA fila y fijan el estado', async () => {
    const h = buildHarness();
    asStore(STORE_A);
    const file = { file_name: 'empleados.xlsx', file_hash: HASH_A };
    await h.service.trackSessionPage('employees', 's-9', file, {
      total: 150,
      successful: 100,
      failed: 0,
    });
    await h.service.trackSessionPage('employees', 's-9', file, {
      total: 150,
      successful: 45,
      failed: 5,
    });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      session_id: 's-9',
      total_rows: 150,
      successful_rows: 145,
      failed_rows: 5,
      status: 'partial',
    });
  });

  it('sin huella válida no registra (nada se inventa)', async () => {
    const h = buildHarness();
    asStore(STORE_A);
    await h.service.trackUpload(
      'customers',
      { file_name: 'c.xlsx', file_hash: 'no-es-hash' },
      { total_processed: 3, successful: 3, failed: 0 },
    );
    expect(h.rows).toHaveLength(0);
  });

  it('todo con error queda «fallida» y un paso accesorio fallido queda «parcial»', async () => {
    const h = buildHarness();
    asStore(STORE_A);
    await h.service.trackUpload(
      'customers',
      { file_name: 'c.xlsx', file_hash: HASH_A },
      { total_processed: 3, successful: 0, failed: 3 },
    );
    await h.service.register({
      upload_type: 'purchase_orders',
      file_name: 'compras.xlsx',
      file_hash: HASH_B,
      total_rows: 5,
      successful_rows: 5,
      failed_rows: 0,
      skipped_rows: 0,
      accessory_step_failed: true,
      result_reference: 'PO-0002',
    });
    expect(h.rows.map((r) => r.status)).toEqual(['failed', 'partial']);
  });

  it('compras: los productos creados se registran como «creados» dentro de lo cargado', async () => {
    const h = buildHarness();
    asStore(STORE_A);
    await h.service.register({
      upload_type: 'purchase_orders',
      file_name: 'compras.xlsx',
      file_hash: HASH_A,
      total_rows: 10,
      successful_rows: 7,
      created_rows: 2,
      failed_rows: 3,
      skipped_rows: 0,
      result_reference: 'PO-0003',
    });
    expect(h.rows[0]).toMatchObject({
      store_id: STORE_A.store_id,
      total_rows: 10,
      successful_rows: 7,
      created_rows: 2,
      failed_rows: 3,
      status: 'partial',
      result_reference: 'PO-0003',
    });
  });

  it('lo creado nunca supera lo cargado; sin dato queda null', async () => {
    const h = buildHarness();
    asStore(STORE_A);
    await h.service.register({
      upload_type: 'purchase_orders',
      file_name: 'a.xlsx',
      file_hash: HASH_A,
      total_rows: 2,
      successful_rows: 1,
      created_rows: 5,
      failed_rows: 1,
      skipped_rows: 0,
    });
    await h.service.trackUpload(
      'bank_statements',
      { file_name: 'e.csv', file_hash: HASH_B },
      { total_processed: 1, successful: 1 },
    );
    expect(h.rows.map((r) => r.created_rows)).toEqual([1, null]);
  });

  it('un fallo al registrar no tumba la carga', async () => {
    const h = buildHarness();
    asStore(STORE_A);
    (h.service as any).prisma.bulk_upload_logs.create = () => {
      throw new Error('db down');
    };
    await expect(
      h.service.trackUpload(
        'bank_statements',
        { file_name: 'extracto.csv', file_hash: HASH_A },
        { total_processed: 1, successful: 1 },
      ),
    ).resolves.toBeUndefined();
  });
});
