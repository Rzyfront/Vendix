import * as XLSX from 'xlsx';
import { SheetParserService } from './sheet-parser.service';
import { detectIngestFile } from '../ingest-file.detector';

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
