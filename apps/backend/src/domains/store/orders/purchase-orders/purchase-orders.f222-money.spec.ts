import { differsByAtLeastCents } from '@common/money-kernel';

/**
 * F-222 — la validación de la suma de cuotas
 * (`purchase-orders.service.ts`, `PO_PAYMENT_005`) vive en centavos enteros,
 * no en `Math.abs(...) > 0.01` sobre floats.
 */
describe('purchase-orders — tolerancia de la suma de cuotas (F-222)', () => {
  it('1¢ real (13603.13 vs 13603.12) SÍ difiere aunque el float diga que no', () => {
    // El par canónico: Math.abs da 0.00999999999839... < 0.01 (el `> 0.01`
    // viejo aceptaba el plan de cuotas descuadrado en silencio).
    expect(Math.abs(13603.13 - 13603.12) > 0.01).toBe(false);
    expect(differsByAtLeastCents(13603.13, 13603.12)).toBe(true);
  });

  it('suma exacta no difiere', () => {
    expect(differsByAtLeastCents(200000, 200000)).toBe(false);
  });
});
