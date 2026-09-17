/**
 * CP-pos-smart-search · A.0 — Flag infra two-tier + cutover (ADR-07).
 *
 * Tier-1 (per-store, rollout gradual): `store_settings.pos_smart_search`
 * `{ l1, l2, trigram }`, default off. Tier-0 (global, incidentes): env
 * `POS_SMART_SEARCH_OFF`, que fuerza el path legacy.
 *
 * Este archivo es PURO: tipos, defaults, coerción estricta y la función de
 * cutover `resolveSearchPath`. Sin I/O, sin Nest, sin Prisma — testeable sin
 * harness. El I/O (lectura never-throw, caché TTL, capability probe,
 * kill-switch, audit) vive en `pos-search-flags.service.ts`.
 */

/** Per-store Tier-1 flags. Todo default `false` (F-006, F-035). */
export interface PosSearchFlags {
  /** Fase A recall: helper tokenizado AND×OR (B.1). Orden legacy by design. */
  l1: boolean;
  /** Fase A rank: scoring en memoria sobre el recall L1 (B.2). Implica L1. */
  l2: boolean;
  /**
   * Fase B nativo: raw SQL sobre pg_trgm + unaccent + GIN (C.3).
   * Solo efectivo ∧ capability (F-049): sin wrapper/GIN cae a L2/L1/legacy.
   */
  trigram: boolean;
}

/** Ruta de búsqueda resuelta por request. */
export type PosSearchPath = 'legacy' | 'l1' | 'l2' | 'trigram';

/** Capability Fase B del cluster (probe cacheada en el servicio). */
export interface PosSearchCapability {
  /**
   * true ⇔ pg_trgm ∧ unaccent instaladas ∧ wrapper `immutable_unaccent(text)`
   * existe ∧ existe GIN trigram válido sobre products ∧ ningún índice
   * products inválido. Nombres/propiedades pactados con C.1/C.2.
   */
  trigramCapable: boolean;
}

/** Default-off explícito: flag ausente/unset/ilegible ⇒ legacy (ERR-19). */
export const POS_SEARCH_FLAGS_DEFAULT: PosSearchFlags = Object.freeze({
  l1: false,
  l2: false,
  trigram: false,
}) as PosSearchFlags;

/** TTL del caché de flags por tienda: 45s ∈ [30s, 60s] (F-051, ADR-07). */
export const POS_SEARCH_FLAGS_TTL_MS = 45_000;

/**
 * TTL del caché de capability: la capability solo cambia con migración
 * (C.1/C.2), así que 60s es conservador y barato.
 */
export const POS_SEARCH_CAPABILITY_TTL_MS = 60_000;

/**
 * Kill-switch global Tier-0 (F-007). Cualquier valor truthy
 * (`1`/`true`/`yes`/`on`, case-insensitive) fuerza legacy en TODAS las
 * tiendas en el próximo request tras ser visible para el proceso — se lee
 * fresco en cada resolución, ANTES del caché, así que no espera al TTL.
 * Cambiar env requiere restart/reload del proceso, no deploy de código.
 */
export const POS_SMART_SEARCH_KILL_SWITCH_ENV = 'POS_SMART_SEARCH_OFF';

/**
 * Wrapper IMMUTABLE pactado con C.1 (`immutable_unaccent`, con reglas custom
 * que preservan ñ/Ñ). La probe lo resuelve con `to_regprocedure`; si C.1 lo
 * renombra, esta constante es el único punto que cambia.
 */
export const POS_SEARCH_NORM_FUNCTION = 'immutable_unaccent';

/** Acción de audit_logs para cada toggle de flag (F-071). */
export const POS_SEARCH_TOGGLE_AUDIT_ACTION = 'POS_SMART_SEARCH_TOGGLE';

/**
 * Coerción estricta del bloque persistido: solo un `true` EXPLÍCITO enciende.
 * Bloque ausente, fila ausente, JSON corrupto o no-booleanos ⇒ default-off.
 * Mismo patrón que `vexi.enabled`: opt-in deliberado por tienda.
 */
export function coerceSearchFlags(raw: unknown): PosSearchFlags {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...POS_SEARCH_FLAGS_DEFAULT };
  }
  const block = raw as Record<string, unknown>;
  return {
    l1: block['l1'] === true,
    l2: block['l2'] === true,
    trigram: block['trigram'] === true,
  };
}

/** Env truthy ⇒ kill-switch prendido. `undefined`/vacío/desconocido ⇒ off. */
export function parseKillSwitch(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Cutover puro flag×capability (F-021, F-049).
 * Precedencia: TRIGRAM∧capable > L2 > L1 > legacy. L2⇒L1.
 *
 * Matriz 8 estados (l1, l2, trigram → comportamiento):
 *
 * | # | l1 | l2 | trigram | capable | path    | Notas                          |
 * |---|----|----|---------|---------|---------|--------------------------------|
 * | 1 | 0  | 0  | 0       |   –     | legacy  | default-off; grid intacta      |
 * | 2 | 1  | 0  | 0       |   –     | l1      | recall nuevo, orden legacy     |
 * |   |    |    |         |         |         | (by design; B.1 lo acepta)     |
 * | 3 | 0  | 1  | 0       |   –     | l2      | L2⇒L1: el rank implica el      |
 * |   |    |    |         |         |         | tokenizado; l1 sobra           |
 * | 4 | 1  | 1  | 0       |   –     | l2      | rollout normal Fase A          |
 * | 5 | 0  | 0  | 1       |   sí    | trigram | Fase B                        |
 * | 5d| 0  | 0  | 1       |   no    | legacy  | fallback + warn (F-049)        |
 * | 6 | 1  | 0  | 1       |   sí    | trigram | Fase B                        |
 * | 6d| 1  | 0  | 1       |   no    | l1      | fallback Fase A + warn         |
 * | 7 | 0  | 1  | 1       |   sí    | trigram | Fase B                        |
 * | 7d| 0  | 1  | 1       |   no    | l2      | fallback Fase A + warn         |
 * | 8 | 1  | 1  | 1       |   sí    | trigram | rollout completo              |
 * | 8d| 1  | 1  | 1       |   no    | l2      | fallback Fase A + warn         |
 *
 * El warn de las filas degradadas (5d–8d) lo emite el servicio
 * (`resolveSearchPathFor`), no esta función pura.
 */
export function resolveSearchPath(
  flags: PosSearchFlags,
  capability: PosSearchCapability,
): PosSearchPath {
  if (flags.trigram && capability.trigramCapable) return 'trigram';
  if (flags.l2) return 'l2';
  if (flags.l1) return 'l1';
  return 'legacy';
}

/**
 * Snapshot de flags para la línea estructurada por-search (F-068/F-071).
 *
 * HOOK PARA B.2: B.2 construye la línea (request_id, store, query-hash,
 * tokens, ms por etapa, candidatos, rank_mode) y la pega con
 * `...snapshotSearchFlags(flags, path)`. A.0 solo deja el builder listo; la
 * línea NO se emite aquí.
 */
export interface PosSearchFlagSnapshot {
  l1: boolean;
  l2: boolean;
  trigram: boolean;
  path: PosSearchPath;
}

export function snapshotSearchFlags(
  flags: PosSearchFlags,
  path: PosSearchPath,
): PosSearchFlagSnapshot {
  return { l1: flags.l1, l2: flags.l2, trigram: flags.trigram, path };
}
