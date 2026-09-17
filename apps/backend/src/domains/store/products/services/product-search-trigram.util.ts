/**
 * CP-pos-smart-search · C.3 — Builders puros del path trigram (Fase B).
 *
 * Genera el SQL parametrizado de `searchIdsRanked`: recall AND×OR sobre la
 * expresión canónica `immutable_unaccent(lower(col))` (idéntica al GIN de
 * C.2, F-026) + scoring CASE que espeja SEARCH_WEIGHTS/SEARCH_SCORE_BONUSES
 * de A.2 (F-019) + COUNT twin con predicados byte-idénticos (F-029).
 *
 * Puro a propósito (mismo patrón que A.1/A.2): sin Nest, sin Prisma, sin I/O.
 * El servicio aporta store_id fail-closed (F-004), timeout/slow-log (F-070) y
 * el `$queryRawUnsafe` con estos params. Cero `${}` de input en el SQL: todo
 * valor viaja en `params` como $1..$n (F-030); cada token LIKE-escapado con
 * `escapeLike` + `ESCAPE '\'` explícito (F-080).
 *
 * Paridad conjunto L1 (F-028/DB-17): el recall cubre name/sku/description +
 * variants(name/sku) — barcode NO entra al recall (igual que
 * POS_PRODUCT_SEARCH_FIELDS de B.1; el barcode solo scora + bonus identidad).
 * La rama description es no-indexada por diseño (F-027, seq-scan acotado por
 * store_id); name/sku van al GIN.
 *
 * Divergencia conocida vs B.2 (documentada, no silenciosa): la expresión
 * canónica pineada por el plan (DB-16) pliega caja+acentos pero NO símbolos,
 * mientras `normalizeSearchText` sí (`'Café-Especial'` → `'cafe especial'`).
 * Efecto: recall idéntico (contains), pero un token pegado a un símbolo
 * puede dear word(40)→contains(12) en SQL vs memoria. Cambiarlo exige
 * re-indexar (correctiva C.2b) y una decisión de plan: ver evidence C.3.
 */
import {
  escapeLike,
  normalizeSearchText,
} from '../../../../common/utils/search-text.util';
import {
  SEARCH_SCORE_BONUSES,
  SEARCH_WEIGHTS,
  type SearchTierWeights,
  type SearchWeightKey,
} from '../../../../common/utils/search-score.util';

/** Expresión canónica C.2/C.3 (F-026): byte-idéntica al DDL del GIN. */
export const TRIGRAM_CANONICAL_FN = 'public.immutable_unaccent';

const canon = (col: string): string =>
  `${TRIGRAM_CANONICAL_FN}(lower(${col}))`;

/** Tope admisión (F-090): nunca más placeholders que el hard-cap de A.1. */
export const TRIGRAM_MAX_TOKENS = 8;

/** `statement_timeout` del raw (F-070/F-090): 8x el presupuesto E.2. */
export const TRIGRAM_STATEMENT_TIMEOUT_MS = 2000;

/** Umbral slow-log (F-070): el presupuesto p95/keystroke de E.2. */
export const TRIGRAM_SLOW_LOG_MS = 250;

/** Estados/familias admitidos: allowlist cerrada, lo demás → throw. */
const PRODUCT_STATES = new Set(['active', 'inactive', 'archived']);
const PRODUCT_TYPES = new Set(['physical', 'service', 'prepared']);

export class TrigramFilterError extends Error {
  constructor(message: string) {
    super(`[TrigramFilter] ${message}`);
    this.name = 'TrigramFilterError';
  }
}

/**
 * Subconjunto de ProductQueryDto que el raw debe respetar (F-028). Espeja
 * `buildProductWhere`: state/include_inactive, brand, category, flags,
 * tri-estado is_ingredient (undefined = sin filtro) e ids masivos.
 * `search`/`barcode` no viajan: el caller ya garantizó search∧¬barcode.
 */
export interface TrigramFilterSet {
  readonly state?: string | null;
  readonly includeInactive?: boolean | null;
  readonly brandId?: number | null;
  readonly categoryId?: number | null;
  readonly trackInventory?: boolean | null;
  readonly productType?: string | null;
  readonly requiresBooking?: boolean | null;
  readonly isSellable?: boolean | null;
  readonly isBatchProduced?: boolean | null;
  /** undefined = sin filtro ("Todos"); true/false = filtra (QUI-729). */
  readonly isIngredient?: boolean | null | undefined;
  readonly ids?: readonly number[] | null;
}

