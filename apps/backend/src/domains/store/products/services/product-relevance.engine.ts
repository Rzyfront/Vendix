import { Prisma } from '@prisma/client';

export interface SearchTokenInfo {
  token: string;
  stems: string[];
}

export interface RelevanceScoreBreakdown {
  exactCodeMatch: number;
  codePrefixMatch: number;
  nameExactMatch: number;
  nameWordMatch: number;
  namePrefixMatch: number;
  nameSubstringMatch: number;
  brandMatch: number;
  categoryMatch: number;
  variantMatch: number;
  descriptionMatch: number;
  allTermsMatchedBonus: number;
  termsCoverageBonus: number;
  stockBoost: number;
}

export interface ScoredProduct<T = any> {
  product: T;
  relevance_score: number;
  score_breakdown?: RelevanceScoreBreakdown;
  matched_tokens_count: number;
}

export class ProductRelevanceEngine {
  /**
   * Conectores y palabras vacías en español que no aportan intención
   * de búsqueda cuando van acompañados de términos sustantivos.
   */
  public static readonly SPANISH_STOP_WORDS = new Set<string>([
    'de',
    'del',
    'la',
    'las',
    'el',
    'los',
    'en',
    'para',
    'por',
    'con',
    'y',
    'e',
    'o',
    'u',
    'un',
    'una',
    'unos',
    'unas',
    'a',
    'al',
    'que',
    'su',
    'sus',
    'se',
    'lo',
    'les',
    'sin',
    'sobre',
    'tras',
  ]);

