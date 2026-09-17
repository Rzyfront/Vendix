/**
 * CP-pos-smart-search · A.0 — Cutover por capability + kill-switch (ADR-07).
 *
 * Sin flags por tienda (removidos a pedido del dueño: eran un mecanismo
 * invisible — sin UI ni endpoint — que hacía ver rota la feature hasta
 * editar un JSON en la DB). La resolución es global y automática:
 * kill-switch ⇒ legacy; si no, capability pg_trgm ⇒ trigram, si no ⇒ l2.
 * L2 sin capability sigue siendo mejor que legacy (multi-token + relevancia
 * con scan-cap acotado y fail-open); trigram agrega unaccent (cafe→Café).
 *
 * Este archivo es PURO: tipos, cutover y parse del kill-switch. Sin I/O,
 * sin Nest, sin Prisma — testeable sin harness. El I/O (capability probe
 * cacheada, kill-switch) vive en `pos-search-path.service.ts`.
 */

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

/** Resolución completa del cutover para un request. */
export interface PosSearchResolution {
  path: PosSearchPath;
  trigramCapable: boolean;
  killSwitch: boolean;
}

/**
 * TTL del caché de capability: la capability solo cambia con migración
 * (C.1/C.2), así que 60s es conservador y barato.
 */
export const POS_SEARCH_CAPABILITY_TTL_MS = 60_000;

/**
 * Kill-switch global (F-007, único freno de emergencia). Cualquier valor
 * truthy (`1`/`true`/`yes`/`on`, case-insensitive) fuerza legacy en TODAS
 * las tiendas en el próximo request tras ser visible para el proceso — se
 * lee fresco en cada resolución. Cambiar env requiere restart/reload del
 * proceso, no deploy de código.
 */
export const POS_SMART_SEARCH_KILL_SWITCH_ENV = 'POS_SMART_SEARCH_OFF';

/**
 * Wrapper IMMUTABLE pactado con C.1 (`immutable_unaccent`, con reglas custom
 * que preservan ñ/Ñ). La probe lo resuelve con `to_regprocedure`; si C.1 lo
 * renombra, esta constante es el único punto que cambia.
 */
export const POS_SEARCH_NORM_FUNCTION = 'immutable_unaccent';

/** Env truthy ⇒ kill-switch prendido. `undefined`/vacío/desconocido ⇒ off. */
export function parseKillSwitch(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Cutover puro kill-switch × capability.
 *
 * | kill | capable | path    | Notas                              |
 * |------|---------|---------|------------------------------------|
 * | on   | –       | legacy  | incidente: comportamiento histórico|
 * | off  | sí      | trigram | Fase B (unaccent + rank nativo)    |
 * | off  | no      | l2      | Fase A (rank en memoria, acotado)  |
 *
 * Sin capability NO se warn-ea por request: l2 es el default diseñado,
 * no una degradación (la probe solo warn-ea si ella misma falla).
 */
export function resolveSearchPath(
  killSwitch: boolean,
  capability: PosSearchCapability,
): PosSearchPath {
  if (killSwitch) return 'legacy';
  if (capability.trigramCapable) return 'trigram';
  return 'l2';
}

/**
 * Snapshot del cutover para la línea estructurada por-search (F-068).
 *
 * B.2 la pega con `...snapshotSearchPath(path, trigramCapable, killSwitch)`.
 */
export interface PosSearchPathSnapshot {
  path: PosSearchPath;
  trigram_capable: boolean;
  kill_switch: boolean;
}

export function snapshotSearchPath(
  path: PosSearchPath,
  trigramCapable: boolean,
  killSwitch: boolean,
): PosSearchPathSnapshot {
  return { path, trigram_capable: trigramCapable, kill_switch: killSwitch };
}