export interface TrigramPredicate {
  /** Fragmentos AND (sin el WHERE): scope + filtros + recall por token. */
  readonly clauses: readonly string[];
  /** Params $1..$n en orden de aparición. */
  readonly params: readonly unknown[];
  /**
   * Prefijo de `params` que el COUNT twin consume ($1..$K contiguos:
   * filtros + contains). El rank consume `params` entero.
   */
  readonly sharedParams: readonly unknown[];
}

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value > 0
  );
}

function assertPositiveInt(
  value: unknown,
  field: string,
): asserts value is number {
  if (!isPositiveInt(value)) {
    throw new TrigramFilterError(`${field} debe ser entero positivo`);
  }
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new TrigramFilterError(`${field} debe ser boolean`);
  }
}

function cleanTokens(tokens: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    throw new TrigramFilterError('tokens vacío: el path trigram exige ≥1');
  }
  if (tokens.length > TRIGRAM_MAX_TOKENS) {
    throw new TrigramFilterError(
      `tokens sobre admisión (${tokens.length}>${TRIGRAM_MAX_TOKENS})`,
    );
  }
  return tokens.map((token) => {
    // F-081: el token que viaja es forma normalizada (minúsculas, sin acentos,
    // ñ viva) — byte-par con `immutable_unaccent(lower())` del lado columna.
    const clean = normalizeSearchText(token);
    if (!clean) throw new TrigramFilterError('token vacío tras normalizar');
    return clean;
  });
}

/** Acumulador $1..$n: el orden de push fija la numeración (twin idéntico). */
class ParamAcc {
  readonly params: unknown[] = [];
  push(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }
}

/**
 * Filtros AND espejo de `buildProductWhere` (F-028). Orden fijo:
 * scope → state → brand → category → flags → ids. El COUNT twin llama a esta
 * misma función: predicados byte-idénticos por construcción (F-029).
 */
export function buildTrigramFilterClauses(
  storeId: number,
  filters: TrigramFilterSet | null | undefined,
  acc: ParamAcc,
): string[] {
  assertPositiveInt(storeId, 'storeId');
  const clauses: string[] = [`p.store_id = ${acc.push(storeId)}::int`];
  const f: TrigramFilterSet =
    typeof filters === 'object' && filters !== null ? filters : {};

  if (f.state !== undefined && f.state !== null) {
    if (!PRODUCT_STATES.has(f.state)) {
      throw new TrigramFilterError(`state inválido: ${String(f.state)}`);
    }
    clauses.push(`p.state = ${acc.push(f.state)}::product_state_enum`);
  } else if (f.includeInactive === true) {
    // Sin predicado: incluye todo (espejo effectiveState=undefined).
  } else {
    clauses.push(`p.state <> 'archived'`);
  }
  if (f.brandId !== undefined && f.brandId !== null) {
    assertPositiveInt(f.brandId, 'brandId');
    clauses.push(`p.brand_id = ${acc.push(f.brandId)}::int`);
  }
  if (f.categoryId !== undefined && f.categoryId !== null) {
    assertPositiveInt(f.categoryId, 'categoryId');
    clauses.push(
      `EXISTS (SELECT 1 FROM public.product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ${acc.push(f.categoryId)}::int)`,
    );
  }
  if (f.trackInventory !== undefined && f.trackInventory !== null) {
    assertBoolean(f.trackInventory, 'trackInventory');
    clauses.push(`p.track_inventory = ${acc.push(f.trackInventory)}::boolean`);
  }
  if (f.productType !== undefined && f.productType !== null) {
    if (!PRODUCT_TYPES.has(f.productType)) {
      throw new TrigramFilterError(
        `productType inválido: ${String(f.productType)}`,
      );
    }
    clauses.push(`p.product_type = ${acc.push(f.productType)}::product_type_enum`);
  }
  if (f.requiresBooking !== undefined && f.requiresBooking !== null) {
    assertBoolean(f.requiresBooking, 'requiresBooking');
    clauses.push(`p.requires_booking = ${acc.push(f.requiresBooking)}::boolean`);
  }
  if (f.isSellable !== undefined && f.isSellable !== null) {
    assertBoolean(f.isSellable, 'isSellable');
    clauses.push(`p.is_sellable = ${acc.push(f.isSellable)}::boolean`);
  }
  if (f.isBatchProduced !== undefined && f.isBatchProduced !== null) {
    assertBoolean(f.isBatchProduced, 'isBatchProduced');
    clauses.push(`p.is_batch_produced = ${acc.push(f.isBatchProduced)}::boolean`);
  }
  if (f.isIngredient !== undefined && f.isIngredient !== null) {
    assertBoolean(f.isIngredient, 'isIngredient');
    clauses.push(`p.is_ingredient = ${acc.push(f.isIngredient)}::boolean`);
  }
  if (f.ids !== undefined && f.ids !== null) {
    if (!Array.isArray(f.ids) || f.ids.length === 0) {
      throw new TrigramFilterError('ids vacío: [] no filtra nada válido');
    }
    const cleanIds = f.ids.map((id) => {
      assertPositiveInt(id, 'ids[]');
      return id;
    });
    clauses.push(`p.id = ANY(${acc.push(cleanIds)}::int[])`);
  }
  return clauses;
}

