import { differsByAtLeastCents } from '@common/money-kernel';
import { IntercompanyDetectionService } from './intercompany-detection.service';

/**
 * F-222 — el matcheo de contrapartidas intercompañía
 * (`intercompany-detection.service.ts`, dos sitios: detección por línea y
 * eliminación de saldos) vive en centavos enteros, no en
 * `Math.abs(...) > 0.01` sobre floats. En ambos sitios `true` significa
 * "no es la misma cifra" (`return false` = descarta la candidata).
 */
describe('intercompany-detection — tolerancia del matcheo (F-222)', () => {
  it('el servicio migrado carga (resuelve @common/money-kernel)', () => {
    expect(IntercompanyDetectionService).toBeDefined();
  });

  it('1¢ real (13603.13 vs 13603.12) SÍ descarta aunque el float diga que no', () => {
    // El par canónico: Math.abs da 0.00999999999839... < 0.01 (el `> 0.01`
    // viejo EMPAREJABA dos líneas que difieren en un centavo real).
    expect(Math.abs(13603.13 - 13603.12) > 0.01).toBe(false);
    expect(differsByAtLeastCents(13603.13, 13603.12)).toBe(true);
  });

  it('mismo monto sí empareja', () => {
    expect(differsByAtLeastCents(250000.5, 250000.5)).toBe(false);
  });
});
