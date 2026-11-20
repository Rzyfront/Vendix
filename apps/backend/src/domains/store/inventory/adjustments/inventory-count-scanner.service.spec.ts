import * as XLSX from 'xlsx';
import { InventoryCountScannerService } from './inventory-count-scanner.service';
import {
  INVENTORY_COUNT_IMAGE_INSTRUCTION,
  mergeInventoryCountBatches,
  parseCountQuantity,
} from './inventory-count-ingest.profile';
import { VendixHttpException } from '@common/errors';
import { SheetParserService } from '@common/ai-ingest/sheets/sheet-parser.service';
import { AiExtractionService } from '@common/ai-ingest/extraction/ai-extraction.service';

const LOCATION_ID = 5;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PDF = Buffer.from('%PDF-1.7 conteo');
const IMG = 'data:image/jpeg;base64,/9j/AAAA';

const AI_FIXTURE = JSON.stringify({
  counted_items: [
    {
      description: 'Coca Cola 350',
      quantity: 12,
      sku_if_visible: 'COC-350',
      barcode_if_visible: null,
      confidence: 90,
    },
  ],
  confidence: 88,
});

type FakePage = {
  page_number: number;
  mode: 'text' | 'image' | 'text+image';
  text: string;
  image?: string;
  strip?: { index: number; count: number };
};

function xlsx(rows: unknown[][], sheet = 'Conteo'): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const file = (buffer: Buffer, mimeType: string, originalName: string) => ({
  buffer,
  mimeType,
  originalName,
  size: buffer.length,
});

