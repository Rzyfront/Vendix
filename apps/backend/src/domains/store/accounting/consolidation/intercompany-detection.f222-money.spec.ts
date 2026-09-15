import { differsByAtLeastCents } from '@common/money-kernel';
import { IntercompanyDetectionService } from './intercompany-detection.service';

/**
 * F-222 — CONTRATO DE UMBRAL de intercompany-detection.
 *
 * Dos sitios (detección de contrapartida por línea y eliminación de
 * saldos). En ambos, `true` = "no es la misma cifra" y la candidata se
 * descarta (`return false`). Los montos vienen de asientos de DOS tiendas
 * redondeados por separado, así que el centavo de residuo es aritmético.
 *
 * El umbral NO cambió con la migración: el original `> 0.01` tolera
 * 1 centavo y el migrado también, sólo que medido en centavos enteros
 * (`differsByAtLeastCents(a, b, 2)`). Lo que desaparece es que el veredicto
 * dependiera de la MAGNITUD de los operandos.
 *
 * Esta spec fija el CONTRATO del umbral, no el camino del servicio: mide los
 * dos bordes y la independencia de magnitud. La ruta real del servicio se
 * cubre en `intercompany-detection.service.ts (consolidación, sin spec de servicio hoy)`.
 */
describe('intercompany-detection — umbral en centavos enteros (F-222)', () => {
  // Los cuatro pares de abajo son EL MISMO centavo de diferencia. Con
  // `Math.abs` sobre floats dos disparan y dos no.
  const UN_CENTAVO: Array<[number, number]> = [
    [13603.13, 13603.12],
    [551.06, 551.05],
    [2425.0, 2424.99],
    [2223.09, 2223.08],
  ];

  it('el mismo centavo daba veredictos opuestos según la magnitud (el defecto)', () => {
    const veredictos = UN_CENTAVO.map(([a, b]) => Math.abs(a - b) > 0.01);
    expect(veredictos).toEqual([false, false, true, true]);
  });

  it('1¢ se TOLERA en las cuatro magnitudes (umbral original preservado)', () => {
    for (const [a, b] of UN_CENTAVO) {
      expect(differsByAtLeastCents(a, b, 2)).toBe(false);
    }
  });

  it('2¢ SÍ descarta en las cuatro magnitudes', () => {
    for (const [a, b] of UN_CENTAVO) {
      expect(differsByAtLeastCents(a + 0.01, b, 2)).toBe(true);
    }
  });

  it('cifras idénticas nunca descartan', () => {
    expect(differsByAtLeastCents(250000.5, 250000.5, 2)).toBe(false);
  });

  it('el servicio migrado carga (resuelve @common/money-kernel)', () => {
    expect(IntercompanyDetectionService).toBeDefined();
  });
});
