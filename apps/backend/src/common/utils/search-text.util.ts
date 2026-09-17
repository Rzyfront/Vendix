/**
 * CP-pos-smart-search · A.1 — Normalización/tokenización/ensamblaje únicos.
 *
 * Única normalización, tokenización y ensamblaje AND×OR para las 4
 * superficies (B.1 productos, D.1 ajustes, D.2 traslados, D.3 catálogo
 * público). Reemplaza como canónica las 3+ variantes dispersas
 * (`normalizeGeoName`, `tokenize` de help-center, `normalizeText` del
 * expense-scanner): esas quedan para su dominio, nadie nuevo las copia.
 *
 * Funciones puras, sin I/O, sin Nest, sin Prisma. El tokenizer es función
 * total never-throw (sanitize-then-tokenize, ERR-15): cualquier input
 * degenerado produce una salida definida, jamás lanza.
 *
 * Paridad SQL (F-081): `normalizeSearchText` emite minúsculas sin acento
 * byte-pares con `immutable_unaccent(lower())` de C.1 para ASCII + acentos
 * latinos + ñ/Ñ (C.1 preserva ñ por reglas custom; acá se preserva por
 * placeholder). Divergencias conocidas: ligaduras y letras sin
 * descomposición NFD (ß, æ, œ, ø, å, ł, ð, þ) JS las conserva mientras
 * unaccent las pliega; C.3 fija el fixture compartido de paridad.
 */

/** Cota de input: ERR-15 trunca runs largos antes de normalizar. */
export const SEARCH_TEXT_MAX_INPUT_LENGTH = 500;

/** Tokens de 1 char (`%x%`) no discriminan: matchean casi todo. */
export const SEARCH_TOKEN_MIN_LENGTH = 2;

/** Tope interno (B.1/D.1/D.2): 6 tokens. */
export const SEARCH_TOKEN_INTERNAL_MAX = 6;

/** Tope público (D.3, superficie sin auth): 4 tokens. */
export const SEARCH_TOKEN_PUBLIC_MAX = 4;

/** Techo absoluto: acota el ancho del AND aunque pidan más. */
const SEARCH_TOKEN_HARD_MAX = 8;

/**
 * Stopwords ES en forma NORMALIZADA (sin acentos: el filtro corre después
 * de `normalizeSearchText`, así `qué`→`que`, `cómo`→`como`). Solo
 * artículos/preposiciones/conjunciones/pronombres que jamás discriminan un
 * producto; palabras de dominio (talla, color, marca, modelo) NO entran.
 */
export const STOPWORDS_ES_SEARCH: ReadonlySet<string> = new Set([
  'a',
  'al',
  'ante',
  'aquel',
  'aquella',
  'aquellas',
  'aquellos',
  'bajo',
  'cabe',
  'como',
  'con',
  'contra',
  'cual',
  'cuales',
  'cuando',
  'de',
  'del',
  'desde',
  'donde',
  'durante',
  'e',
  'el',
  'ella',
  'ellas',
  'ello',
  'ellos',
  'en',
  'entre',
  'esa',
  'esas',
  'ese',
  'eso',
  'esos',
  'esta',
  'estas',
  'este',
  'estos',
  'hacia',
  'hasta',
  'la',
  'las',
  'le',
  'les',
  'lo',
  'los',
  'mas',
  'mediante',
  'mi',
  'mis',
  'muy',
  'ni',
  'nos',
  'o',
  'para',
  'pero',
  'por',
  'porque',
  'que',
  'se',
  'segun',
  'sin',
  'sobre',
  'su',
  'sus',
  'tan',
  'te',
  'tras',
  'tu',
  'tus',
  'u',
  'un',
  'una',
  'unas',
  'unos',
  'versus',
  'vs',
  'y',
]);

/** Placeholder PUA para ñ durante el strip NFD (ñ = n + U+0303). */
const ENE_PLACEHOLDER = '\uE000';

/** Subrogados sueltos (mitad de par sin su compañera). */
const HIGH_SURROGATE_ORPHAN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g;
const LOW_SURROGATE_ORPHAN = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Forma canónica de búsqueda: minúsculas, sin acentos (ñ preservada),
 * símbolos→espacio, espacios colapsados.
 *
 * `'CAFÉ  Negro.'` → `'cafe negro'`; `'niño'` → `'niño'`.
 *
 * Total never-throw: no-string → `''`; truncada a 500 chars; null bytes,
 * controles y subrogados sueltos → espacio antes de tokenizar.
 */
