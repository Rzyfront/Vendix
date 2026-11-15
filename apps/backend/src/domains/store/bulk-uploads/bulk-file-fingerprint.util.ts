import { createHash } from 'crypto';
import * as XLSX from 'xlsx';

/**
 * QUI-1004 — huella corta de un archivo de carga masiva.
 *
 * Para una hoja de cálculo se hashea el CONTENIDO normalizado (celdas como
 * texto recortado, sin filas vacías ni celdas vacías al final): el mismo Excel
 * guardado otra vez —que cambia fechas internas del ZIP— sigue reconociéndose.
 * Cualquier otro formato (ZIP de imágenes, OFX) se hashea por sus bytes.
 *
 * La huella solo se compara contra cargas de la MISMA tienda y el mismo tipo;
 * no se guarda nada del archivo además de ella.
 */
const SPREADSHEET_EXTENSION = /\.(xlsx|xlsm|xls|csv|ods)$/i;

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function normalizeSheetRows(rows: unknown[][]): string[][] {
  const normalized: string[][] = [];
  for (const row of rows) {
    const cells = (Array.isArray(row) ? row : []).map((cell) =>
      String(cell ?? '').trim(),
    );
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.length > 0) normalized.push(cells);
  }
  return normalized;
}

export function computeBulkFileFingerprint(
  buffer: Buffer,
  fileName?: string,
): string {
  if (fileName && SPREADSHEET_EXTENSION.test(fileName)) {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheets = workbook.SheetNames.map((name) =>
        normalizeSheetRows(
          XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
            header: 1,
            raw: false,
            defval: '',
            blankrows: false,
          }),
        ),
      );
      return sha256Hex(JSON.stringify(sheets));
    } catch {
      // Un archivo que no se deja leer como hoja se reconoce por sus bytes.
    }
  }
  return sha256Hex(buffer);
}

/**
 * Nombre de archivo apto para el registro: sin ruta y a lo sumo 255
 * caracteres. Multer entrega `originalname` en latin1; si al reinterpretarlo
 * como UTF-8 no aparecen caracteres inválidos, esa es la lectura correcta
 * («Compras_año.xlsx» en vez de «Compras_aÃ±o.xlsx»).
 */
export function normalizeUploadFileName(name?: string | null): string {
  let value = String(name ?? '').trim();
  if (/[\u0080-ÿ]/.test(value)) {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (!decoded.includes('�')) value = decoded;
  }
  value = value.split(/[\\/]/).pop() ?? '';
  return (value || 'archivo').slice(0, 255);
}
