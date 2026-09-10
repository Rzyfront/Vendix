import { VendixHttpException } from 'src/common/errors/vendix-http.exception';
import {
  PROD_TAXMAP_001,
  normalizeTaxInclusiveMapKeys,
  resolveCatalogInclusiveDefault,
  resolveIsInclusive,
  validateTaxInclusiveMap,
} from './dto/bulk-edit-products.dto';

/**
 * Regresión A.6 — merge del mapa `tax_inclusive_map` create/update (A.2).
 *
 * Cubre F-006/F-018/F-025/F-026/F-027/F-034/F-035: coerción JSON, validador
 * cerrado con 400 PROD_TAXMAP_001 y matriz de resolución por celda
 * (CREATE-hereda / UPDATE-sin-mapa-preserva / parcial-merge).
 *
 * Estos specs fijan las PRIMITIVAS puras que `create()` y `update()` consumen
 * (`validateTaxInclusiveMap` + `resolveIsInclusive`); el cableado con Prisma
 * vive en el servicio y lo cubren sus suites.
 */
describe('product tax_inclusive_map — validación y merge (A.2)', () => {
  describe('ERR PROD_TAXMAP_001 — contrato del código', () => {
    it('el código es 400 con error_code estable', () => {
      expect(PROD_TAXMAP_001.code).toBe('PROD_TAXMAP_001');
      expect(PROD_TAXMAP_001.httpStatus).toBe(400);
    });

    const expectTaxMap400 = (map: unknown, ids: number[] | undefined) => {
      let err: unknown;
      try {
        validateTaxInclusiveMap(map, ids);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(VendixHttpException);
      const http = err as VendixHttpException;
      expect(http.errorCode).toBe('PROD_TAXMAP_001');
      expect(http.getStatus()).toBe(400);
      expect(http.getResponse()).toMatchObject({
        error_code: 'PROD_TAXMAP_001',
      });
    };

    it('no-objeto o arreglo ⇒ 400 (nunca 500)', () => {
      expectTaxMap400('true', [19]);
      expectTaxMap400(42, [19]);
      expectTaxMap400([true], [19]);
    });

    it('clave no-entera-positiva ⇒ 400', () => {
      expectTaxMap400({ abc: true }, [19]);
      expectTaxMap400({ '1.5': true }, [19]);
      expectTaxMap400({ '0': true }, [19]);
      expectTaxMap400({ '-3': true }, [19]);
    });

    it('valor no-booleano-estricto ⇒ 400 ("true"/1/0/null no pasan)', () => {
      expectTaxMap400({ '19': 'true' }, [19]);
      expectTaxMap400({ '19': 1 }, [19]);
      expectTaxMap400({ '19': 0 }, [19]);
      expectTaxMap400({ '19': null }, [19]);
    });

    it('clave fuera de tax_category_ids ⇒ 400 (sobrante, F-026/F-035)', () => {
      expectTaxMap400({ '19': true, '99': false }, [19]);
    });
  });

  describe('F-026 — reglas de ignorado (no son error)', () => {
    it('mapa ausente ⇒ undefined (sin efecto)', () => {
      expect(validateTaxInclusiveMap(undefined, [19])).toBeUndefined();
      expect(validateTaxInclusiveMap(null, [19])).toBeUndefined();
    });

    it('sin tax_category_ids el mapa SE IGNORA (nunca crea asignaciones)', () => {
      expect(validateTaxInclusiveMap({ '19': true }, undefined)).toBeUndefined();
    });

    it('entrada faltante NO es error: el llamador hereda o preserva', () => {
      const out = validateTaxInclusiveMap({ '19': true }, [19, 8]);
      expect(out).toBeInstanceOf(Map);
      expect(out!.get(19)).toBe(true);
      expect(out!.has(8)).toBe(false);
    });

    it('mapa vacío ⇒ mapa vacío (válido, sin efecto)', () => {
      expect(validateTaxInclusiveMap({}, [19])).toEqual(new Map());
    });
  });

  describe('F-025 — coerción JSON de claves', () => {
    it('{"19": true} se resuelve como categoría 19', () => {
      expect(normalizeTaxInclusiveMapKeys({ '19': true })).toEqual({
        '19': true,
      });
    });

    it('"19.0" canonicaliza a "19" (gana la última en colisión)', () => {
      expect(
        normalizeTaxInclusiveMapKeys({ '19': false, '19.0': true }),
      ).toEqual({ '19': true });
    });

    it('clave no-entera SE CONSERVA para que el validador la rechace con 400', () => {
      expect(normalizeTaxInclusiveMapKeys({ abc: true })).toEqual({
        abc: true,
      });
    });

    it('los VALORES no se tocan: "true"/1 llegan intactos al validador', () => {
      expect(normalizeTaxInclusiveMapKeys({ '19': 'true' })).toEqual({
        '19': 'true',
      });
      expect(normalizeTaxInclusiveMapKeys({ '19': 1 })).toEqual({ '19': 1 });
    });

    it('no-objeto pasa tal cual (lo rechaza el servicio con el mismo código)', () => {
      expect(normalizeTaxInclusiveMapKeys(null)).toBeNull();
      expect(normalizeTaxInclusiveMapKeys([true])).toEqual([true]);
    });
  });

  describe('F-012 — default canónico del catálogo', () => {
    it('categoría ?? primera tasa ?? false', () => {
      expect(resolveCatalogInclusiveDefault({ is_inclusive: true })).toBe(true);
      expect(
        resolveCatalogInclusiveDefault({
          is_inclusive: null,
          tax_rates: [{ is_inclusive: true }],
        }),
      ).toBe(true);
      expect(
        resolveCatalogInclusiveDefault({
          is_inclusive: null,
          tax_rates: [{ is_inclusive: null }],
        }),
      ).toBe(false);
      expect(resolveCatalogInclusiveDefault({})).toBe(false);
    });
  });

  describe('F-034 — matriz create/update por celda (el mapa gana; sin entrada rige el default)', () => {
    it('CREATE: sin entrada ⇒ hereda el catálogo', () => {
      expect(resolveIsInclusive(19, undefined, true)).toBe(true);
      expect(resolveIsInclusive(19, undefined, false)).toBe(false);
    });

    it('CREATE/UPDATE parcial: la entrada gana, la ausente cae al default del llamador', () => {
      // El llamador pasa como default el flag preservado (asignación
      // existente) o el del catálogo (asignación nueva): la primitiva no
      // distingue, y por eso no puede borrar decisiones (F-006).
      const map = new Map([[19, true]]);
      expect(resolveIsInclusive(19, map, false)).toBe(true);
      expect(resolveIsInclusive(8, map, true)).toBe(true); // preserva
      expect(resolveIsInclusive(8, map, false)).toBe(false); // hereda
    });

    it('forma Record (cable) y forma Map (servicio) resuelven igual', () => {
      expect(resolveIsInclusive(19, { '19': false }, true)).toBe(false);
      expect(resolveIsInclusive(19, new Map([[19, false]]), true)).toBe(false);
    });
  });
});