export function normalizeSearchText(input: unknown): string {
  try {
    if (typeof input !== 'string') return '';
    if (input.length === 0) return '';

    const normalized = input
      .slice(0, SEARCH_TEXT_MAX_INPUT_LENGTH)
      .replace(/[\0-\x1F\x7F-\x9F]/g, ' ')
      .replace(HIGH_SURROGATE_ORPHAN, ' ')
      .replace(LOW_SURROGATE_ORPHAN, ' ')
      .toLowerCase()
      .replace(/ñ/g, ENE_PLACEHOLDER)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(ENE_PLACEHOLDER).join('ñ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return normalized;
  } catch {
    return '';
  }
}

/**
 * Tokeniza a formas buscables: normaliza, parte por espacio, filtra
 * stopwords + tokens cortos, dedupea preservando orden y corta a `maxTokens`.
 *
 * `maxTokens` es REQUERIDO (sin default): el tope vive en la frontera
 * validada (wrappers), no en cada call-site (F-087). Inválido (≤0, NaN,
 * no-entero) → `[]` (fail-closed a fallback legacy); >8 → clamp a 8.
 *
 * Total never-throw (F-032): input adversarial → salida definida, jamás lanza.
 */
export function tokenizeSearch(input: unknown, maxTokens: number): string[] {
  try {
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) return [];
    const cap = Math.min(maxTokens, SEARCH_TOKEN_HARD_MAX);

    const normalized = normalizeSearchText(input);
    if (!normalized) return [];

    const seen = new Set<string>();
    const tokens: string[] = [];
    for (const raw of normalized.split(' ')) {
      if (raw.length < SEARCH_TOKEN_MIN_LENGTH) continue;
      if (STOPWORDS_ES_SEARCH.has(raw)) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      tokens.push(raw);
      if (tokens.length >= cap) break;
    }
    return tokens;
  } catch {
    return [];
  }
}

/** Tokenizer interno (B.1/D.1/D.2): tope 6, frontera validada. */
export function tokenizeInternal(input: unknown): string[] {
  return tokenizeSearch(input, SEARCH_TOKEN_INTERNAL_MAX);
}

/** Tokenizer público (D.3 catálogo sin auth): tope 4, frontera validada. */
export function tokenizePublic(input: unknown): string[] {
  return tokenizeSearch(input, SEARCH_TOKEN_PUBLIC_MAX);
}

/**
 * Escapa `\\`, `%`, `_` para patrones LIKE con `ESCAPE '\'`.
 * Fase B (C.3 raw SQL) DEBE declarar `ESCAPE '\'` al usarlo.
 * Total never-throw: no-string → `''`.
 */
export function escapeLike(input: unknown): string {
  try {
    if (typeof input !== 'string') return '';
    return input
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
  } catch {
    return '';
  }
}

/**
 * Flags mínimos para el gate. Estructural a propósito: `PosSearchFlags`
 * de A.0 es asignable sin que `common/` importe el dominio settings.
 */
export interface SmartSearchGateFlags {
  l1: boolean;
  l2: boolean;
  trigram: boolean;
}

/**
 * Predicado ÚNICO wrap-vs-legacy (F-013). Lo consumen el where (B.1/D.x) y
 * el rank (B.2) con los mismos argumentos: imposible que el conjunto y el
 * orden diverjan por caller.
 *
 * Activo ⇔ (algún tier explícitamente on) ∧ (tokeniza a ≥1 token).
 * Query solo-stopwords → `false` → fallback a frase legacy (ADR-02).
 *
 * Tabla de decisión por caller (flags iguales ⇒ misma decisión):
 *
 * | Caller              | pos_optimized | L1 on + tokens | Decisión |
 * |---------------------|---------------|----------------|----------|
 * | POS web/móvil       | sí            | sí             | smart    |
 * | Admin listado       | no            | sí             | smart    |
 * | Bulk / findIds      | no            | sí             | smart    |
 * | Vexi / restaurante  | no            | sí             | smart    |
 * | Cualquiera          | –             | no (off/vacío) | legacy   |
 *
 * `pos_optimized` deliberadamente NO es input: gatear el rank por él pero
 * el where por flags partía set-nuevo/orden-viejo. `findAll`≡`findIds`
 * porque ambos comparten `buildProductWhere` + este predicado (DB-17).
 *
 * Total never-throw: flags nulos/raros → `false` (fail-closed a legacy).
 */
