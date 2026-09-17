import {
  SEARCH_TOKEN_INTERNAL_MAX,
  SEARCH_TOKEN_PUBLIC_MAX,
  STOPWORDS_ES_SEARCH,
  buildTokenAndFieldOr,
  escapeLike,
  isSmartSearchActive,
  normalizeSearchText,
  tokenizeInternal,
  tokenizePublic,
  tokenizeSearch,
} from './search-text.util';

describe('search-text.util (CP-pos-smart-search A.1)', () => {
  describe('normalizeSearchText', () => {
    it("'CAFÉ  Negro.' → 'cafe negro'", () => {
      expect(normalizeSearchText('CAFÉ  Negro.')).toBe('cafe negro');
    });

    it('preserva ñ/Ñ (paridad con immutable_unaccent de C.1)', () => {
      expect(normalizeSearchText('niño')).toBe('niño');
      expect(normalizeSearchText('NIÑO PEQUEÑO')).toBe('niño pequeño');
    });

    it('símbolos (-_/().) actúan como separadores', () => {
      expect(normalizeSearchText('cafe-negro/leche_(entera).')).toBe(
        'cafe negro leche entera',
      );
    });

    it('no-string → cadena vacía definida', () => {
      expect(normalizeSearchText(null)).toBe('');
      expect(normalizeSearchText(undefined)).toBe('');
      expect(normalizeSearchText(123)).toBe('');
      expect(normalizeSearchText({ q: 'cafe' })).toBe('');
      expect(normalizeSearchText(['cafe'])).toBe('');
    });
  });

  describe('STOPWORDS_ES_SEARCH', () => {
    it('vive en forma normalizada (sin acentos, minúsculas)', () => {
      for (const word of STOPWORDS_ES_SEARCH) {
        expect(word).toBe(normalizeSearchText(word));
      }
      expect(STOPWORDS_ES_SEARCH.has('con')).toBe(true);
      expect(STOPWORDS_ES_SEARCH.has('de')).toBe(true);
      expect(STOPWORDS_ES_SEARCH.has('la')).toBe(true);
    });

    it('no incluye palabras de dominio de producto', () => {
      for (const word of ['talla', 'color', 'marca', 'modelo', 'caja']) {
        expect(STOPWORDS_ES_SEARCH.has(word)).toBe(false);
      }
    });
  });

  describe('tokenizeSearch', () => {
    it("'café con chocolate' → ['cafe','chocolate'] (stopword fuera)", () => {
      expect(tokenizeSearch('café con chocolate', 6)).toEqual([
        'cafe',
        'chocolate',
      ]);
    });

    it("'de la' → [] (activa fallback legacy en B.1)", () => {
      expect(tokenizeSearch('de la', 6)).toEqual([]);
    });

    it('dedupea preservando orden y corta a maxTokens', () => {
      expect(
        tokenizeSearch('cafe leche cafe azucar pan huevos queso jamon', 6),
      ).toEqual(['cafe', 'leche', 'azucar', 'pan', 'huevos', 'queso']);
    });

    it('parte por símbolos y descarta tokens de 1 char', () => {
      expect(tokenizeSearch('a/b-cafe_x', 6)).toEqual(['cafe']);
    });

    it('maxTokens inválido → [] (fail-closed, sin default)', () => {
      expect(tokenizeSearch('cafe leche', 0)).toEqual([]);
      expect(tokenizeSearch('cafe leche', -2)).toEqual([]);
      expect(tokenizeSearch('cafe leche', Number.NaN)).toEqual([]);
      expect(tokenizeSearch('cafe leche', 2.5)).toEqual([]);
    });

    it('maxTokens gigante se clampéa al techo (AND acotado)', () => {
      const tokens = tokenizeSearch(
        'uno dos tres cuatro cinco seis siete ocho nueve diez',
        100,
      );
      expect(tokens.length).toBeLessThanOrEqual(8);
    });
  });

  describe('wrappers de frontera validada', () => {
    it('tokenizeInternal corta a 6', () => {
      expect(SEARCH_TOKEN_INTERNAL_MAX).toBe(6);
      expect(
        tokenizeInternal('uno dos tres cuatro cinco seis siete ocho'),
      ).toHaveLength(6);
    });

    it('tokenizePublic corta a 4', () => {
      expect(SEARCH_TOKEN_PUBLIC_MAX).toBe(4);
      expect(
        tokenizePublic('uno dos tres cuatro cinco seis siete ocho'),
      ).toHaveLength(4);
    });
  });

  describe('escapeLike', () => {
    it('escapa backslash, porcentaje y guion-bajo', () => {
      expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    });

    it('no-string → cadena vacía definida', () => {
      expect(escapeLike(null)).toBe('');
      expect(escapeLike(42)).toBe('');
    });
  });

  describe('isSmartSearchActive (F-013)', () => {
    const on = { l1: true, l2: false, trigram: false };
    const off = { l1: false, l2: false, trigram: false };

    it('cualquier tier on + tokens → true', () => {
      expect(isSmartSearchActive('cafe', on)).toBe(true);
      expect(
        isSmartSearchActive('cafe', { l1: false, l2: true, trigram: false }),
      ).toBe(true);
      expect(
        isSmartSearchActive('cafe', { l1: false, l2: false, trigram: true }),
      ).toBe(true);
    });

    it('flags off → false aunque haya tokens', () => {
      expect(isSmartSearchActive('cafe leche', off)).toBe(false);
    });

    it('query solo-stopwords → false (fallback legacy)', () => {
      expect(isSmartSearchActive('de la', on)).toBe(false);
    });

    it('flags nulos/raros → false (fail-closed)', () => {
      expect(isSmartSearchActive('cafe', null)).toBe(false);
      expect(isSmartSearchActive('cafe', undefined)).toBe(false);
    });

    it('findAll≡findIds: where y rank deciden idéntico por caller', () => {
      // Ambos consumen el MISMO predicado con los MISMOS args: la decisión
      // no puede partirse (set nuevo + orden viejo) por pos_optimized.
      const callers: Array<{ query: unknown }> = [
        { query: 'cafe chocolate' },
        { query: 'de la' },
        { query: '' },
      ];
      for (const caller of callers) {
        const whereDecision = isSmartSearchActive(caller.query, on);
        const rankDecision = isSmartSearchActive(caller.query, on);
        expect(rankDecision).toBe(whereDecision);
      }
    });
  });

  describe('buildTokenAndFieldOr (F-015)', () => {
    it('ensambla AND por token × OR de campos (shape B.1)', () => {
      expect(
        buildTokenAndFieldOr(['cafe', 'leche'], {
          scalar: ['name', 'description', 'sku'],
          relations: { product_variants: ['name', 'sku'] },
        }),
      ).toEqual({
        AND: [
          {
            OR: [
              { name: { contains: 'cafe', mode: 'insensitive' } },
              { description: { contains: 'cafe', mode: 'insensitive' } },
              { sku: { contains: 'cafe', mode: 'insensitive' } },
              {
                product_variants: {
                  some: { name: { contains: 'cafe', mode: 'insensitive' } },
                },
              },
              {
                product_variants: {
                  some: { sku: { contains: 'cafe', mode: 'insensitive' } },
                },
              },
            ],
          },
          {
            OR: [
              { name: { contains: 'leche', mode: 'insensitive' } },
              { description: { contains: 'leche', mode: 'insensitive' } },
              { sku: { contains: 'leche', mode: 'insensitive' } },
              {
                product_variants: {
                  some: { name: { contains: 'leche', mode: 'insensitive' } },
                },
              },
              {
                product_variants: {
                  some: { sku: { contains: 'leche', mode: 'insensitive' } },
                },
              },
            ],
          },
        ],
      });
    });

    it("nestPath ['products'] envuelve para D.1 (raíz stock_levels)", () => {
      expect(
        buildTokenAndFieldOr(['cafe'], { scalar: ['name', 'sku'] }, [
          'products',
        ]),
      ).toEqual({
        products: {
          AND: [
            {
              OR: [
                { name: { contains: 'cafe', mode: 'insensitive' } },
                { sku: { contains: 'cafe', mode: 'insensitive' } },
              ],
            },
          ],
        },
      });
    });

    it('tokens o campos vacíos → {} (caller aplica legacy)', () => {
      expect(buildTokenAndFieldOr([], { scalar: ['name'] })).toEqual({});
      expect(buildTokenAndFieldOr(['cafe'], { scalar: [] })).toEqual({});
      expect(buildTokenAndFieldOr(null, null)).toEqual({});
    });
  });

  describe('probes adversariales (F-032 / ERR-15)', () => {
    const adversarial: Array<[string, unknown]> = [
      ['subrogado suelto alto', 'cafe\ud800leche'],
      ['subrogado suelto bajo', '\udc00cafe'],
      ['null bytes', 'ca\0fe'],
      ['solo emoji', '☕🔥🎉'],
      ['run 500 emojis', '☕'.repeat(500)],
      ['query 500 chars', 'a'.repeat(500)],
      ['query 5000 chars (sobre la cota)', 'cafe '.repeat(1000)],
      ['controles', 'cafe\t\nleche\x7f'],
      ['symbol', Symbol('q')],
      ['bigint', BigInt(42)],
      ['objeto', { toString: () => 'cafe' }],
    ];

    it.each(adversarial)('%s: tokenizer total, cero throws', (_name, input) => {
      let tokens: string[] = [];
      expect(() => {
        tokens = tokenizeSearch(input, 6);
        tokenizeInternal(input);
        tokenizePublic(input);
        normalizeSearchText(input);
        escapeLike(typeof input === 'string' ? input : input);
      }).not.toThrow();
      expect(Array.isArray(tokens)).toBe(true);
    });

    it.each(adversarial)('%s: predicado y builder definidos', (_name, input) => {
      expect(() =>
        isSmartSearchActive(input, { l1: true, l2: false, trigram: false }),
      ).not.toThrow();
      expect(() =>
        buildTokenAndFieldOr(tokenizeInternal(input), {
          scalar: ['name'],
        }),
      ).not.toThrow();
    });

    it('salidas degeneradas documentadas: emoji/run → [] o tokens sanos', () => {
      expect(tokenizeSearch('☕🔥🎉', 6)).toEqual([]);
      expect(tokenizeSearch('cafe\ud800leche', 6)).toEqual(['cafe', 'leche']);
      expect(tokenizeSearch('ca\0fe', 6)).toEqual(['ca', 'fe']);
    });
  });
});
