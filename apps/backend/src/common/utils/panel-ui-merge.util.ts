import { hasPrivilegedRole } from './privileged-roles.util';

type PanelUiNested = Record<string, Record<string, boolean>>;
type PanelUiSeenKeys = Record<string, string[]>;
type PanelUiNewKeys = Record<string, string[]>;

/**
 * Detecta formato legacy plano: top-level keys con valor `boolean` en vez
 * de objetos por app_type. Ej: `{ products: true, dashboard: false }`.
 * El formato válido actual es nested: `{ ORG_ADMIN: {...}, STORE_ADMIN: {...} }`.
 */
function isLegacyFlatPanelUi(panelUi: unknown): boolean {
  if (!panelUi || typeof panelUi !== 'object') return false;
  const values = Object.values(panelUi as Record<string, unknown>);
  if (values.length === 0) return false;
  return values.every((v) => typeof v === 'boolean');
}

/**
 * Merge soft de panel_ui del usuario con los defaults nested por app_type.
 *
 * Reglas:
 *  - Si `userPanelUi` viene en formato legacy plano se descarta por completo
 *    (sin intento de migrar valores) y se trata como si el usuario no
 *    tuviera config.
 *  - El merge soft aplica SOLO si el usuario tiene rol privilegiado
 *    (owner/admin/super_admin). Si no, devuelve la base tal cual.
 *  - User wins: si una key existe en `userPanelUi[appType]` (incluso con
 *    valor `false`), se respeta. Los defaults solo rellenan keys ausentes.
 *
 * Formato soportado: nested por app_type. No se persiste.
 */
export function mergePanelUiSoft(
  userPanelUi: PanelUiNested | null | undefined,
  defaults: PanelUiNested | null | undefined,
  userRoles:
    | ReadonlyArray<string | { name?: string | null } | null | undefined>
    | null
    | undefined,
): PanelUiNested {
  const base: PanelUiNested =
    !isLegacyFlatPanelUi(userPanelUi) &&
    userPanelUi &&
    typeof userPanelUi === 'object'
      ? { ...userPanelUi }
      : {};

  if (!defaults || !hasPrivilegedRole(userRoles)) {
    return base;
  }

  for (const [appType, defaultKeys] of Object.entries(defaults)) {
    if (!defaultKeys || typeof defaultKeys !== 'object') continue;
    const current = { ...(base[appType] || {}) };
    for (const [key, value] of Object.entries(defaultKeys)) {
      if (current[key] === undefined) {
        current[key] = value;
      }
    }
    base[appType] = current;
  }

  return base;
}

/**
 * Calcula los `new_keys` por app_type: keys que existen en `defaults` pero
 * que NO están en `panel_ui_seen_keys[app_type]` del usuario. Sirve para
 * mostrar el badge "Nuevo" en el menú lateral cuando se agregan módulos
 * recientes al `PANEL_UI_FALLBACK`.
 *
 * Reglas:
 *  - Solo se computa para roles privilegiados (los demás siempre devuelven
 *    arrays vacíos por app_type).
 *  - Si el usuario no tiene `panel_ui_seen_keys` (clientes legacy), todas
 *    las keys de los defaults se consideran "new" hasta el primer click.
 *  - El resultado siempre incluye TODAS las app_type claves de `defaults`
 *    con un array (posiblemente vacío) — facilita consumo en frontend.
 */
export function computeNewPanelUiKeys(
  defaults: PanelUiNested | null | undefined,
  seenKeys: PanelUiSeenKeys | null | undefined,
  userRoles:
    | ReadonlyArray<string | { name?: string | null } | null | undefined>
    | null
    | undefined,
): PanelUiNewKeys {
  const result: PanelUiNewKeys = {};
  if (!defaults || typeof defaults !== 'object') {
    return result;
  }

  const isPrivileged = hasPrivilegedRole(userRoles);
  const safeSeen: PanelUiSeenKeys =
    seenKeys && typeof seenKeys === 'object' ? seenKeys : {};

  for (const [appType, defaultKeys] of Object.entries(defaults)) {
    if (!defaultKeys || typeof defaultKeys !== 'object') {
      result[appType] = [];
      continue;
    }
    if (!isPrivileged) {
      result[appType] = [];
      continue;
    }
    const seenForApp = Array.isArray(safeSeen[appType])
      ? safeSeen[appType]
      : [];
    const seenSet = new Set(seenForApp);
    result[appType] = Object.keys(defaultKeys).filter((k) => !seenSet.has(k));
  }

  return result;
}

/**
 * Versión que opera sobre el `config` completo. Devuelve un nuevo objeto
 * `config` con `panel_ui` mergeado y `new_keys` calculado cuando corresponde.
 *
 * El campo `new_keys` se agrega al config retornado (no se persiste) y
 * permite al frontend renderizar el badge "Nuevo" sin lógica adicional.
 */
export function mergeUserConfigPanelUi(
  config: Record<string, any> | null | undefined,
  defaults: PanelUiNested | null | undefined,
  userRoles:
    | ReadonlyArray<string | { name?: string | null } | null | undefined>
    | null
    | undefined,
): Record<string, any> {
  const safeConfig = config && typeof config === 'object' ? config : {};
  const merged = mergePanelUiSoft(
    safeConfig.panel_ui as PanelUiNested | null | undefined,
    defaults,
    userRoles,
  );
  const seenKeys = safeConfig.panel_ui_seen_keys as
    | PanelUiSeenKeys
    | null
    | undefined;
  const newKeys = computeNewPanelUiKeys(defaults, seenKeys, userRoles);
  return {
    ...safeConfig,
    panel_ui: merged,
    panel_ui_seen_keys: seenKeys || {},
    new_keys: newKeys,
  };
}
