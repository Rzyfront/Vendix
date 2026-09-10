/**
 * Coerción + hidratación + estimado del flag "impuesto incluido" por producto.
 *
 * Single-source para los TRES escritores del flag (FB-01 modal rápido,
 * FB-02 página avanzada, edición masiva): F-008 / F-021 / F-028.
 *
 * ## Contrato (backend A.2, deploy backend-ANTES que frontend — F-030)
 *
 * - `POST/PATCH /store/products` aceptan `tax_inclusive_map: Record<string, boolean>`
 *   filtrado a los ids de `tax_category_ids`. El backend lo persiste en
 *   `product_tax_assignments.is_inclusive`.
 * - `GET` expone `product_tax_assignments[].is_inclusive`. En un GET viejo sin el
 *   flag, el campo viene `undefined` y se cae al default del catálogo.
 * - Masiva: `tax_category_action.inclusive?: Record<string, boolean>`, también
 *   filtrado a `ids`.
 *
 * Enviar `tax_inclusive_map` a un backend viejo devuelve 400 (whitelist
 * cerrada): por eso el orden de deploy es backend-primero y por eso el payload
 * SIEMPRE se filtra a ids efectivos.
 *
 * ## Precedencia (F-007 / F-022 / F-024)
 *
 * `asignación > tax_categories embebido > catálogo`. La asignación gana SIN
 * importar el orden de carga: `hydrateTaxInclusiveMap` pone los defaults del
 * catálogo primero y las asignaciones después (overlay), y
 * `loadTaxCategories` solo rellena entradas `undefined`, nunca sobrescribe.
 *
 * ## Estimado de precio (F-013)
 *
 * `estimatePriceWithTax` es ESPECIFICACIÓN DE SIGNO para pintar el "precio con
 * impuestos" en el formulario, NO un oráculo de centavos. El backend puede
 * prorratear/truncar distinto (1–2 centavos): la fuente autoritativa es
 * `resolveTaxableBase` + `dianAmount` del backend, nunca este helper.
 */

/** Estado de vista: un flag por id de categoría de impuesto. */
export type TaxInclusiveMap = Record<number, boolean>;

/** Forma que viaja por el cable: las claves JSON siempre son string. */
export type TaxInclusivePayloadMap = Record<string, boolean>;

/** Nombre del control dentro del FormGroup de la acción masiva de impuestos. */
export const BULK_TAX_INCLUSIVE_CONTROL = 'inclusive';

/** Lo mínimo que el helper necesita leer de una categoría de impuesto. */
export interface TaxInclusiveCatalogEntry {
  id: number;
  is_inclusive?: boolean | null;
  tax_rates?: { is_inclusive?: boolean | null }[] | null;
}

/** Lo mínimo que el helper necesita leer de una asignación producto↔impuesto. */
export interface TaxInclusiveAssignmentEntry {
  tax_category_id: number;
  is_inclusive?: boolean | null;
  tax_categories?: TaxInclusiveCatalogEntry | null;
}

/**
 * Tasa como fracción (0.19). Acepta `19`, `0.19`, `'19'`, `null`.
 * Negativos / NaN / ausentes ⇒ 0.
 */
export function parseTaxRateFraction(raw: unknown): number {
  const val = Number(raw);
  if (!Number.isFinite(val) || val < 0) return 0;
  return val > 1 ? val / 100 : val;
}

/** Default del catálogo para un impuesto (punto de partida, no veredicto). */
export function catalogInclusiveDefault(
  cat: Pick<
    TaxInclusiveCatalogEntry,
    'is_inclusive' | 'tax_rates'
  > | null | undefined,
): boolean {
  return !!(cat?.is_inclusive ?? cat?.tax_rates?.[0]?.is_inclusive ?? false);
}

/**
 * Resuelve el flag efectivo para UN impuesto: el mapa de la vista gana;
 * sin entrada, cae al default del catálogo (F-024, ruta de lectura).
 */
export function resolveTaxInclusive(
  taxId: number,
  map: TaxInclusiveMap | null | undefined,
  catalog: readonly TaxInclusiveCatalogEntry[] | null | undefined,
): boolean {
  const hit = map?.[taxId];
  if (hit !== undefined) return hit;
  return catalogInclusiveDefault(catalog?.find((c) => c.id === taxId));
}

/**
 * Construye el mapa de vista para UN producto desde cero (scope por producto,
 * F-023): defaults del catálogo primero, asignaciones después — la asignación
 * gana siempre, sin importar si el catálogo cargó antes o después (F-024).
 *
 * Cada asignación resuelve `ta.is_inclusive ?? ta.tax_categories.is_inclusive
 * ?? catálogo` (F-007/F-022). Sin dato en ningún nivel, queda el default del
 * catálogo ya sembrado (o `undefined` ⇒ fallback en lectura si el catálogo aún
 * no cargó).
 */
