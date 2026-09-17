import {
  SEARCH_SCORE_BONUSES,
  SEARCH_WEIGHTS,
  compareSearchRank,
  rankedIdsPage,
  scoreTokens,
  type RankedIdsPageDelegates,
  type SearchRankKey,
  type SearchWeightKey,
} from './search-score.util';

describe('search-score.util (CP-pos-smart-search A.2)', () => {
  describe('SEARCH_WEIGHTS contract (F-019, pinned for C.3 SQL parity)', () => {
    it('matches the exact pinned table', () => {
      expect(SEARCH_WEIGHTS).toEqual({
        name: { exact: 120, word: 40, prefix: 25, contains: 12 },
        sku: { exact: 110, word: 30, prefix: 20, contains: 10 },
        barcode: { exact: 110, word: 25, prefix: 15, contains: 8 },
        variantName: { exact: 105, word: 30, prefix: 18, contains: 8 },
        variantSku: { exact: 110, word: 30, prefix: 20, contains: 10 },
        description: { exact: 100, word: 15, prefix: 10, contains: 5 },
      });
    });

    it('respects the mandated tier ranges', () => {
      for (const weights of Object.values(SEARCH_WEIGHTS)) {
        expect(weights.exact).toBeGreaterThanOrEqual(100);
        expect(weights.exact).toBeLessThanOrEqual(120);
        expect(weights.word).toBeGreaterThanOrEqual(15);
        expect(weights.word).toBeLessThanOrEqual(40);
        expect(weights.prefix).toBeGreaterThanOrEqual(10);
        expect(weights.prefix).toBeLessThanOrEqual(25);
        expect(weights.contains).toBeGreaterThanOrEqual(5);
        expect(weights.contains).toBeLessThanOrEqual(12);
      }
    });

    it('ranks identity > name > variants > description per tier', () => {
      expect(SEARCH_WEIGHTS.sku.word).toBeLessThanOrEqual(
        SEARCH_WEIGHTS.name.word,
      );
      expect(SEARCH_WEIGHTS.description.word).toBeLessThan(
        SEARCH_WEIGHTS.variantName.word,
      );
      expect(SEARCH_WEIGHTS.variantName.word).toBeLessThanOrEqual(
        SEARCH_WEIGHTS.name.word,
      );
    });

    it('pins bonuses incl. barcode exact +30', () => {
      expect(SEARCH_SCORE_BONUSES).toEqual({
        fullCoverage: 15,
        allInPrimary: 25,
        skuExact: 20,
        barcodeExact: 30,
      });
    });
  });

  describe('scoreTokens tiers', () => {
    const field = (key: SearchWeightKey, value: string | null) => ({
      key,
      value,
    });

    it('exact beats word beats prefix beats contains on the same field', () => {
      expect(
        scoreTokens(['cafe'], [field('name', 'cafe')]).tokenScore,
      ).toBe(120);
      expect(
        scoreTokens(['cafe'], [field('name', 'café negro')]).tokenScore,
      ).toBe(40);
      expect(
        scoreTokens(['caf'], [field('name', 'café negro')]).tokenScore,
      ).toBe(25);
      expect(
        scoreTokens(['afe'], [field('name', 'café negro')]).tokenScore,
      ).toBe(12);
    });

    it('normalizes accents/case before matching (tildes, mayúsculas)', () => {
      const lower = scoreTokens(['cafe'], [field('name', 'café')]);
      const upper = scoreTokens(['CAFE'], [field('name', 'CAFÉ')]);
      expect(lower.tokenScore).toBe(120);
      expect(upper).toEqual(lower);
    });

    it('takes the MAX per token across fields (matched once, not summed)', () => {
      const breakdown = scoreTokens(
        ['cafe'],
        [field('name', 'café negro'), field('description', 'café suave')],
      );
      expect(breakdown.tokenScore).toBe(40);
      expect(breakdown.coverage).toBe(1);
    });

    it('sums across distinct tokens and reports coverage', () => {
      const breakdown = scoreTokens(
        ['cafe', 'chocolate'],
        [field('name', 'café negro')],
      );
      expect(breakdown.tokenScore).toBe(40);
      expect(breakdown.coverage).toBe(1);
      expect(breakdown.totalTokens).toBe(2);
      expect(breakdown.fullCoverage).toBe(false);
    });

    it('dedupes repeated tokens (coverage counts distinct)', () => {
      const breakdown = scoreTokens(
        ['cafe', 'cafe'],
        [field('name', 'café')],
      );
      expect(breakdown.totalTokens).toBe(1);
      expect(breakdown.tokenScore).toBe(120);
    });

    it('awards fullCoverage + allInPrimary when every token hits the primary', () => {
      const breakdown = scoreTokens(
        ['cafe', 'negro'],
        [field('name', 'café negro')],
        { primaryKey: 'name' },
      );
      expect(breakdown.tokenScore).toBe(80);
      expect(breakdown.fullCoverage).toBe(true);
      expect(breakdown.allInPrimary).toBe(true);
      expect(breakdown.score).toBe(80 + 15 + 25);
    });

    it('awards fullCoverage without allInPrimary when split across fields', () => {
      const breakdown = scoreTokens(
        ['cafe', 'suave'],
        [field('name', 'café negro'), field('description', 'tueste suave')],
        { primaryKey: 'name' },
      );
      expect(breakdown.fullCoverage).toBe(true);
      expect(breakdown.allInPrimary).toBe(false);
      expect(breakdown.score).toBe(40 + 15 + 15);
    });

    it('awards no allInPrimary bonus without a primaryKey', () => {
      const breakdown = scoreTokens(
        ['cafe'],
        [field('variantName', 'café')],
      );
      expect(breakdown.allInPrimary).toBe(false);
      expect(breakdown.tokenScore).toBe(105);
      expect(breakdown.score).toBe(105 + 15);
    });

    it('ignores unknown keys and empty values fail-closed (no coverage)', () => {
      const breakdown = scoreTokens(
        ['cafe'],
        [
          { key: 'not-a-key', value: 'café' } as unknown as {
            key: SearchWeightKey;
            value: string;
          },
          field('name', null),
          field('description', '   '),
        ],
      );
      expect(breakdown.score).toBe(0);
      expect(breakdown.coverage).toBe(0);
      expect(breakdown.totalTokens).toBe(1);
    });

    it('is total never-throw: garbage in, zero breakdown out', () => {
      expect(scoreTokens(null, null)).toEqual({
        score: 0,
        tokenScore: 0,
        coverage: 0,
        totalTokens: 0,
        fullCoverage: false,
        allInPrimary: false,
      });
      expect(scoreTokens(['cafe'], null).score).toBe(0);
      expect(scoreTokens(null, [field('name', 'café')]).score).toBe(0);
      expect(
        scoreTokens([null, 42, {}] as unknown as string[], [
          field('name', 'café'),
        ]).score,
      ).toBe(0);
    });
  });

  describe('compareSearchRank (order contract score→coverage→featured→created_at→id)', () => {
    const key = (overrides: Partial<SearchRankKey> = {}): SearchRankKey => ({
      id: 1,
      score: 0,
      coverage: 0,
      featured: false,
      createdAt: 0,
      ...overrides,
    });

    it('orders by score first', () => {
      const rows = [key({ id: 1, score: 10 }), key({ id: 2, score: 50 })];
      expect([...rows].sort(compareSearchRank).map((row) => row.id)).toEqual([
        2, 1,
      ]);
    });

    it('breaks score ties by coverage, then featured, then recency, then id desc', () => {
      const rows = [
        key({ id: 1, score: 40, coverage: 1 }),
        key({ id: 2, score: 40, coverage: 2 }),
        key({ id: 3, score: 40, coverage: 2, featured: true }),
      ];
      expect(rows.sort(compareSearchRank).map((row) => row.id)).toEqual([
        3, 2, 1,
      ]);

      const olderNewer = [
        key({ id: 1, score: 40, createdAt: 100 }),
        key({ id: 2, score: 40, createdAt: 200 }),
      ];
      expect(
        olderNewer.sort(compareSearchRank).map((row) => row.id),
      ).toEqual([2, 1]);

      const sameTime = [
        key({ id: 7, score: 40, createdAt: 100 }),
        key({ id: 9, score: 40, createdAt: 100 }),
      ];
      expect(sameTime.sort(compareSearchRank).map((row) => row.id)).toEqual([
        9, 7,
      ]);
    });

    it('is a total order: deterministic regardless of input order (no page flips)', () => {
      const rows = [
        key({ id: 1, score: 40, coverage: 1, createdAt: 300 }),
        key({ id: 2, score: 80, coverage: 2, createdAt: 100 }),
        key({ id: 3, score: 40, coverage: 2, createdAt: 200 }),
        key({ id: 4, score: 40, coverage: 1, featured: true, createdAt: 50 }),
      ];
      const forward = [...rows].sort(compareSearchRank).map((row) => row.id);
      const backward = [...rows]
        .reverse()
        .sort(compareSearchRank)
        .map((row) => row.id);
      expect(forward).toEqual(backward);
      expect(forward).toEqual([2, 3, 4, 1]);
    });

    it('is null-safe and antisymmetric', () => {
      expect(compareSearchRank(null, undefined)).toBe(0);
      const a = key({ score: 10 });
      const b = key({ score: 20 });
      expect(compareSearchRank(a, b)).toBeGreaterThan(0);
      expect(compareSearchRank(b, a)).toBeLessThan(0);
    });
  });

  describe('rankedIdsPage (F-072 reusable orchestration)', () => {
    interface FakeRow {
      id: number;
      score: number;
    }

    const candidates: FakeRow[] = [
      { id: 1, score: 10 },
      { id: 2, score: 50 },
      { id: 3, score: 30 },
      { id: 4, score: 40 },
      { id: 5, score: 20 },
    ];

    const delegates = (
      overrides: Partial<RankedIdsPageDelegates<object, FakeRow, FakeRow>> = {},
    ): RankedIdsPageDelegates<object, FakeRow, FakeRow> => ({
      scanCap: 100,
      scan: async (_where, take) => candidates.slice(0, take),
      score: (candidate) => ({
        id: candidate.id,
        score: candidate.score,
        coverage: 1,
        featured: false,
        createdAt: 0,
      }),
      hydrate: async (_where, ids) =>
        candidates.filter((row) => ids.includes(row.id)),
      getId: (row) => row.id,
      ...overrides,
    });

    it('ranks globally, slices the page, hydrates, and re-sorts by rank', async () => {
      const hydrateOrder: number[][] = [];
      const result = await rankedIdsPage({}, 1, 2, delegates({
        hydrate: async (_where, ids) => {
          hydrateOrder.push([...ids]);
          return [...candidates]
            .filter((row) => ids.includes(row.id))
            .reverse();
        },
      }));
      expect(result).not.toBeNull();
      expect(result?.rows.map((row) => row.id)).toEqual([2, 4]);
      expect(hydrateOrder).toEqual([[2, 4]]);
      expect(result?.totalCandidates).toBe(5);
    });

    it('paginates without flips: page1 ++ page2 === full order, no overlap', async () => {
      const page1 = await rankedIdsPage({}, 1, 2, delegates());
      const page2 = await rankedIdsPage({}, 2, 2, delegates());
      const page3 = await rankedIdsPage({}, 3, 2, delegates());
      const ids1 = page1?.rows.map((row) => row.id) ?? [];
      const ids2 = page2?.rows.map((row) => row.id) ?? [];
      const ids3 = page3?.rows.map((row) => row.id) ?? [];
      expect([...ids1, ...ids2, ...ids3]).toEqual([2, 4, 3, 5, 1]);
      expect(new Set([...ids1, ...ids2, ...ids3]).size).toBe(5);
    });

    it('returns null over the scan cap (fail-open signal, caller falls back)', async () => {
      const result = await rankedIdsPage({}, 1, 10, delegates({ scanCap: 2 }));
      expect(result).toBeNull();
    });

    it('returns an empty page past the end (valid, not capped)', async () => {
      const result = await rankedIdsPage({}, 99, 10, delegates());
      expect(result).toEqual({ rows: [], totalCandidates: 5 });
    });

    it('clamps invalid page/limit instead of throwing', async () => {
      const result = await rankedIdsPage({}, 0, -5, delegates());
      expect(result?.rows.map((row) => row.id)).toEqual([2]);
    });

    it('drops ids missing from hydrate (concurrent delete) keeping rank order', async () => {
      const result = await rankedIdsPage({}, 1, 3, delegates({
        hydrate: async (_where, ids) =>
          candidates.filter((row) => ids.includes(row.id) && row.id !== 4),
      }));
      expect(result?.rows.map((row) => row.id)).toEqual([2, 3]);
    });

    it('propagates delegate failures so the service can degrade loudly', async () => {
      await expect(
        rankedIdsPage({}, 1, 10, delegates({
          scan: async () => {
            throw new Error('db down');
          },
        })),
      ).rejects.toThrow('db down');
    });
  });
});
