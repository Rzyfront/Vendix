import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs/operators';

import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import {
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CrmMainPageComponent } from '../../../crm/pages/crm-main-page/crm-main-page.component';
import { BookingSettingsPanelComponent } from '../../components/booking-settings-panel.component';
import { LandingSettingsPanelComponent } from '../../components/landing-settings-panel.component';
import { ProductPageSettingsPanelComponent } from '../../components/product-page-settings-panel.component';
import { ServicePageSettingsPanelComponent } from '../../components/service-page-settings-panel.component';
import { StoreHomeSettingsPanelComponent } from '../../components/store-home-settings-panel.component';
import type { AppSettingsPanel } from '../../components/app-settings-panel';
import type { AppKind, AppStatus, StoreAppDetail } from '../../interfaces/store-app.interface';
import { StoreAppsService } from '../../services/store-apps.service';
import { APPS_ROUTE, appKindFromSlug } from '../../utils/app-routes.util';

type AppDetailTab = 'content' | 'settings' | 'general';

const STATUS_BADGE: Record<AppStatus, { label: string; color: StickyHeaderBadgeColor }> = {
  published: { label: 'Publicada', color: 'green' },
  draft: { label: 'Borrador', color: 'yellow' },
  disabled: { label: 'Apagada', color: 'gray' },
  not_installed: { label: 'No instalada', color: 'gray' },
};

/** Per-app header icon and name of the settings tab. */
const APP_VIEW: Partial<Record<AppKind, { icon: string; settingsLabel: string }>> = {
  store_home: { icon: 'home', settingsLabel: 'Configuración' },
  landing: { icon: 'sparkles', settingsLabel: 'Oferta y dominio' },
  product_page: { icon: 'package', settingsLabel: 'Producto y dominio' },
  service_page: { icon: 'briefcase', settingsLabel: 'Servicios y dominio' },
  booking: { icon: 'bed-double', settingsLabel: 'Reservas y dominio' },
};

/**
 * `/admin/apps/:kind` — the own view of one app (apps-vistas-f1 S3/S4/S6).
 *
 * Its detail (`GET /store/apps/:kind`) is only fetched here, on entering the
 * view; the catalog stays light. The header carries name, status, domain/URL
 * and the Publicar/Despublicar and Encender/Apagar actions; each app brings
 * its settings panel (the former modal content) and, for the landing, the
 * CRM landing editor from Clientes reused as it is.
 */
