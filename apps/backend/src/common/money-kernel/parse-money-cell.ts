/**
 * Parser de celdas monetarias provenientes de hojas de cálculo (XLSX/CSV).
 *
 * Un comerciante escribe el precio como lo ve en su factura: `"$ 5.000"`,
 * `"5.000,50"`, `"1.234.567"`, `"5000"`, `"0,00"`. `parseFloat` no entiende
 * esas formas: `parseFloat("$ 5.000")` es `NaN` (y el precio se descarta) y
 * `parseFloat("5.000")` es `5` (y se guarda un precio mil veces menor). Ese
 * era el origen de QUI-846: el producto terminaba persistido con precio 0.
 *
 * Regla de separadores — determinista, sin depender del locale del servidor:
 *  - Se descartan símbolos de moneda, letras, espacios y apóstrofes.
 *  - Si aparecen `.` y `,` a la vez, el ÚLTIMO del string es el decimal y el
 *    otro es de miles: `"1.234,56"` → `1234.56`; `"1,234.56"` → `1234.56`.
 *  - Con un solo tipo de separador:
 *      · repetido (`"1.234.567"`) → separador de miles;
 *      · un único grupo final de exactamente 3 dígitos (`"5.000"`) → miles;
 *      · cualquier otro caso (`"85.5"`, `"85.50"`) → decimal.
 *    La ambigüedad `"1,500"` se resuelve como miles (1500), consistente con
 *    la convención de miles de Colombia; el decimal local se escribe `"1,5"`.
 *  - Un signo `-`/`+` inicial o el paréntesis contable `"(5.000)"` se
 *    conservan/computan. La validación de negocio sigue rechazando negativos.
 *
 * Devuelve `null` cuando la celda no representa un número (vacía, `"N/A"`,
 * `"sin precio"`): el llamador debe tratarla como error de fila, NUNCA como 0.
 */
export function parseMoneyCell(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return null;

  let text = String(raw).trim();
  if (text === '') return null;

  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  text = text.replace(/[^\d.,]/g, '');
  if (text === '' || !/\d/.test(text)) return null;

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let decimalSeparator: '.' | ',' | null = null;

  if (lastDot !== -1 && lastComma !== -1) {
    decimalSeparator = lastDot > lastComma ? '.' : ',';
  } else {
    const separator: '.' | ',' | null =
      lastDot !== -1 ? '.' : lastComma !== -1 ? ',' : null;
    if (separator !== null) {
      const occurrences = text.split(separator).length - 1;
      const trailingGroup = text.slice(text.lastIndexOf(separator) + 1);
      // Repetido, o grupo final de 3 dígitos, es separador de miles.
      const isThousands = occurrences > 1 || trailingGroup.length === 3;
      decimalSeparator = isThousands ? null : separator;
    }
  }

  let normalized: string;
  if (decimalSeparator === null) {
    normalized = text.replace(/[.,]/g, '');
  } else {
    const thousandsSeparator = decimalSeparator === '.' ? ',' : '.';
    normalized = text
      .split(thousandsSeparator)
      .join('')
      .replace(decimalSeparator, '.');
    const firstDecimal = normalized.indexOf('.');
    normalized =
      normalized.slice(0, firstDecimal + 1) +
      normalized.slice(firstDecimal + 1).replace(/\./g, '');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
