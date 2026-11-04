import { formatQuantityInSaleUnit } from './sale-unit-display.util';

describe('formatQuantityInSaleUnit — regla 1 (presentación) frente a líneas de peso', () => {
  it('presentación: quantity ya cuenta paquetes y lleva el nombre de la presentación', () => {
    expect(
      formatQuantityInSaleUnit(2, {
        stockUnitsConsumed: 100,
        presentationName: 'Bulto x 50',
        stockUomCode: 'unit',
      }),
    ).toEqual({ value: 2, suffix: 'Bulto x 50', label: '2 Bulto x 50' });
  });

  it('pesada de 0,180 kg con stock en g: el snapshot (180) no la vuelve presentación', () => {
    const display = formatQuantityInSaleUnit(1, {
      stockUnitsConsumed: 180,
      weight: '0.180',
      presentationName: null,
      stockUomCode: 'g',
    });
    // Mismo resultado que una línea de peso sin snapshot (regla 3, histórico).
    expect(display).toEqual(
      formatQuantityInSaleUnit(1, { stockUomCode: 'g' }),
    );
  });
});
