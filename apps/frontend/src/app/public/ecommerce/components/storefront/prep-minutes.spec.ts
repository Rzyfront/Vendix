import { prepMinutesOrNull } from './storefront.component';

/**
 * F-013 — `prepMinutesOrNull` es la única decisión de render del tiempo de
 * preparación: la vitrina, la card y el detalle lo comparten para que el
 * mismo dato no tenga tres renders.
 */
describe('prepMinutesOrNull — F-013', () => {
  it('pinta los minutos enteros con el flag encendido', () => {
    expect(prepMinutesOrNull(25, true)).toBe(25);
  });

  it('oculta el sub-minuto (0.5) en vez de pintar "~0.5 min"', () => {
    expect(prepMinutesOrNull(0.5, true)).toBeNull();
  });

  it('trunca hacia abajo (25.9 ⇒ 25)', () => {
    expect(prepMinutesOrNull(25.9, true)).toBe(25);
  });

  it('no renderiza con flag apagado, ausente, nulo, no numérico o <= 0', () => {
    expect(prepMinutesOrNull(25, false)).toBeNull();
    expect(prepMinutesOrNull(undefined, true)).toBeNull();
    expect(prepMinutesOrNull(null, true)).toBeNull();
    expect(prepMinutesOrNull('abc', true)).toBeNull();
    expect(prepMinutesOrNull(0, true)).toBeNull();
    expect(prepMinutesOrNull(-5, true)).toBeNull();
  });
});
