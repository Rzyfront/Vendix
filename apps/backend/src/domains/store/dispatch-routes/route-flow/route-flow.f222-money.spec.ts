import { differsByAtLeastCents } from '@common/money-kernel';

/**
 * F-222 — la tolerancia del desglose de retención
 * (`route-flow.service.ts`, settle de parada con agente retenedor) vive en
 * centavos enteros, no en `Math.abs(...) > 0.01` sobre floats.
 */
describe('route-flow — tolerancia del desglose de retención (F-222)', () => {
  it('1¢ real (13603.13 vs 13603.12) SÍ difiere aunque el float diga que no', () => {
    // El par canónico: Math.abs da 0.00999999999839... < 0.01 (el `> 0.01`
    // viejo aceptaba el desglose descuadrado en silencio).
    expect(Math.abs(13603.13 - 13603.12) > 0.01).toBe(false);
    expect(differsByAtLeastCents(13603.13, 13603.12)).toBe(true);
  });

  it('desglose exacto no difiere', () => {
    expect(differsByAtLeastCents(50000, 50000)).toBe(false);
  });

  it('descuadre mayor a 1¢ difiere', () => {
    expect(differsByAtLeastCents(50000.05, 50000)).toBe(true);
  });
});
