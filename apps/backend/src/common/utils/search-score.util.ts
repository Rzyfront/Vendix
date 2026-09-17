/**
 * CP-pos-smart-search · A.2 — Scoring genérico, pesos compartidos y orquestación rank.
 *
 * F-014: el contrato vive acá — tokens sobre field-extractors del caller — y
 * cada dominio mapea sus campos sin importar producto. F-019: SEARCH_WEIGHTS +
 * SEARCH_SCORE_BONUSES + compareSearchRank son EL contrato B.2 (memoria) ⇄ C.3
 * (SQL): mismos números, mismo tiebreak. F-072: rankedIdsPage centraliza
 * scan-cap → rank → slice → hydrate → re-sort con delegates inyectados.
 * F-073: provider-free — funciones puras, cero imports de dominio (solo
 * ./search-text.util, mismo common/).
 *
 * Funciones totales never-throw salvo rankedIdsPage: los delegates hacen I/O y
 * sus rechazos propagan para que el servicio degrade (orderBy + warn + counter,
 * ADR-03); tragarlos acá vaciaría la grilla en silencio.
 */
import { normalizeSearchText } from './search-text.util';

/**
 * Claves de campo con peso. Son etiquetas de datos, no dependencias: el caller
 * declara qué campo es qué y common/ jamás importa su dominio.
 */
export type SearchWeightKey =
  | 'name'
  | 'sku'
  | 'barcode'
  | 'variantName'
  | 'variantSku'
  | 'description';

export interface SearchTierWeights {
  readonly exact: number;
  readonly word: number;
  readonly prefix: number;
  readonly contains: number;
}

/**
 * Contrato de pesos B.2 ⇄ C.3 (F-019). Rangos: exacto 100-120, palabra 15-40,
 * prefijo 10-25, contiene 5-12. Identidad (sku/barcode) > nombre > variantes >
 * descripción. C.3 traduce cada celda a un CASE WHEN con el mismo número;
 * cualquier cambio acá exige migrar el SQL y el fixture de paridad.
 */
export const SEARCH_WEIGHTS: Readonly<
  Record<SearchWeightKey, SearchTierWeights>
> = {
  name: { exact: 120, word: 40, prefix: 25, contains: 12 },
  sku: { exact: 110, word: 30, prefix: 20, contains: 10 },
  barcode: { exact: 110, word: 25, prefix: 15, contains: 8 },
  variantName: { exact: 105, word: 30, prefix: 18, contains: 8 },
  variantSku: { exact: 110, word: 30, prefix: 20, contains: 10 },
  description: { exact: 100, word: 15, prefix: 10, contains: 5 },
};

export interface SearchScoreBonuses {
  /** Todos los tokens matchearon en algún campo. */
  readonly fullCoverage: number;
  /** Todos los tokens matchearon dentro del campo primario (producto: name). */
  readonly allInPrimary: number;
  /** La query completa normalizada iguala un sku (dominio lo evalúa). */
  readonly skuExact: number;
  /** La query completa normalizada iguala un barcode (dominio lo evalúa). */
  readonly barcodeExact: number;
}

export const SEARCH_SCORE_BONUSES: SearchScoreBonuses = {
  fullCoverage: 15,
  allInPrimary: 25,
  skuExact: 20,
  barcodeExact: 30,
};

/** Un campo a scorar: clave de peso + valor crudo (se normaliza acá). */
export interface SearchScoreField {
  readonly key: SearchWeightKey;
  readonly value: string | null | undefined;
}

export interface ScoreTokensOptions {
  /**
   * Clave del campo primario: habilita el bonus all-in-primary. El dominio
   * decide cuál es (producto: 'name'); common/ no conoce campos de nadie.
   */
  readonly primaryKey?: SearchWeightKey | null;
}

export interface TokenScoreBreakdown {
  /** tokenScore + bonus que apliquen. */
  readonly score: number;
  /** Σ del mejor peso por token (el token matched suma una sola vez). */
  readonly tokenScore: number;
  /** Tokens distintos que matchearon en algún campo. */
  readonly coverage: number;
  readonly totalTokens: number;
  readonly fullCoverage: boolean;
  readonly allInPrimary: boolean;
}

const ZERO_BREAKDOWN: TokenScoreBreakdown = {
  score: 0,
  tokenScore: 0,
  coverage: 0,
  totalTokens: 0,
  fullCoverage: false,
  allInPrimary: false,
};

interface NormalizedField {
  readonly key: SearchWeightKey;
  readonly weights: SearchTierWeights;
  readonly text: string;
  readonly words: readonly string[];
}

