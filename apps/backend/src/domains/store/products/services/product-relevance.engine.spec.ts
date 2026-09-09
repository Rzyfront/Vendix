import { ProductRelevanceEngine } from './product-relevance.engine';

describe('ProductRelevanceEngine', () => {
  describe('normalizeText', () => {
    it('debe remover tildes, diacríticos y pasar a minúsculas', () => {
      expect(ProductRelevanceEngine.normalizeText('VÁLVULA')).toBe('valvula');
      expect(ProductRelevanceEngine.normalizeText('Camión de Carga')).toBe(
        'camion de carga',
      );
      expect(ProductRelevanceEngine.normalizeText(null)).toBe('');
      expect(ProductRelevanceEngine.normalizeText(undefined)).toBe('');
    });
  });

  describe('tokenize and stop words', () => {
    it('debe filtrar stop words en español como "de", "la", "para", "con"', () => {
      const tokens = ProductRelevanceEngine.tokenize('válvulas de tvs');
      expect(tokens.map((t) => t.token)).toEqual(['valvulas', 'tvs']);
    });

    it('debe conservar las palabras si todas son stop words', () => {
      const tokens = ProductRelevanceEngine.tokenize('de');
      expect(tokens.map((t) => t.token)).toEqual(['de']);
    });
  });

  describe('expandStems', () => {
    it('debe expandir plurales en -s a singular', () => {
      const stems = ProductRelevanceEngine.expandStems('valvulas');
      expect(stems).toContain('valvulas');
      expect(stems).toContain('valvula');
    });

    it('debe expandir plurales en -es a singular', () => {
      const stems = ProductRelevanceEngine.expandStems('motores');
      expect(stems).toContain('motores');
      expect(stems).toContain('motor');
    });

    it('debe preservar acrónimos y palabras cortas (<= 3 chars)', () => {
      const stems = ProductRelevanceEngine.expandStems('tvs');
      expect(stems).toEqual(['tvs']);
    });
  });

  describe('scoreProduct and rankProducts (Caso Real del Cliente)', () => {
    const productA = {
      id: 1,
      name: 'Válvula Escape TVS Apache',
      sku: 'VALV-TVS-01',
      barcode: '770123456789',
      description: 'Válvula de escape original para motocicleta TVS Apache',
      stock_quantity: 5,
      brands: { name: 'TVS' },
      product_categories: [{ categories: { name: 'Válvulas' } }],
      product_variants: [],
      created_at: new Date('2026-01-01'),
    };

    const productB = {
      id: 2,
      name: 'Llanta Delantera TVS',
      sku: 'LLAN-TVS-01',
      barcode: '770987654321',
      description: 'Llanta de repuesto marca TVS',
      stock_quantity: 10,
      brands: { name: 'TVS' },
      product_categories: [{ categories: { name: 'Llantas' } }],
      product_variants: [],
      created_at: new Date('2026-06-01'),
    };

    const productC = {
      id: 3,
      name: 'Válvula Universal Moto',
      sku: 'VALV-GEN-01',
      barcode: '770555555555',
      description: 'Válvula universal para moto',
      stock_quantity: 2,
      brands: { name: 'Genérico' },
      product_categories: [{ categories: { name: 'Válvulas' } }],
      product_variants: [],
      created_at: new Date('2026-03-01'),
    };

    const productD = {
      id: 4,
      name: 'Aceite 4T 10W40',
      sku: 'ACE-MOT-01',
      barcode: '770444444444',
      description: 'Aceite de motor sintetico',
      stock_quantity: 15,
      brands: { name: 'Motul' },
      product_categories: [{ categories: { name: 'Lubricantes' } }],
      product_variants: [],
      created_at: new Date('2026-05-01'),
    };

    const catalog = [productB, productD, productC, productA];

    it('debe posicionar "Válvula Escape TVS" en el puesto #1 al buscar "válvulas de tvs"', () => {
      const results = ProductRelevanceEngine.rankProducts(
        catalog,
        'válvulas de tvs',
      );

      expect(results.length).toBe(3); // A, B y C coinciden con algún término, D no
      expect(results[0].product.id).toBe(productA.id);
      expect(results[0].product.name).toBe('Válvula Escape TVS Apache');

      // ProductA satisface ambos términos y debe tener puntaje significativamente superior
      expect(results[0].relevance_score).toBeGreaterThan(
        results[1].relevance_score,
      );
      expect(results[0].score_breakdown?.allTermsMatchedBonus).toBe(50);
    });

    it('debe encontrar el producto cuando se busca en plural ("válvulas") aunque el nombre esté en singular ("Válvula")', () => {
      const results = ProductRelevanceEngine.rankProducts(catalog, 'válvulas');
      const ids = results.map((r) => r.product.id);

      expect(ids).toContain(productA.id);
      expect(ids).toContain(productC.id);
      expect(ids).not.toContain(productB.id); // no tiene válvula
    });

    it('debe encontrar todos los productos de la marca al buscar "tvs"', () => {
      const results = ProductRelevanceEngine.rankProducts(catalog, 'tvs');
      const ids = results.map((r) => r.product.id);

      expect(ids).toContain(productA.id);
      expect(ids).toContain(productB.id);
      expect(ids).not.toContain(productC.id);
      expect(ids).not.toContain(productD.id);
    });

    it('debe priorizar coincidencia exacta de SKU sobre coincidencias parciales de texto', () => {
      const results = ProductRelevanceEngine.rankProducts(
        catalog,
        'VALV-GEN-01',
      );
      expect(results[0].product.id).toBe(productC.id);
      expect(results[0].score_breakdown?.exactCodeMatch).toBeGreaterThanOrEqual(
        90,
      );
    });

    it('debe otorgar boost por stock disponible', () => {
      const inStockProduct = {
        id: 10,
        name: 'Filtro de Aire',
        stock_quantity: 8,
        product_variants: [],
      };
      const outOfStockProduct = {
        id: 11,
        name: 'Filtro de Aire',
        stock_quantity: 0,
        product_variants: [],
      };

      const results = ProductRelevanceEngine.rankProducts(
        [outOfStockProduct, inStockProduct],
        'filtro de aire',
      );

      expect(results[0].product.id).toBe(10);
      expect(results[0].score_breakdown?.stockBoost).toBe(5);
      expect(results[1].score_breakdown?.stockBoost).toBe(0);
    });
  });

  describe('buildPrismaSearchFilter', () => {
    it('debe generar una cláusula OR con campos de producto, marcas, categorías y variantes', () => {
      const filter =
        ProductRelevanceEngine.buildPrismaSearchFilter('válvulas tvs');
      expect(filter).not.toBeNull();
      expect(filter?.OR).toBeDefined();
      expect(filter?.OR?.length).toBeGreaterThan(0);
    });

    it('debe retornar null si la búsqueda está vacía o son puros espacios', () => {
      expect(ProductRelevanceEngine.buildPrismaSearchFilter('')).toBeNull();
      expect(ProductRelevanceEngine.buildPrismaSearchFilter('   ')).toBeNull();
    });
  });
});
