import * as XLSX from 'xlsx';
import {
  computeBulkFileFingerprint,
  normalizeUploadFileName,
  sha256Hex,
} from './bulk-file-fingerprint.util';

function workbookBuffer(rows: unknown[][], sheetName = 'Datos'): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('computeBulkFileFingerprint', () => {
  const rows = [
    ['SKU', 'Cantidad'],
    ['A-1', 5],
    ['B-2', 3],
  ];

  it('el mismo contenido da la misma huella aunque cambien espacios y filas vacías', () => {
    const original = workbookBuffer(rows);
    const resaved = workbookBuffer([
      ['SKU ', ' Cantidad', ''],
      [],
      ['A-1', '5'],
      ['B-2', 3, ''],
    ]);
    expect(computeBulkFileFingerprint(original, 'compras.xlsx')).toBe(
      computeBulkFileFingerprint(resaved, 'compras (1).xlsx'),
    );
  });

  it('otro contenido da otra huella', () => {
    const changed = workbookBuffer([...rows.slice(0, 2), ['B-2', 4]]);
    expect(computeBulkFileFingerprint(workbookBuffer(rows), 'a.xlsx')).not.toBe(
      computeBulkFileFingerprint(changed, 'a.xlsx'),
    );
  });

  it('un archivo que no es hoja de cálculo se reconoce por sus bytes', () => {
    const zip = Buffer.from('PK\u0003\u0004 imagenes');
    expect(computeBulkFileFingerprint(zip, 'imagenes.zip')).toBe(sha256Hex(zip));
    expect(computeBulkFileFingerprint(zip, 'imagenes.zip')).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});

describe('normalizeUploadFileName', () => {
  it('quita la ruta, recorta y corrige el nombre que multer entrega en latin1', () => {
    const latin1 = Buffer.from('Compras_año.xlsx', 'utf8').toString('latin1');
    expect(normalizeUploadFileName(latin1)).toBe('Compras_año.xlsx');
    expect(normalizeUploadFileName('C:\\fakepath\\datos.xlsx')).toBe('datos.xlsx');
    expect(normalizeUploadFileName('x'.repeat(300) + '.xlsx')).toHaveLength(255);
    expect(normalizeUploadFileName('')).toBe('archivo');
  });
});
