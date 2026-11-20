import * as XLSX from 'xlsx';
import {
  MAX_COLUMNS,
  SheetParserService,
  sheetRowCap,
} from './sheet-parser.service';
import { detectIngestFile } from '../ingest-file.detector';
import { VendixHttpException } from '@common/errors';

/**
 * A tiny xlsx whose second cell sits at `far` and whose declared range is
 * `A1:far`. `XLSX.write` walks the declared range, so the sheet XML is
 * patched inside the zip (same file as the release review probe).
 */
function farCellWorkbook(far: string): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([['Nombre'], [null, 'x']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S');
  const small = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const CFB = (XLSX as unknown as { CFB: any }).CFB;
  const zip = CFB.read(small, { type: 'buffer' });
  const index = zip.FullPaths.findIndex((p: string) =>
    /xl\/worksheets\/sheet1\.xml$/.test(p),
  );
  const farRow = XLSX.utils.decode_cell(far).r + 1;
  const xml = Buffer.from(zip.FileIndex[index].content)
    .toString()
    .replace('r="B2"', `r="${far}"`)
    .replace('<row r="2"', `<row r="${farRow}"`)
    .replace('A1:B2', `A1:${far}`);
  zip.FileIndex[index].content = Buffer.from(xml);
  return Buffer.from(
    CFB.write(zip, { fileType: 'zip', type: 'buffer', compression: true }),
  );
}

function timed<T>(run: () => T): { value: T; ms: number } {
  const start = process.hrtime.bigint();
  const value = run();
  return { value, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

function workbook(rows: unknown[][], tweak?: (ws: XLSX.WorkSheet) => void): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  tweak?.(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('SheetParserService', () => {
  const parser = new SheetParserService();

  it('xlsx con título arriba: el encabezado es la fila 3 y los códigos quedan como texto', () => {
    const buffer = workbook(
      [
        ['Listado de clientes 2026'],
        [],
        ['Nombre', 'NIT', 'Teléfono', 'Código'],
        ['Acme SAS', 900123456, 573001234567, 123],
        [],
        ['Ana Pérez', 1020304050, 3001234567, 45],
        ['TOTAL', null, null, null],
      ],
      (ws) => {
        // Formato de celda con ceros a la izquierda ("00123").
        ws['D4'].z = '00000';
        ws['D6'].z = '00000';
      },
    );

    const result = parser.parse(buffer, 'xlsx', { maxRows: 100 });

    expect(result.tables).toHaveLength(1);
    const [table] = result.tables;
    expect(table.header_row).toBe(3);
    expect(table.headers).toEqual(['Nombre', 'NIT', 'Teléfono', 'Código']);
    expect(table.row_numbers).toEqual([4, 6]);
    expect(table.rows[0]).toEqual({
      Nombre: 'Acme SAS',
      NIT: '900123456',
      Teléfono: '573001234567',
      Código: '00123',
    });
    expect(table.rows[1].NIT).toBe('1020304050');
    expect(result.total_rows).toBe(2);
    expect(result.skipped).toEqual([
      { row: 5, reason: 'empty', message: 'Fila vacía.' },
      { row: 7, reason: 'total', message: 'Fila de totales.' },
    ]);
  });

  it('celdas combinadas repiten su valor y el encabezado repetido se omite', () => {
    const buffer = workbook(
      [
        ['Cliente', 'Documento', 'Ciudad'],
        ['Acme SAS', '900123456', 'Cali'],
        ['Acme SAS', '900123456', null],
        ['Cliente', 'Documento', 'Ciudad'],
        ['Beta LTDA', '800111222', 'Pasto'],
      ],
      (ws) => {
        ws['!merges'] = [{ s: { r: 1, c: 2 }, e: { r: 2, c: 2 } }];
      },
    );

    const result = parser.parse(buffer, 'xlsx', { maxRows: 100 });

    expect(result.tables[0].rows.map((r) => r.Ciudad)).toEqual(['Cali', 'Cali', 'Pasto']);
    expect(result.skipped).toEqual([
      { row: 4, reason: 'header', message: 'Encabezado repetido.' },
    ]);
  });

  it('CSV con ";" en latin1: tildes legibles y ceros a la izquierda intactos', () => {
    const buffer = Buffer.from(
      'Nombre;Cédula;Teléfono\r\nJosé Peña;0012345;300 123 4567\r\nMaría Núñez;="00789";3109998877\r\n',
      'latin1',
    );
    expect(detectIngestFile({ buffer, originalName: 'clientes.csv' })).toMatchObject({
      kind: 'sheet',
      sheetFormat: 'csv',
    });

    const result = parser.parse(buffer, 'csv', { maxRows: 100 });

    expect(result.tables[0].headers).toEqual(['Nombre', 'Cédula', 'Teléfono']);
    expect(result.tables[0].rows).toEqual([
      { Nombre: 'José Peña', Cédula: '0012345', Teléfono: '300 123 4567' },
      { Nombre: 'María Núñez', Cédula: '00789', Teléfono: '3109998877' },
    ]);
  });

  it('CSV UTF-8 con tabulador', () => {
    const buffer = Buffer.from('nombre\tciudad\nAñaña\tBogotá\n', 'utf8');
    const result = parser.parse(buffer, 'csv', { maxRows: 100 });
    expect(result.tables[0].rows).toEqual([{ nombre: 'Añaña', ciudad: 'Bogotá' }]);
  });

  it('las filas que pasan el tope se informan como un rango, no se cortan en silencio', () => {
    const rows: unknown[][] = [['Nombre', 'Documento']];
    for (let i = 1; i <= 10; i++) rows.push([`Cliente ${i}`, `${1000 + i}`]);
    const result = parser.parse(workbook(rows), 'xlsx', { maxRows: 4 });

    expect(result.tables[0].rows).toHaveLength(4);
    expect(result.total_rows).toBe(10);
    expect(result.skipped).toEqual([
      expect.objectContaining({ row: 6, row_end: 11, reason: 'limit' }),
    ]);
  });

  it('hoja sin encabezado: columnas por posición y la primera fila es dato (no se pierde)', () => {
    const buffer = workbook([
      ['Ana Pérez', 1020304050, 3001234567, 'ana@correo.co'],
      ['Luis Gómez', 79123456, 3109876543, 'luis@correo.co'],
    ]);
    const result = parser.parse(buffer, 'xlsx', { maxRows: 100 });
    const table = result.tables[0];
    expect(table.header_row).toBe(0);
    expect(table.headers).toEqual(['Columna A', 'Columna B', 'Columna C', 'Columna D']);
    expect(table.row_numbers).toEqual([1, 2]);
    expect(table.rows[0]['Columna A']).toBe('Ana Pérez');
    expect(result.skipped).toEqual([]);
    expect(result.warnings.join(' ')).toContain('no tiene fila de encabezados');
  });

  it('hoja sin encabezado con filas mayormente de texto (nombre, cédula, celular, dirección, ciudad): nada se pierde', () => {
    const csv = Buffer.from(
      [
        'Juan Pérez;1020304050;3001234567;Calle 10 # 5-20;Bogotá',
        'Ana Gómez;79123456;3109876543;Cra 7 # 1-2;Cali',
        'Luis Ruiz;80111222;3201112233;Av 3 # 4-5;Medellín',
      ].join('\n'),
      'utf8',
    );
    const result = parser.parse(csv, 'csv', { maxRows: 100 });
    const table = result.tables[0];
    expect(table.header_row).toBe(0);
    expect(table.row_numbers).toEqual([1, 2, 3]);
    expect(table.rows[0]['Columna A']).toBe('Juan Pérez');
    expect(result.warnings.join(' ')).toContain('no tiene fila de encabezados');
  });

  it('encabezados con fecha o periodo siguen siendo encabezados', () => {
    const result = parser.parse(
      workbook([
        ['Nombre', 'NIT', 'Saldo', '2024-2025', '31/01/2024'],
        ['Acme SAS', '900123456', '100', '5', '6'],
      ]),
      'xlsx',
      { maxRows: 100 },
    );
    expect(result.tables[0].header_row).toBe(1);
    expect(result.tables[0].row_numbers).toEqual([2]);
  });

  it('si el encabezado real se descarta, las filas anchas de arriba quedan en omitidas (nunca en silencio)', () => {
    const result = parser.parse(
      workbook([
        ['Nombre', 'Ciudad', 'Correo', '13050505'],
        ['Acme', 'Cali', 'a@a.co', '5'],
        ['Beta', 'Bogotá', '', '7'],
        ['Gama', 'Neiva', '', '8'],
      ]),
      'xlsx',
      { maxRows: 100 },
    );
    const table = result.tables[0];
    const accounted = [
      ...(table.header_row ? [table.header_row] : []),
      ...table.row_numbers,
      ...result.skipped.map((s) => s.row),
    ].sort();
    expect(accounted).toEqual([1, 2, 3, 4]);
  });

  it('un cliente cuyo nombre empieza por "Total" no es fila de totales', () => {
    const buffer = workbook([
      ['Nombre', 'NIT', 'Ciudad'],
      ['Totalgas SAS', '900555444', 'Neiva'],
      ['Total Logística SAS', '900555445', 'Neiva'],
    ]);
    const result = parser.parse(buffer, 'xlsx', { maxRows: 100 });
    expect(result.tables[0].rows).toHaveLength(2);
    expect(result.skipped).toEqual([]);
  });

  describe('topes del rectángulo (P0 release #1291)', () => {
    const MAX_ROWS = 5000;
    const CAP = sheetRowCap(MAX_ROWS);

    it('xlsx de pocos KB con A1 + XFD1048576: < 1 s y el resto queda como un rango `limit`', () => {
      const buffer = farCellWorkbook('XFD1048576');
      expect(buffer.length).toBeLessThan(20 * 1024);
      expect(detectIngestFile({ buffer, originalName: 'x.png', mimeType: 'image/png' }))
        .toMatchObject({ kind: 'sheet', sheetFormat: 'xlsx' });

      const { value: result, ms } = timed(() =>
        parser.parse(buffer, 'xlsx', { maxRows: MAX_ROWS }),
      );

      expect(ms).toBeLessThan(1000);
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].rows).toEqual([{ 'Columna A': 'Nombre' }]);
      expect(result.skipped).toEqual([
        expect.objectContaining({ row: CAP + 1, row_end: 1048576, reason: 'limit' }),
      ]);
    });

    it('xlsx con una celda en la columna XFD dentro de las filas: se ignora con aviso', () => {
      const buffer = farCellWorkbook('XFD2');
      const { value: result, ms } = timed(() =>
        parser.parse(buffer, 'xlsx', { maxRows: MAX_ROWS }),
      );

      expect(ms).toBeLessThan(1000);
      expect(result.tables[0].headers).toEqual(['Columna A']);
      expect(result.skipped).toEqual([]);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining(`máximo ${MAX_COLUMNS} columnas`)]),
      );
    });

    it('miles de celdas combinadas que cubren toda la hoja se recortan al rectángulo', () => {
      const buffer = workbook([['Nombre', 'Documento'], ['Ana', '1020304050']], (ws) => {
        ws['!merges'] = Array.from({ length: 2000 }, () => ({
          s: { r: 1, c: 0 },
          e: { r: 1048575, c: 16383 },
        }));
      });

      const { value: result, ms } = timed(() =>
        parser.parse(buffer, 'xlsx', { maxRows: MAX_ROWS }),
      );

      expect(ms).toBeLessThan(2000);
      for (const table of result.tables) {
        expect(table.headers.length).toBeLessThanOrEqual(MAX_COLUMNS);
        expect(table.rows.length).toBeLessThanOrEqual(MAX_ROWS);
      }
      const lastRow = Math.max(...result.skipped.map((s) => s.row_end ?? s.row));
      expect(lastRow).toBeLessThanOrEqual(CAP);
    });

    it('CSV con una primera línea de miles de separadores: el ancho se mide en lo recortado', () => {
      const lines = [`Nombre,Documento${','.repeat(60_000)}`];
      for (let i = 1; i <= 3000; i++) lines.push(`Cliente ${i},${1_000_000 + i}`);
      const buffer = Buffer.from(lines.join('\n'), 'utf8');

      const { value: result, ms } = timed(() =>
        parser.parse(buffer, 'csv', { maxRows: MAX_ROWS }),
      );

      expect(ms).toBeLessThan(1000);
      expect(result.tables[0].headers).toEqual(['Nombre', 'Documento']);
      expect(result.tables[0].rows).toHaveLength(3000);
      expect(result.tables[0].rows[2999]).toEqual({
        Nombre: 'Cliente 3000',
        Documento: '1003000',
      });
    });

    it('CSV con una línea de más de 64 KB: se rechaza con un error claro, sin rellenar', () => {
      const buffer = Buffer.from(`Nombre${','.repeat(2_000_000)}\nAna\n`, 'utf8');
      const { ms, value: error } = timed(() => {
        try {
          parser.parse(buffer, 'csv', { maxRows: MAX_ROWS });
          return null;
        } catch (e) {
          return e as VendixHttpException;
        }
      });

      expect(ms).toBeLessThan(1000);
      expect(error).toBeInstanceOf(VendixHttpException);
      expect(JSON.stringify(error!.getResponse())).toContain('AI_INGEST_INVALID_FILE');
    });

    it('CSV con más filas que el tope de lectura: un solo rango `limit` hasta la última fila', () => {
      const lines = ['Nombre,Documento'];
      for (let i = 1; i <= 300; i++) lines.push(`Cliente ${i},${1000 + i}`);
      const result = parser.parse(Buffer.from(lines.join('\n')), 'csv', { maxRows: 10 });

      expect(result.tables[0].rows).toHaveLength(10);
      expect(result.skipped).toEqual([
        expect.objectContaining({ row: 12, row_end: 301, reason: 'limit' }),
      ]);
    });

    it('exactamente 200 columnas se leen completas; la 201 se ignora con aviso', () => {
      const header = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `Campo ${i + 1}`);
      const data = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `v${i + 1}`);
      const result = parser.parse(workbook([header, data]), 'xlsx', { maxRows: MAX_ROWS });

      expect(result.tables[0].headers).toEqual(header.slice(0, MAX_COLUMNS));
      expect(result.tables[0].rows[0][`Campo ${MAX_COLUMNS}`]).toBe(`v${MAX_COLUMNS}`);
      expect(result.warnings).toHaveLength(1);

      const exact = parser.parse(
        workbook([header.slice(0, MAX_COLUMNS), data.slice(0, MAX_COLUMNS)]),
        'xlsx',
        { maxRows: MAX_ROWS },
      );
      expect(exact.tables[0].headers).toHaveLength(MAX_COLUMNS);
      expect(exact.warnings).toEqual([]);
    });

    it('regresión: una hoja normal da exactamente el mismo resultado que antes', () => {
      const buffer = workbook(
        [
          ['Clientes'],
          ['Nombre', 'Documento', 'Ciudad'],
          ['Acme SAS', '900123456', 'Cali'],
          [],
          ['Beta LTDA', '800111222', 'Pasto'],
          ['Total', '2', null],
        ],
        (ws) => {
          ws['!merges'] = [{ s: { r: 2, c: 2 }, e: { r: 2, c: 2 } }];
        },
      );

      expect(parser.parse(buffer, 'xlsx', { maxRows: MAX_ROWS })).toEqual({
        tables: [
          {
            sheet: 'Clientes',
            header_row: 2,
            headers: ['Nombre', 'Documento', 'Ciudad'],
            rows: [
              { Nombre: 'Acme SAS', Documento: '900123456', Ciudad: 'Cali' },
              { Nombre: 'Beta LTDA', Documento: '800111222', Ciudad: 'Pasto' },
            ],
            row_numbers: [3, 5],
          },
        ],
        total_rows: 2,
        skipped: [
          { row: 4, reason: 'empty', message: 'Fila vacía.' },
          { row: 6, reason: 'total', message: 'Fila de totales.' },
        ],
        warnings: [],
      });
    });
  });

  it('el detector reconoce xlsx por firma aunque el mimetype diga imagen', () => {
    const buffer = workbook([['a', 'b'], ['1', '2']]);
    expect(
      detectIngestFile({ buffer, originalName: 'x.xlsx', mimeType: 'image/jpeg' }),
    ).toMatchObject({ kind: 'sheet', sheetFormat: 'xlsx' });
    expect(
      detectIngestFile({ buffer: Buffer.from('%PDF-1.7 x'), originalName: 'x.xlsx' }),
    ).toMatchObject({ kind: 'pdf' });
    expect(detectIngestFile({ buffer: Buffer.from([0, 1, 2]), originalName: 'x.bin' })).toBeNull();
  });
});
