/**
 * CP-pos-smart-search · A.2 — Scoring de relevancia de producto.
 *
 * Mapea la fila producto+variantes (subconjunto de lo que findAll hidrata:
 * name/description/sku/barcode/is_featured/created_at + name/sku/barcode por
 * variante) al contrato genérico de common/. Sin campos de stock a propósito:
 * vendible ≠ disponible — las variantes suman por texto aunque tengan cero
 * existencias (skill vendix-product-variants); el stock filtra disponibilidad
 * en el POS, jamás relevancia.
 *
 * Two-tier (ADR-03): tier-1 (campos del producto + bonus de identidad) rankea
 * el scan; el tier de variantes solo re-scora el top-K. Provider-free:
 * funciones puras, importan common/ (permitido) y nada de dominio.
 */
import { normalizeSearchText } from '../../../../common/utils/search-text.util';
import {
  SEARCH_SCORE_BONUSES,
  compareSearchRank,
  scoreTokens,
  type SearchRankKey,
  type SearchScoreField,
  type SearchWeightKey,
} from '../../../../common/utils/search-score.util';

/** Campo primario del producto: habilita el bonus todos-en-nombre. */
export const PRODUCT_SEARCH_PRIMARY_KEY: SearchWeightKey = 'name';

/**
 * Two-tier: el re-score de variantes solo corre sobre el top-K de tier-1. 200
 * cubre varias páginas de scroll del POS sin pagar variantes sobre el scan
 * entero (cap 2000); B.2 puede afinarlo con p95 real.
 */
export const PRODUCT_SEARCH_VARIANT_RESCORE_TOP_K = 200;

/**
 * Variante tal como la hidrata findAll (select name/sku/barcode). Sin stock:
 * la relevancia no filtra por existencias.
 */
export interface ProductSearchVariantRow {
  readonly id: number;
  readonly name: string | null;
  readonly sku: string | null;
  readonly barcode: string | null;
}

/** Subconjunto de producto que el scoring necesita. */
export interface ProductSearchRow {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly sku: string | null;
  readonly barcode: string | null;
  readonly is_featured: boolean | null;
  readonly created_at: Date | string | number | null;
  readonly product_variants?: readonly ProductSearchVariantRow[] | null;
}

export interface ProductSearchScore {
  /** Total: tokens + bonus de cobertura/primario + identidad + variantes. */
  readonly score: number;
  /** Σ token de tier-1, sin bonus. */
  readonly tokenScore: number;
  readonly coverage: number;
  readonly identityBonus: number;
  readonly variantScore: number;
}

function isRow(value: unknown): value is ProductSearchRow {
  return typeof value === 'object' && value !== null;
}

