import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';

import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import type { StoreSettings } from '../../../../core/models/store-settings.interface';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { BadgeComponent } from '../../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { StoreApp } from './interfaces/store-app.interface';
import { StoreAppsService } from './services/store-apps.service';
import { AppCard, toAppCard } from './utils/app-card.util';
import { MenuFilterService } from '../../../../core/services/menu-filter.service';

/**
 * `/admin/apps` — catalog of the store's web apps (odd/tasks/apps-module.md
 * S4/T6, apps-vistas-f1 S2/S6). It only loads the light list
 * (`GET /store/apps`: status, encendida, domain, public URL); each card opens
 * the app's own view, where its detail is fetched. No app is managed from a
 * modal.
 */
@Component({
  selector: 'app-apps-catalog',
  standalone: true,
  imports: [
    RouterModule,
    BadgeComponent,
    IconComponent,
  ],
  template: `
    <div class="w-full max-w-6xl mx-auto px-3 py-4 md:px-6 md:py-6">
      <header class="mb-5">
        <h1 class="text-xl font-semibold text-[var(--color-text-primary)]">Apps</h1>
        <p class="mt-1 text-sm text-[var(--color-text-secondary)]">
          Las aplicaciones web que tu negocio puede publicar, con su estado y su dominio.
        </p>
      </header>

      @if (!appsEnabled()) {
        <div
          class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-secondary)]"
          data-testid="apps-disabled-notice"
        >
          El módulo Apps está apagado en esta tienda. El propietario lo enciende en
          Configuración, General, Negocio.
        </div>
      }

      @if (loading()) {
        <p class="text-sm text-[var(--color-text-secondary)]">Cargando apps…</p>
      } @else if (error()) {
        <div
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm"
          role="alert"
        >
          <p class="text-[var(--color-text-primary)]">{{ error() }}</p>
          <button
            type="button"
            class="mt-2 text-sm font-semibold text-[var(--color-primary)]"
            (click)="load()"
          >
            Reintentar
          </button>
        </div>
      } @else {
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="apps-grid">
          @for (card of cards(); track card.key) {
            <article
              class="flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
              [attr.data-app]="card.key"
            >
              <div class="flex items-start gap-3">
                <div
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-background)] text-[var(--color-primary)]"
                >
                  <app-icon [name]="card.icon" [size]="20" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-base font-semibold text-[var(--color-text-primary)]">
                      {{ card.name }}
                    </h2>
                    <app-badge [variant]="card.statusVariant" size="xs">
                      {{ card.statusLabel }}
                    </app-badge>
                  </div>
                  <p class="mt-1 text-sm text-[var(--color-text-secondary)]">
                    {{ card.description }}
                  </p>
                </div>
              </div>

              <dl class="mt-3 space-y-1 text-xs text-[var(--color-text-secondary)]">
                <div class="flex gap-1">
                  <dt class="font-medium">Encendida:</dt>
                  <dd>{{ card.enabled ? 'Sí' : 'No' }}</dd>
                </div>
                <div class="flex gap-1">
                  <dt class="font-medium">Dominio:</dt>
                  <dd class="truncate">{{ card.hostname ?? 'Sin dominio' }}</dd>
                </div>
                @if (card.publicUrl) {
                  <div class="flex gap-1">
                    <dt class="font-medium">URL:</dt>
                    <dd class="truncate">
                      <a
                        [href]="card.publicUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-[var(--color-primary)] hover:underline"
                      >
                        {{ card.publicUrl }}
                      </a>
                    </dd>
                  </div>
                }
              </dl>

              <div class="mt-auto pt-4">
                @if (card.action.kind === 'route') {
                  <a
                    [routerLink]="card.action.route"
                    class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-[var(--color-text-on-primary)]"
                  >
                    {{ card.action.label }}
                    <app-icon name="arrow-right" [size]="14" />
                  </a>
                } @else {
                  <span
                    class="inline-flex w-full items-center justify-center rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"
                    aria-disabled="true"
                  >
                    {{ card.action.label }}
                  </span>
                }
              </div>
            </article>
          }
        </div>
      }
    </div>
  `,
})
export class AppsCatalogComponent {
  private readonly appsService = inject(StoreAppsService);
  private readonly authFacade = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly menuFilter = inject(MenuFilterService);

  readonly apps = signal<StoreApp[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private readonly settings = computed(
    () => this.authFacade.storeSettings() as StoreSettings | null,
  );

  readonly appsEnabled = computed(() => this.settings()?.apps?.enabled === true);

  private readonly storeType = computed<string | null>(
    () =>
      this.settings()?.general?.store_type ??
      (this.authFacade.userStoreType() as string | null) ??
      null,
  );

  readonly cards = computed(() =>
    this.apps().map((app) => this.applyAccessGate(toAppCard(app, this.storeType()))),
  );

  /**
   * apps-f4 S4: the card consults the same `canSeeKey` gate as the sidebar
   * and the URL guard. Audit mode only records (`would_hide`); with the flag
   * on, an app whose view the store industry cannot open is disabled.
   */
  private applyAccessGate(card: AppCard): AppCard {
    if (card.action.kind !== 'route') return card;
    if (!this.menuFilter.applyRouteGate(card.action.route, true, 'apps_card')) {
      return { ...card, action: { kind: 'disabled', label: 'No aplica a tu industria' } };
    }
    // Plan layer: the card stays usable (it opens the module paywall through
    // the route guard) but says it belongs to a higher plan.
    const keys = this.menuFilter.resolveGateKeysForRoute(card.action.route);
    return this.menuFilter.isPlanLocked(keys)
      ? { ...card, action: { ...card.action, label: 'Disponible en un plan superior' } }
      : card;
  }

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.appsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.apps.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(
            parseApiError(err).userMessage ?? 'No se pudieron cargar las apps.',
          );
          this.loading.set(false);
        },
      });
  }
}
