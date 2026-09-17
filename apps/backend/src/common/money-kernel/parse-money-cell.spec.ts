import { parseMoneyCell } from './parse-money-cell';

/**
 * QUI-846: la plantilla de carga masiva guarda el precio como texto (una
 * celda formateada como moneda o escrita a mano). `parseFloat` la descartaba
 * (`parseFloat('$ 5.000')` = NaN) o la leía mil veces menor
 * (`parseFloat('5.000')` = 5), y el producto terminaba con precio 0. Estos
 * casos fijan la interpretación esperada.
 */
describe('parseMoneyCell — celdas monetarias de hojas de cálculo', () => {
  const ENTRADAS_VALIDAS: Array<[unknown, number]> = [
    // Números puros (celdas numéricas de Excel).
    [5000, 5000],
    [0, 0],
    [85000.5, 85000.5],
    ['5000', 5000],
    ['0', 0],
    // Símbolo de moneda y espacios.
    ['$ 5.000', 5000],
    ['$5000', 5000],
    ['COP 5.000', 5000],
    ['5.000,00', 5000],
    ['$ 1.234.567,89', 1234567.89],
    // Separador de miles simple: el grupo final de 3 dígitos es miles.
    ['5.000', 5000],
    ['1.234.567', 1234567],
    ['12,345', 12345],
    // Decimales reales.
    ['5,5', 5.5],
    ['5.5', 5.5],
    ['85,50', 85.5],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    // Signos.
    ['-5.000', -5000],
    ['+5.000', 5000],
    ['(5.000)', -5000],
  ];

  it.each(ENTRADAS_VALIDAS)(
    'interpreta %p como %p',
    (entrada, esperado) => {
      expect(parseMoneyCell(entrada)).toBeCloseTo(esperado, 6);
    },
  );

  const ENTRADAS_INVALIDAS: unknown[] = [
    null,
    undefined,
    '',
    '   ',
    'N/A',
    'sin precio',
    'cinco mil',
    '$',
    '-',
    true,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ];

  it.each(ENTRADAS_INVALIDAS)(
    'devuelve null para la celda no numérica %p',
    (entrada) => {
      expect(parseMoneyCell(entrada)).toBeNull();
    },
  );

  it('distingue 5.000 (miles) de 5.5 (decimal)', () => {
    // El caso que `parseFloat` rompía: leía 5.000 como 5.
    expect(parseMoneyCell('5.000')).toBe(5000);
    expect(parseFloat('5.000')).toBe(5);
    expect(parseMoneyCell('5.5')).toBe(5.5);
  });

  it('no es un cero silencioso: un texto no numérico devuelve null, no 0', () => {
    expect(parseMoneyCell('N/A')).not.toBe(0);
    expect(parseMoneyCell('N/A')).toBeNull();
  });
});