/** Los 7 patrones LIKE de un token (F-080: escapeLike + `ESCAPE '\'`). */
export interface TrigramTokenPatterns {
  readonly exact: string;
  readonly startsWord: string;
  readonly midWord: string;
  readonly endsWord: string;
  readonly prefix: string;
  readonly wordPrefix: string;
  readonly contains: string;
}

export function buildTokenPatterns(token: string): TrigramTokenPatterns {
  const e = escapeLike(token);
  return {
    // `exact` viaja como PARAM ($n), jamás interpolado al SQL (F-030: el gate
    // grep prohíbe interpolar valores al texto; los ${} de este archivo son
    // solo fragmentos estructurales: $n refs, números de SEARCH_WEIGHTS y
    // nombres de columna fijos — cero input de usuario).
    exact: token,
    startsWord: `${e} %`,
    midWord: `% ${e} %`,
    endsWord: `% ${e}`,
    prefix: `${e}%`,
    wordPrefix: `% ${e}%`,
    contains: `%${e}%`,
  };
}

function weightNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : 0;
}

/**
 * Celda CASE de un (token, campo): espeja `matchTier` de A.2 en el mismo
 * orden exact→word→prefix→contains con los mismos números (F-019). `refs`
 * son los $n de los 7 patrones del token, en orden.
 */
export function buildTierCase(
  fieldExpr: string,
  weightKey: SearchWeightKey,
  refs: readonly string[],
): string {
  const w: SearchTierWeights = SEARCH_WEIGHTS[weightKey];
  const [ex, sw, mw, ew, pf, wp, ct] = refs;
  // Casts explícitos (::text): el adapter Prisma/pg no infiere tipos de
  // params en todos los contextos (42P18 vivo: `func() = $n` + string).
  // El cast va en el PARAM, jamás en la expresión columna: el GIN intacto.
  const like = (ref: string | undefined): string =>
    `${fieldExpr} LIKE ${ref}::text ESCAPE '\\'`;
  return (
    `(CASE WHEN ${fieldExpr} = ${ex}::text THEN ${weightNumber(w.exact)} ` +
    `WHEN ${like(sw)} OR ${like(mw)} OR ${like(ew)} THEN ${weightNumber(w.word)} ` +
    `WHEN ${like(pf)} OR ${like(wp)} THEN ${weightNumber(w.prefix)} ` +
    `WHEN ${like(ct)} THEN ${weightNumber(w.contains)} ELSE 0 END)`
  );
}

export interface TrigramTokenRefs {
  readonly token: string;
  /** $n de los 7 patrones, en el orden de TrigramTokenPatterns. */
  readonly refs: readonly string[];
}

/**
 * Recall AND×OR (F-015 en SQL): cada token en ≥1 campo indexado o rama
 * description/variantes.
 *
 * ORDEN DE PUSH LOAD-BEARING (P2010/42P18 vivo): el adapter Prisma/pg aborta
 * cuando un query recibe params que NO referencia (`$4` huérfano ⇒ 42P18).
 * El COUNT twin solo referencia filtros + contains, así que el push va en
 * DOS pasadas: primero los contains de TODOS los tokens (prefijo contiguo
 * $1..$K que el COUNT consume entero), después los 6 patrones de score por
 * token (solo el rank los referencia). `sharedParamCount` marca el corte:
 * COUNT pasa `params.slice(0, sharedParamCount)` — cero huérfanos, cero gaps.
 */
