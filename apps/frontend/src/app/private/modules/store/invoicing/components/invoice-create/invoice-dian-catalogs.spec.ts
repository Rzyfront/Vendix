import {
  AIU_COMPONENT_CONTRATO_OPTION,
  AIU_COMPONENT_OPTIONS,
  aiuComponentOptionsForModel,
} from './invoice-dian-catalogs';

/**
 * Paso 5 del plan «AIU modelo no sumada» — el catálogo de componentes de línea.
 *
 * La propiedad custodiada: `'contrato'` EXISTE (sin él el frontend no puede
 * producir una línea Modelo 1 ni a mano) pero SÓLO se ofrece cuando el
 * documento declara `'no_sumada'`. Ofrecerlo bajo `'sumada'` dejaría construir
 * el documento híbrido —una línea de contrato junto a tres de porción— que
 * declara el AIU dos veces y que el backend rechaza con la validación D.4,
 * después de haber capturado el documento entero.
 */
describe('invoice-dian-catalogs · aiuComponentOptionsForModel (paso 5)', () => {
  it("bajo 'sumada' se ofrecen las TRES porciones y ninguna más", () => {
    const options = aiuComponentOptionsForModel('sumada');
    expect(options.map((option) => option.value)).toEqual([
      'administracion',
      'imprevistos',
      'utilidad',
    ]);
  });

  it("bajo 'sumada' devuelve la MISMA lista de siempre, no una copia", () => {
    expect(aiuComponentOptionsForModel('sumada')).toBe(AIU_COMPONENT_OPTIONS);
  });

  it("bajo 'no_sumada' suma «Contrato (AIU incluido)» al final", () => {
    const options = aiuComponentOptionsForModel('no_sumada');
    expect(options.map((option) => option.value)).toEqual([
      'administracion',
      'imprevistos',
      'utilidad',
      'contrato',
    ]);
    expect(options[3].label).toBe('Contrato (AIU incluido)');
  });

  it("bajo 'no_sumada' no muta la lista base: 'sumada' sigue con tres", () => {
    aiuComponentOptionsForModel('no_sumada');
    expect(AIU_COMPONENT_OPTIONS.length).toBe(3);
    expect(aiuComponentOptionsForModel('sumada').length).toBe(3);
  });

  it('la opción del Modelo 1 dice que el AIU va DENTRO de la línea', () => {
    expect(AIU_COMPONENT_CONTRATO_OPTION.value).toBe('contrato');
    expect(AIU_COMPONENT_CONTRATO_OPTION.description).toContain('DENTRO');
    expect(AIU_COMPONENT_CONTRATO_OPTION.description).toContain(
      'no suma al total',
    );
  });

  it("'contrato' NO está en la lista base: el desglose por porción cuenta tres cubetas", () => {
    expect(
      AIU_COMPONENT_OPTIONS.some((option) => option.value === 'contrato'),
    ).toBe(false);
  });
});
