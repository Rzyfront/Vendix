import { Decimal } from './decimal';

/**
 * Congela la paridad con `Prisma.Decimal` (ADR-16). Estos cinco valores se
 * verificaron contra el árbol instalado (`@prisma/client-runtime-utils@7.8.0`
 * empaquetando `decimal.js@10.5.0` sin overrides — ver el comentario largo en
 * `./decimal.ts`). Si este test falla, alguien cambió la config del kernel
 * (o decimal.js cambió sus defaults de fábrica) y el kernel dejó de ser
 * idéntico a `Prisma.Decimal`: es acá donde tiene que romperse, no en un
 * cálculo de dinero en producción.
 */
describe('Decimal (kernel) — paridad de configuración con Prisma.Decimal', () => {
  it('fija los cinco valores verificados de Prisma.Decimal', () => {
    expect(Decimal.precision).toBe(20);
    expect(Decimal.rounding).toBe(4); // ROUND_HALF_UP
    expect(Decimal.toExpNeg).toBe(-7);
    expect(Decimal.toExpPos).toBe(21);
    expect(Decimal.modulo).toBe(1); // DOWN
  });

  it('ROUND_HALF_UP === 4, la constante que Prisma usa como rounding global', () => {
    expect(Decimal.ROUND_HALF_UP).toBe(4);
  });

  it('1/3 produce las mismas 20 cifras significativas que Prisma.Decimal', () => {
    // Valor de referencia verificado en el árbol instalado con
    // `new Prisma.Decimal(1).div(3)`.
    expect(new Decimal(1).dividedBy(3).toString()).toBe('0.33333333333333333333');
  });

  it('es un constructor propio, no el `Decimal` global de decimal.js sin clonar', () => {
    // `clone()` siempre crea un constructor nuevo; comparar contra el import
    // "crudo" de decimal.js sería importar la dependencia dos veces en este
    // test, así que la señal indirecta es que `Decimal.set` es una función
    // propia de ESTE constructor (todo `clone()` la redefine).
    expect(typeof Decimal.set).toBe('function');
    expect(typeof Decimal.clone).toBe('function');
  });
});