  /**
   * Normaliza una cadena removiendo tildes, diacríticos y caracteres
   * especiales, convirtiendo a minúsculas para comparaciones uniformes.
   */
  public static normalizeText(text: string | null | undefined): string {
    if (!text) return '';
    return text
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Genera variantes morfológicas básicas (singular/plural en español)
   * para un token dado, evitando recortar siglas o acrónimos cortos (<= 3 caracteres).
   */
  public static expandStems(token: string): string[] {
    const stems = new Set<string>([token]);
    const len = token.length;

    // Palabras muy cortas (ej. 'tvs', 'ps5', 'sol', 'gas') se preservan intactas
    if (len <= 3) {
      return Array.from(stems);
    }

    // Reglas comunes de pluralización en español
    if (token.endsWith('es')) {
      // motores -> motor, balones -> balon, luces -> luz
      stems.add(token.slice(0, -2));
      stems.add(token.slice(0, -1)); // por si acaso terminaba en 'e' + 's'
    } else if (token.endsWith('s')) {
      // valvulas -> valvula, camisetas -> camiseta
      stems.add(token.slice(0, -1));
    } else {
      // Singular -> agregar plurales posibles
      stems.add(`${token}s`);
      stems.add(`${token}es`);
    }

    return Array.from(stems);
  }

  /**
   * Tokeniza una consulta de búsqueda: normaliza, extrae palabras,
   * descarta stop words y calcula sus stems.
   */
  public static tokenize(query: string): SearchTokenInfo[] {
    const normalized = this.normalizeText(query);
    if (!normalized) return [];

    // Separar por cualquier secuencia de caracteres no alfanuméricos
    const rawWords = normalized.split(/[^a-z0-9]+/i).filter(Boolean);
    if (rawWords.length === 0) return [];

    // Filtrar stop words
    let filteredWords = rawWords.filter(
      (word) => !this.SPANISH_STOP_WORDS.has(word),
    );

    // Si todas eran stop words (ej. el usuario buscó solo "de"), conservamos las originales
    if (filteredWords.length === 0) {
      filteredWords = rawWords;
    }

    return filteredWords.map((word) => ({
      token: word,
      stems: this.expandStems(word),
    }));
  }

  /**
   * Construye una cláusula Prisma OR inclusiva sobre múltiples entidades
   * (producto, marca, categoría, variantes) para recuperar candidatos.
   */
  public static buildPrismaSearchFilter(
    search: string,
  ): Prisma.productsWhereInput | null {
    const tokenInfos = this.tokenize(search);
    if (tokenInfos.length === 0) {
      return null;
    }

    // Colección de todos los términos a buscar (tokens + stems)
    const termsToMatch = new Set<string>();
    for (const info of tokenInfos) {
      termsToMatch.add(info.token);
      for (const stem of info.stems) {
        if (stem.length >= 2) {
          termsToMatch.add(stem);
        }
      }
    }

    // También incluimos la frase original normalizada completa si tiene múltiples palabras
    const fullNormalized = this.normalizeText(search);
    if (fullNormalized && tokenInfos.length > 1) {
      termsToMatch.add(fullNormalized);
    }

    const orClauses: Prisma.productsWhereInput[] = [];

    for (const term of termsToMatch) {
      orClauses.push(
        { name: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
        { barcode: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { brands: { name: { contains: term, mode: 'insensitive' } } },
        {
          product_categories: {
            some: {
              categories: {
                name: { contains: term, mode: 'insensitive' },
              },
            },
          },
        },
        {
          product_variants: {
            some: {
              OR: [
                { sku: { contains: term, mode: 'insensitive' } },
                { barcode: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
              ],
            },
          },
        },
      );
    }

    return orClauses.length > 0 ? { OR: orClauses } : null;
  }

  /**
   * Evalúa un producto contra la consulta tokenizada y calcula
   * su puntaje de relevancia multifactorial.
   */
  public static scoreProduct(
    product: any,
    rawQuery: string,
    tokenInfos: SearchTokenInfo[],
  ): {
    score: number;
    breakdown: RelevanceScoreBreakdown;
    matchedTokensCount: number;
  } {
    const breakdown: RelevanceScoreBreakdown = {
      exactCodeMatch: 0,
      codePrefixMatch: 0,
      nameExactMatch: 0,
      nameWordMatch: 0,
      namePrefixMatch: 0,
      nameSubstringMatch: 0,
      brandMatch: 0,
      categoryMatch: 0,
      variantMatch: 0,
      descriptionMatch: 0,
      allTermsMatchedBonus: 0,
      termsCoverageBonus: 0,
      stockBoost: 0,
    };

    if (!product || tokenInfos.length === 0) {
      return { score: 0, breakdown, matchedTokensCount: 0 };
    }

    const normalizedQuery = this.normalizeText(rawQuery);
    const prodName = this.normalizeText(product.name);
    const prodSku = this.normalizeText(product.sku);
    const prodBarcode = this.normalizeText(product.barcode);
    const prodDesc = this.normalizeText(product.description);
    const brandName = this.normalizeText(product.brands?.name);

    // Nombres de categorías vinculadas
    const categoryNames: string[] = (product.product_categories || [])
      .map((pc: any) => this.normalizeText(pc.categories?.name || pc.name))
      .filter(Boolean);

    // Variantes (SKUs, barcodes, nombres)
    const variantSkus: string[] = [];
    const variantBarcodes: string[] = [];
    const variantNames: string[] = [];

    if (Array.isArray(product.product_variants)) {
      for (const v of product.product_variants) {
        if (v.sku) variantSkus.push(this.normalizeText(v.sku));
        if (v.barcode) variantBarcodes.push(this.normalizeText(v.barcode));
        if (v.name) variantNames.push(this.normalizeText(v.name));
      }
    }

    // ─── 1. Coincidencias de la Frase Completa ───────────────────────
    if (normalizedQuery) {
      // Coincidencia exacta de código (SKU / Barcode)
      if (
        (prodSku && prodSku === normalizedQuery) ||
        (prodBarcode && prodBarcode === normalizedQuery) ||
        variantSkus.includes(normalizedQuery) ||
        variantBarcodes.includes(normalizedQuery)
      ) {
        breakdown.exactCodeMatch += 150;
      } else if (
        (prodSku && prodSku.startsWith(normalizedQuery)) ||
        (prodBarcode && prodBarcode.startsWith(normalizedQuery))
      ) {
        breakdown.codePrefixMatch += 40;
      }

      // Coincidencia exacta o frase completa en Nombre
      if (prodName === normalizedQuery) {
        breakdown.nameExactMatch += 100;
      } else if (prodName.includes(normalizedQuery)) {
        breakdown.nameSubstringMatch += 50;
      }
    }

    // ─── 2. Coincidencias por Token Individual ───────────────────────
    const matchedTokenSet = new Set<string>();
    const prodNameWords = prodName.split(/\s+/).filter(Boolean);

    for (const info of tokenInfos) {
      const candidates = [info.token, ...info.stems];
      let tokenMatched = false;

      for (const term of candidates) {
        // A. Código exacto o prefijo
        if (prodSku === term || prodBarcode === term) {
          breakdown.exactCodeMatch = Math.max(breakdown.exactCodeMatch, 90);
          tokenMatched = true;
        } else if (prodSku.startsWith(term) || prodBarcode.startsWith(term)) {
          breakdown.codePrefixMatch = Math.max(breakdown.codePrefixMatch, 25);
          tokenMatched = true;
        }

        // B. Variantes
        if (variantSkus.includes(term) || variantBarcodes.includes(term)) {
          breakdown.variantMatch = Math.max(breakdown.variantMatch, 70);
          tokenMatched = true;
        } else if (variantNames.some((vn) => vn.includes(term))) {
          breakdown.variantMatch += 15;
          tokenMatched = true;
        }

        // C. Nombre del producto
        // Palabra exacta en nombre (ej. 'valvula' en 'valvula tvs apache')
        if (prodNameWords.includes(term)) {
          breakdown.nameWordMatch += 40;
          tokenMatched = true;
        } else if (prodNameWords.some((w) => w.startsWith(term))) {
          breakdown.namePrefixMatch += 25;
          tokenMatched = true;
        } else if (prodName.includes(term)) {
          breakdown.nameSubstringMatch += 15;
          tokenMatched = true;
        }

        // D. Marca
        if (brandName) {
          if (brandName === term) {
            breakdown.brandMatch += 35;
            tokenMatched = true;
          } else if (brandName.includes(term)) {
            breakdown.brandMatch += 25;
            tokenMatched = true;
          }
        }

        // E. Categoría
        if (categoryNames.some((c) => c === term || c.includes(term))) {
          breakdown.categoryMatch += 20;
          tokenMatched = true;
        }

        // F. Descripción
        if (prodDesc && prodDesc.includes(term)) {
          breakdown.descriptionMatch += 5;
          tokenMatched = true;
        }

        if (tokenMatched) break;
      }

      if (tokenMatched) {
        matchedTokenSet.add(info.token);
      }
    }

    const matchedTokensCount = matchedTokenSet.size;
    const totalTokensCount = tokenInfos.length;

    // ─── 3. Bonificación Multi-Término (Caso decisivo del cliente) ────
    if (totalTokensCount > 1 && matchedTokensCount > 0) {
      // Cobertura porcentual de los términos de la consulta
      const coverageRatio = matchedTokensCount / totalTokensCount;
      breakdown.termsCoverageBonus = Math.round(coverageRatio * 40);

      // Si el producto satisface TODOS los términos de la búsqueda (ej. 'válvula' y 'tvs'):
      // recibe una gran bonificación que lo posiciona por encima de productos parciales.
      if (matchedTokensCount === totalTokensCount) {
        breakdown.allTermsMatchedBonus = 50;
      }
    }

    // ─── 4. Desempate por Stock Disponible ───────────────────────────
    const hasAnyMatch =
      matchedTokensCount > 0 ||
      breakdown.exactCodeMatch > 0 ||
      breakdown.nameExactMatch > 0 ||
      breakdown.nameSubstringMatch > 0;

    if (!hasAnyMatch) {
      return { score: 0, breakdown, matchedTokensCount: 0 };
    }

    const hasStock =
      (product.stock_quantity != null && product.stock_quantity > 0) ||
      (Array.isArray(product.stock_levels) &&
        product.stock_levels.some(
          (sl: any) => (sl.quantity_available || 0) > 0,
        ));

    if (hasStock) {
      breakdown.stockBoost = 5;
    }

    const totalScore =
      breakdown.exactCodeMatch +
      breakdown.codePrefixMatch +
      breakdown.nameExactMatch +
      breakdown.nameWordMatch +
      breakdown.namePrefixMatch +
      breakdown.nameSubstringMatch +
      breakdown.brandMatch +
      breakdown.categoryMatch +
      breakdown.variantMatch +
      breakdown.descriptionMatch +
      breakdown.allTermsMatchedBonus +
      breakdown.termsCoverageBonus +
      breakdown.stockBoost;

    return {
      score: totalScore,
      breakdown,
      matchedTokensCount,
    };
  }

  /**
   * Ordena un arreglo de productos por relevancia decreciente según la consulta.
   */
  public static rankProducts<T = any>(
    products: T[],
    search: string,
  ): ScoredProduct<T>[] {
    if (!products || products.length === 0) return [];
    if (!search || !search.trim()) {
      return products.map((p) => ({
        product: p,
        relevance_score: 0,
        matched_tokens_count: 0,
      }));
    }

    const tokenInfos = this.tokenize(search);
    const scored: ScoredProduct<T>[] = [];

    for (const product of products) {
      const { score, breakdown, matchedTokensCount } = this.scoreProduct(
        product,
        search,
        tokenInfos,
      );

      // Solo conservamos productos que tengan alguna coincidencia (score > 0)
      if (score > 0) {
        // Inyectar relevance_score en el producto mismo para facilidad de consumo
        (product as any).relevance_score = score;
        scored.push({
          product,
          relevance_score: score,
          score_breakdown: breakdown,
          matched_tokens_count: matchedTokensCount,
        });
      }
    }

    // Ordenamiento:
    // 1. Mayor puntaje de relevancia (descendente)
    // 2. Mayor cantidad de tokens coincidentes (descendente)
    // 3. Stock disponible (descendente)
    // 4. Fecha de creación (más recientes primero)
    scored.sort((a, b) => {
      if (b.relevance_score !== a.relevance_score) {
        return b.relevance_score - a.relevance_score;
      }
      if (b.matched_tokens_count !== a.matched_tokens_count) {
        return b.matched_tokens_count - a.matched_tokens_count;
      }
      const stockA = (a.product as any).stock_quantity || 0;
      const stockB = (b.product as any).stock_quantity || 0;
      if (stockB !== stockA) {
        return stockB - stockA;
      }
      const dateA = new Date((a.product as any).created_at || 0).getTime();
      const dateB = new Date((b.product as any).created_at || 0).getTime();
      return dateB - dateA;
    });

    return scored;
  }
}
