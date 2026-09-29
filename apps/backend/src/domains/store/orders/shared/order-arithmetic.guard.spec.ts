import { VendixHttpException } from 'src/common/errors';
import { Logger } from '@nestjs/common';
import {
  assertOrderLineTotalInvariant,
  getOrderLineInvariantViolationCount,
} from './order-arithmetic.guard';

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

  it('bandera ON: 2 ¢ exactos de residuo no lanzan (borde estable en centavos)', () => {
    // P2-4: antes el borde de 0,02 era inestable en floats
    // (10000.02 − 10000 = 0.020000000000436557 ⇒ "excedía"). En centavos
    // enteros 2 ¢ se toleran siempre, en cualquier magnitud.
    for (const [unit, total] of [[10000, 10000.02], [13603.12, 13603.14], [551.05, 551.07]]) {
      expect(() =>
        assertOrderLineTotalInvariant(
          { order_item_id: 6, unit_price: unit, total_price: total, quantity: 1 },
          { enabled: true },
        ),
      ).not.toThrow();
    }
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

  it('bandera OFF: la violación deja warn estructurado y suma a la métrica, sin lanzar', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const before = getOrderLineInvariantViolationCount();
    expect(() =>
      assertOrderLineTotalInvariant(
        { order_item_id: 8, unit_price: 10000, total_price: 10000.05, quantity: 1 },
        { enabled: false, context: { store_id: 3, writer: 'test' } },
      ),
    ).not.toThrow();
    expect(getOrderLineInvariantViolationCount()).toBe(before + 1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'orders.line_total_invariant_violation',
        blocking: false,
        order_item_id: 8,
        residual: 0.05,
        store_id: 3,
        writer: 'test',
      }),
    );
    warn.mockRestore();
  });

  it('línea sana: ni warn ni métrica', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const before = getOrderLineInvariantViolationCount();
    assertOrderLineTotalInvariant({ unit_price: 925.93, total_price: 2777.79, quantity: 3 });
    expect(getOrderLineInvariantViolationCount()).toBe(before);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
