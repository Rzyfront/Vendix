import { detectDegenerateRepetition } from './degenerate-output.util';

describe('detectDegenerateRepetition', () => {
  it('flags "ells" repeated to the token cap and cuts before the repetition', () => {
    const prefix = 'Claro, te explico el resultado del reembolso. ';
    const text = prefix + 'ells'.repeat(1000);
    const result = detectDegenerateRepetition(text);
    expect(result.degenerate).toBe(true);
    expect(result.cutAt).toBeLessThanOrEqual(prefix.length + 4);
    expect(result.cutAt).toBeGreaterThanOrEqual(prefix.length - 4);
  });

  it('flags irregular but trivially compressible windows', () => {
    const text = 'abab abba baab '.repeat(80);
    expect(detectDegenerateRepetition(text).degenerate).toBe(true);
  });

  it('does not flag long normal prose', () => {
    const text = Array.from(
      { length: 60 },
      (_, i) =>
        `Párrafo ${i}: el pedido número ${1000 + i * 7} se facturó por $${(i + 3) * 1234} y quedó pendiente de entrega en la bodega ${i % 5}.`,
    ).join('\n');
    expect(detectDegenerateRepetition(text).degenerate).toBe(false);
  });

  it('does not flag a moderately repeated markdown table separator', () => {
    const header = '| Producto | Cant | Precio | Total | Nota |\n';
    const sep = '| --- | --- | --- | --- | --- |\n';
    const rows = Array.from(
      { length: 8 },
      (_, i) => `| Item ${i} | ${i + 1} | $${i * 100 + 50} | $${i * 300} | ok |\n`,
    ).join('');
    const text = header + sep + rows + '\n' + header + sep + rows;
    expect(detectDegenerateRepetition(text).degenerate).toBe(false);
  });

  it('does not flag numbered lists', () => {
    const text = Array.from(
      { length: 80 },
      (_, i) => `${i + 1}. Revisar el producto ${i + 1} del inventario`,
    ).join('\n');
    expect(detectDegenerateRepetition(text).degenerate).toBe(false);
  });

  it('does not flag a short horizontal rule or empty text', () => {
    expect(detectDegenerateRepetition('')).toEqual({ degenerate: false });
    expect(
      detectDegenerateRepetition('Resumen\n' + '-'.repeat(80) + '\nFin'),
    ).toEqual({ degenerate: false });
  });
});