/** created_at → epoch ms defensivo (Date|string|number|null → finito). */
export function toSearchEpochMs(
  value: Date | string | number | null | undefined,
): number {
  try {
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isFinite(time) ? time : 0;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string' && value.length > 0) {
      const time = new Date(value).getTime();
      return Number.isFinite(time) ? time : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

/** Tier-1: campos del producto. Basura → []. */
export function extractProductSearchFields(
  row: ProductSearchRow | null | undefined,
): SearchScoreField[] {
  try {
    if (!isRow(row)) return [];
    return [
      { key: 'name', value: row.name },
      { key: 'description', value: row.description },
      { key: 'sku', value: row.sku },
      { key: 'barcode', value: row.barcode },
    ];
  } catch {
    return [];
  }
}

/** Tier-2: campos de una variante. Basura → []. */
export function extractVariantSearchFields(
  variant: ProductSearchVariantRow | null | undefined,
): SearchScoreField[] {
  try {
    if (typeof variant !== 'object' || variant === null) return [];
    return [
      { key: 'variantName', value: variant.name },
      { key: 'variantSku', value: variant.sku },
      { key: 'barcode', value: variant.barcode },
    ];
  } catch {
    return [];
  }
}

/**
 * Bonus de identidad: la query completa normalizada iguala un sku (+20) o un
 * barcode (+30) del producto o de cualquier variante. Igualdad sobre la forma
 * normalizada — 'CAFE-001' casa con 'cafe 001' — no sobre tokens sueltos.
 * Never-throw: basura → 0.
 */
export function scoreIdentityBonus(
  rawQuery: unknown,
  row: ProductSearchRow | null | undefined,
): number {
  try {
    const query = normalizeSearchText(rawQuery);
    if (!query || !isRow(row)) return 0;
    const variants = Array.isArray(row.product_variants)
      ? row.product_variants
      : [];
    const skus: string[] = [];
    const barcodes: string[] = [];
    const collect = (sku: unknown, barcode: unknown): void => {
      const normalizedSku = normalizeSearchText(sku);
      if (normalizedSku) skus.push(normalizedSku);
      const normalizedBarcode = normalizeSearchText(barcode);
      if (normalizedBarcode) barcodes.push(normalizedBarcode);
    };
    collect(row.sku, row.barcode);
    for (const variant of variants) {
      if (typeof variant !== 'object' || variant === null) continue;
      collect(variant.sku, variant.barcode);
    }
    let bonus = 0;
    if (skus.includes(query)) bonus += SEARCH_SCORE_BONUSES.skuExact;
    if (barcodes.includes(query)) bonus += SEARCH_SCORE_BONUSES.barcodeExact;
    return bonus;
  } catch {
    return 0;
  }
}

/**
 * Tier-1: campos del producto + bonus de cobertura/primario + identidad. Sin
 * variantes. Never-throw: basura → score cero.
 */
export function scoreProductTier1(
  tokens: readonly string[] | null | undefined,
  row: ProductSearchRow | null | undefined,
  rawQuery?: unknown,
): ProductSearchScore {
  try {
    const breakdown = scoreTokens(tokens, extractProductSearchFields(row), {
      primaryKey: PRODUCT_SEARCH_PRIMARY_KEY,
    });
    const identityBonus = scoreIdentityBonus(rawQuery, row);
    return {
      score: breakdown.score + identityBonus,
      tokenScore: breakdown.tokenScore,
      coverage: breakdown.coverage,
      identityBonus,
      variantScore: 0,
    };
  } catch {
    return {
      score: 0,
      tokenScore: 0,
      coverage: 0,
      identityBonus: 0,
      variantScore: 0,
    };
  }
}

/**
 * Tier-2: la mejor variante suma (max sobre variantes, token-score sin bonus;
 * los bonus de cobertura viven en tier-1). Sin filtro de stock por diseño.
 * Never-throw: basura → 0.
 */
export function scoreVariantTier(
  tokens: readonly string[] | null | undefined,
  variants: readonly ProductSearchVariantRow[] | null | undefined,
): number {
  try {
    if (!Array.isArray(variants) || variants.length === 0) return 0;
    let best = 0;
    for (const variant of variants) {
      const fields = extractVariantSearchFields(variant);
      if (fields.length === 0) continue;
      const { tokenScore } = scoreTokens(tokens, fields);
      if (tokenScore > best) best = tokenScore;
    }
    return best;
  } catch {
    return 0;
  }
}

function toRowId(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : 0;
}

/**
 * Score completo single-pass: tier-1 + tier-2 de variantes → SearchRankKey
 * lista para compareSearchRank. Never-throw: basura → clave en cero.
 */
export function scoreProductSearchRow(
  tokens: readonly string[] | null | undefined,
  row: ProductSearchRow | null | undefined,
  rawQuery?: unknown,
): SearchRankKey {
  try {
    const tier1 = scoreProductTier1(tokens, row, rawQuery);
    const variantScore = scoreVariantTier(
      tokens,
      isRow(row) ? row.product_variants : null,
    );
    return {
      id: isRow(row) ? toRowId(row.id) : 0,
      score: tier1.score + variantScore,
      coverage: tier1.coverage,
      featured: isRow(row) ? row.is_featured === true : false,
      createdAt: isRow(row) ? toSearchEpochMs(row.created_at) : 0,
    };
  } catch {
    return { id: 0, score: 0, coverage: 0, featured: false, createdAt: 0 };
  }
}

/**
 * Ordena filas por relevancia (single-pass). No muta el input. Never-throw:
 * basura → [].
 */
export function rankProductSearchRows(
  tokens: readonly string[] | null | undefined,
  rows: readonly ProductSearchRow[] | null | undefined,
  rawQuery?: unknown,
): ProductSearchRow[] {
  try {
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(isRow)
      .map((row) => ({ row, key: scoreProductSearchRow(tokens, row, rawQuery) }))
      .sort((left, right) => compareSearchRank(left.key, right.key))
      .map((entry) => entry.row);
  } catch {
    return [];
  }
}

function clampTopK(value: unknown): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.floor(value) >= 1
    ? Math.floor(value)
    : PRODUCT_SEARCH_VARIANT_RESCORE_TOP_K;
}

/**
 * Two-tier (ADR-03): tier-1 sobre todo el scan, variantes solo para el top-K,
 * re-sort de la cabeza; la cola conserva orden de tier-1. Con K ≥ n equivale
 * al single-pass. B.2 lo usa cuando el scan no trae variantes hidratadas.
 */
export function rankProductSearchRowsTwoTier(
  tokens: readonly string[] | null | undefined,
  rows: readonly ProductSearchRow[] | null | undefined,
  rawQuery?: unknown,
  topK?: number,
): ProductSearchRow[] {
  try {
    if (!Array.isArray(rows)) return [];
    const limit = clampTopK(topK);
    const scored = rows.filter(isRow).map((row) => {
      const tier1 = scoreProductTier1(tokens, row, rawQuery);
      return {
        row,
        key: {
          id: toRowId(row.id),
          score: tier1.score,
          coverage: tier1.coverage,
          featured: row.is_featured === true,
          createdAt: toSearchEpochMs(row.created_at),
        } satisfies SearchRankKey,
      };
    });
    scored.sort((left, right) => compareSearchRank(left.key, right.key));
    const head = scored.slice(0, limit).map((entry) => ({
      row: entry.row,
      key: {
        ...entry.key,
        score:
          entry.key.score +
          scoreVariantTier(tokens, entry.row.product_variants),
      } satisfies SearchRankKey,
    }));
    head.sort((left, right) => compareSearchRank(left.key, right.key));
    return [...head, ...scored.slice(limit)].map((entry) => entry.row);
  } catch {
    return [];
  }
}
