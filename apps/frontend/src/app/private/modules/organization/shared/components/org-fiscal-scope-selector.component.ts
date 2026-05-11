import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  SpinnerComponent,
  StickyHeaderBadgeColor,
  StickyHeaderComponent,
} from '../../../../../shared/components/index';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ApiErrorService } from '../../../../../core/services/api-error.service';
import { OrganizationStoresService } from '../../stores/services/organization-stores.service';
import { StoreListItem } from '../../stores/interfaces/store.interface';

@Component({
  selector: 'app-org-fiscal-scope-selector',
  standalone: true,
  imports: [AlertBannerComponent, SpinnerComponent, StickyHeaderComponent],
  template: `
    @if (showHeader()) {
      <app-sticky-header
        title="Alcance fiscal"
        [subtitle]="scopeSubtitle()"
        icon="receipt"
        variant="glass"
        [badgeText]="scopeBadgeText()"
        [badgeColor]="scopeBadgeColor()"
        [metadataContent]="selectedStoreName()"
      />
    }

    @if (requiresStoreSelector() || loadingStores() || errorMessage()) {
      <section class="w-full px-2 md:px-4">
        @if (requiresStoreSelector()) {
          <div class="mb-2 rounded-lg border border-border bg-surface px-3 py-3 shadow-sm">
          <label class="flex w-full flex-col gap-1 text-xs text-text-secondary md:max-w-xs">
            Tienda fiscal
            <select
              class="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary"
              [value]="currentStoreId() || ''"
              [disabled]="loadingStores() || stores().length === 0"
              (change)="onStoreChange($event)"
            >
              <option value="">Selecciona una tienda</option>
              @for (store of stores(); track store.id) {
                <option [value]="store.id">{{ store.name }}</option>
              }
            </select>
          </label>
          </div>
        }

        @if (loadingStores()) {
          <div class="py-3">
            <app-spinner [center]="true" text="Cargando tiendas fiscales..." />
          </div>
        }

        @if (errorMessage(); as msg) {
          <div class="pt-2">
            <app-alert-banner variant="danger" title="No se pudo cargar el alcance fiscal">
              {{ msg }}
            </app-alert-banner>
          </div>
        }

        @if (requiresStoreSelector() && stores().length === 0 && !loadingStores() && !errorMessage()) {
          <div class="pt-2">
            <app-alert-banner variant="warning" title="Sin tiendas fiscales">
              No hay tiendas activas para consultar flujos fiscales individuales.
            </app-alert-banner>
          </div>
        }
      </section>
    }
  `,
})
export class OrgFiscalScopeSelectorComponent {
  private readonly auth = inject(AuthFacade);
  private readonly storesService = inject(OrganizationStoresService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly selectedStoreId = input<number | null>(null);
  readonly showHeader = input(true);
  readonly storeChange = output<number | null>();

  readonly initialized = signal(false);
  readonly loadingStores = signal(false);
  readonly stores = signal<StoreListItem[]>([]);
  readonly currentStoreId = signal<number | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly fiscalScope = computed(() => this.auth.fiscalScope());
  readonly requiresStoreSelector = computed(() => this.fiscalScope() === 'STORE');
  readonly scopeSubtitle = computed(() =>
    this.requiresStoreSelector()
      ? 'Fiscal individual por tienda'
      : 'Fiscal consolidado de organización',
  );
  readonly scopeBadgeText = computed(() =>
    this.requiresStoreSelector() ? 'Modo tienda' : 'Modo ORG',
  );
  readonly scopeBadgeColor = computed<StickyHeaderBadgeColor>(() =>
    this.requiresStoreSelector() ? 'green' : 'blue',
  );
  readonly selectedStoreName = computed(() => {
    if (!this.requiresStoreSelector()) return '';
    const store = this.stores().find((item) => item.id === this.currentStoreId());
    return store ? `Tienda fiscal: ${store.name}` : '';
  });

  constructor() {
    effect(() => {
      const selected = this.selectedStoreId();
      if (selected !== this.currentStoreId()) {
        this.currentStoreId.set(selected);
      }
    });

    effect(() => {
      const organization = this.auth.userOrganization();
      if (!organization || this.initialized()) return;

      this.initialized.set(true);
      if (this.requiresStoreSelector()) {
        this.loadStores();
        return;
      }

      this.emitStore(null);
    });
  }

  onStoreChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.emitStore(Number.isFinite(value) && value > 0 ? value : null);
  }

  private loadStores(): void {
    this.loadingStores.set(true);
    this.errorMessage.set(null);

    this.storesService
      .getStores({ limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const stores = (res?.data ?? []) as unknown as StoreListItem[];
          const requested = this.selectedStoreId();
          const selected =
            stores.find((store) => store.id === requested)?.id ?? stores[0]?.id ?? null;

          this.stores.set(stores);
          this.loadingStores.set(false);
          this.emitStore(selected);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar las tiendas fiscales.'),
          );
          this.loadingStores.set(false);
          this.emitStore(null);
        },
      });
  }

  private emitStore(storeId: number | null): void {
    this.currentStoreId.set(storeId);
    this.storeChange.emit(storeId);
  }
}
