/**
 * CP-pos-smart-search · C.3 — Specs del builder trigram puro + fixture F-081.
 *
 * Sin DB: pinean SQL parametrizado ($1..$n, cero interpolación), ESCAPE,
 * expresión canónica ≡ GIN, filtros espejo, COUNT twin byte-idéntico y el
 * fixture compartido tokenizer-JS ⇄ SQL. El match real (`cafe`→`Café` rank-1)
 * se verifica en vivo (evidence C.3) + gate EXPLAIN automatizado.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildTokenPatterns,
  buildTrigramCountQuery,
  buildTrigramPredicates,
  buildTrigramRankedQuery,
  extractWhereClause,
  TRIGRAM_CANONICAL_FN,
  TrigramFilterError,
} from './product-search-trigram.util';
import { tokenizeInternal } from '../../../../common/utils/search-text.util';
import {
  SEARCH_SCORE_BONUSES,
  SEARCH_WEIGHTS,
} from '../../../../common/utils/search-score.util';

describe('product-search-trigram (C.3)', () => {
  describe('scope fail-closed (F-004)', () => {
    it('store_id es SIEMPRE $1, primera cláusula', () => {
      const { sql, params } = buildTrigramRankedQuery(
        7,
        ['cafe'],
        null,
        'cafe',
        20,
        0,
      );
      expect(params[0]).toBe(7);
      // Primera cláusula DEL WHERE (el score SELECT va antes en el texto).
      expect(extractWhereClause(sql).startsWith('p.store_id = $1')).toBe(
        true,
      );
    });

    it.each([[0], [-3], [NaN], ['7'], [null], [undefined]])(
      'storeId=%p → throw (nunca predicado sin tenant)',
      (storeId) => {
        expect(() =>
          buildTrigramPredicates(storeId as number, ['cafe'], null),
        ).toThrow(TrigramFilterError);
      },
    );
  });

  describe('placeholders, cero interpolación (F-030)', () => {
    const adversarial = [`' OR '1'='1`, `100%`, `tornillo_M8`, `a\\b`, `cafe`];
    it.each(adversarial)('token %p: ni rastro en el SQL, solo en params', (raw) => {
      const tokens = tokenizeInternal(raw);
      // `' OR '1'='1` tokeniza (or/1...): si vacía, el builder debe lanzar.
      if (tokens.length === 0) {
        expect(() =>
          buildTrigramRankedQuery(1, tokens, null, raw, 20, 0),
        ).toThrow(TrigramFilterError);
        return;
      }
      const { sql, params } = buildTrigramRankedQuery(
        1,
        tokens,
        null,
        raw,
        20,
        0,
      );
      expect(sql).not.toContain(raw);
      expect(sql).not.toContain(`'${raw}'`);
      // Los placeholders existen y los valores viven en params.
      expect(sql).toMatch(/\$\d+/);
      expect(params.length).toBeGreaterThan(1);
    });

    it('grep-gate: el builder no interpola valores (solo $n/constantes)', () => {
      const { sql } = buildTrigramRankedQuery(
        1,
        ['cafe', 'molido'],
        { brandId: 5 },
        'cafe molido',
        20,
        0,
      );
      // Cero literales de input: ni tokens, ni brandId como literal.
      expect(sql).not.toContain('cafe');
      expect(sql).not.toContain('molido');
      expect(sql).not.toMatch(/brand_id = 5[^0-9]/);
      expect(sql).toContain('p.brand_id = $');
    });
  });

  describe('LIKE literal + ESCAPE (F-080)', () => {
    it('cada LIKE lleva ESCAPE explícito', () => {
      const { sql } = buildTrigramRankedQuery(1, ['cafe'], null, 'cafe', 20, 0);
      const likes = sql.match(/LIKE \$\d+::text/g) ?? [];
      expect(likes.length).toBeGreaterThan(0);
      const escaped = sql.match(/LIKE \$\d+::text ESCAPE '\\'/g) ?? [];
      expect(escaped.length).toBe(likes.length);
    });

    it('42P18: TODO $n lleva cast explícito (cero inferencia del adapter)', () => {
      // Regresión del P2010 vivo: `func() = $n` + string → 42P18 vía Prisma.
      const filters = {
        state: 'active',
        brandId: 3,
        categoryId: 9,
        trackInventory: true,
        productType: 'physical',
        requiresBooking: false,
        isSellable: true,
        isBatchProduced: false,
        isIngredient: true,
        ids: [11, 12],
      } as const;
      for (const q of [
        buildTrigramRankedQuery(1, ['cafe', 'molido'], filters, 'x', 20, 0),
        buildTrigramCountQuery(1, ['cafe', 'molido'], filters),
      ]) {
        // \b: sin boundary, `$1` matchearía dentro de `$13`.
        const bare = q.sql.match(/\$\d+\b(?!::)/g) ?? [];
        expect(bare).toEqual([]);
      }
    });

    it('`%` y `_` viajan escapados en params', () => {
      const patterns = buildTokenPatterns('100%_x');
      expect(patterns.contains).toBe('%100\\%\\_x%');
      expect(patterns.prefix).toBe('100\\%\\_x%');
      expect(patterns.exact).toBe('100%_x');
    });
  });

  describe('expresión canónica ≡ GIN (F-026)', () => {
    it('usa immutable_unaccent(lower(col)) en name/sku/description', () => {
      const { sql } = buildTrigramRankedQuery(1, ['cafe'], null, 'cafe', 20, 0);
      expect(sql).toContain(`${TRIGRAM_CANONICAL_FN}(lower(p.name))`);
      expect(sql).toContain(`${TRIGRAM_CANONICAL_FN}(lower(p.sku))`);
      expect(sql).toContain(`${TRIGRAM_CANONICAL_FN}(lower(p.description))`);
    });
  });

  describe('recall AND×OR (F-015 en SQL)', () => {
    it('cada token exige su grupo OR (AND entre tokens)', () => {
      const { sql } = buildTrigramRankedQuery(
        1,
        ['cafe', 'molido'],
        null,
        'cafe molido',
        20,
        0,
      );
      // 2 grupos recall EN EL WHERE: cada uno con pata description.
      // (El score también nombra description: por eso se aísla el WHERE.)
      const where = extractWhereClause(sql);
      const groups = where.match(
        /public\.immutable_unaccent\(lower\(p\.description\)\) LIKE/g,
      );
      expect(groups?.length).toBe(2);
    });

    it('barcode NO entra al recall (paridad set L1)', () => {
      const where = extractWhereClause(
        buildTrigramRankedQuery(1, ['cafe'], null, 'cafe', 20, 0).sql,
      );
      expect(where).not.toContain('p.barcode');
    });
  });

  describe('filtros espejo buildProductWhere (F-028)', () => {
    it('state explícito → predicado; default → <> archived; includeInactive → nada', () => {
      const active = extractWhereClause(
        buildTrigramRankedQuery(
          1,
          ['cafe'],
          { state: 'active' },
          'cafe',
          20,
          0,
        ).sql,
      );
      expect(active).toContain('p.state = $');
      const def = extractWhereClause(
        buildTrigramRankedQuery(1, ['cafe'], null, 'cafe', 20, 0).sql,
      );
      expect(def).toContain(`p.state <> 'archived'`);
      const all = extractWhereClause(
        buildTrigramRankedQuery(
          1,
          ['cafe'],
          { includeInactive: true },
          'cafe',
          20,
          0,
        ).sql,
      );
      expect(all).not.toContain('p.state');
    });

    it('brand/category/flags/ids → AND dentro del SQL', () => {
      const where = extractWhereClause(
        buildTrigramRankedQuery(
          1,
          ['cafe'],
          {
            brandId: 3,
            categoryId: 9,
            trackInventory: true,
            productType: 'physical',
            requiresBooking: false,
            isSellable: true,
            isBatchProduced: false,
            isIngredient: false,
            ids: [11, 12],
          },
          'cafe',
          20,
          0,
        ).sql,
      );
      for (const fragment of [
        'p.brand_id = $',
        'product_categories pc',
        'pc.category_id = $',
        'p.track_inventory = $',
        'p.product_type = $',
        'p.requires_booking = $',
        'p.is_sellable = $',
        'p.is_batch_produced = $',
        'p.is_ingredient = $',
        'p.id = ANY($',
      ]) {
        expect(where).toContain(fragment);
      }
    });

    it('isIngredient tri-estado: undefined = sin filtro', () => {
      const where = extractWhereClause(
        buildTrigramRankedQuery(
          1,
          ['cafe'],
          { isIngredient: undefined },
          'cafe',
          20,
          0,
        ).sql,
      );
      expect(where).not.toContain('is_ingredient');
    });

    it.each([
      [{ state: 'borrado' }, 'state'],
      [{ productType: 'magia' }, 'productType'],
      [{ brandId: -1 }, 'brandId'],
      [{ categoryId: 0 }, 'categoryId'],
      [{ ids: [] }, 'ids'],
    ])('filtro inválido %p → throw fail-closed', (filters: object, _label: string) => {
      void _label;
      expect(() =>
        buildTrigramPredicates(
          1,
          ['cafe'],
          filters as unknown as import('./product-search-trigram.util').TrigramFilterSet,
        ),
      ).toThrow(TrigramFilterError);
    });
  });

  describe('COUNT twin byte-idéntico (F-029)', () => {
    it('rank y COUNT comparten WHERE byte a byte', () => {
      const filters = {
        state: 'active',
        brandId: 3,
        categoryId: 9,
        isSellable: true,
      } as const;
      const rank = buildTrigramRankedQuery(
        4,
        ['cafe', 'molido'],
        filters,
        'Café Molido',
        20,
        40,
      );
      const count = buildTrigramCountQuery(4, ['cafe', 'molido'], filters);
      expect(extractWhereClause(rank.sql)).toBe(
        extractWhereClause(count.sql),
      );
      // Y los params del WHERE son los mismos en orden.
      expect(count.params).toEqual(
        rank.params.slice(0, count.params.length),
      );
    });

    it('snapshot: el builder emite byte-exacto el SQL del gate EXPLAIN', () => {
      // Cadena de confianza del gate (F-101): el script
      // scripts/pos-search-explain-gate.sh corre EXPLAIN sobre este snapshot;
      // este test garantiza que el builder genera EXACTAMENTE ese SQL (y esos
      // params). Cambiar el builder ⇒ regenerar snapshot a conciencia.
      const dir = join(__dirname, '__fixtures__');
      const rank = buildTrigramRankedQuery(
        3,
        ['cafe'],
        { state: 'active', isSellable: true },
        'cafe',
        20,
        0,
      );
      expect(rank.sql + '\n').toBe(
        readFileSync(join(dir, 'trigram-rank-canonical.sql'), 'utf8'),
      );
      expect(JSON.stringify(rank.params)).toBe(
        readFileSync(
          join(dir, 'trigram-rank-canonical.params.json'),
          'utf8',
        ),
      );
    });

    it('cero params huérfanos: max $n referenciado == params.length (P2010)', () => {
      // Regresión del 42P18 vivo: el adapter aborta si recibe un $n que el
      // SQL no referencia. Ambos twins: contiguos $1..$N, todos usados.
      const maxRef = (sql: string): number =>
        Math.max(
          0,
          ...(sql.match(/\$\d+\b/g) ?? []).map((ref) =>
            Number(ref.slice(1)),
          ),
        );
      for (const tokens of [['cafe'], ['cafe', 'molido'], ['a', 'b', 'c']]) {
        const rank = buildTrigramRankedQuery(1, tokens, null, 'x', 20, 0);
        const count = buildTrigramCountQuery(1, tokens, null);
        expect(maxRef(rank.sql)).toBe(rank.params.length);
        expect(maxRef(count.sql)).toBe(count.params.length);
      }
    });
  });

  describe('rank espejo A.2 (F-019)', () => {
    it('ORDER BY score→coverage→featured→created→id (compareSearchRank)', () => {
      const { sql } = buildTrigramRankedQuery(1, ['cafe'], null, 'cafe', 20, 0);
      expect(sql).toContain(
        'ORDER BY score DESC, coverage DESC, p.is_featured DESC, p.created_at DESC NULLS LAST, p.id DESC',
      );
    });

    it('números de SEARCH_WEIGHTS/bonus viajan al CASE', () => {
      const { sql } = buildTrigramRankedQuery(1, ['cafe'], null, 'cafe', 20, 0);
      expect(sql).toContain(`THEN ${SEARCH_WEIGHTS.name.exact}`);
      expect(sql).toContain(`THEN ${SEARCH_WEIGHTS.name.word}`);
      expect(sql).toContain(`THEN ${SEARCH_WEIGHTS.sku.contains}`);
      expect(sql).toContain(`+ ${SEARCH_SCORE_BONUSES.fullCoverage} +`);
      expect(sql).toContain(`THEN ${SEARCH_SCORE_BONUSES.allInPrimary}`);
      expect(sql).toContain(`THEN ${SEARCH_SCORE_BONUSES.skuExact}`);
      expect(sql).toContain(`THEN ${SEARCH_SCORE_BONUSES.barcodeExact}`);
    });

    it('paginación por params LIMIT/OFFSET al final', () => {
      const { sql, params } = buildTrigramRankedQuery(
        1,
        ['cafe'],
        null,
        'cafe',
        20,
        40,
      );
      expect(sql).toMatch(/LIMIT \$\d+::int OFFSET \$\d+::int$/);
      expect(params.slice(-2)).toEqual([20, 40]);
    });
  });

  describe('fixture paridad tokenizer ⇄ SQL (F-081)', () => {
    // Las 4 queries objetivo-1: arrays pineados; el SQL los consume byte-par
    // con immutable_unaccent(lower()) del lado columna (ñ viva, tilde muerta).
    it.each([
      ['cafe', ['cafe']],
      ['Café Molido', ['cafe', 'molido']],
      ['niño', ['niño']],
      ['slim playstation', ['slim', 'playstation']],
    ])('tokenize %p → %p', (query, expected) => {
      expect(tokenizeInternal(query)).toEqual(expected);
    });

    it('`cafe` produce contains `%cafe%` sobre la forma canónica', () => {
      const { sql, params } = buildTrigramRankedQuery(
        1,
        tokenizeInternal('Café'),
        null,
        'Café',
        20,
        0,
      );
      expect(params).toContain('%cafe%');
      expect(sql).toContain(
        `${TRIGRAM_CANONICAL_FN}(lower(p.name)) LIKE `,
      );
    });

    it('`niño` preserva ñ en params (F-079 end-to-end)', () => {
      const { params } = buildTrigramRankedQuery(
        1,
        tokenizeInternal('niño'),
        null,
        'niño',
        20,
        0,
      );
      expect(params).toContain('%niño%');
    });
  });

  describe('admisión (F-090)', () => {
    it('tokens vacíos o >8 → throw', () => {
      expect(() => buildTrigramPredicates(1, [], null)).toThrow(
        TrigramFilterError,
      );
      expect(() =>
        buildTrigramPredicates(
          1,
          ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
          null,
        ),
      ).toThrow(TrigramFilterError);
    });

    it('limit/offset inválidos → throw', () => {
      expect(() =>
        buildTrigramRankedQuery(1, ['cafe'], null, 'cafe', 0, 0),
      ).toThrow(TrigramFilterError);
      expect(() =>
        buildTrigramRankedQuery(1, ['cafe'], null, 'cafe', 20, -1),
      ).toThrow(TrigramFilterError);
    });
  });
});
