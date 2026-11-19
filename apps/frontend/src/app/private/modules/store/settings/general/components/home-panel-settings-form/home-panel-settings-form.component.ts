import { Component, computed, inject, input, output } from '@angular/core';

import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import {
  HOME_PANEL_EDITOR_ROLES,
  HOME_PANEL_MAX_ENABLED,
  HomePanelId,
  HomePanelSettings,
} from '../../../../../../../shared/constants/home-panels';
import {
  HomePanelService,
  normalizeHomePanelSettings,
} from '../../../../dashboard/home-panels/home-panel.service';

/**
 * Section «Panel principal»: which panel the store opens on and which extra
 * panels appear as tabs. Receives the saved section and emits the whole
 * section on every change (the settings store saves it with the rest).
 */
@Component({
  selector: 'app-home-panel-settings-form',
  standalone: true,
  imports: [IconComponent, ButtonComponent],
  template: `
    <div class="space-y-5">
      @if (!canEdit()) {
        <p class="home-panel-hint text-xs text-gray-500">
          Solo el propietario o un administrador pueden cambiar el panel
          principal.
        </p>
      }

      <div>
        <h4 class="text-sm font-semibold text-gray-800">Panel de inicio</h4>
        <p class="text-xs text-gray-500 mb-2">
          Es lo primero que ve tu equipo al entrar al Panel Principal.
        </p>
        <div
          class="grid grid-cols-1 sm:grid-cols-2 gap-2"
          role="radiogroup"
          aria-label="Panel de inicio"
        >
          @for (panel of eligible(); track panel.id) {
            <button
              type="button"
              role="radio"
              class="home-panel-card text-left flex gap-3 p-3 rounded-xl border transition-colors"
              [class.border-primary]="value().default_panel === panel.id"
              [class.bg-primary-light]="value().default_panel === panel.id"
              [class.border-gray-200]="value().default_panel !== panel.id"
              [attr.aria-checked]="value().default_panel === panel.id"
              [attr.data-panel]="panel.id"
              [disabled]="!canEdit()"
              (click)="selectHome(panel.id)"
            >
              <app-icon [name]="panel.icon" [size]="20" class="shrink-0" />
              <span class="flex-1">
                <span class="block text-sm font-semibold text-gray-800">
                  {{ panel.title }}
                </span>
                <span class="block text-xs text-gray-500">
                  {{ panel.description }}
                </span>
                @if (panel.id === suggestedId()) {
                  <span
                    class="home-panel-suggested inline-block mt-1 text-[10px] font-semibold text-primary"
                  >
                    Sugerido para tu industria
                  </span>
                }
              </span>
            </button>
          }
        </div>
      </div>

      @if (extraPanels().length > 0) {
        <div>
          <h4 class="text-sm font-semibold text-gray-800">
            Paneles adicionales
          </h4>
          <p class="text-xs text-gray-500 mb-2">
            Aparecen como pestañas en el Panel Principal.
          </p>
          <ul class="space-y-1">
            @for (panel of eligible(); track panel.id) {
              <li>
                <label
                  class="home-panel-extra flex items-center gap-3 p-2 rounded-lg border border-gray-100"
                  [attr.data-panel]="panel.id"
                >
                  <input
                    type="checkbox"
                    class="accent-primary"
                    [checked]="isEnabled(panel.id)"
                    [disabled]="!canEdit() || panel.id === value().default_panel"
                    (change)="toggleExtra(panel.id, $any($event.target).checked)"
                  />
                  <app-icon [name]="panel.icon" [size]="16" />
                  <span class="text-sm text-gray-700">{{ panel.title }}</span>
                  @if (panel.id === value().default_panel) {
                    <span class="text-[10px] text-gray-500">Panel de inicio</span>
                  }
                </label>
              </li>
            }
          </ul>
          @if (overLimit()) {
            <p class="home-panel-limit text-xs text-gray-500 mt-2">
              Recomendamos máximo {{ maxEnabled }} paneles para que la barra de
              pestañas se mantenga clara.
            </p>
          }
        </div>
      }

      @if (canEdit()) {
        <div>
          <app-button
            variant="outline"
            size="sm"
            (clicked)="useSuggested()"
          >
            Usar sugerido
          </app-button>
        </div>
      }
    </div>
  `,
})
export class HomePanelSettingsForm {
  private readonly auth = inject(AuthFacade);
  private readonly panels = inject(HomePanelService);

  /** Saved section; `undefined` = the store never chose (keeps the Resumen). */
  readonly settings = input<HomePanelSettings | undefined>();
  readonly settingsChange = output<HomePanelSettings>();

  protected readonly maxEnabled = HOME_PANEL_MAX_ENABLED;

  protected readonly eligible = this.panels.eligiblePanels;
  protected readonly suggestedId = this.panels.suggestedPanel;

  protected readonly canEdit = computed(
    () =>
      this.auth.isOwner() ||
      this.auth.isAdmin() ||
      this.auth.hasAnyRole([...HOME_PANEL_EDITOR_ROLES]),
  );

  /** Current value restricted to eligible panels, home panel first. */
  protected readonly value = computed<HomePanelSettings>(() => {
    const normalized = normalizeHomePanelSettings(this.settings());
    const eligibleIds = new Set(this.eligible().map((p) => p.id));
    const enabled = normalized.enabled_panels.filter((id) =>
      eligibleIds.has(id),
    );
    return {
      default_panel: normalized.default_panel,
      enabled_panels: enabled.includes(normalized.default_panel)
        ? enabled
        : [normalized.default_panel, ...enabled],
    };
  });

  protected readonly extraPanels = computed(() =>
    this.eligible().filter((p) => p.id !== this.value().default_panel),
  );

  protected readonly overLimit = computed(
    () => this.value().enabled_panels.length > HOME_PANEL_MAX_ENABLED,
  );

  protected isEnabled(id: HomePanelId): boolean {
    return this.value().enabled_panels.includes(id);
  }

  protected selectHome(id: HomePanelId): void {
    if (!this.canEdit()) return;
    const current = this.value();
    const rest = current.enabled_panels.filter((p) => p !== id);
    this.settingsChange.emit({
      default_panel: id,
      enabled_panels: [id, ...rest],
    });
  }

  protected toggleExtra(id: HomePanelId, checked: boolean): void {
    const current = this.value();
    if (!this.canEdit() || id === current.default_panel) return;
    const rest = current.enabled_panels.filter(
      (p) => p !== id && p !== current.default_panel,
    );
    const next = checked ? [...rest, id] : rest;
    this.settingsChange.emit({
      default_panel: current.default_panel,
      enabled_panels: [current.default_panel, ...next],
    });
  }

  protected useSuggested(): void {
    if (!this.canEdit()) return;
    this.settingsChange.emit(this.panels.suggestedSettings());
  }
}
