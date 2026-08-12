import {
  resolveLineStockUnits,
  resolvePackSize,
  resolveRefundStockUnits,
  resolveStockUnitsConsumed,
} from './packaging.util';

/**
 * Proporción paquete↔unidad. Es la pieza que sostiene los dos P0 de venta
 * empacada: la remisión descontaba `dispatched_quantity` (bultos) donde la
 * reserva había tomado `stock_units_consumed` (unidades), y la anulación
 * reponía con el mismo número equivocado.
 *
 * Un solo cálculo para las dos puntas del desdoblamiento. Duplicarlo es cómo se
 * desincronizan: arreglar el descuento sin la reversión repone 1 donde se
 * sacaron 50.
 */
describe('packaging.util', () => {
  describe('resolvePackSize', () => {
    it('el override del producto gana sobre la tarifa', () => {
      expect(resolvePackSize(12, 6)).toBe(6);
    });

    it('usa la tarifa cuando no hay override', () => {
      expect(resolvePackSize(24, null)).toBe(24);
    });

    it('sin tarifa ni override no hay presentación (1)', () => {
      expect(resolvePackSize(null, null)).toBe(1);
      expect(resolvePackSize(undefined, undefined)).toBe(1);
    });

    it('cualquier valor no mayor que 1 colapsa a 1 — no es tarifa de empaque', () => {
      expect(resolvePackSize(1, null)).toBe(1);
      expect(resolvePackSize(0, null)).toBe(1);
      expect(resolvePackSize(-5, null)).toBe(1);
      expect(resolvePackSize(50, 1)).toBe(1);
    });
  });

  describe('resolveStockUnitsConsumed', () => {
    it('un bulto de 50 consume 50 unidades de stock', () => {
      expect(resolveStockUnitsConsumed(1, 50)).toBe(50);
    });

    it('tres bultos de 24 consumen 72', () => {
      expect(resolveStockUnitsConsumed(3, 24)).toBe(72);
    });

    it('devuelve null cuando no hay presentación, para no persistir un snapshot inútil', () => {
      expect(resolveStockUnitsConsumed(7, 1)).toBeNull();
      expect(resolveStockUnitsConsumed(7, null, null)).toBeNull();
    });
  });

  describe('resolveLineStockUnits', () => {
    it('EL DEFECTO: despachar el único bulto de la línea mueve 50 unidades, no 1', () => {
      // Línea vendida: 1 bulto (quantity=1) que consumió 50 unidades.
      // La remisión anota dispatched_quantity=1 → antes descontaba 1 y dejaba
      // 49 unidades fantasma vendibles otra vez.
      expect(resolveLineStockUnits(1, 1, 50)).toBe(50);
    });

    it('despacho parcial mueve la porción proporcional', () => {
      // 1 de 2 bultos vendidos, la línea consumió 100 unidades → 50.
      expect(resolveLineStockUnits(1, 2, 100)).toBe(50);
      expect(resolveLineStockUnits(2, 4, 200)).toBe(100);
    });

    it('redondea al entero más cercano porque el inventario es Int', () => {
      // 1 de 3 bultos de una línea que consumió 100 → 33,33 → 33.
      expect(resolveLineStockUnits(1, 3, 100)).toBe(33);
      expect(resolveLineStockUnits(2, 3, 100)).toBe(67);
    });

    it('despachar la línea completa mueve exactamente lo consumido, sin recalcular', () => {
      expect(resolveLineStockUnits(4, 4, 97)).toBe(97);
    });

    it('un despacho por encima de lo vendido se topa en lo consumido', () => {
      expect(resolveLineStockUnits(9, 2, 100)).toBe(100);
    });

    it('sin snapshot de presentación devuelve la cantidad tal cual (líneas históricas)', () => {
      // Ventas anteriores a la feature, o sin presentación: la cantidad YA está
      // expresada en unidades de stock.
      expect(resolveLineStockUnits(7, 7, null)).toBe(7);
      expect(resolveLineStockUnits(7, 7, undefined)).toBe(7);
    });

    it('un snapshot inservible no corrompe el cálculo', () => {
      expect(resolveLineStockUnits(7, 7, 0)).toBe(7);
      expect(resolveLineStockUnits(7, 7, -50)).toBe(7);
      expect(resolveLineStockUnits(7, 7, Number.NaN)).toBe(7);
    });

    it('una cantidad vendida inservible no divide por cero', () => {
      expect(resolveLineStockUnits(5, 0, 100)).toBe(5);
      expect(resolveLineStockUnits(5, null, 100)).toBe(5);
      expect(resolveLineStockUnits(5, -2, 100)).toBe(5);
    });

    it('SIMETRÍA: descontar y revertir el mismo despacho mueven el mismo número', () => {
      // Este es el aserto que impide que D-1.1 y D-1.2 vuelvan a divergir.
      // El commit y el listener de anulación llaman a esta misma función con los
      // mismos argumentos; si alguien duplica el cálculo en uno de los dos, este
      // caso deja de tener sentido y debe fallar en revisión.
      const casos: Array<[number, number, number]> = [
        [1, 1, 50],
        [1, 2, 100],
        [1, 3, 100],
        [3, 5, 250],
      ];
      for (const [movido, vendido, consumido] of casos) {
        const descuento = resolveLineStockUnits(movido, vendido, consumido);
        const reversion = resolveLineStockUnits(movido, vendido, consumido);
        expect(reversion).toBe(descuento);
      }
    });
  });

  describe('resolveRefundStockUnits', () => {
    it('la devolución usa exactamente la misma proporción que la entrega', () => {
      expect(resolveRefundStockUnits(1, 1, 50)).toBe(
        resolveLineStockUnits(1, 1, 50),
      );
      expect(resolveRefundStockUnits(1, 3, 100)).toBe(
        resolveLineStockUnits(1, 3, 100),
      );
    });
  });
});
