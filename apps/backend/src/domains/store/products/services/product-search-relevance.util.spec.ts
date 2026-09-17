import { tokenizeInternal } from '../../../../common/utils/search-text.util';
import {
  POS_SMART_SEARCH_PARITY_CORPUS,
  POS_SMART_SEARCH_PARITY_EXPECTED,
  POS_SMART_SEARCH_PARITY_QUERIES,
} from './product-search.parity.fixture';
import {
  PRODUCT_SEARCH_VARIANT_RESCORE_TOP_K,
  rankProductSearchRows,
  rankProductSearchRowsTwoTier,
  scoreIdentityBonus,
  scoreProductSearchRow,
  scoreProductTier1,
  scoreVariantTier,
  toSearchEpochMs,
  type ProductSearchRow,
} from './product-search-relevance.util';

let nextId = 1000;

function makeRow(overrides: Partial<ProductSearchRow> = {}): ProductSearchRow {
  nextId += 1;
  return {
    id: nextId,
    name: 'Producto base',
    description: null,
    sku: null,
    barcode: null,
    is_featured: false,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    product_variants: [],
    ...overrides,
  };
}

describe('product-search-relevance.util (CP-pos-smart-search A.2)', () => {
  describe('acceptance: multi-word recall ranks the full match first', () => {
    it("'café negro granizado con hielo y chocolate' ranks 1st for ['cafe','chocolate']", () => {
      const full = makeRow({
        id: 101,
        name: 'café negro granizado con hielo y chocolate',
      });
      const partial = makeRow({ id: 102, name: 'café negro' });
      const other = makeRow({ id: 103, name: 'chocolate blanco' });
      const ranked = rankProductSearchRows(
        ['cafe', 'chocolate'],
        [partial, other, full],
      );
      expect(ranked.map((row) => row.id)).toEqual([101, 103, 102]);
    });
  });

  describe('identity over text: sku exact > partial name; barcode exact +30', () => {
    it('exact sku beats a partial name match', () => {
      const bySku = makeRow({ id: 201, name: 'Azúcar Morena', sku: 'CAFE-999' });
      const byName = makeRow({ id: 202, name: 'Cafecito de la casa' });
      const ranked = rankProductSearchRows(
        ['cafe', '999'],
        [byName, bySku],
        'CAFE-999',
      );
      expect(ranked.map((row) => row.id)).toEqual([201, 202]);
      expect(scoreProductSearchRow(['cafe', '999'], bySku, 'CAFE-999').score).toBe(
        30 + 30 + 15 + 20,
      );
      expect(scoreProductSearchRow(['cafe', '999'], byName, 'CAFE-999').score).toBe(
        25,
      );
    });

    it('exact barcode adds exactly +30 over tier-1 without identity', () => {
      const withBarcode = makeRow({
        id: 203,
        name: 'Leche entera',
        barcode: '7501234567890',
      });
      const query = '7501234567890';
      const tokens = tokenizeInternal(query);
      const tier1NoIdentity = scoreProductTier1(tokens, withBarcode);
      expect(tier1NoIdentity.score).toBe(110 + 15);
      expect(tier1NoIdentity.identityBonus).toBe(0);
      const full = scoreProductSearchRow(tokens, withBarcode, query);
      expect(full.score).toBe(110 + 15 + 30);
      expect(full.score - tier1NoIdentity.score).toBe(30);
      expect(scoreIdentityBonus(query, withBarcode)).toBe(30);
    });

    it('exact sku query adds the +20 identity bonus (hyphens normalized)', () => {
      const row = makeRow({ name: 'Café', sku: 'CAFE-001' });
      expect(scoreIdentityBonus('CAFE-001', row)).toBe(20);
      expect(scoreIdentityBonus('cafe-001', row)).toBe(20);
      expect(scoreIdentityBonus('CAFE-002', row)).toBe(0);
      expect(scoreIdentityBonus('', row)).toBe(0);
    });

    it('identity bonus also matches variant sku/barcode', () => {
      const row = makeRow({
        sku: 'BASE-1',
        product_variants: [
          { id: 301, name: 'Rojo', sku: 'VAR-9', barcode: '770000000001' },
        ],
      });
      expect(scoreIdentityBonus('VAR-9', row)).toBe(20);
      expect(scoreIdentityBonus('770000000001', row)).toBe(30);
    });
  });

  describe('stable order: score→coverage→featured→created_at→id, no flips', () => {
    it('is independent of input order', () => {
      const rows = [...POS_SMART_SEARCH_PARITY_CORPUS];
      const tokens = tokenizeInternal('cafe');
      const forward = rankProductSearchRows(tokens, rows, 'cafe');
      const backward = rankProductSearchRows(tokens, [...rows].reverse(), 'cafe');
      expect(forward.map((row) => row.id)).toEqual(
        backward.map((row) => row.id),
      );
    });

    it('prefers featured, then coverage, then recency, then id desc', () => {
      const rows = rankProductSearchRows(
        tokenizeInternal('café'),
        POS_SMART_SEARCH_PARITY_CORPUS,
        'café',
      );
      expect(rows.map((row) => row.id)).toEqual([1, 3, 2, 6, 5, 4]);
    });

    it('does not mutate the input array', () => {
      const rows = [...POS_SMART_SEARCH_PARITY_CORPUS];
      const snapshot = rows.map((row) => row.id);
      rankProductSearchRows(tokenizeInternal('cafe'), rows, 'cafe');
      expect(rows.map((row) => row.id)).toEqual(snapshot);
    });
  });

  describe('variants add without stock filtering (vendible ≠ disponible)', () => {
    it('variant-only match scores above zero (no stock field exists to filter on)', () => {
      const row = makeRow({
        name: 'Granizado de Chocolate',
        sku: 'GRA-100',
        product_variants: [
          { id: 401, name: 'Extra shot de cafe', sku: 'GRA-100-S', barcode: null },
        ],
      });
      const tier1 = scoreProductTier1(['cafe'], row);
      const withVariants = scoreProductSearchRow(['cafe'], row);
      expect(tier1.score).toBe(0);
      expect(tier1.coverage).toBe(0);
      expect(withVariants.score).toBe(30);
    });

    it('takes the best variant (max, not sum across variants)', () => {
      const row = makeRow({
        name: 'Camiseta',
        product_variants: [
          { id: 402, name: 'roja', sku: null, barcode: null },
          { id: 403, name: 'roja talla m', sku: null, barcode: null },
        ],
      });
      expect(scoreVariantTier(['roja'], row.product_variants)).toBe(105);
      expect(scoreVariantTier(['roja'], [])).toBe(0);
      expect(scoreVariantTier(['roja'], null)).toBe(0);
    });
  });

  describe('two-tier (ADR-03): tier-1 rank, then variant re-score of top-K', () => {
    it('single-pass equals tier-1 + variant tier composition', () => {
      for (const row of POS_SMART_SEARCH_PARITY_CORPUS) {
        const tokens = tokenizeInternal('chocolate cafe');
        const tier1 = scoreProductTier1(tokens, row, 'chocolate cafe');
        const full = scoreProductSearchRow(tokens, row, 'chocolate cafe');
        expect(full.score).toBe(
          tier1.score + scoreVariantTier(tokens, row.product_variants),
        );
        expect(full.coverage).toBe(tier1.coverage);
      }
    });

    it('two-tier with K >= n equals single-pass order', () => {
      const tokens = tokenizeInternal('chocolate cafe');
      const single = rankProductSearchRows(
        tokens,
        POS_SMART_SEARCH_PARITY_CORPUS,
        'chocolate cafe',
      );
      const twoTier = rankProductSearchRowsTwoTier(
        tokens,
        POS_SMART_SEARCH_PARITY_CORPUS,
        'chocolate cafe',
        POS_SMART_SEARCH_PARITY_CORPUS.length,
      );
      expect(twoTier.map((row) => row.id)).toEqual(
        single.map((row) => row.id),
      );
    });

    it('two-tier with small K only re-scores the head (documented approximation)', () => {
      const tokens = tokenizeInternal('chocolate cafe');
      const twoTier = rankProductSearchRowsTwoTier(
        tokens,
        POS_SMART_SEARCH_PARITY_CORPUS,
        'chocolate cafe',
        1,
      );
      expect(twoTier[0]?.id).toBe(2);
      expect(twoTier.map((row) => row.id)).toHaveLength(
        POS_SMART_SEARCH_PARITY_CORPUS.length,
      );
    });

    it('exposes the default rescore top-K constant', () => {
      expect(PRODUCT_SEARCH_VARIANT_RESCORE_TOP_K).toBe(200);
    });
  });

  describe('stopwords and coverage flow through the shared tokenizer', () => {
    it("query with stopwords tokenizes to ['cafe','chocolate'] and ranks full match first", () => {
      const tokens = tokenizeInternal('café con y de chocolate');
      expect(tokens).toEqual(['cafe', 'chocolate']);
      const full = makeRow({ id: 501, name: 'Café con chocolate' });
      const partial = makeRow({ id: 502, name: 'Café negro' });
      expect(
        rankProductSearchRows(tokens, [partial, full]).map((row) => row.id),
      ).toEqual([501, 502]);
    });
  });

  describe('parity fixture (shared by B.2 memory and C.3 SQL specs)', () => {
    it('has exactly the 4 mandated queries', () => {
      expect(POS_SMART_SEARCH_PARITY_QUERIES.map((entry) => entry.label)).toEqual(
        ['tildes', 'orden', 'guiones', 'mayusculas'],
      );
    });

    it.each(POS_SMART_SEARCH_PARITY_QUERIES)(
      'fixture "$label" ($query) produces the pinned order',
      ({ label, query }) => {
        const ranked = rankProductSearchRows(
          tokenizeInternal(query),
          POS_SMART_SEARCH_PARITY_CORPUS,
          query,
        );
        expect(ranked.map((row) => row.id)).toEqual(
          POS_SMART_SEARCH_PARITY_EXPECTED[label],
        );
      },
    );

    it('token order does not change the ranking (orden invariance)', () => {
      const direct = rankProductSearchRows(
        tokenizeInternal('chocolate cafe'),
        POS_SMART_SEARCH_PARITY_CORPUS,
        'chocolate cafe',
      );
      const reversed = rankProductSearchRows(
        tokenizeInternal('cafe chocolate'),
        POS_SMART_SEARCH_PARITY_CORPUS,
        'cafe chocolate',
      );
      expect(reversed.map((row) => row.id)).toEqual(
        direct.map((row) => row.id),
      );
    });

    it('guiones and mayusculas tokenize identically (shared normalization)', () => {
      expect(tokenizeInternal('cafe-negro')).toEqual(
        tokenizeInternal('CAFE NEGRO'),
      );
      expect(POS_SMART_SEARCH_PARITY_EXPECTED.guiones).toEqual(
        POS_SMART_SEARCH_PARITY_EXPECTED.mayusculas,
      );
    });
  });

  describe('defensive behavior', () => {
    it('never throws on garbage; unknown rows score zero', () => {
      expect(rankProductSearchRows(null, null)).toEqual([]);
      expect(rankProductSearchRows(['cafe'], null)).toEqual([]);
      expect(
        rankProductSearchRows(['cafe'], [null, undefined] as unknown as ProductSearchRow[]),
      ).toEqual([]);
      expect(scoreProductSearchRow(['cafe'], null)).toEqual({
        id: 0,
        score: 0,
        coverage: 0,
        featured: false,
        createdAt: 0,
      });
      expect(scoreIdentityBonus('x', null)).toBe(0);
      expect(rankProductSearchRowsTwoTier(['cafe'], null)).toEqual([]);
    });

    it('coerces created_at defensively', () => {
      expect(toSearchEpochMs(new Date('2026-01-01T00:00:00.000Z'))).toBe(
        Date.parse('2026-01-01T00:00:00.000Z'),
      );
      expect(toSearchEpochMs('2026-01-01T00:00:00.000Z')).toBe(
        Date.parse('2026-01-01T00:00:00.000Z'),
      );
      expect(toSearchEpochMs(123)).toBe(123);
      expect(toSearchEpochMs(null)).toBe(0);
      expect(toSearchEpochMs('not-a-date')).toBe(0);
      expect(toSearchEpochMs(Number.NaN)).toBe(0);
    });
  });
});
