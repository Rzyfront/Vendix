import type { StoreSettings, PanelUiSettings } from '../types/settings.types';

/**
 * Aplana `panel_ui.{app}.{module}` a `panel_ui.{module}` para que la UI
 * pueda hablar consistentemente de la app activa (la mayoría de los
 * consumidores de la pantalla de Configuración son STORE_ADMIN). La
 * sección `app` se infiere del flag `targetApp` (por defecto
 * `STORE_ADMIN`).
 *
 * Si `panel_ui` ya está en la raíz, se devuelve tal cual.
 */
export function flattenPanelUi(
  panelUi: PanelUiSettings | undefined,
  targetApp = 'STORE_ADMIN',
): Record<string, boolean> | undefined {
  if (!panelUi) return undefined;
  const fromTarget = panelUi[targetApp];
  if (fromTarget) return { ...fromTarget };
  const asRoot: Record<string, boolean> = {};
  for (const [appKey, modules] of Object.entries(panelUi)) {
    if (appKey === 'STORE_ADMIN' || appKey === 'STORE_ECOMMERCE') continue;
    if (!modules) continue;
    for (const [moduleKey, value] of Object.entries(modules)) {
      if (typeof value === 'boolean') asRoot[moduleKey] = value;
    }
  }
  return asRoot;
}

/** Anida un panel_ui plano dentro de la app objetivo. */
export function nestPanelUi(
  panelUi: Record<string, boolean> | undefined,
  targetApp = 'STORE_ADMIN',
): PanelUiSettings | undefined {
  if (!panelUi) return undefined;
  return { [targetApp]: { ...panelUi } } as PanelUiSettings;
}

/**
 * Compara dos `StoreSettings` y devuelve un PATCH mínimo con solo las
 * secciones cuyo JSON cambia. Si no hay cambios, devuelve `null` para
 * que la UI no haga un PATCH vacío.
 *
 * El backend hace deep-merge por sección, así que un top-level solo
 * incluye claves realmente modificadas; las claves deprecadas/
 * desconocidas (e.g. `app`, `branding`, `fiscal_status`) no se envían.
 */
const PATCHABLE_SECTIONS: ReadonlyArray<keyof StoreSettings> = [
  'general',
  'inventory',
  'checkout',
  'notifications',
  'pos',
  'receipts',
  'operations',
  'dispatch',
  'restaurant',
  'membership',
  'panel_ui',
];

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const key of keys) {
    if (!deepEqual(ao[key], bo[key])) return false;
  }
  return true;
}

export function buildSettingsUpdatePayload(
  form: Partial<StoreSettings>,
  original: Partial<StoreSettings> | null | undefined,
  targetApp = 'STORE_ADMIN',
): Partial<StoreSettings> | null {
  if (!form) return null;
  const payload: Partial<StoreSettings> = {};
  let mutated = false;
  for (const key of PATCHABLE_SECTIONS) {
    if (!(key in form)) continue;
    const next = (form as Record<string, unknown>)[key as string];
    const prev = original ? (original as Record<string, unknown>)[key as string] : undefined;
    if (deepEqual(next, prev)) continue;
    if (key === 'panel_ui') {
      // Aplana a la app objetivo antes de enviar.
      const flat = flattenPanelUi(next as PanelUiSettings, targetApp);
      const flatPrev = flattenPanelUi(prev as PanelUiSettings | undefined, targetApp);
      if (deepEqual(flat, flatPrev)) continue;
      const nested = nestPanelUi(flat, targetApp);
      if (nested) {
        (payload as Record<string, unknown>).panel_ui = nested;
        mutated = true;
      }
    } else {
      (payload as Record<string, unknown>)[key as string] = next;
      mutated = true;
    }
  }
  return mutated ? payload : null;
}

/**
 * Normaliza la respuesta del backend: si viene `panel_ui.STORE_ADMIN.{k}`,
 * mantiene la forma anidada; la UI ya opera contra la raíz cuando el
 * panel objetivo es STORE_ADMIN (ver `flattenPanelUi`).
 */
export function normalizeSettingsResponse(
  raw: Partial<StoreSettings> | null | undefined,
): Partial<StoreSettings> | null {
  if (!raw) return null;
  return raw;
}
