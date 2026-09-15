import { toCents, differsByAtLeastCents } from './money-compare';

/**
 * El bug que cierra `differsByAtLeastCents`: `Math.abs(a - b) >= 0.01` sobre
 * dos `number` de 2 decimales no es fiable en punto flotante — el MISMO
 * centavo de diferencia cruza o no cruza el umbral según la magnitud de `a`
 * y `b`. Verificado en Node antes de escribir este test:
 *
 *   13603.13 - 13603.12 = 0.00999999999839...  >= 0.01 ? false
 *     551.06 -   551.05 = 0.00999999999999...  >= 0.01 ? false
 *       2425 -  2424.99 = 0.01000000000021...  >= 0.01 ? true
 *    2223.09 -  2223.08 = 0.01000000000021...  >= 0.01 ? true
 *
 * Los cuatro pares son EL MISMO centavo de diferencia; los cuatro deben dar
 * el mismo veredicto.
 */
describe('differsByAtLeastCents — reemplaza la resta en punto flotante', () => {
  const CASOS: Array<[number, number]> = [
    [13603.13, 13603.12],
    [551.06, 551.05],
    [2425, 2424.99],
    [2223.09, 2223.08],
  ];

  it.each(CASOS)('%p vs %p: difieren en exactamente 1 centavo (true)', (a, b) => {
    expect(differsByAtLeastCents(a, b)).toBe(true);
    // Simétrico: el orden de los operandos no cambia el veredicto.
    expect(differsByAtLeastCents(b, a)).toBe(true);
  });

  it('demuestra la inconsistencia que tenía la resta en punto flotante', () => {
    // Documenta el defecto que este archivo reemplaza: la MISMA magnitud de
    // diferencia (1 centavo) no cruza el umbral de la misma forma para los
    // cuatro pares cuando se resta en `number` puro.
    const veredictos_float = CASOS.map(([a, b]) => Math.abs(a - b) >= 0.01);
    expect(veredictos_float).toEqual([false, false, true, true]);

    // Con `differsByAtLeastCents` los cuatro son idénticos.
    const veredictos_kernel = CASOS.map(([a, b]) => differsByAtLeastCents(a, b));
    expect(veredictos_kernel).toEqual([true, true, true, true]);
  });

  it('no dispara con 0 ¢ de diferencia real', () => {
    expect(differsByAtLeastCents(100, 100)).toBe(false);
    expect(differsByAtLeastCents('100.00', 100)).toBe(false);
  });

  it('respeta un umbral explícito distinto de 1 ¢', () => {
    expect(differsByAtLeastCents(100, 100.02, 2)).toBe(true);
    expect(differsByAtLeastCents(100, 100.01, 2)).toBe(false);
  });
});

describe('toCents', () => {
  it('convierte a centavos enteros sin arrastrar polvo de punto flotante', () => {
    expect(toCents(13603.13)).toBe(1360313);
    expect(toCents('551.05')).toBe(55105);
    expect(toCents(2425)).toBe(242500);
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
  });
});
