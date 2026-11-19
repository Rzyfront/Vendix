/**
 * HOME PANELS — closed catalog of the store "Panel Principal" (QUI-967).
 *
 * Canonical source. The backend copy is the canonical one and is copied BYTE
 * FOR BYTE to the frontend, because the repo has no executable package shared
 * between Nest and Angular (same criterion as `module-industries.ts`):
 *
 *   - apps/backend/src/common/access/home-panels.ts
 *   - apps/frontend/src/app/shared/constants/home-panels.ts
 *
 * `apps/backend/src/common/access/home-panels.parity.spec.ts` fails if the
 * frontend mirror drifts. Edit this file, then copy it over the mirror.
 *
 * The setting is per store (`store_settings.settings.home_panel`). A store
 * without the key keeps the current "Resumen" (existing stores never change
 * until someone saves); new stores are created with the industry suggestion.
 *
 * Pure data + pure functions: no imports, no runtime dependencies.
 */

export const HOME_PANEL_IDS = [
  'summary',
  'occupancy',
  'reservations_agenda',
  'scheduled_orders_agenda',
  'production',
  'workflows_board',
  'crm_pipeline',
] as const;

export type HomePanelId = (typeof HOME_PANEL_IDS)[number];

export interface HomePanelSettings {
  /** Panel the store opens on. Always one of `enabled_panels`. */
  default_panel: HomePanelId;
  /** Panels shown as tabs, in order. */
  enabled_panels: HomePanelId[];
}

/** Suggested maximum of enabled panels (soft limit shown in the settings UI). */
export const HOME_PANEL_MAX_ENABLED = 4;

/** Panel used when a store has no saved choice (existing stores). */
export const HOME_PANEL_FALLBACK: HomePanelId = 'summary';

/**
 * Industry → suggested panel, in priority order for multi-industry stores:
 * Hotelería > Servicios > Pedidos programados > Administración > Resumen.
 * Any industry not listed (retail, gym, manufacturing, construction…) gets
 * the "Resumen".
 */
export const INDUSTRY_DEFAULT_HOME_PANEL: ReadonlyArray<
  readonly [string, HomePanelId]
> = [
  ['hospitality', 'occupancy'],
  ['service', 'reservations_agenda'],
  ['restaurant', 'scheduled_orders_agenda'],
  ['administration', 'workflows_board'],
];

export function isHomePanelId(value: unknown): value is HomePanelId {
  return (
    typeof value === 'string' &&
    (HOME_PANEL_IDS as readonly string[]).includes(value)
  );
}

/** Suggested home panel for a set of store industries. */
export function suggestHomePanel(
  industries: readonly string[] | null | undefined,
): HomePanelId {
  const list = Array.isArray(industries) ? industries : [];
  for (const [industry, panel] of INDUSTRY_DEFAULT_HOME_PANEL) {
    if (list.includes(industry)) return panel;
  }
  return HOME_PANEL_FALLBACK;
}

/**
 * Suggested `home_panel` setting: the suggested panel first and the "Resumen"
 * as a second tab (so indicators stay one click away).
 */
export function suggestHomePanelSettings(
  industries: readonly string[] | null | undefined,
): HomePanelSettings {
  const panel = suggestHomePanel(industries);
  return {
    default_panel: panel,
    enabled_panels:
      panel === HOME_PANEL_FALLBACK ? [panel] : [panel, HOME_PANEL_FALLBACK],
  };
}
