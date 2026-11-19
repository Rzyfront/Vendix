import { Injectable, computed, inject } from '@angular/core';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { MenuFilterService } from '../../../../../core/services/menu-filter.service';
import { canUserAccessDashboard } from '../../../../../core/utils/dashboard-access.util';
import { DashboardAccessExtension } from '../../../../../core/services/dashboard-access-extension.service';
import { industryAllowsKey } from '../../../../../shared/constants/module-industries';
import {
  HOME_PANEL_FALLBACK,
  HomePanelId,
  HomePanelSettings,
  isHomePanelId,
  suggestHomePanel,
  suggestHomePanelSettings,
} from '../../../../../shared/constants/home-panels';
import { StoreSettings } from '../../../../../core/models/store-settings.interface';
import {
  HOME_PANEL_REGISTRY,
  HOME_PANELS,
  HomePanelDefinition,
} from './home-panel.registry';

/**
 * QUI-967 — resolves which panels the store "Panel Principal" shows.
 *
 * 1. Store eligibility: industry allows the panel keys, the store panel_ui
 *    does not switch them off, the plan includes them, plus the panel's own
 *    store condition. The "Resumen" is always eligible.
 * 2. Store config: saved `home_panel`; without it the store keeps the
 *    "Resumen" (existing stores never change until someone saves).
 * 3. User visibility: eligible ∧ the user's panel_ui ∧ permission (owner
 *    always passes).
 * 4. Tabs: `default_panel` first, then the rest of `enabled_panels`, visible
 *    only. Nothing visible → the "Resumen" if the user may see it; still
 *    nothing → empty: the guard keeps its current rule (first active module
 *    / no-access). Never a blank screen nor a 403.
 */
@Injectable({ providedIn: 'root' })
export class HomePanelService {
  private readonly auth = inject(AuthFacade);
  private readonly menuFilter = inject(MenuFilterService);

  private readonly settings = computed(
    () => this.auth.storeSettings() as StoreSettings | null | undefined,
  );

  /** Panels the store may configure (industry, module, plan). */
  readonly eligiblePanels = computed<HomePanelDefinition[]>(() => {
    const settings = this.settings();
    const industries = this.auth.storeIndustries();
    return HOME_PANELS.filter((panel) =>
      this.isStoreEligible(panel, settings, industries),
    );
  });

  /** Panel suggested for the store industries, when eligible. */
  readonly suggestedPanel = computed<HomePanelId>(() => {
    const suggested = suggestHomePanel(this.auth.storeIndustries());
    return this.eligiblePanels().some((panel) => panel.id === suggested)
      ? suggested
      : HOME_PANEL_FALLBACK;
  });

  /** Suggested `home_panel` value, restricted to eligible panels. */
  readonly suggestedSettings = computed<HomePanelSettings>(() => {
    const eligible = new Set(this.eligiblePanels().map((p) => p.id));
    const suggestion = suggestHomePanelSettings(this.auth.storeIndustries());
    const enabled = suggestion.enabled_panels.filter((id) => eligible.has(id));
    const fallbackDefault = this.suggestedPanel();
    return {
      default_panel: fallbackDefault,
      enabled_panels: enabled.includes(fallbackDefault)
        ? enabled
        : [fallbackDefault, ...enabled],
    };
  });

  /** Saved store configuration, or the "Resumen" for unconfigured stores. */
  readonly storeConfig = computed<HomePanelSettings>(() =>
    normalizeHomePanelSettings(this.settings()?.home_panel),
  );

  /** Tabs the current user sees, the home panel first. */
  readonly visibleTabs = computed<HomePanelDefinition[]>(() => {
    const eligible = new Set(this.eligiblePanels().map((p) => p.id));
    const canSee = (id: HomePanelId) =>
      eligible.has(id) && this.isUserVisible(HOME_PANEL_REGISTRY[id]);

    const config = this.storeConfig();
    const ordered = [
      config.default_panel,
      ...config.enabled_panels.filter((id) => id !== config.default_panel),
    ];
    const tabs = ordered.filter(canSee);
    if (tabs.length) return tabs.map((id) => HOME_PANEL_REGISTRY[id]);

    // Nothing enabled is visible for this user: the "Resumen" (current
    // behaviour). Without it, empty: the guard keeps its current rule.
    return canSee(HOME_PANEL_FALLBACK)
      ? [HOME_PANEL_REGISTRY[HOME_PANEL_FALLBACK]]
      : [];
  });

  constructor() {
    // Lets `core` (sidebar, guards) apply the Panel Principal entry rule.
    inject(DashboardAccessExtension).register(() => this.canEnterDashboard());
  }

  /** True when the user can open `/admin/dashboard` (at least one tab). */
  canEnterDashboard(): boolean {
    return this.visibleTabs().length > 0;
  }

  private isStoreEligible(
    panel: HomePanelDefinition,
    settings: StoreSettings | null | undefined,
    industries: string[],
  ): boolean {
    if (panel.id === HOME_PANEL_FALLBACK) return true;
    const storePanel = settings?.panel_ui?.STORE_ADMIN;
    const keysAllowed = panel.moduleKeys.every(
      (key) =>
        industryAllowsKey(key, industries) &&
        storePanel?.[key] !== false &&
        !this.menuFilter.planDeniesKey(key),
    );
    return keysAllowed && (panel.storeCondition?.(settings) ?? true);
  }

  private isUserVisible(panel: HomePanelDefinition): boolean {
    if (panel.id === HOME_PANEL_FALLBACK) {
      return canUserAccessDashboard(this.auth);
    }
    const keysVisible = panel.moduleKeys.every(
      (key) => this.menuFilter.canSeeKey(key).allowed,
    );
    if (!keysVisible) return false;
    return (
      this.auth.isOwner() || this.auth.hasAnyPermission([...panel.permissions])
    );
  }
}

/**
 * Sanitizes a stored `home_panel`: unknown ids are dropped without error and
 * `default_panel` always ends up first among the enabled panels. Missing or
 * empty → the "Resumen" (existing stores).
 */
export function normalizeHomePanelSettings(
  value: Partial<HomePanelSettings> | null | undefined,
): HomePanelSettings {
  const enabled = Array.isArray(value?.enabled_panels)
    ? value!.enabled_panels.filter(isHomePanelId)
    : [];
  const unique = [...new Set(enabled)];
  const defaultPanel = isHomePanelId(value?.default_panel)
    ? value!.default_panel
    : (unique[0] ?? HOME_PANEL_FALLBACK);
  return {
    default_panel: defaultPanel,
    enabled_panels: unique.includes(defaultPanel)
      ? unique
      : [defaultPanel, ...unique],
  };
}