@Component({
  selector: 'app-app-detail',
  standalone: true,
  imports: [
    RouterLink,
    StickyHeaderComponent,
    CrmMainPageComponent,
    StoreHomeSettingsPanelComponent,
    LandingSettingsPanelComponent,
    ProductPageSettingsPanelComponent,
    ServicePageSettingsPanelComponent,
    BookingSettingsPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full" [attr.data-app-view]="kind()">
      <app-sticky-header
        [title]="title()"
        [subtitle]="subtitle()"
        [icon]="icon()"
        [showBackButton]="true"
        [backRoute]="catalogRoute"
        [badgeText]="badge()?.label ?? ''"
        [badgeColor]="badge()?.color ?? 'gray'"
        [actions]="actions()"
        [tabs]="tabs()"
        [activeTab]="tab()"
        tabsAriaLabel="Secciones de la app"
        (actionClicked)="onAction($event)"
        (tabChanged)="setTab($event)"
      />

      <div class="mx-auto w-full max-w-6xl px-3 py-4 md:px-6">
        @if (loading() && !detail()) {
          <p class="text-sm text-[var(--color-text-secondary)]">Cargando app…</p>
        } @else if (error() && !detail()) {
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm" role="alert">
            <p class="text-[var(--color-text-primary)]">{{ error() }}</p>
            <button type="button" class="mt-2 text-sm font-semibold text-[var(--color-primary)]" (click)="loadDetail()">
              Reintentar
            </button>
          </div>
        } @else if (detail(); as app) {
          @if (!app.applies_to_store_industries) {
            <div class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-secondary)]"
                 data-testid="app-not-applicable">
              Esta app no aplica a la industria de tu tienda.
            </div>
          }

          <!-- Estado -->
          <section [class.hidden]="tab() !== 'general'" data-tab="general"
                   class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
            <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt class="text-xs font-medium text-[var(--color-text-secondary)]">Estado</dt>
                <dd class="text-[var(--color-text-primary)]" data-testid="app-status">{{ badge()?.label }}</dd>
              </div>
              <div>
                <dt class="text-xs font-medium text-[var(--color-text-secondary)]">Encendida</dt>
                <dd class="text-[var(--color-text-primary)]">{{ app.enabled ? 'Sí' : 'No' }}</dd>
              </div>
              <div>
                <dt class="text-xs font-medium text-[var(--color-text-secondary)]">Dominio</dt>
                <dd class="truncate text-[var(--color-text-primary)]" data-testid="app-domain">{{ app.domain?.hostname ?? 'Sin dominio' }}</dd>
              </div>
              <div>
                <dt class="text-xs font-medium text-[var(--color-text-secondary)]">URL pública</dt>
                <dd class="truncate">
                  @if (app.public_url; as url) {
                    <a [href]="url" target="_blank" rel="noopener noreferrer"
                       class="text-[var(--color-primary)] hover:underline" data-testid="app-public-url">{{ url }}</a>
                  } @else {
                    <span class="text-[var(--color-text-secondary)]">Sin publicar</span>
                  }
                </dd>
              </div>
            </dl>
            <p class="mt-4 text-xs text-[var(--color-text-secondary)]">
              Encender deja la app lista para configurarla y publicarla; apagar la retira del catálogo de tu tienda.
              Para apagar una app publicada, primero despublícala.
            </p>
          </section>

          <!-- Contenido (landing: el editor de Clientes, sin reescribir) -->
          @if (kind() === 'landing') {
            <div [class.hidden]="tab() !== 'content'" data-tab="content">
              <app-crm-main-page />
            </div>
          }

          <!-- Configuración: el contenido de los antiguos modales -->
          <div [class.hidden]="tab() !== 'settings'" data-tab="settings"
               class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            @switch (kind()) {
              @case ('store_home') { <app-store-home-settings-panel #panel (changed)="loadDetail()" /> }
              @case ('landing') { <app-landing-settings-panel #panel (changed)="loadDetail()" /> }
              @case ('product_page') { <app-product-page-settings-panel #panel (changed)="loadDetail()" /> }
              @case ('service_page') { <app-service-page-settings-panel #panel (changed)="loadDetail()" /> }
              @case ('booking') { <app-booking-settings-panel #panel (changed)="loadDetail()" /> }
            }
          </div>
        } @else {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Esta app no existe. <a [routerLink]="catalogRoute" class="text-[var(--color-primary)] hover:underline">Ver todas las apps</a>.
          </p>
        }
      </div>
    </div>
  `,
})
export class AppDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly appsService = inject(StoreAppsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly catalogRoute = APPS_ROUTE;

  readonly kind = toSignal(
    this.route.paramMap.pipe(map((params) => appKindFromSlug(params.get('kind')))),
    { initialValue: appKindFromSlug(this.route.snapshot.paramMap.get('kind')) },
  );

  readonly detail = signal<StoreAppDetail | null>(null);
  readonly loading = signal(false);
  readonly switching = signal(false);
  readonly error = signal<string | null>(null);
  readonly tab = signal<AppDetailTab>('settings');

  /** The settings panel of the current app (always mounted, maybe hidden). */
  readonly panel = viewChild<AppSettingsPanel>('panel');

  readonly title = computed(() => this.detail()?.name ?? 'Apps');
  readonly icon = computed(() => APP_VIEW[this.kind() ?? 'store_home']?.icon ?? 'app-window');
  readonly subtitle = computed(() => {
    const app = this.detail();
    if (!app) return '';
    return app.public_url ?? app.domain?.hostname ?? 'Sin dominio';
  });
  readonly badge = computed(() => {
    const status = this.detail()?.status;
    return status ? STATUS_BADGE[status] : null;
  });

  readonly tabs = computed<StickyHeaderTab[]>(() => {
    const kind = this.kind();
    if (!kind) return [];
    return [
      ...(kind === 'landing' ? [{ id: 'content', label: 'Contenido', icon: 'palette' }] : []),
      { id: 'settings', label: APP_VIEW[kind]?.settingsLabel ?? 'Configuración', icon: 'settings' },
      { id: 'general', label: 'Estado', icon: 'activity' },
    ];
  });

  /**
   * Header actions, from the app status and its panel:
   * - published → Despublicar (when there is a publication to take down);
   * - not published → Publicar (saves the panel first);
   * - draft → Apagar; not installed or off → Encender.
   */
  readonly actions = computed<StickyHeaderActionButton[]>(() => {
    const app = this.detail();
    const panel = this.panel();
    if (!app || !app.applies_to_store_industries) return [];
    const busy = this.switching() || (panel?.busy() ?? false);
    const published = app.status === 'published';
    const isLanding = this.kind() === 'landing';
    const canUnpublish = published && (panel?.canUnpublish() ?? false);
    const actions: StickyHeaderActionButton[] = [];

    if (app.status === 'draft') {
      actions.push({ id: 'deactivate', label: 'Apagar', variant: 'outline', icon: 'power', disabled: busy });
    } else if (app.status === 'not_installed' || app.status === 'disabled') {
      actions.push({ id: 'activate', label: 'Encender', variant: 'outline', icon: 'power', disabled: busy });
    }
    if (canUnpublish) {
      actions.push({ id: 'unpublish', label: 'Despublicar', variant: 'outline', icon: 'eye-off', disabled: busy });
    }
    if (!published || (isLanding && !canUnpublish)) {
      actions.push({
        id: 'publish',
        label: isLanding ? 'Publicar en su dominio' : 'Publicar',
        variant: 'primary',
        icon: 'globe',
        disabled: busy || !(panel?.canPublish() ?? false),
      });
    }
    return actions;
  });

  constructor() {
    effect(() => {
      const kind = this.kind();
      untracked(() => {
        this.detail.set(null);
        this.tab.set(kind === 'landing' ? 'content' : 'settings');
        if (kind) this.loadDetail();
      });
    });
  }

  setTab(id: string): void {
    if (id === 'content' || id === 'settings' || id === 'general') this.tab.set(id);
  }

  onAction(id: string): void {
    const panel = this.panel();
    if (id === 'publish') panel?.publish();
    else if (id === 'unpublish') panel?.unpublish();
    else if (id === 'activate' || id === 'deactivate') this.switchApp(id);
  }

  loadDetail(): void {
    const kind = this.kind();
    if (!kind) return;
    this.loading.set(true);
    this.error.set(null);
    this.appsService
      .get(kind)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.detail.set(res?.data ?? null);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(parseApiError(err).userMessage ?? 'No se pudo cargar la app.');
          this.loading.set(false);
        },
      });
  }

  private switchApp(action: 'activate' | 'deactivate'): void {
    const kind = this.kind();
    if (!kind) return;
    this.switching.set(true);
    const request$ =
      action === 'activate' ? this.appsService.activate(kind) : this.appsService.deactivate(kind);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.detail.set(res?.data ?? this.detail());
        this.switching.set(false);
        this.toast.success(action === 'activate' ? 'App encendida' : 'App apagada');
        this.panel()?.load();
      },
      error: (err) => {
        this.switching.set(false);
        this.toast.error(parseApiError(err).userMessage ?? 'No se pudo completar la acción.');
      },
    });
  }
}