type MatchTier = keyof SearchTierWeights;

function matchTier(
  token: string,
  text: string,
  words: readonly string[],
): MatchTier | null {
  if (text === token) return 'exact';
  if (words.includes(token)) return 'word';
  if (words.some((word) => word.length > token.length && word.startsWith(token)))
    return 'prefix';
  if (text.includes(token)) return 'contains';
  return null;
}

function isScoreField(value: unknown): value is SearchScoreField {
  if (typeof value !== 'object' || value === null) return false;
  const key = (value as { key?: unknown }).key;
  return (
    typeof key === 'string' &&
    (SEARCH_WEIGHTS as Record<string, SearchTierWeights | undefined>)[key] !==
      undefined
  );
}

/**
 * Scora tokens normalizados contra campos del caller. Por token toma el MEJOR
 * peso entre campos (max, no suma: el token matched cuenta una vez; la
 * amplitud se premia vía coverage). SQL-parity: Σ_token GREATEST(celdas) +
 * bonus — C.3 lo replica literal.
 *
 * Clave desconocida → campo ignorado (fail-closed, sin coverage). Total
 * never-throw: basura → breakdown en cero.
 */
export function scoreTokens(
  tokens: readonly string[] | null | undefined,
  fields: readonly SearchScoreField[] | null | undefined,
  options?: ScoreTokensOptions | null,
): TokenScoreBreakdown {
  try {
    const seen = new Set<string>();
    const cleanTokens: string[] = [];
    if (Array.isArray(tokens)) {
      for (const token of tokens) {
        const normalized = normalizeSearchText(token);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        cleanTokens.push(normalized);
      }
    }

    const cleanFields: NormalizedField[] = [];
    if (Array.isArray(fields)) {
      for (const field of fields) {
        if (!isScoreField(field)) continue;
        const text = normalizeSearchText(field.value);
        if (!text) continue;
        cleanFields.push({
          key: field.key,
          weights: SEARCH_WEIGHTS[field.key],
          text,
          words: text.split(' '),
        });
      }
    }

    if (cleanTokens.length === 0 || cleanFields.length === 0) {
      return { ...ZERO_BREAKDOWN, totalTokens: cleanTokens.length };
    }

    const primaryKey =
      typeof options?.primaryKey === 'string' &&
      (SEARCH_WEIGHTS as Record<string, SearchTierWeights | undefined>)[
        options.primaryKey
      ] !== undefined
        ? options.primaryKey
        : null;

    let tokenScore = 0;
    const matched = new Set<string>();
    const matchedInPrimary = new Set<string>();

    for (const token of cleanTokens) {
      let best = 0;
      for (const field of cleanFields) {
        const tier = matchTier(token, field.text, field.words);
        if (tier === null) continue;
        const weight = field.weights[tier];
        if (weight <= 0) continue;
        if (weight > best) best = weight;
        matched.add(token);
        if (primaryKey !== null && field.key === primaryKey) {
          matchedInPrimary.add(token);
        }
      }
      tokenScore += best;
    }

    const coverage = matched.size;
    const fullCoverage =
      cleanTokens.length > 0 && coverage === cleanTokens.length;
    const allInPrimary =
      primaryKey !== null &&
      cleanTokens.length > 0 &&
      matchedInPrimary.size === cleanTokens.length;

    return {
      score:
        tokenScore +
        (fullCoverage ? SEARCH_SCORE_BONUSES.fullCoverage : 0) +
        (allInPrimary ? SEARCH_SCORE_BONUSES.allInPrimary : 0),
      tokenScore,
      coverage,
      totalTokens: cleanTokens.length,
      fullCoverage,
      allInPrimary,
    };
  } catch {
    return { ...ZERO_BREAKDOWN };
  }
}

/**
 * Clave de orden total. El dominio la hidrata (score/coverage del motor +
 * featured/created_at/id de la fila); el comparador vive acá para que B.2, C.3
 * y D.x no reinventen el tiebreak.
 */
