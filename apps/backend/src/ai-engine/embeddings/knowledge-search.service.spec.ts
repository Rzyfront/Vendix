import {
  intentTsQuery,
  KnowledgeSearchService,
} from './knowledge-search.service';
import { buildToolDocument, localToolRanking } from '../tools/tool-catalog';
const doc = (name: string, description: string) =>
  buildToolDocument({
    name,
    description,
    domain: 'inventory',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
  });
const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
describe('KnowledgeSearchService B', () => {
  let raw: jest.Mock;
  let transaction: jest.Mock;
  let embeddings: any;
  let service: KnowledgeSearchService;
  const docs = [
    doc('find_coffee', 'Busca café de bodega'),
    doc('find_orders', 'Busca órdenes'),
  ];
  const ready = docs.map((d, i) => ({
    id: i + 1,
    document_key: d.key,
    content_hash: d.hash,
    indexed_hash: d.hash,
    embedding_fingerprint: 'model-v1',
  }));
  beforeEach(() => {
    raw = jest.fn(async (sql: string) =>
      sql.includes('document_key') ? ready : [{ id: 1 }, { id: 2 }],
    );
    transaction = jest.fn((fn) =>
      fn({ $executeRawUnsafe: jest.fn(), $queryRawUnsafe: raw }),
    );
    embeddings = {
      configuration: jest.fn().mockResolvedValue({ fingerprint: 'model-v1' }),
      generate: jest
        .fn()
        .mockResolvedValue({ vector, fingerprint: 'model-v1' }),
    };
    service = new KnowledgeSearchService(
      { $transaction: transaction } as any,
      embeddings,
    );
  });
  afterAll(() => {});
  it('uses authorized global IDs only, explicit namespaces and parameterized PostgreSQL lexical/vector branches', async () => {
    const query = `café'); SELECT secreto --`;
    const result = await service.rank(query, docs.slice(0, 1), 'tenant1');
    expect(result.names).toEqual(['find_coffee']);
    expect(raw).toHaveBeenCalledTimes(3);
    const [lexicalSql, ids, lexicalQuery] = raw.mock.calls[1];
    expect(lexicalSql).not.toContain(query);
    expect(lexicalQuery).toBe(intentTsQuery(query));
    expect(lexicalQuery).toBe('cafe:* | select:* | secreto:*');
    expect(lexicalSql).toContain("to_tsquery('spanish', $2)");
    expect(lexicalSql).toContain("knowledge_scope = 'global'");
    expect(ids).toEqual([1]);
    const [vectorSql, vectorIds] = raw.mock.calls[2];
    expect(vectorSql).toContain('e.store_id = 0 AND e.organization_id = 0');
    expect(vectorSql).toContain('id = ANY($1::int[])');
    expect(vectorIds).toEqual([1]);
    expect(vectorSql).not.toMatch(/OR\s+.*store_id/);
    expect(transaction.mock.calls[0][1]).toEqual({
      timeout: 500,
      maxWait: 150,
    });
  });
  it('degrades to SQL lexical when vector generation fails', async () => {
    embeddings.generate.mockRejectedValue(new Error('provider down'));
    const result = await service.rank('café', docs, 'tenant');
    expect(result.names[0]).toBe('find_coffee');
    expect(result.degraded).toContain('vector_unavailable');
    expect(raw).toHaveBeenCalledTimes(2);
  });
  it('still uses PostgreSQL lexical with no embedding app configured', async () => {
    embeddings.configuration.mockRejectedValue(new Error('missing app'));
    const result = await service.rank('café', docs, 'tenant');
    expect(result.degraded).toContain('vector_unavailable');
    expect(embeddings.generate).not.toHaveBeenCalled();
    expect(raw).toHaveBeenCalledTimes(2);
  });
  it('falls back locally with missing migration/DB/timeout', async () => {
    transaction.mockRejectedValue(new Error('table missing'));
    const result = await service.rank('café', docs, 's');
    expect(result.names[0]).toBe('find_coffee');
    expect(result.degraded).toContain('index_unavailable');
  });
  it('never queries vector on a wrong dimension, NaN or zero vector', async () => {
    for (const bad of [
      [1, 2],
      [...vector.slice(0, -1), NaN],
      Array(1536).fill(0),
    ]) {
      embeddings.generate.mockResolvedValue({
        vector: bad,
        fingerprint: 'model-v1',
      });
      const result = await service.rank(
        'café',
        docs,
        `s${String(bad[0])}${bad.length}`,
      );
      expect(result.degraded).toContain('vector_unavailable');
    }
    expect(raw.mock.calls.some(([sql]) => sql.includes('<=>'))).toBe(false);
  });
  it('filters stale hashes/retired versions before any ranking SQL', async () => {
    raw.mockResolvedValue(
      ready.map((row) => ({ ...row, indexed_hash: 'stale' })),
    );
    const result = await service.rank('café', docs, 's');
    expect(result.degraded).toContain('index_not_ready');
    expect(embeddings.generate).not.toHaveBeenCalled();
  });
  it('does not mix embedding models/fingerprints', async () => {
    embeddings.configuration.mockResolvedValue({ fingerprint: 'model-v2' });
    const result = await service.rank('café', docs, 's');
    expect(result.degraded).toContain('vector_unavailable');
    expect(embeddings.generate).not.toHaveBeenCalled();
  });
  it('caches one intention embedding and invalidates by authority, query, schema and model', async () => {
    await service.rank('café', docs, 'store1');
    expect((await service.rank('café', docs, 'store1')).cacheHit).toBe(true);
    expect(embeddings.generate).toHaveBeenCalledTimes(1);
    await service.rank('café', docs.slice(0, 1), 'store1');
    await service.rank('café', docs, 'store2');
    await service.rank('orden', docs, 'store1');
    expect(embeddings.generate).toHaveBeenCalledTimes(4);
    const keys = [...(service as any).cache.keys()];
    expect(keys.every((k) => /^[a-f0-9]{64}$/.test(k))).toBe(true);
  });
  it('expires selection cache after five minutes', async () => {
    const time = jest.spyOn(Date, 'now').mockReturnValue(1);
    try {
      await service.rank('café', docs, 's');
      time.mockReturnValue(300002);
      await service.rank('café', docs, 's');
      expect(embeddings.generate).toHaveBeenCalledTimes(2);
    } finally {
      time.mockRestore();
    }
  });

  it('uses exact canonical/alias fast path with zero DB or embedding calls', async () => {
    const result = await service.rank('find_coffee', docs, 's');
    expect(result.names[0]).toBe('find_coffee');
    expect(transaction).not.toHaveBeenCalled();
    expect(embeddings.configuration).not.toHaveBeenCalled();
  });
  it('process retrieval binds its type separately', async () => {
    try {
      const processDoc = {
        ...docs[0],
        key: 'process:reponer:1:steps',
        name: 'reponer:steps',
        metadata: { ...docs[0].metadata, entity_type: 'process' },
      };
      raw.mockImplementation(async (sql: string) =>
        sql.includes('document_key')
          ? [{ ...ready[0], document_key: processDoc.key }]
          : [{ id: 1 }],
      );
      const result = await service.rank(
        'necesito abastecer café',
        [processDoc, docs[1]],
        'scope',
        undefined,
        'process',
      );
      expect(result.names).toEqual([processDoc.name]);
      expect(raw.mock.calls[0][2]).toBe('process');
      expect(raw.mock.calls[1][3]).toBe('process');
      expect(raw.mock.calls[2][4]).toBe('process');
      expect(raw.mock.calls[2][0]).toContain('e.entity_type = d.entity_type');
    } finally {
    }
  });
});

