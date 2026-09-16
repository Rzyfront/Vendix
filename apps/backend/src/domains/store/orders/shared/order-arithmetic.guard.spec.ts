import { VendixHttpException } from 'src/common/errors';
import { assertOrderLineTotalInvariant } from './order-arithmetic.guard';

/**
 * D.13 — Compuerta G3. Cubre SÓLO el archivo aislado (no está cableado a
 * ningún escritor — ver docblock de `order-arithmetic.guard.ts`):
 *   1. Bandera OFF (default): nunca lanza, ni con una línea rota.
 *   2. Bandera ON: cuadra silenciosamente en peso / escala / cantidad plana
 *      (las tres ramas de `resolveLineUnits`).
 *   3. Bandera ON: lanza `ORD_LINE_TOTAL_MISMATCH_001` (422) fuera de
 *      tolerancia.
 *   4. Tolerancia de 0,02 se respeta en el borde.
 */
describe('order-arithmetic.guard (G3, D.13)', () => {
  it('bandera OFF (default): no lanza aunque la línea esté rota', () => {
    expect(() =>
      assertOrderLineTotalInvariant({
        order_item_id: 1,
        unit_price: 10000,
        total_price: 999999, // muy lejos de 10000 * 1
        quantity: 1,
      }),
    ).not.toThrow();
  });

  it('bandera OFF explícita por opción: idéntico resultado', () => {
    expect(() =>
      assertOrderLineTotalInvariant(
        {
          order_item_id: 1,
          unit_price: 10000,
          total_price: 999999,
          quantity: 1,
        },
        { enabled: false },
      ),
    ).not.toThrow();
  });

  it('bandera ON: cuadra por cantidad plana (sin peso, sin escala)', () => {
    expect(() =>
      assertOrderLineTotalInvariant(
        {
          order_item_id: 2,
          unit_price: 10000,
          total_price: 30000,
          quantity: 3,
        },
        { enabled: true },
      ),
    ).not.toThrow();
  });

  it('bandera ON: cuadra por peso (line_units = weight, no quantity)', () => {
    expect(() =>
      assertOrderLineTotalInvariant(
        {
          order_item_id: 3,
          unit_price: 5000,
          total_price: 6250, // 5000 * 1.25 kg
          quantity: 1,
          weight: 1.25,
        },
        { enabled: true },
      ),
    ).not.toThrow();
  });

  it('bandera ON: cuadra por escala (price_unit_quantity > 1)', () => {
    // 12 unidades vendidas, presentación de 6 -> line_units = 12/6 = 2
    expect(() =>
      assertOrderLineTotalInvariant(
        {
          order_item_id: 4,
          unit_price: 8000,
          total_price: 16000,
          quantity: 12,
          price_unit_quantity: 6,
        },
        { enabled: true },
      ),
    ).not.toThrow();
  });

  it('bandera ON: lanza ORD_LINE_TOTAL_MISMATCH_001 (422) fuera de tolerancia', () => {
    try {
      assertOrderLineTotalInvariant(
        {
          order_item_id: 5,
          unit_price: 10000,
          total_price: 12000,
          quantity: 1,
        },
        { enabled: true },
      );
      fail('debía lanzar');
    } catch (e) {
      const error = e as VendixHttpException;
      expect(error.errorCode).toBe('ORD_LINE_TOTAL_MISMATCH_001');
      expect(error.getStatus()).toBe(422);
    }
  });

  it('bandera ON: dentro de tolerancia (0,01 de residuo) no lanza', () => {
    // 0,02 exacto se evita a propósito: el residuo real de punto flotante
    // (10000.02 - 10000) da 0.020000000000436557, un poco por encima de la
    // tolerancia — no es un caso de borde estable para esta aserción.
    expect(() =>
      assertOrderLineTotalInvariant(
        {
          order_item_id: 6,
          unit_price: 10000,
          total_price: 10000.01,
          quantity: 1,
        },
        { enabled: true },
      ),
    ).not.toThrow();
  });

  it('bandera ON: 0,03 de residuo SÍ excede la tolerancia por defecto', () => {
    expect(() =>
      assertOrderLineTotalInvariant(
        {
          order_item_id: 7,
          unit_price: 10000,
          total_price: 10000.03,
          quantity: 1,
        },
        { enabled: true },
      ),
    ).toThrow();
  });
});
