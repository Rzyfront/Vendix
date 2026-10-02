import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { VexiSettingsComponent } from '../vexi/vexi-settings.component';
import { VexSettingsComponent } from './vex-settings.component';

type AiAgentsTab = 'vexi' | 'vex';

/**
 * "Agentes IA" settings page (`/admin/settings/ai-agents`).
 *
 * Tab container over the per-agent settings: Vexi (the in-app assistant) and
 * Vex (the fullscreen business agent). Deep-linkable via `?tab=vex`; anything
 * else — including the legacy `/admin/settings/vexi` redirect, which lands
 * here without a query param — opens the Vexi tab.
 *
 * The whole page is gated by `aiAgentsSettingsGuard` (owner/admin): both tabs
 * flip store-wide switches, so there is no per-tab role split.
 */
@Component({
  selector: 'app-ai-agents-settings',
  standalone: true,
  imports: [IconComponent, VexiSettingsComponent, VexSettingsComponent],
  template: `
    <div class="w-full max-w-3xl">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-[var(--color-text-primary)] mb-2">Agentes IA</h1>
        <p class="text-[var(--color-text-secondary)]">
          Los asistentes de inteligencia artificial de tu tienda. Cada uno se
          activa por separado y solo lo configuran el propietario y los
          administradores.
        </p>
      </div>

      <div
        class="flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-1 mb-6"
        role="tablist"
        aria-label="Agentes IA"
      >
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="activeTab() === 'vexi'"
          [attr.tabindex]="activeTab() === 'vexi' ? 0 : -1"
          (click)="selectTab('vexi')"
          class="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors"
          [class.bg-surface]="activeTab() === 'vexi'"
          [class.shadow-sm]="activeTab() === 'vexi'"
          [class.text-[var(--color-text-primary)]]="activeTab() === 'vexi'"
          [class.text-[var(--color-text-secondary)]]="activeTab() !== 'vexi'"
          [class.hover:text-[var(--color-text-primary)]]="activeTab() !== 'vexi'"
        >
          <app-icon name="bot" [size]="16" />
          Vexi
        </button>
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="activeTab() === 'vex'"
          [attr.tabindex]="activeTab() === 'vex' ? 0 : -1"
          (click)="selectTab('vex')"
          class="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors"
          [class.bg-surface]="activeTab() === 'vex'"
          [class.shadow-sm]="activeTab() === 'vex'"
          [class.text-[var(--color-text-primary)]]="activeTab() === 'vex'"
          [class.text-[var(--color-text-secondary)]]="activeTab() !== 'vex'"
          [class.hover:text-[var(--color-text-primary)]]="activeTab() !== 'vex'"
        >
          <app-icon name="sparkles" [size]="16" />
          Vex
        </button>
      </div>

      @if (activeTab() === 'vexi') {
        <div role="tabpanel" aria-label="Configuración de Vexi">
          <app-vexi-settings />
        </div>
      } @else {
        <div role="tabpanel" aria-label="Configuración de Vex">
          <app-vex-settings />
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class AiAgentsSettingsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly activeTab = signal<AiAgentsTab>(
    this.route.snapshot.queryParamMap.get('tab') === 'vex' ? 'vex' : 'vexi',
  );

  selectTab(tab: AiAgentsTab): void {
    if (tab === this.activeTab()) return;
    this.activeTab.set(tab);
    // `vexi` is the default tab and keeps a clean URL; only `vex` persists
    // the query param so the link stays shareable.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'vex' ? 'vex' : null },
      queryParamsHandling: 'merge',
    });
  }
}