export function buildRecallClauses(
  tokens: readonly string[],
  acc: ParamAcc,
): {
  clauses: string[];
  tokenRefs: TrigramTokenRefs[];
  sharedParamCount: number;
} {
  const name = canon('p.name');
  const sku = canon('p.sku');
  const desc = canon('p.description');
  const clauses: string[] = [];
  const tokenRefs: TrigramTokenRefs[] = [];
  const patternsByToken = tokens.map(buildTokenPatterns);
  // Pasada 1: contains de todos (referenciados por rank Y count).
  const containsRefs: string[] = patternsByToken.map((patterns) =>
    acc.push(patterns.contains),
  );
  const sharedParamCount = acc.params.length;
  // Pasada 2: patrones de score (solo el rank los referencia).
  patternsByToken.forEach((patterns, index) => {
    const refs = [
      acc.push(patterns.exact),
      acc.push(patterns.startsWord),
      acc.push(patterns.midWord),
      acc.push(patterns.endsWord),
      acc.push(patterns.prefix),
      acc.push(patterns.wordPrefix),
      containsRefs[index] as string,
    ];
    const token = tokens[index] as string;
    const like = (expr: string): string =>
      `${expr} LIKE ${containsRefs[index] as string}::text ESCAPE '\\'`;
    clauses.push(
      `(${like(name)} OR ${like(sku)} OR ${like(desc)} OR ` +
        `EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND ` +
        `(${like(canon('v.name'))} OR ${like(canon('v.sku'))})))`,
    );
    tokenRefs.push({ token, refs });
  });
  return { clauses, tokenRefs, sharedParamCount };
}

/**
 * Score Σ_token GREATEST(celdas) + bonus (F-019): name/sku/barcode/desc +
 * mejor variante (max sobre filas) + fullCoverage fijo (+15: el recall lo
 * garantiza) + allInPrimary (+25 si todo token pegó en name) + identidad
 * sku/barcode sobre la query normalizada (+20/+30).
 */
export function buildScoreExpression(
  tokenRefs: readonly TrigramTokenRefs[],
  normalizedQuery: string,
  acc: ParamAcc,
): string {
  const name = canon('p.name');
  const sku = canon('p.sku');
  const barcode = canon('p.barcode');
  const desc = canon('p.description');
  const perToken: string[] = [];
  const primaryHits: string[] = [];
  for (const { refs } of tokenRefs) {
    const nameCell = buildTierCase(name, 'name', refs);
    const skuCell = buildTierCase(sku, 'sku', refs);
    const barcodeCell = buildTierCase(barcode, 'barcode', refs);
    const descCell = buildTierCase(desc, 'description', refs);
    const variantCell =
      `(SELECT COALESCE(MAX(GREATEST(${buildTierCase(canon('v2.name'), 'variantName', refs)}, ` +
      `${buildTierCase(canon('v2.sku'), 'variantSku', refs)})), 0) ` +
      `FROM public.product_variants v2 WHERE v2.product_id = p.id)`;
    perToken.push(
      `GREATEST(${nameCell}, ${skuCell}, ${barcodeCell}, ${descCell}, ${variantCell})`,
    );
    primaryHits.push(`(${nameCell} > 0)`);
  }
  const queryRef = acc.push(normalizedQuery);
  // Identidad (A.2 scoreIdentityBonus): la query normalizada iguala un sku
  // (+20) o barcode (+30) del producto o de cualquier variante. El fold
  // espeja `normalizeSearchText` (símbolos→espacio) para que 'CAFE-001' case
  // con 'cafe 001'; es bonus-only (no toca recall ni GIN), así que un
  // locale raro como mucho pierde +20, jamás filas.
  const foldCode = (col: string): string =>
    `btrim(regexp_replace(${canon(col)}, '[^[:alnum:] ]+', ' ', 'g'))`;
  const identitySku =
    `(CASE WHEN ${foldCode('p.sku')} = ${queryRef}::text OR EXISTS ` +
    `(SELECT 1 FROM public.product_variants v3 WHERE v3.product_id = p.id AND ${foldCode('v3.sku')} = ${queryRef}::text) ` +
    `THEN ${weightNumber(SEARCH_SCORE_BONUSES.skuExact)} ELSE 0 END)`;
  const identityBarcode =
    `(CASE WHEN ${foldCode('p.barcode')} = ${queryRef}::text OR EXISTS ` +
    `(SELECT 1 FROM public.product_variants v4 WHERE v4.product_id = p.id AND ${foldCode('v4.barcode')} = ${queryRef}::text) ` +
    `THEN ${weightNumber(SEARCH_SCORE_BONUSES.barcodeExact)} ELSE 0 END)`;
  return (
    `(${perToken.join(' + ')}) + ${weightNumber(SEARCH_SCORE_BONUSES.fullCoverage)} + ` +
    `(CASE WHEN ${primaryHits.join(' AND ')} THEN ${weightNumber(SEARCH_SCORE_BONUSES.allInPrimary)} ELSE 0 END) + ` +
    `${identitySku} + ${identityBarcode}`
  );
}

