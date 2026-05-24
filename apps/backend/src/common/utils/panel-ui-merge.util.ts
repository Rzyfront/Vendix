import { hasPrivilegedRole } from './privileged-roles.util';

type PanelUiNested = Record<string, Record<string, boolean>>;

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
 * Versión que opera sobre el `config` completo. Devuelve un nuevo objeto
 * `config` con `panel_ui` mergeado cuando corresponde.
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
  return { ...safeConfig, panel_ui: merged };
}