export interface SearchRankKey {
  readonly id: number;
  readonly score: number;
  readonly coverage: number;
  readonly featured: boolean;
  /** Epoch ms; no-finito se trata como 0. */
  readonly createdAt: number;
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Orden total: score → coverage → featured → created_at → id. Sin flips entre
 * páginas: a inputs iguales, mismo orden siempre (sort estable + id cierra).
 * id descendente, igual que resolveBestSellingPageIds. C.3 lo espeja en
 * ORDER BY score DESC, coverage DESC, featured DESC, created_at DESC, id DESC.
 * Null-safe: basura empata a cero, nunca lanza.
 */
export function compareSearchRank(
  a: SearchRankKey | null | undefined,
  b: SearchRankKey | null | undefined,
): number {
  try {
    const scoreA = toFiniteNumber(a?.score);
    const scoreB = toFiniteNumber(b?.score);
    if (scoreA !== scoreB) return scoreB - scoreA;

    const coverageA = toFiniteNumber(a?.coverage);
    const coverageB = toFiniteNumber(b?.coverage);
    if (coverageA !== coverageB) return coverageB - coverageA;

    const featuredA = a?.featured === true;
    const featuredB = b?.featured === true;
    if (featuredA !== featuredB) return featuredA ? -1 : 1;

    const createdA = toFiniteNumber(a?.createdAt);
    const createdB = toFiniteNumber(b?.createdAt);
    if (createdA !== createdB) return createdB - createdA;

    return toFiniteNumber(b?.id) - toFiniteNumber(a?.id);
  } catch {
    return 0;
  }
}

/**
 * Delegates de rankedIdsPage (F-072). El servicio inyecta su Prisma; la
 * orquestación no importa ningún dominio. `scan` usa el MISMO where del
 * listado (mismo conjunto); `hydrate` trae solo la página por ids.
 */
export interface RankedIdsPageDelegates<Where, Candidate, Hydrated> {
  /** Tope de filas a rankear en memoria; por encima → null (fail-open). */
  readonly scanCap: number;
  readonly scan: (where: Where, take: number) => Promise<readonly Candidate[]>;
  readonly score: (candidate: Candidate) => SearchRankKey;
  readonly hydrate: (
    where: Where,
    ids: readonly number[],
  ) => Promise<readonly Hydrated[]>;
  readonly getId: (row: Hydrated) => number;
}

export interface RankedIdsPageResult<Hydrated> {
  readonly rows: Hydrated[];
  readonly totalCandidates: number;
}

function clampPageNumber(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : fallback;
  return parsed >= 1 ? parsed : 1;
}

/**
 * Orquestación reusable scan-cap → rank → slice → hydrate → re-sort.
 *
 * Devuelve `null` sobre el cap para que el caller degrade al orderBy barato
 * (misma señal que resolveBestSellingPageIds). Página vacía válida → rows [].
 * page/limit inválidos se clampean (≥1); el clamp a @Max vive en el DTO de
 * cada superficie, no acá.
 *
 * Errores de delegates/score propagan: el servicio los degrada con warn +
 * counter (ADR-03). Nunca retorna filas en otro orden que el rankeado.
 */
export async function rankedIdsPage<Where, Candidate, Hydrated>(
  where: Where,
  page: number,
  limit: number,
  delegates: RankedIdsPageDelegates<Where, Candidate, Hydrated>,
): Promise<RankedIdsPageResult<Hydrated> | null> {
  const rawCap = delegates.scanCap;
  const scanCap =
    typeof rawCap === 'number' && Number.isFinite(rawCap)
      ? Math.max(0, Math.floor(rawCap))
      : 0;
  const safePage = clampPageNumber(page, 1);
  const safeLimit = clampPageNumber(limit, 10);
  const skip = (safePage - 1) * safeLimit;

  const scanned = await delegates.scan(where, scanCap + 1);
  const candidates: readonly Candidate[] = Array.isArray(scanned) ? scanned : [];
  if (candidates.length > scanCap) return null;

  const ranked = candidates
    .map((candidate) => ({ candidate, key: delegates.score(candidate) }))
    .sort((left, right) => compareSearchRank(left.key, right.key));

  const pageIds = ranked
    .slice(skip, skip + safeLimit)
    .map((entry) => entry.key?.id)
    .filter(
      (id): id is number => typeof id === 'number' && Number.isFinite(id),
    );
  if (pageIds.length === 0) {
    return { rows: [], totalCandidates: candidates.length };
  }

  const hydrated = await delegates.hydrate(where, pageIds);
  const rows: Hydrated[] = Array.isArray(hydrated) ? [...hydrated] : [];
  const position = new Map<number, number>(
    pageIds.map((id, index) => [id, index]),
  );
  rows.sort(
    (left, right) =>
      (position.get(delegates.getId(left)) ?? Number.MAX_SAFE_INTEGER) -
      (position.get(delegates.getId(right)) ?? Number.MAX_SAFE_INTEGER),
  );
  return { rows, totalCandidates: candidates.length };
}
