import { resolveGrossLineTotals } from './quotations.service';

/**
 * La cabecera de la cotización resta el descuento UNA sola vez
 * (`grand_total = subtotal - descuentos + impuestos`), así que el subtotal
 * tiene que salir de totales BRUTOS.
 *
 * Medido en dev antes del arreglo: 3 unidades a $5.000 con $1.000 de descuento
 * se guardaban en $13.000 mientras el modal mostraba $14.000, y la orden
 * convertida heredaba el faltante porque `convertToOrder` copia los totales sin
 * recalcularlos.
 */
describe('resolveGrossLineTotals', () => {
  it('ignora el total neteado que manda el cliente y devuelve el bruto', () => {
    const items = [
      // El modal mandaba `precio × cantidad - descuento`.
      { unit_price: 5000, quantity: 3, discount_amount: 1000, total_price: 14000 },
    ];

    expect(
      resolveGrossLineTotals(items, { priceUnitByIndex: [null] }),
    ).toEqual([15000]);
  });

  it('aplica la escala del producto: 2 m de un cable a $4.500 el metro', () => {
    const items = [{ unit_price: 4500, quantity: 2000 }];

    expect(
      resolveGrossLineTotals(items, { priceUnitByIndex: [1000] }),
    ).toEqual([9000]);
  });

  it('no divide una presentación: la escala llega en null', () => {
    // Rollo de 20 m: `unit_price` ya es el precio del paquete y `quantity`
    // cuenta paquetes.
    const items = [{ unit_price: 90000, quantity: 1 }];

    expect(resolveGrossLineTotals(items, { priceUnitByIndex: [null] })).toEqual([
      90000,
    ]);
  });

  it('resuelve cada línea con su propia escala', () => {
    const items = [
      { unit_price: 4500, quantity: 2000 },
      { unit_price: 5000, quantity: 3 },
    ];

    expect(
      resolveGrossLineTotals(items, { priceUnitByIndex: [1000, null] }),
    ).toEqual([9000, 15000]);
  });
});