export function isSmartSearchActive(
  query: unknown,
  flags: SmartSearchGateFlags | null | undefined,
): boolean {
  try {
    if (typeof flags !== 'object' || flags === null || Array.isArray(flags)) {
      return false;
    }
    const anyTierOn =
      flags.l1 === true || flags.l2 === true || flags.trigram === true;
    if (!anyTierOn) return false;
    return tokenizeInternal(query).length > 0;
  } catch {
    return false;
  }
}

/** Filtro `contains` case-insensitive, forma Prisma. */
export interface SearchTextContainsFilter {
  contains: string;
  mode: 'insensitive';
}

export interface SearchTextSomeFilter {
  some: Record<string, SearchTextContainsFilter>;
}

/** Una rama del OR: escalar directo o `some` bajo relación. */
export type SearchTextFieldCondition = Record<
  string,
  SearchTextContainsFilter | SearchTextSomeFilter
>;

export interface SearchTextTokenOrClause {
  OR: SearchTextFieldCondition[];
}

/**
 * Mapa de campos buscables por superficie. Cada una declara el suyo
 * (B.1: escalares name/description/sku + `product_variants` name/sku;
 * D.1/D.2/D.3: el suyo); el LOOP vive acá, no en cada servicio.
 */
export interface SearchTextFieldMap {
  /** Campos escalares directos sobre la raíz del where. */
  scalar: readonly string[];
  /** Relación → campos: cada par emite `{ rel: { some: { campo } } }`. */
  relations?: Readonly<Record<string, readonly string[]>>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Ensamblaje compartido AND×OR (F-015, ADR-02): cada token en ≥1 campo.
 *
 * ```ts
 * buildTokenAndFieldOr(['cafe','leche'],
 *   { scalar: ['name','sku'], relations: { product_variants: ['name'] } })
 * // { AND: [
 * //   { OR: [{name},{sku},{product_variants:{some:{name}}}] },  // 'cafe'
 * //   { OR: [...] },                                            // 'leche'
 * // ] }
 * ```
 *
 * `nestPath` (D.1: `['products']`) envuelve el AND bajo cada segmento:
 * `{ products: { AND: [...] } }`. Vacío/omitido = sin envoltura.
 *
 * Semántica relaciones: una entrada OR por par (relación, campo) con su
 * propio `some` — unión sobre los 5 espacios de campo, cada token puede
 * matchear en filas distintas.
 *
 * Total never-throw: tokens/fields inválidos o vacíos → `{}` (el caller
 * aplica fallback legacy). Retorna `Record<string, unknown>` a propósito:
 * `common/` no importa Prisma; cada superficie lo vuelca a su `*WhereInput`
 * con un único `as` en su costura.
 */
export function buildTokenAndFieldOr(
  tokens: readonly string[] | null | undefined,
  fieldMap: SearchTextFieldMap | null | undefined,
  nestPath?: readonly string[] | null,
): Record<string, unknown> {
  try {
    const cleanTokens = Array.isArray(tokens)
      ? tokens.filter(isNonEmptyString)
      : [];
    if (cleanTokens.length === 0) return {};

    const scalarFields =
      typeof fieldMap === 'object' &&
      fieldMap !== null &&
      Array.isArray(fieldMap.scalar)
        ? fieldMap.scalar.filter(isNonEmptyString)
        : [];
    const relationEntries =
      typeof fieldMap === 'object' &&
      fieldMap !== null &&
      typeof fieldMap.relations === 'object' &&
      fieldMap.relations !== null
        ? Object.entries(fieldMap.relations).filter(
            (entry): entry is [string, readonly string[]] =>
              isNonEmptyString(entry[0]) && Array.isArray(entry[1]),
          )
        : [];

    const orSize =
      scalarFields.length +
      relationEntries.reduce(
        (sum, [, fields]) =>
          sum + fields.filter(isNonEmptyString).length,
        0,
      );
    if (orSize === 0) return {};

    const and = cleanTokens.map(
      (token): SearchTextTokenOrClause => ({
        OR: [
          ...scalarFields.map(
            (field): SearchTextFieldCondition => ({
              [field]: { contains: token, mode: 'insensitive' },
            }),
          ),
          ...relationEntries.flatMap(
            ([relation, fields]): SearchTextFieldCondition[] =>
              fields
                .filter(isNonEmptyString)
                .map((field) => ({
                  [relation]: {
                    some: { [field]: { contains: token, mode: 'insensitive' } },
                  },
                })),
          ),
        ],
      }),
    );

    let node: Record<string, unknown> = { AND: and };
    const segments = Array.isArray(nestPath)
      ? nestPath.filter(isNonEmptyString)
      : [];
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      node = { [segments[index] as string]: node };
    }
    return node;
  } catch {
    return {};
  }
}
