import { Component, DestroyRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, timeout } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { EnvironmentSwitchService } from '../../../../../../core/services/environment-switch.service';
import { OrganizationStoresService } from '../../../stores/services/organization-stores.service';
import { describeApiFailure } from '../../../../store/invoicing/utils/invoicing-errors.util';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { OrgFiscalScopeSelectorComponent } from '../../../shared/components/org-fiscal-scope-selector.component';
import { ReceivedDocumentsConfigurationComponent } from '../../../../store/invoicing/received-documents/received-documents-configuration.component';
import {
  OrgDianConfigRow,
  OrgInvoicingService,
} from '../../services/org-invoicing.service';

@Component({
  selector: 'vendix-org-dian-config',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    OrgFiscalScopeSelectorComponent,
    ReceivedDocumentsConfigurationComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-org-fiscal-scope-selector
        [selectedStoreId]="selectedStoreId()"
        [showHeader]="false"
        (storeChange)="onFiscalStoreChange($event)"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Configuraciones"
          [value]="rows().length"
          smallText="Perfiles DIAN"
          iconName="settings"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Habilitadas"
          [value]="enabledCount()"
          smallText="Listas para operar"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Producción"
          [value]="productionCount()"
          smallText="Ambiente productivo"
          iconName="shield-check"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
        <app-stats
          title="Por vencer"
          [value]="expiringCertificates()"
          smallText="Certificados 30 días"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar configuración DIAN">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Configuración DIAN ({{ filteredRows().length }})
            </h2>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar nombre, NIT o tienda..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />

              <app-options-dropdown
                class="rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                triggerLabel="Filtros"
                triggerIcon="filter"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="filteredRows()"
            [columns]="tableColumns"
            [actions]="tableActions"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin configuración DIAN"
            emptyMessage="Sin configuración DIAN"
            emptyDescription="No hay configuración DIAN para el alcance fiscal seleccionado."
            emptyIcon="shield-check"
            [showEmptyAction]="false"
            [showEmptyClearFilters]="hasActiveFilters()"
            (emptyClearFiltersClick)="clearFilters()"
          />
        </div>
      </app-card>

      @if (receptionEmailPilotAvailable()) {
      <app-card [responsive]="true">
        <section class="space-y-3" aria-label="Recepción por correo en una tienda">
          <h2 class="text-base font-semibold text-text-primary">Recepción por correo</h2>
          <p class="text-sm text-text-secondary">El correo se administra en el Buzón de una tienda. Esta vista de organización es sólo de consulta y no muestra direcciones ni códigos privados.</p>
          @if (selectedReceptionSlug()) {
            <app-button customClasses="min-h-11" [disabled]="switchingReceptionStore()" (clicked)="switchReceptionStore(selectedReceptionSlug()!)">Administrar en esta tienda</app-button>
          } @else if (canReadOperationalStores()) {
            <app-button customClasses="min-h-11" variant="outline" [disabled]="receptionStoresLoading() || switchingReceptionStore()" (clicked)="loadReceptionStores()">Elegir tienda operativa</app-button>
          } @else {
            <p class="text-sm text-text-secondary">Entra al panel de esta tienda para activar. Usa Tiendas en el menú lateral o solicita acceso a una persona autorizada.</p>
          }
          @if (receptionStoresLoaded()) {
            @if (receptionStoresForContext().length) {
              <label class="flex flex-col gap-2 text-sm text-text-primary" for="email-operational-store">Tienda para administrar el correo
                <select id="email-operational-store" class="min-h-11 rounded-lg border border-border bg-background px-3 text-text-primary" [disabled]="switchingReceptionStore()" [value]="chosenReceptionSlug()" (change)="chooseReceptionStore($event)">
                  <option value="">Selecciona una tienda</option>
                  @for (store of receptionStoresForContext(); track store.id) { <option [value]="store.slug">{{ store.name }}</option> }
                </select>
              </label>
              <app-button customClasses="min-h-11" [disabled]="!chosenReceptionSlug() || switchingReceptionStore()" (clicked)="switchReceptionStore(chosenReceptionSlug())">Entrar al Buzón de la tienda</app-button>
              <p class="text-xs text-text-secondary">Se muestran hasta 200 tiendas. Si falta una, usa Tiendas en el menú lateral.</p>
            } @else {
              <p class="text-sm text-text-secondary">No encontramos una tienda disponible. Entra al panel desde Tiendas en el menú lateral o solicita acceso.</p>
            }
          }
          @if (receptionStoreError()) { <p role="alert" class="text-sm text-error">{{ receptionStoreError() }}</p> }
        </section>
      </app-card>
      }
      <app-received-documents-configuration
        scope="organization"
        [selectedStoreId]="requiresStoreSelector() ? selectedStoreId() : null"
        [scopeReady]="receptionScopeReady()"
        [readOnly]="readOnly()"
      />
    </div>
  `,
})
export class OrgDianConfigComponent {
  private readonly service = inject(OrgInvoicingService);
  private readonly auth = inject(AuthFacade);
  private readonly operationalStores = inject(OrganizationStoresService);
  private readonly environmentSwitch = inject(EnvironmentSwitchService);
  private readonly errors = inject(ApiErrorService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly readOnly = input(false);
  readonly errorMessage = signal<string | null>(null);
  readonly selectedStoreId = signal<number | null>(null);
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly rows = signal<OrgDianConfigRow[]>([]);

  private readonly receptionConfiguration = viewChild(ReceivedDocumentsConfigurationComponent);
  readonly receptionEmailPilotAvailable = computed(() => this.receptionConfiguration()?.health()?.email?.pilot_available === true);
  readonly switchingReceptionStore = signal(false);
  readonly receptionStoresLoading = signal(false);
  readonly receptionStoresLoaded = signal(false);
  readonly receptionStores = signal<Array<{ id: number; name: string; slug: string }>>([]);
  readonly chosenReceptionSlug = signal('');
  private readonly receptionStoresSnapshotKey = signal('');
  private readonly fiscalRowsReceptionKey = signal('');
  readonly receptionStoreError = signal<string | null>(null);
  readonly canReadOperationalStores = computed(() => this.auth.hasPermission('organization:stores:read'));
  readonly selectedReceptionSlug = computed(() => {
    const selected = this.selectedStoreId();
    if (!selected || this.fiscalRowsReceptionKey() !== this.receptionFiscalContextKey()) return null;
    const store = this.rows().find((row) => row.store?.id === selected)?.store;
    return store?.slug && /^[a-zA-Z0-9-]{1,200}$/.test(store.slug) ? store.slug : null;
  });
  private receptionStoresRequest?: Subscription;
  private receptionStoresGeneration = 0;
  private readonly receptionFiscalContextKey = computed(() => JSON.stringify([this.auth.userId(), this.auth.userOrganization()?.id, this.selectedStoreId()]));
  private readonly receptionStoreContext = computed(() => JSON.stringify([this.auth.userId(), this.auth.userOrganization()?.id,
    this.selectedStoreId(), this.canReadOperationalStores()]));
  readonly receptionStoresForContext = computed(() => this.canReadOperationalStores()
    && this.receptionStoresSnapshotKey() === this.receptionStoreContext() ? this.receptionStores() : []);
  loadReceptionStores(): void {
    if (!this.receptionEmailPilotAvailable() || !this.canReadOperationalStores() || this.receptionStoresLoading() || this.switchingReceptionStore()) return;
    this.receptionStoresGeneration++; this.receptionStoresRequest?.unsubscribe();
    const generation = this.receptionStoresGeneration; const key = this.receptionStoreContext();
    const organizationId = this.auth.userOrganization()?.id;
    this.receptionStoresLoading.set(true); this.receptionStoreError.set(null);
    this.receptionStoresRequest = this.operationalStores.getStores({ limit: 200 }).pipe(timeout(20_000), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        if (generation !== this.receptionStoresGeneration || key !== this.receptionStoreContext()) return;
        // Service's historical generic is nested; validate the actual paginated flat HTTP array without trusting that annotation.
        const rows: unknown = response.data;
        const choices: Array<{ id: number; name: string; slug: string }> = [];
        if (Array.isArray(rows)) for (const row of rows.slice(0, 200)) {
          if (typeof row !== 'object' || row === null) continue;
          if (Number.isSafeInteger(row.id) && row.id > 0 && row.organization_id === organizationId && row.is_active === true
            && typeof row.name === 'string' && typeof row.slug === 'string' && /^[a-zA-Z0-9-]{1,200}$/.test(row.slug))
            choices.push({ id: row.id, name: row.name.slice(0, 120), slug: row.slug });
        }
        this.receptionStores.set(choices); this.receptionStoresSnapshotKey.set(key); this.receptionStoresLoaded.set(true); this.receptionStoresLoading.set(false);
      },
      error: (error: unknown) => {
        if (generation !== this.receptionStoresGeneration || key !== this.receptionStoreContext()) return;
        this.receptionStoresLoading.set(false); this.receptionStoreError.set(describeApiFailure(error).message || 'No se pudieron consultar las tiendas. Usa Tiendas en el menú lateral.');
      },
    });
  }
  chooseReceptionStore(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.chosenReceptionSlug.set(this.receptionStoresForContext().some((store) => store.slug === value) ? value : '');
  }
  async switchReceptionStore(slug: string): Promise<void> {
    if (!this.receptionEmailPilotAvailable() || this.switchingReceptionStore() || !slug || (slug !== this.selectedReceptionSlug()
      && (!this.canReadOperationalStores() || !this.receptionStoresForContext().some((store) => store.slug === slug)))) return;
    this.switchingReceptionStore.set(true); this.receptionStoreError.set(null);
    try {
      const success = await this.environmentSwitch.performEnvironmentSwitch('STORE_ADMIN', slug);
      if (!success) { this.receptionStoreError.set('No se pudo entrar a la tienda. Solicita acceso a una persona autorizada.'); return; }
      // Only the successful authenticated switch replaces tokens/permissions/routes; no organization JWT is reused by this link.
      await this.router.navigate(['/admin/invoicing/received-documents'], { queryParams: { setup: 'email' } });
    } catch (error: unknown) {
      this.receptionStoreError.set(describeApiFailure(error).message || 'No se pudo entrar a la tienda. Usa Tiendas en el menú lateral o solicita acceso.');
    } finally { this.switchingReceptionStore.set(false); }
  }
  readonly requiresStoreSelector = computed(() => this.auth.fiscalScope() === 'STORE');
  readonly receptionScopeReady = computed(() => !this.requiresStoreSelector() || this.selectedStoreId() !== null);
  readonly enabledCount = computed(() =>
    this.rows().filter((row) => ['enabled', 'accepted', 'production'].includes(String(row.enablement_status).toLowerCase())).length,
  );
  readonly productionCount = computed(() =>
    this.rows().filter((row) => String(row.environment).toLowerCase() === 'production').length,
  );
  readonly expiringCertificates = computed(() => {
    const now = new Date();
    const limit = new Date(now);
    limit.setDate(limit.getDate() + 30);
    return this.rows().filter((row) => {
      if (!row.certificate_expiry) return false;
      const expiry = new Date(row.certificate_expiry);
      return expiry >= now && expiry <= limit;
    }).length;
  });

  readonly filteredRows = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const environment = this.filterValues()['environment'] as string | undefined;
    const status = this.filterValues()['status'] as string | undefined;
    return this.rows().filter((row) => {
      if (environment && row.environment !== environment) return false;
      if (status && row.enablement_status !== status) return false;
      if (!search) return true;
      return [
        row.name,
        row.nit,
        row.nit_dv,
        row.store?.name,
        row.store_id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  });

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'environment',
      label: 'Ambiente',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'test', label: 'Pruebas' },
        { value: 'production', label: 'Producción' },
      ],
    },
    {
      key: 'status',
      label: 'Estado DIAN',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'not_started', label: 'No iniciado' },
        { value: 'testing', label: 'Pruebas' },
        { value: 'enabled', label: 'Habilitada' },
        { value: 'rejected', label: 'Rechazada' },
      ],
    },
  ];

  readonly dropdownActions = [
    { label: 'Manejo fiscal', icon: 'settings', action: 'fiscal-settings', variant: 'outline' as const },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Manejo fiscal',
      icon: 'settings',
      variant: 'secondary',
      action: () => this.onActionClick('fiscal-settings'),
    },
  ];

  readonly tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'nit',
      label: 'NIT',
      priority: 1,
      transform: (value, row) => `${value || '—'}${row?.nit_dv ? '-' + row.nit_dv : ''}`,
    },
    { key: 'store.name', label: 'Tienda', priority: 2, defaultValue: 'Organización' },
    {
      key: 'environment',
      label: 'Ambiente',
      priority: 2,
      transform: (value) => this.environmentLabel(String(value || '')),
    },
    {
      key: 'certificate_expiry',
      label: 'Certificado',
      priority: 3,
      transform: (value) => this.formatDate(value),
    },
    {
      key: 'enablement_status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          enabled: 'success',
          accepted: 'success',
          testing: 'info',
          not_started: 'warn',
          rejected: 'danger',
        },
      },
      transform: (value) => this.statusLabel(String(value || '')),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleTransform: (item) => `NIT ${item?.nit || '—'}${item?.nit_dv ? '-' + item.nit_dv : ''}`,
    avatarFallbackIcon: 'shield-check',
    avatarShape: 'square',
    badgeKey: 'enablement_status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        enabled: 'success',
        accepted: 'success',
        testing: 'info',
        not_started: 'warn',
        rejected: 'danger',
      },
    },
    badgeTransform: (value) => this.statusLabel(String(value || '')),
    detailKeys: [
      { key: 'store.name', label: 'Tienda', icon: 'store', transform: (value) => value || 'Organización' },
      { key: 'environment', label: 'Ambiente', icon: 'globe', transform: (value) => this.environmentLabel(String(value || '')) },
      { key: 'certificate_expiry', label: 'Certificado', icon: 'calendar', transform: (value) => this.formatDate(value) },
    ],
  };

  constructor() {
    effect(() => {
      this.receptionStoreContext();
      untracked(() => {
        this.receptionStoresGeneration++; this.receptionStoresRequest?.unsubscribe();
        this.receptionStores.set([]); this.receptionStoresSnapshotKey.set(''); this.receptionStoresLoaded.set(false); this.receptionStoresLoading.set(false);
        this.chosenReceptionSlug.set(''); this.receptionStoreError.set(null);
      });
    });
    this.destroyRef.onDestroy(() => { this.receptionStoresGeneration++; this.receptionStoresRequest?.unsubscribe(); });

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const storeId = this.requiresStoreSelector() ? params.get('store_id') : null;
        const parsedStoreId = storeId === null ? null : Number(storeId);
        this.selectedStoreId.set(parsedStoreId !== null && Number.isSafeInteger(parsedStoreId) && parsedStoreId > 0 ? parsedStoreId : null);
        this.loadData();
      });
  }

  onFiscalStoreChange(storeId: number | null): void {
    if (storeId === this.selectedStoreId()) return;
    this.updateQuery({ store_id: storeId || null });
  }

  onSearch(search: string): void {
    this.searchTerm.set(search);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
  }

  onActionClick(action: string): void {
    if (action === 'fiscal-settings') {
      this.router.navigate(['/admin/fiscal']);
    }
  }

  hasActiveFilters(): boolean {
    return !!(
      this.searchTerm() ||
      this.filterValues()['environment'] ||
      this.filterValues()['status']
    );
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  environmentLabel(value: string): string {
    return value === 'production' ? 'Producción' : value === 'test' ? 'Pruebas' : value || '-';
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      not_started: 'No iniciado',
      testing: 'Pruebas',
      enabled: 'Habilitada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
    };
    return labels[status] || status || '-';
  }

  private loadData(): void {
    if (this.requiresStoreSelector() && !this.selectedStoreId()) {
      this.rows.set([]);
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const receptionKey = this.receptionFiscalContextKey();
    this.fiscalRowsReceptionKey.set('');
    this.service
      .getDianConfigs(this.selectedStoreId() ? { store_id: this.selectedStoreId() } : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data ?? []);
          if (receptionKey === this.receptionFiscalContextKey()) this.fiscalRowsReceptionKey.set(receptionKey);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar la configuración DIAN.'),
          );
          this.rows.set([]);
          this.loading.set(false);
        },
      });
  }

  private updateQuery(queryParams: Record<string, string | number | null>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
