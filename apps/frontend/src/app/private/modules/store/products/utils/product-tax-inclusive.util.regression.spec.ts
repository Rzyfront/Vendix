import {
  BULK_TAX_INCLUSIVE_CONTROL,
  buildTaxInclusivePayload,
  catalogInclusiveDefault,
  coerceBulkTaxAction,
  estimateNetBase,
  estimatePriceWithTax,
  hydrateTaxInclusiveMap,
  normalizeTaxInclusiveMap,
  parseTaxRateFraction,
  resolveTaxInclusive,
  withoutTaxFromMap,
} from './product-tax-inclusive.util';

/**
 * Regresión A.6 — hidratación del mapa impuesto-incluido (A.5, F-007/F-022/
 * F-023/F-024/F-028/F-032). Cifras y precedencias a mano, no derivadas del SUT.
 *
 * Precedencia fijada: asignación > tax_categories embebido > catálogo, con la
 * asignación ganando SIN importar el orden de carga (defaults primero,
 * overlay después). `estimatePriceWithTax` es especificación de SIGNO para
 * exhibición (F-013): el oráculo de centavos es el backend.
 */
describe('product-tax-inclusive.util — hidratación y precedencia (A.5)', () => {
  describe('hydrateTaxInclusiveMap — la asignación gana siempre (F-024)', () => {
    const catalog = [
      { id: 19, is_inclusive: false },
      { id: 8, is_inclusive: true },
    ];

    it('siembra defaults del catálogo cuando no hay asignaciones', () => {
      expect(hydrateTaxInclusiveMap([], catalog)).toEqual({
        19: false,
        8: true,
      });
    });

    it('asignación true bajo catálogo false ⇒ true (F-007/F-022)', () => {
      const map = hydrateTaxInclusiveMap(
        [{ tax_category_id: 19, is_inclusive: true }],
        catalog,
      );
      expect(map[19]).toBe(true);
      expect(map[8]).toBe(true);
    });

    it('asignación null cae a tax_categories embebido y luego al catálogo', () => {
      const map = hydrateTaxInclusiveMap(
        [
          {
            tax_category_id: 19,
            is_inclusive: null,
            tax_categories: { id: 19, is_inclusive: true },
          },
          { tax_category_id: 8, is_inclusive: null },
        ],
        catalog,
      );
      expect(map[19]).toBe(true);
      expect(map[8]).toBe(true);
    });

    it('sin dato en ningún nivel queda el default del catálogo (o sin entrada)', () => {
      expect(hydrateTaxInclusiveMap(null, catalog)).toEqual({
        19: false,
        8: true,
      });
      expect(hydrateTaxInclusiveMap([], null)).toEqual({});
    });

    it('ids inválidos se saltan sin romper el resto', () => {
      const map = hydrateTaxInclusiveMap(
        [{ tax_category_id: NaN, is_inclusive: true }],
        catalog,
      );
      expect(map).toEqual({ 19: false, 8: true });
    });
  });

  describe('resolveTaxInclusive — el mapa de vista gana; sin entrada, catálogo', () => {
    const catalog = [{ id: 19, is_inclusive: true }];

    it('entrada del mapa gana al catálogo en ambas direcciones', () => {
      expect(resolveTaxInclusive(19, { 19: false }, catalog)).toBe(false);
      expect(resolveTaxInclusive(19, { 19: true }, [{ id: 19 }])).toBe(true);
    });

    it('sin entrada cae al default del catálogo; sin catálogo ⇒ false', () => {
      expect(resolveTaxInclusive(19, {}, catalog)).toBe(true);
      expect(resolveTaxInclusive(19, null, null)).toBe(false);
    });
  });

  describe('buildTaxInclusivePayload — filtrado a ids efectivos (F-023/F-032)', () => {
    it('solo viajan los ids seleccionados; el resto se cae', () => {
      expect(
        buildTaxInclusivePayload([19], { 19: true, 8: true }),
      ).toEqual({ '19': true });
    });

    it('sin entrada en el mapa no hay clave (no resucita al re-añadir)', () => {
      expect(buildTaxInclusivePayload([8], { 19: true })).toEqual({});
    });

    it('dedup y saneo de ids', () => {
      expect(
        buildTaxInclusivePayload([19, 19, -1, NaN], { 19: true }),
      ).toEqual({ '19': true });
    });
  });

  describe('withoutTaxFromMap / normalizeTaxInclusiveMap', () => {
    it('quitar un impuesto limpia su entrada (F-032)', () => {
      expect(withoutTaxFromMap({ 19: true, 8: false }, 19)).toEqual({
        8: false,
      });
    });

    it('normaliza claves string a numéricas con booleanos estrictos', () => {
      expect(normalizeTaxInclusiveMap({ '19': 1, abc: true })).toEqual({
        19: true,
      });
      expect(normalizeTaxInclusiveMap(null)).toEqual({});
    });
  });

  describe('parseTaxRateFraction / catalogInclusiveDefault', () => {
    it('19, 0.19 y "19" ⇒ 0.19; negativos/NaN/ausentes ⇒ 0', () => {
      expect(parseTaxRateFraction(19)).toBe(0.19);
      expect(parseTaxRateFraction(0.19)).toBe(0.19);
      expect(parseTaxRateFraction('19')).toBe(0.19);
      expect(parseTaxRateFraction(-1)).toBe(0);
      expect(parseTaxRateFraction(NaN)).toBe(0);
      expect(parseTaxRateFraction(null)).toBe(0);
    });

    it('default: is_inclusive ?? primera tasa ?? false', () => {
      expect(catalogInclusiveDefault({ is_inclusive: true })).toBe(true);
      expect(
        catalogInclusiveDefault({
          tax_rates: [{ is_inclusive: true }],
        }),
      ).toBe(true);
      expect(catalogInclusiveDefault({})).toBe(false);
      expect(catalogInclusiveDefault(null)).toBe(false);
    });
  });

  describe('estimatePriceWithTax — signo, no centavos (F-013)', () => {
    it('todo inclusivo NO crece: 119000 con 19% dentro ⇒ 119000', () => {
      expect(
        estimatePriceWithTax(119000, [{ rateFraction: 0.19, inclusive: true }]),
      ).toBeCloseTo(119000, 8);
    });

    it('todo agregado suma: 100000 + 19% ⇒ 119000', () => {
      expect(
        estimatePriceWithTax(100000, [{ rateFraction: 0.19, inclusive: false }]),
      ).toBeCloseTo(119000, 8);
    });

    it('mixto: despeja lo inclusivo y suma lo agregado encima', () => {
      expect(
        estimatePriceWithTax(100000, [
          { rateFraction: 0.08, inclusive: true },
          { rateFraction: 0.19, inclusive: false },
        ]),
      ).toBeCloseTo(117592.59, 2);
    });

    it('estimateNetBase: sin tasa inclusiva devuelve la base', () => {
      expect(estimateNetBase(100000, 0)).toBe(100000);
      expect(estimateNetBase(119000, 0.19)).toBeCloseTo(100000, 8);
    });
  });

  describe('coerceBulkTaxAction — inclusive preservado y filtrado (F-028)', () => {
    it(`usa el control '${BULK_TAX_INCLUSIVE_CONTROL}' y filtra a ids`, () => {
      expect(
        coerceBulkTaxAction({
          mode: 'add',
          ids: [19],
          [BULK_TAX_INCLUSIVE_CONTROL]: { '19': true, '8': true },
        }),
      ).toEqual({ mode: 'add', ids: [19], inclusive: { '19': true } });
    });

    it('sin entradas efectivas no emite la clave inclusive', () => {
      expect(
        coerceBulkTaxAction({ mode: 'add', ids: [19], inclusive: {} }),
      ).toEqual({ mode: 'add', ids: [19] });
    });

    it('modo inválido ⇒ undefined (nada que mandar)', () => {
      expect(coerceBulkTaxAction({ mode: 'merge', ids: [19] })).toBeUndefined();
      expect(coerceBulkTaxAction(null)).toBeUndefined();
    });
  });
});