function build(options: {
  answers?: Array<string | Record<string, unknown>>;
  answerFor?: (text: string) => string | Record<string, unknown>;
  pages?: FakePage[];
  source?: 'pdf' | 'image';
} = {}) {
  const queue = [...(options.answers ?? [AI_FIXTURE])];
  const toResponse = (a: string | Record<string, unknown>) =>
    typeof a === 'string' ? { success: true, content: a, finish_reason: 'stop' } : a;
  const ai = {
    run: jest.fn(async (_app: string, _vars: unknown, messages: any[]) => {
      if (options.answerFor) {
        return toResponse(options.answerFor(JSON.stringify(messages[0]?.content ?? '')));
      }
      return toResponse(queue.shift() ?? '{}');
    }),
  };
  const pageList: FakePage[] = options.pages ?? [{ page_number: 1, mode: 'image', text: '', image: IMG }];
  const pages = {
    prepareForAi: jest.fn().mockResolvedValue({
      source: options.source ?? 'image',
      pages: pageList,
      page_count: pageList.length,
      unreadable_pages: [],
    }),
  };
  const prisma = {
    products: {
      findFirst: jest.fn().mockResolvedValue({ id: 9, name: 'Coca Cola 350ml', sku: 'COC-350' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    stock_levels: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const registry = { register: jest.fn() };
  const service = new InventoryCountScannerService(
    prisma as any,
    registry as any,
    new SheetParserService(),
    new AiExtractionService(ai as any),
    pages as any,
  );
  return { service, ai, pages, prisma, registry };
}

describe('InventoryCountScannerService', () => {
  describe('fotos y PDF (lector común)', () => {
    it('una foto viaja como imagen preparada con el pedido de siempre y se cruza con el catálogo', async () => {
      const { service, ai, pages, prisma } = build();

      const out = await service.scanCountFromFiles([file(JPEG, 'image/jpeg', 'conteo.jpg')], LOCATION_ID);

      expect((pages.prepareForAi as jest.Mock).mock.calls[0][0]).toEqual(
        expect.objectContaining({ mimetype: 'image/jpeg' }),
      );
      const content = ai.run.mock.calls[0][2][0].content as any[];
      expect(ai.run.mock.calls[0][0]).toBe('inventory_count_ocr');
      expect(content[0]).toEqual({ type: 'text', text: INVENTORY_COUNT_IMAGE_INSTRUCTION });
      expect(content.some((p) => p.type === 'image_url' && p.image_url.url === IMG)).toBe(true);
      expect(out.matched_products[0].selected_product_id).toBe(9);
      expect(out.stats).toEqual(expect.objectContaining({ source: 'document', pages: 1 }));
      expect(prisma.stock_levels.findMany).toHaveBeenCalled();
    });

    it('scanCount (síncrono) da lo mismo que scanCountFromFiles', async () => {
      const a = build();
      const viaFiles = await a.service.scanCountFromFiles([file(JPEG, 'image/jpeg', 'c.jpg')], LOCATION_ID);
      const b = build();
      const sync = await b.service.scanCount(
        { buffer: JPEG, mimetype: 'image/jpeg', originalname: 'c.jpg', size: JPEG.length } as any,
        LOCATION_ID,
      );
      expect(sync).toEqual(viaFiles);
    });

    it('lista larga en PDF de 6 páginas: 3 lotes de 2 páginas y ninguna línea se trunca', async () => {
      const pages: FakePage[] = Array.from({ length: 6 }, (_, i) => ({
        page_number: i + 1,
        mode: 'text',
        text: `CONTEO pagina ${i + 1} ` + 'x'.repeat(220),
      }));
      const { service, ai } = build({
        source: 'pdf',
        pages,
        answerFor: (text) => {
          const page = Number(/CONTEO pagina (\d)/.exec(text)![1]);
          return JSON.stringify({
            counted_items: Array.from({ length: 60 }, (_, i) => ({
              description: `Producto p${page}-${i}`,
              quantity: i + 1,
              confidence: 90,
            })),
            confidence: 90,
          });
        },
      });

      const out = await service.scanCountFromFiles([file(PDF, 'application/pdf', 'c.pdf')], LOCATION_ID);

      expect(ai.run).toHaveBeenCalledTimes(3);
      expect(out.scan.counted_items).toHaveLength(180);
      expect(out.matched_products).toHaveLength(180);
      expect(out.stats).toEqual(expect.objectContaining({ pages: 6, text_pages: 6, imported_rows: 180 }));
    });

    it('un lote cortado por longitud se parte en dos y se leen todas las páginas', async () => {
      const pages: FakePage[] = [1, 2].map((n) => ({ page_number: n, mode: 'text', text: `CONTEO pagina ${n} ` + 'x'.repeat(220) }));
      const { service, ai } = build({
        source: 'pdf',
        pages,
        answerFor: (text) =>
          text.includes('pagina 1') && text.includes('pagina 2')
            ? { success: true, content: '{"counted_items":[', finish_reason: 'length' }
            : JSON.stringify({ counted_items: [{ description: text.includes('pagina 1') ? 'A' : 'B', quantity: 1 }] }),
      });

      const out = await service.scanCountFromFiles([file(PDF, 'application/pdf', 'c.pdf')], LOCATION_ID);

      expect(ai.run).toHaveBeenCalledTimes(3);
      expect(out.scan.counted_items.map((i) => i.description)).toEqual(['A', 'B']);
    });

    it('franjas de una foto larga: la línea repetida en el solape se cuenta una vez y se avisa', () => {
      const merged = mergeInventoryCountBatches(
        [
          { pages: [1, 2], data: { counted_items: [{ description: 'Arroz', quantity: 3 }, { description: 'Sal', quantity: 2 }] } },
          { pages: [3], data: { counted_items: [{ description: 'Sal', quantity: 2 }, { description: 'Azúcar', quantity: 5 }] } },
        ],
        { strips: true },
      );
      expect(merged.data.counted_items.map((i: any) => i.description)).toEqual(['Arroz', 'Sal', 'Azúcar']);
      expect(merged.warnings[0]).toContain('"Sal"');

      const pdf = mergeInventoryCountBatches(
        [
          { pages: [1], data: { counted_items: [{ description: 'Sal', quantity: 2 }] } },
          { pages: [2], data: { counted_items: [{ description: 'Sal', quantity: 2 }] } },
        ],
        { strips: false },
      );
      expect(pdf.data.counted_items).toHaveLength(2);
      expect(pdf.warnings).toEqual([]);
    });

    it('errores: fallo de IA sigue siendo INV_SCAN_AI_FAIL; documento no soportado es AI_INGEST_INVALID_FILE', async () => {
      const down = build({ answers: [{ success: false, error: 'down' }] });
      await expect(
        down.service.scanCountFromFiles([file(JPEG, 'image/jpeg', 'c.jpg')], LOCATION_ID),
      ).rejects.toMatchObject({ errorCode: 'INV_SCAN_AI_FAIL' });

      const { service, ai } = build();
      await expect(service.scanCountFromFiles([], LOCATION_ID)).rejects.toMatchObject({ errorCode: 'INV_SCAN_NO_FILE' });
      await expect(
        service.scanCountFromFiles([file(Buffer.from('hola'), 'image/jpeg', 'x.jpg')], LOCATION_ID),
      ).rejects.toMatchObject({ errorCode: 'AI_INGEST_INVALID_FILE' });
      await expect(
        service.scanCountFromFiles([file(Buffer.alloc(11 * 1024 * 1024, 1), 'image/jpeg', 'x.jpg')], LOCATION_ID),
      ).rejects.toBeInstanceOf(VendixHttpException);
      expect(ai.run).not.toHaveBeenCalled();
    });
  });

  describe('hojas de cálculo (xlsx/csv)', () => {
    it('Excel de 300 filas con columnas propias: UNA llamada de mapeo y las 300 filas sin truncar', async () => {
      const rows: unknown[][] = [
        ['Inventario bodega norte'],
        [],
        ['Artículo vendido', 'Unid. físicas halladas', 'Ref. interna', 'Observación'],
        ...Array.from({ length: 300 }, (_, i) => [`Producto ${i + 1}`, i % 7, `REF-${i + 1}`, i % 2 ? 'ok' : '']),
      ];
      const { service, ai } = build({
        answers: [
          JSON.stringify({
            columns: [
              { column: 'Artículo vendido', field: 'description' },
              { column: 'Unid. físicas halladas', field: 'quantity' },
              { column: 'Ref. interna', field: 'sku' },
              { column: 'Observación', field: 'ignore' },
            ],
            warnings: [],
          }),
        ],
      });

      const out = await service.scanCountFromFiles(
        [file(xlsx(rows), 'application/octet-stream', 'conteo.xlsx')],
        LOCATION_ID,
      );

      expect(ai.run).toHaveBeenCalledTimes(1);
      const mappingPrompt = String(ai.run.mock.calls[0][2][0].content);
      expect(mappingPrompt).toContain('Map each column');
      expect(mappingPrompt).not.toContain('Producto 299');
      expect(out.scan.counted_items).toHaveLength(300);
      expect(out.matched_products).toHaveLength(300);
      expect(out.scan.counted_items[0]).toEqual(
        expect.objectContaining({ description: 'Producto 1', quantity: 0, sku_if_visible: 'REF-1', source_row: 4 }),
      );
      expect(out.scan.counted_items[299]).toEqual(
        expect.objectContaining({ description: 'Producto 300', quantity: 299 % 7, source_row: 303 }),
      );
      expect(out.matched_products[0].source_row).toBe(4);
      expect(out.stats).toEqual(
        expect.objectContaining({ source: 'sheet', total_rows: 300, imported_rows: 300, skipped_rows: 0, mapping: 'ai' }),
      );
      expect(out.warnings).toContain('Columnas ignoradas: Observación.');
      expect(out.columns).toEqual(
        expect.arrayContaining([{ column: 'Unid. físicas halladas', field: 'quantity' }]),
      );
    });

    it('encabezados conocidos se mapean sin IA', async () => {
      const { service, ai } = build();
      const out = await service.scanCountFromFiles(
        [file(xlsx([['Producto', 'Cantidad', 'Código de barras'], ['Arroz 500g', 4, '7701234567890']]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'c.xlsx')],
        LOCATION_ID,
      );
      expect(ai.run).not.toHaveBeenCalled();
      expect(out.scan.counted_items).toEqual([
        expect.objectContaining({ description: 'Arroz 500g', quantity: 4, barcode_if_visible: '7701234567890', confidence: 100 }),
      ]);
      expect(out.stats?.mapping).toBe('synonyms');
    });

    it('CSV: ninguna fila se pierde en silencio (sin cantidad, negativa, sin producto) y avisa ambigüedades y repetidos', async () => {
      const csv = [
        'Producto;Cantidad;SKU',
        'Arroz;4;A1',
        'Frijol;;F1',
        'Lenteja;-2;L1',
        ';5;',
        'Azúcar;1.500;AZ',
        'Arroz;2;A1',
        'Sal;abc;S1',
      ].join('\n');
      const { service, ai, prisma } = build();
      // Nothing in the catalog: every line gets a "no coincide" notice.
      prisma.products.findFirst.mockResolvedValue(null);

      const out = await service.scanCountFromFiles(
        [file(Buffer.from(csv, 'utf8'), 'text/csv', 'conteo.csv')],
        LOCATION_ID,
      );

      expect(ai.run).not.toHaveBeenCalled();
      expect(out.scan.counted_items.map((i) => [i.description, i.quantity, i.source_row])).toEqual([
        ['Arroz', 4, 2],
        ['Azúcar', 1500, 6],
        ['Arroz', 2, 7],
      ]);
      expect(out.skipped?.map((s) => [s.row, s.message])).toEqual([
        [3, 'Fila sin cantidad contada.'],
        [4, 'La cantidad contada no puede ser negativa (-2).'],
        [5, 'Fila sin producto: no tiene nombre, SKU ni código de barras.'],
        [8, 'La cantidad "abc" no es un número.'],
      ]);
      expect(out.stats).toEqual(expect.objectContaining({ skipped_rows: 4, imported_rows: 3 }));
      expect(out.warnings).toContain('4 fila(s) de la hoja no se cargaron; mira "Filas omitidas" para ver cuáles y por qué.');
      expect(out.row_issues?.map((r) => r.row)).toEqual([6, 7]);
      expect(out.row_issues?.[1].message).toContain('fila 2');
      // The matching warnings speak of the Excel row, not the line index.
      expect(out.warnings).toContain("Fila 6: 'Azúcar' no coincide con catálogo, revisar");
    });

    it('una hoja sin columna de cantidad reconocible se reporta como filas omitidas', async () => {
      const { service } = build({ answers: [JSON.stringify({ columns: [{ column: 'Nombre', field: 'description' }] })] });
      const out = await service.scanCountFromFiles(
        [file(xlsx([['Nombre', 'Precio'], ['Arroz', 2500], ['Sal', 900]]), 'application/octet-stream', 'c.xlsx')],
        LOCATION_ID,
      );
      expect(out.scan.counted_items).toEqual([]);
      expect(out.skipped).toEqual([
        expect.objectContaining({ row: 2, row_end: 3, reason: 'unreadable' }),
      ]);
      expect(out.warnings[0]).toContain('cantidad contada');
    });
  });

  it('parseCountQuantity: decimales, miles y ambigüedad', () => {
    expect(parseCountQuantity('12')).toEqual({ value: 12, ambiguous: false });
    expect(parseCountQuantity('2,5')).toEqual({ value: 2.5, ambiguous: false });
    expect(parseCountQuantity('2.5 und')).toEqual({ value: 2.5, ambiguous: false });
    expect(parseCountQuantity('1.500')).toEqual({ value: 1500, ambiguous: true });
    expect(parseCountQuantity('1.500.000')).toEqual({ value: 1500000, ambiguous: false });
    expect(parseCountQuantity('1.234,5')).toEqual({ value: 1234.5, ambiguous: false });
    expect(parseCountQuantity('')).toEqual({ value: null, ambiguous: false });
    expect(parseCountQuantity('n/a')).toEqual({ value: null, ambiguous: false });
  });

  it('onModuleInit registra inventory_count y delega con location_id numérico', async () => {
    const { service, registry } = build();
    service.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith('inventory_count', expect.any(Function));
    const handler = registry.register.mock.calls[0][1];
    const spy = jest.spyOn(service, 'scanCountFromFiles');
    const files = [file(JPEG, 'image/jpeg', 'c.jpg')];
    await handler({ files, params: { location_id: '5' }, context: {} });
    expect(spy).toHaveBeenCalledWith(files, 5, undefined);
  });
});
