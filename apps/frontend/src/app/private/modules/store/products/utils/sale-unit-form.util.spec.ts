import { UnitOfMeasure } from '../../inventory/services/uom.service';
import {
  compatibleAdditionalUnits,
  compatiblePurchaseUnits,
  fromProduct,
  inventoryCandidates,
  isMassPrincipal,
  PIECE,
  principalOptionGroups,
  SaleUnitFormState,
  summaryText,
  toPayload,
  violations,
} from './sale-unit-form.util';

function u(
  id: number,
  code: string,
  name: string,
  dimension: UnitOfMeasure['dimension'],
  factor: number,
): UnitOfMeasure {
  return {
    id,
    code,
    name,
    dimension,
    factor_to_base: factor,
    is_base: factor === 1,
    is_active: true,
    is_stock_eligible: true,
  };
}

const G = u(1, 'g', 'Gramo', 'mass', 1);
const LB = u(2, 'lb', 'Libra', 'mass', 500);
const KG = u(3, 'kg', 'Kilogramo', 'mass', 1000);
const ARROBA = u(4, '@', 'Arroba', 'mass', 12500);
const QQ = u(5, 'qq', 'Quintal', 'mass', 50000);
const TON = u(6, 'ton', 'Tonelada', 'mass', 1000000);
const ML = u(7, 'ml', 'Mililitro', 'volume', 1);
const L = u(8, 'L', 'Litro', 'volume', 1000);
const GAL = u(9, 'gal', 'Galón', 'volume', 3785.41);
const MM = u(10, 'mm', 'Milímetro', 'length', 1);
const M = u(11, 'm', 'Metro', 'length', 1000);
const UNIT = u(12, 'unit', 'Unidad', 'count', 1);
const PAR = u(13, 'par', 'Par', 'count', 2);
const DOCENA = u(14, 'doc', 'Docena', 'count', 12);
const CATALOG: UnitOfMeasure[] = [
  G, LB, KG, ARROBA, QQ, TON, ML, L, GAL, MM, M, UNIT, PAR, DOCENA,
];

function state(over: Partial<SaleUnitFormState>): SaleUnitFormState {
  return {
    principalUomId: PIECE,
    additionalUomIds: [],
    stockUomId: null,
    stockOverrideUomId: null,
    purchaseUomId: null,
    legacy: false,
    ...over,
  };
}

const money = (v: number) => `$${v.toLocaleString('de-DE')}`;