/**
 * Predicado completo compartido rank+COUNT (F-029): scope + filtros + recall.
 * Mismo orden de push ⇒ WHERE byte-idéntico en ambos queries.
 */
export function buildTrigramPredicates(
  storeId: number,
  tokens: readonly string[] | null | undefined,
  filters: TrigramFilterSet | null | undefined,
): TrigramPredicate {
  const clean = cleanTokens(tokens);
  const acc = new ParamAcc();
  const filterClauses = buildTrigramFilterClauses(storeId, filters, acc);
  const { clauses: recallClauses, sharedParamCount } = buildRecallClauses(
    clean,
    acc,
  );
  return {
    clauses: [...filterClauses, ...recallClauses],
    params: [...acc.params],
    sharedParams: [...acc.params].slice(0, sharedParamCount),
  };
}

export interface TrigramRankedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * Query rankeada: ids+score de LA página + ORDER BY espejo de
 * `compareSearchRank` (score→coverage→featured→created_at→id, F-019).
 * `created_at DESC NULLS LAST`: NULL saca epoch 0 en JS ⇒ va al fondo.
 */
export function buildTrigramRankedQuery(
  storeId: number,
  tokens: readonly string[] | null | undefined,
  filters: TrigramFilterSet | null | undefined,
  rawQuery: unknown,
  limit: number,
  offset: number,
): TrigramRankedQuery {
  const clean = cleanTokens(tokens);
  if (!isPositiveInt(limit)) {
    throw new TrigramFilterError('limit debe ser entero positivo');
  }
  if (
    typeof offset !== 'number' ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    throw new TrigramFilterError('offset debe ser entero ≥0');
  }
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (!normalizedQuery) {
    throw new TrigramFilterError('query vacía tras normalizar');
  }
  const acc = new ParamAcc();
  const filterClauses = buildTrigramFilterClauses(storeId, filters, acc);
  const { clauses: recallClauses, tokenRefs } = buildRecallClauses(clean, acc);
  const scoreExpr = buildScoreExpression(tokenRefs, normalizedQuery, acc);
  const limitRef = acc.push(limit);
  const offsetRef = acc.push(offset);
  const where = [...filterClauses, ...recallClauses].join(' AND ');
  const sql =
    `SELECT p.id AS id, (${scoreExpr}) AS score, ${clean.length} AS coverage ` +
    `FROM public.products p WHERE ${where} ` +
    `ORDER BY score DESC, coverage DESC, p.is_featured DESC, p.created_at DESC NULLS LAST, p.id DESC ` +
    `LIMIT ${limitRef}::int OFFSET ${offsetRef}::int`;
  return { sql, params: [...acc.params] };
}

/**
 * COUNT twin (F-029): mismo WHERE, sin score ni paginación. Pasa SOLO
 * `sharedParams` (filtros + contains): cada $n pasado es referenciado —
 * params huérfanos ⇒ P2010/42P18 en el adapter (ver buildRecallClauses).
 */
export function buildTrigramCountQuery(
  storeId: number,
  tokens: readonly string[] | null | undefined,
  filters: TrigramFilterSet | null | undefined,
): TrigramRankedQuery {
  const predicate = buildTrigramPredicates(storeId, tokens, filters);
  const sql =
    `SELECT COUNT(*)::int AS total FROM public.products p ` +
    `WHERE ${predicate.clauses.join(' AND ')}`;
  return { sql, params: predicate.sharedParams };
}

/**
 * Extrae el WHERE principal de un query twin para assert byte-idéntico
 * (F-029). Anclado a `FROM public.products p WHERE `: un `indexOf(' WHERE ')`
 * ingenuo caería en los WHERE de las subqueries del score/EXISTS.
 */
export function extractWhereClause(sql: string): string {
  const anchor = 'FROM public.products p WHERE ';
  const anchorIndex = sql.indexOf(anchor);
  if (anchorIndex < 0) return '';
  const tail = sql.slice(anchorIndex + anchor.length);
  const orderIndex = tail.indexOf(' ORDER BY ');
  return (orderIndex < 0 ? tail : tail.slice(0, orderIndex)).trim();
}