export function hydrateTaxInclusiveMap(
  assignments: readonly TaxInclusiveAssignmentEntry[] | null | undefined,
  catalog: readonly TaxInclusiveCatalogEntry[] | null | undefined,
): TaxInclusiveMap {
  const fresh: TaxInclusiveMap = {};
  for (const cat of catalog ?? []) {
    if (cat && Number.isFinite(cat.id)) {
      fresh[cat.id] = catalogInclusiveDefault(cat);
    }
  }
  for (const ta of assignments ?? []) {
    const id = Number(ta?.tax_category_id);
    if (!Number.isFinite(id)) continue;
    const v =
      ta?.is_inclusive ?? ta?.tax_categories?.is_inclusive ?? undefined;
    if (v !== undefined && v !== null) {
      fresh[id] = !!v;
    }
  }
  return fresh;
}

/**
 * Filtra el mapa de vista a los ids efectivos y lo deja en forma de cable
 * (`Record<string, boolean>`). Todo lo que no esté seleccionado se cae:
 * ni fugas entre productos (F-023) ni resurrecciones al re-añadir (F-032).
 */
export function buildTaxInclusivePayload(
  effectiveIds: readonly unknown[] | null | undefined,
  map: TaxInclusiveMap | null | undefined,
): TaxInclusivePayloadMap {
  const payload: TaxInclusivePayloadMap = {};
  const seen = new Set<number>();
  for (const raw of effectiveIds ?? []) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    const hit = map?.[id];
    if (hit !== undefined) payload[String(id)] = !!hit;
  }
  return payload;
}

/** Copia del mapa sin la entrada de un impuesto (al quitarlo, F-032). */
export function withoutTaxFromMap(
  map: TaxInclusiveMap | null | undefined,
  taxId: number,
): TaxInclusiveMap {
  const next: TaxInclusiveMap = { ...(map ?? {}) };
  delete next[taxId];
  return next;
}

/**
 * Normaliza un mapa crudo (draft de navegación, valor de un FormControl) a
 * `TaxInclusiveMap`: claves numéricas, valores booleanos.
 */
export function normalizeTaxInclusiveMap(raw: unknown): TaxInclusiveMap {
  const out: TaxInclusiveMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isFinite(id)) continue;
    out[id] = !!value;
  }
  return out;
}

/**
 * Estimado de "precio con impuestos" SOLO para exhibición en el formulario.
 *
 * - Base con impuestos incluidos: se extrae la base neta (`base / (1+tasa)`);
 * - impuestos adicionales: se suman sobre la base neta.
 *
 * Es especificación de signo, no oráculo de centavos (F-013): el backend es la
 * única fuente para el total facturable.
 */
export function estimatePriceWithTax(
  basePrice: number,
  entries: readonly { rateFraction: number; inclusive: boolean }[] | null | undefined,
): number {
  const base = Number(basePrice) || 0;
  let inclusiveRate = 0;
  let additionalRate = 0;
  for (const e of entries ?? []) {
    const rate = Number(e?.rateFraction) || 0;
    if (rate <= 0) continue;
    if (e?.inclusive) inclusiveRate += rate;
    else additionalRate += rate;
  }
  const netBase = estimateNetBase(base, inclusiveRate);
  return base + netBase * additionalRate;
}

/** Base neta tras extraer la porción de impuestos incluidos (puede ser `base`). */
export function estimateNetBase(basePrice: number, inclusiveRate: number): number {
  const base = Number(basePrice) || 0;
  const rate = Number(inclusiveRate) || 0;
  return rate > 0 ? base / (1 + rate) : base;
}

export type BulkTaxActionMode = 'add' | 'remove' | 'replace';

export interface CoercedBulkTaxAction {
  mode: BulkTaxActionMode;
  ids: number[];
  /** Solo presente cuando hay al menos una entrada filtrada a `ids`. */
  inclusive?: TaxInclusivePayloadMap;
}

function isBulkTaxActionMode(raw: unknown): raw is BulkTaxActionMode {
  return raw === 'add' || raw === 'remove' || raw === 'replace';
}

/**
 * Coerción de la acción masiva de impuestos, INCLUSIVE preservado (F-028).
 *
 * La página (`products-bulk-edit-page.component.ts`, fuera del alcance de este
 * cambio) debe delegar su rama `'tax-action'` de `coerceBulkEditValue` a esta
 * función —ver parche exacto en el mensaje del commit—. Hasta entonces, el
 * hijo ya escribe `inclusive` en el FormGroup y esta función es su espejo.
 *
 * Devuelve `undefined` cuando no hay nada que mandar (modo inválido).
 * `inclusive` se filtra a `ids`: quitar un impuesto de la selección lo saca
 * también del mapa (F-032).
 */
export function coerceBulkTaxAction(raw: unknown): CoercedBulkTaxAction | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const action = raw as {
    mode?: unknown;
    ids?: unknown;
    [BULK_TAX_INCLUSIVE_CONTROL]?: unknown;
  };
  const modeRaw = typeof action.mode === 'string' ? action.mode : 'add';
  if (!isBulkTaxActionMode(modeRaw)) return undefined;
  const rawIds = Array.isArray(action.ids) ? action.ids : [];
  const ids = [...new Set(
    rawIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0),
  )];
  const inclusive = buildTaxInclusivePayload(
    ids,
    normalizeTaxInclusiveMap(action[BULK_TAX_INCLUSIVE_CONTROL]),
  );
  const out: CoercedBulkTaxAction = { mode: modeRaw, ids };
  if (Object.keys(inclusive).length > 0) out.inclusive = inclusive;
  return out;
}