describe('sale-unit-form util', () => {
  describe('fromProduct', () => {
    it('LOMO AHUMADO legado (stock kg + weight, sin sale_uoms) muestra kg y se marca legacy', () => {
      const s = fromProduct(
        { pricing_type: 'weight', stock_uom_id: 3, price_unit_quantity: 1 },
        CATALOG,
      );
      expect(s.principalUomId).toBe(KG.id);
      expect(s.legacy).toBeTrue();
    });

    it('legado con escala: la principal es la unidad cuya razón con el stock es la escala', () => {
      const s = fromProduct(
        { pricing_type: 'unit', stock_uom_id: 1, price_unit_quantity: 1000 },
        CATALOG,
      );
      expect(s.principalUomId).toBe(KG.id);
      expect(s.legacy).toBeTrue();
    });

    it('legado con stock y escala 1: la principal es la unidad de stock', () => {
      const s = fromProduct(
        { pricing_type: 'unit', stock_uom_id: 11, price_unit_quantity: 1 },
        CATALOG,
      );
      expect(s.principalUomId).toBe(M.id);
    });

    it('legado sin stock ni peso: Pieza', () => {
      const s = fromProduct({ pricing_type: 'unit' }, CATALOG);
      expect(s.principalUomId).toBe(PIECE);
      expect(s.legacy).toBeTrue();
    });

    it('con sale_uoms lee principal y adicionales y deriva el inventario a la base', () => {
      const s = fromProduct(
        {
          pricing_type: 'weight',
          stock_uom_id: 1,
          sale_uoms: [
            { uom_id: 1 },
            { uom_id: 3, is_principal: true },
            { uom_id: 2 },
          ],
        },
        CATALOG,
      );
      expect(s.principalUomId).toBe(KG.id);
      expect(s.additionalUomIds).toEqual([1, 2]);
      expect(s.stockUomId).toBe(G.id);
      expect(s.legacy).toBeFalse();
    });
  });

  describe('toPayload', () => {
    const legacyOriginal = {
      pricing_type: 'weight',
      stock_uom_id: 3,
      purchase_uom_id: null,
      price_unit_quantity: 1,
      sale_uoms: [],
    };

    it('legado sin tocar devuelve los valores originales (sin reescribir)', () => {
      const s = fromProduct(legacyOriginal, CATALOG);
      expect(toPayload(s, CATALOG, false, legacyOriginal)).toEqual({
        pricing_type: 'weight',
        stock_uom_id: 3,
        purchase_uom_id: null,
        sale_uoms: [],
        price_unit_quantity: 1,
      });
    });

    it('legado tocado: stock en g, principal kg, escala 1000, weight', () => {
      // Al primer cambio el editor limpia el inventario heredado (forma canónica).
      const s = {
        ...fromProduct(legacyOriginal, CATALOG),
        stockOverrideUomId: null,
      };
      expect(toPayload(s, CATALOG, true, legacyOriginal)).toEqual({
        pricing_type: 'weight',
        stock_uom_id: G.id,
        purchase_uom_id: null,
        sale_uoms: [{ uom_id: KG.id, is_principal: true }],
        price_unit_quantity: 1000,
      });
    });

    it('COSTILLA: principal g, stock g, escala 1', () => {
      const p = toPayload(state({ principalUomId: G.id }), CATALOG, true);
      expect(p.stock_uom_id).toBe(G.id);
      expect(p.price_unit_quantity).toBe(1);
      expect(p.sale_uoms).toEqual([{ uom_id: G.id, is_principal: true }]);
    });

    it('principal kg + adicionales g y lb: una sola principal y stock en la base', () => {
      const p = toPayload(
        state({ principalUomId: KG.id, additionalUomIds: [G.id, LB.id] }),
        CATALOG,
        true,
      );
      expect(p.pricing_type).toBe('weight');
      expect(p.stock_uom_id).toBe(G.id);
      expect(p.price_unit_quantity).toBe(1000);
      expect(p.sale_uoms).toEqual([
        { uom_id: KG.id, is_principal: true },
        { uom_id: G.id },
        { uom_id: LB.id },
      ]);
    });

    it('principal volumen: pricing unit y stock en ml', () => {
      const p = toPayload(state({ principalUomId: L.id }), CATALOG, true);
      expect(p.pricing_type).toBe('unit');
      expect(p.stock_uom_id).toBe(ML.id);
      expect(p.price_unit_quantity).toBe(1000);
    });

    it('Pieza: producto simple', () => {
      expect(toPayload(state({}), CATALOG, true)).toEqual({
        pricing_type: 'unit',
        stock_uom_id: null,
        purchase_uom_id: null,
        sale_uoms: [],
        price_unit_quantity: 1,
      });
    });

    it('principal "unit" del catálogo sin adicionales equivale a Pieza', () => {
      const s = fromProduct(
        { sale_uoms: [{ uom_id: UNIT.id, is_principal: true }] },
        CATALOG,
      );
      expect(s.principalUomId).toBe(PIECE);
      expect(toPayload(s, CATALOG, true).stock_uom_id).toBeNull();
    });

    it('principal de conteo (par): inventario en unit y escala 2', () => {
      const p = toPayload(state({ principalUomId: PAR.id }), CATALOG, true);
      expect(p.stock_uom_id).toBe(UNIT.id);
      expect(p.price_unit_quantity).toBe(2);
      expect(p.pricing_type).toBe('unit');
    });
  });

  describe('persisted stock and untouched payload', () => {
    it('stock guardado distinto del derivado se conserva como override y se ve la violación', () => {
      const original = {
        pricing_type: 'weight',
        stock_uom_id: KG.id,
        price_unit_quantity: 1,
        sale_uoms: [{ uom_id: KG.id, is_principal: true }],
      };
      const s = fromProduct(original, CATALOG);
      expect(s.stockUomId).toBe(KG.id);
      expect(violations(s, CATALOG).map((v) => v.code)).toContain(
        'MEASURED_STOCK_NOT_BASE',
      );
      expect(toPayload(s, CATALOG, false, original).stock_uom_id).toBe(KG.id);
    });
  });

  describe('compatibleAdditionalUnits', () => {
    const codes = (principal: number) =>
      compatibleAdditionalUnits(principal, CATALOG).map((x) => x.code);

    it('principal kg ofrece g, lb, @, qq y ton (menores y mayores), sin kg', () => {
      expect(codes(KG.id)).toEqual(['g', 'lb', '@', 'qq', 'ton']);
    });

    it('principal L nunca ofrece gal (equivalencia no entera) ni otras dimensiones', () => {
      expect(codes(L.id)).toEqual(['ml']);
    });

    it('Pieza no ofrece adicionales', () => {
      expect(compatibleAdditionalUnits(PIECE, CATALOG)).toEqual([]);
    });
  });

  describe('summaryText', () => {
    it('forma exacta con adicionales', () => {
      const s = state({
        principalUomId: KG.id,
        additionalUomIds: [LB.id, G.id],
        stockUomId: G.id,
      });
      expect(summaryText(s, 24000, CATALOG, money)).toBe(
        'Se vende por kg a $24.000 · también en g y lb · el inventario se cuenta en g',
      );
    });

    it('sin adicionales omite "también en"', () => {
      const s = state({ principalUomId: KG.id });
      expect(summaryText(s, 24000, CATALOG, money)).toBe(
        'Se vende por kg a $24.000 · el inventario se cuenta en g',
      );
    });

    it('COSTILLA: principal g dice "Se vende por g"', () => {
      const s = state({ principalUomId: G.id });
      expect(summaryText(s, 24, CATALOG, money)).toContain('Se vende por g a');
    });

    it('Pieza', () => {
      expect(summaryText(state({}), 5000, CATALOG, money)).toBe(
        'Se vende por pieza a $5.000',
      );
    });
  });

  describe('violations', () => {
    const codesOf = (s: SaleUnitFormState) =>
      violations(s, CATALOG).map((v) => v.code);

    it('combinación derivada (kg + g + lb, stock g) no tiene violaciones', () => {
      expect(
        codesOf(
          state({ principalUomId: KG.id, additionalUomIds: [G.id, LB.id] }),
        ),
      ).toEqual([]);
    });

    it('inventario en kg con principal kg es MEASURED_STOCK_NOT_BASE (caso LOMO AHUMADO)', () => {
      expect(
        codesOf(state({ principalUomId: KG.id, stockOverrideUomId: KG.id })),
      ).toContain('MEASURED_STOCK_NOT_BASE');
    });

    it('adicional de otra dimensión es DIMENSION_MISMATCH', () => {
      expect(
        codesOf(state({ principalUomId: KG.id, additionalUomIds: [L.id] })),
      ).toContain('DIMENSION_MISMATCH');
    });

    it('adicional no entero (gal con principal L) es NOT_INTEGER_MULTIPLE', () => {
      const codes = codesOf(
        state({ principalUomId: L.id, additionalUomIds: [GAL.id] }),
      );
      expect(
        codes.includes('NOT_INTEGER_MULTIPLE') ||
          codes.includes('SMALLER_THAN_STOCK'),
      ).toBeTrue();
    });

    it('compra de otra dimensión se reporta', () => {
      expect(
        codesOf(state({ principalUomId: KG.id, purchaseUomId: L.id })),
      ).toContain('PURCHASE_DIMENSION_MISMATCH');
    });
  });

  describe('auxiliares', () => {
    it('el selector principal agrupa por dimensión y deja el conteo base como Pieza', () => {
      const groups = principalOptionGroups(CATALOG);
      expect(groups.map((g) => g.label)).toEqual([
        'Peso',
        'Volumen',
        'Longitud',
        'Conteo',
      ]);
      const count = groups.find((g) => g.label === 'Conteo')!;
      expect(count.options.map((o) => o.label)).toEqual([
        'Par (par)',
        'Docena (doc)',
      ]);
    });

    it('el inventario solo admite unidades que no generan violaciones', () => {
      const s = state({ principalUomId: KG.id, additionalUomIds: [LB.id] });
      expect(inventoryCandidates(s, CATALOG).map((x) => x.code)).toEqual(['g']);
    });

    it('compra: misma dimensión y no menor que el inventario', () => {
      expect(
        compatiblePurchaseUnits(G, CATALOG).map((x) => x.code),
      ).toEqual(['g', 'lb', 'kg', '@', 'qq', 'ton']);
    });

    it('isMassPrincipal solo con principal de masa', () => {
      expect(isMassPrincipal(state({ principalUomId: LB.id }), CATALOG)).toBeTrue();
      expect(isMassPrincipal(state({ principalUomId: L.id }), CATALOG)).toBeFalse();
      expect(isMassPrincipal(state({}), CATALOG)).toBeFalse();
    });
  });
});