/**
 * Recall de la recuperación LÉXICA (el piso en prod sin vectores) sobre el
 * catálogo real (snapshot de 316 tools, `test/agentic/fixtures`), con las
 * consultas sintéticas versionadas. Meta del plan: ≥27/30 en top-8.
 * Regenerar el snapshot: volcar `AIToolRegistry.getAll()` del backend vivo.
 */
describe('Recall léxico sobre el catálogo real (top-8)', () => {
  const snapshot: Array<
    Record<string, any>
  > = require('../../../test/agentic/fixtures/tool-catalog.snapshot.json');
  const SCAFFOLD = new Set([
    'discovery',
    'planning',
    'playbooks',
    'procedural_memory',
    'capabilities',
    'api-bridge',
    'sandbox',
    'tasks',
  ]);
  const docs = snapshot
    .filter((t) => !SCAFFOLD.has(t.domain))
    .map((t) =>
      buildToolDocument({
        name: t.name,
        description: t.description,
        domain: t.domain,
        parameters: t.parameters,
        readOnly: t.readOnly,
        requiresConfirmation: t.requiresConfirmation,
        clientSide: t.clientSide,
        discovery: t.synonyms?.length ? { synonyms: t.synonyms } : undefined,
      } as any),
    );
  const CASES: Array<[string, string[]]> = [
    [
      'Oe me ayudas a analizar un cierre de caja que no me dio?',
      [
        'list_cash_sessions',
        'get_cash_session_close_report',
        'get_cash_session_status',
      ],
    ],
    [
      'kuanto stok tengo de cocacola',
      ['get_stock_levels', 'find_product', 'check_stock_availability'],
    ],
    [
      'facturas rechazadas por la DIAN',
      ['list_invoices', 'get_invoice_status', 'send_invoice_dian'],
    ],
    [
      '¿Cuánto hay en caja?',
      ['get_active_cash_session', 'get_cash_session_status'],
    ],
    ['¿qué productos tienen poco stock?', ['get_low_stock_alerts']],
    ['muéstrame las últimas facturas', ['list_invoices']],
    ['Crea el cliente Juan Pérez', ['upsert_customer']],
    ['cámbiale la dirección a Cra 10 #20-30', ['upsert_customer']],
    ['¿cuánto me cuesta enviarle?', ['quote_shipping']],
    ['¿Cuánto vendí hoy?', ['get_sales_report']],
    ['Crea un producto Prueba E2E a 5000', ['create_product']],
    [
      'Ajusta el stock de Coca-Cola a 0',
      ['adjust_stock', 'create_stock_adjustment'],
    ],
    ['Llévame a las órdenes pendientes', ['ui_navigate', 'list_orders']],
    ['¿Cuántos empleados tengo en nómina?', ['list_employees']],
    [
      '¿cuándo es la próxima liquidación de nómina?',
      ['list_payroll_runs', 'calculate_payroll', 'get_payroll_run'],
    ],
    ['Muéstrame el estado de resultados del mes', ['get_income_statement']],
    ['¿y el balance general?', ['get_balance_sheet']],
    ['reenvía la factura a la DIAN', ['send_invoice_dian']],
    ['¿Qué mesas están abiertas?', ['list_tables']],
    [
      'manda la orden de la mesa 3 a cocina',
      ['fire_kitchen_order', 'preview_kitchen_fire'],
    ],
    ['crea un gasto de 20.000 de aseo', ['create_expense']],
    ['Analiza mis gastos del mes', ['list_expenses']],
    [
      'Prepara una orden de compra para reponer stock bajo',
      ['manage_purchase_orders', 'get_sourcing_suggestion'],
    ],
    ['muéstrame el inventario valorizado', ['get_stock_levels', 'get_report']],
    ['¿qué clientes me deben? cartera vencida', ['list_receivables']],
    ['Lista mis proveedores', ['find_supplier', 'manage_suppliers']],
    [
      '¿Cuánto me cuesta la nómina este mes con parafiscales?',
      ['calculate_payroll', 'get_payroll_run', 'list_payroll_runs'],
    ],
    ['muéstrame el top de productos más vendidos', ['get_top_products']],
    [
      '¿quién es mi mejor cliente?',
      ['get_customer_stats', 'get_customer_segments', 'analyze_report'],
    ],
    ['abre la caja con 100 mil de base', ['open_cash_session']],
  ];
  it('≥27/30 consultas reales con su herramienta esperada en el top-8 solo con léxico', () => {
    const misses: string[] = [];
    for (const [query, expected] of CASES) {
      const top8 = localToolRanking(query, docs).slice(0, 8);
      if (!expected.some((name) => top8.includes(name)))
        misses.push(`${query} → ${top8.join(',')}`);
    }
    // eslint-disable-next-line no-console
    if (misses.length) console.log(misses.join('\n'));
    expect(CASES).toHaveLength(30);
    expect(CASES.length - misses.length).toBeGreaterThanOrEqual(27);
  });
  it('el tsquery es un OR de prefijos con sinónimos de negocio y nunca interpola símbolos', () => {
    const q = intentTsQuery(`Oe me ayudas con el arqueo'); DROP --`);
    expect(q).toContain('arqueo:*');
    expect(q).toContain('caja:*');
    expect(q).toContain(' | ');
    expect(q).not.toMatch(/[;'()-]/);
    expect(q).not.toContain('oe:*');
  });
});
