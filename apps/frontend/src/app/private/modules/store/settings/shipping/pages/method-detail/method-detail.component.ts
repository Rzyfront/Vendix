import {Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { ShippingMethodsService } from '../../services/shipping-methods.service';
import { StoreShippingMethod } from '../../interfaces/shipping-methods.interface';
import {
  ShippingZone,
  ShippingRate,
  ZoneWithRates} from '../../interfaces/shipping-zones.interface';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StatsComponent,
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
  BadgeComponent,
  ResponsiveDataViewComponent,
  ToastService,
  DialogService} from '../../../../../../../shared/components/index';
import {
  TableColumn,
  TableAction} from '../../../../../../../shared/components/table/table.component';
import { ItemListCardConfig } from '../../../../../../../shared/components/item-list/item-list.interfaces';
import { AddRateWizardModalComponent } from '../../components/index';

@Component({
  selector: 'app-method-detail',
  standalone: true,
  imports: [
    RouterModule,
    StickyHeaderComponent,
    StatsComponent,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    BadgeComponent,
    ResponsiveDataViewComponent,
    AddRateWizardModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full">
      <!-- Sticky Header -->
      <app-sticky-header
        [title]="method()?.name ?? 'Cargando...'"
        [subtitle]="getSubtitle()"
        icon="truck"
        variant="glass"
        [showBackButton]="true"
        [backRoute]="['/admin/settings/shipping']"
        [badgeText]="method() ? getTypeLabel(method()!.type) : ''"
        badgeColor="blue"
        [actions]="header_actions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <!-- Mini Stats (4 horizontal) -->
      <div
        class="stats-container sticky top-[52px] z-20 bg-background py-3 md:static md:bg-transparent md:py-0 mb-4"
      >
        <div
          class="flex gap-3 overflow-x-auto px-4 md:px-0 md:grid md:grid-cols-4 md:gap-4 no-scrollbar"
        >
          <app-stats
            title="Zonas"
            [value]="zones_with_rates().length"
            iconName="map-pin"
            iconBgColor="#ECFDF5"
            iconColor="#10B981"
            [loading]="is_loading()"
          />
          <app-stats
            title="Tarifas activas"
            [value]="active_rates_count()"
            iconName="tag"
            iconBgColor="#F5F3FF"
            iconColor="#8B5CF6"
            [loading]="is_loading()"
          />
          <app-stats
            title="Pedidos este mes"
            [value]="0"
            iconName="package"
            iconBgColor="#FFF7ED"
            iconColor="#F59E0B"
            [loading]="is_loading()"
            smallText="—"
          />
          <app-stats
            title="Ingresos envio"
            [value]="'—'"
            iconName="banknote"
            iconBgColor="#EEF2FF"
            iconColor="#6366F1"
            [loading]="is_loading()"
          />
        </div>
      </div>

      <!-- Zones Table Card -->
      <div class="mx-4 md:mx-0 mb-6">
        <div class="bg-surface rounded-xl border border-border overflow-hidden">
          <!-- Table Header -->
          <div
            class="flex flex-col md:flex-row md:items-center justify-between p-3 md:p-4 border-b border-border gap-3"
          >
            <div class="flex items-center gap-3">
              <h3 class="text-sm md:text-base font-semibold text-text-primary">
                Zonas y Tarifas
              </h3>
              <app-badge variant="neutral" size="xs"
                >{{ zones_with_rates().length }} zonas</app-badge
              >
            </div>
            <div class="flex items-center gap-2 md:gap-3">
              <app-inputsearch
                placeholder="Buscar zona..."
                class="flex-1 md:w-56"
                (searchChange)="search_term.set($event)"
              />
              <app-button size="sm" (clicked)="openRateWizard()">
                <app-icon slot="icon" name="plus" [size]="16" />
                Agregar Tarifa
              </app-button>
            </div>
          </div>

          <!-- Table / Card list -->
          <app-responsive-data-view
            [data]="table_data()"
            [columns]="tableColumns"
            [cardConfig]="cardConfig"
            [actions]="tableActions"
            [loading]="is_loading()"
            [hoverable]="true"
            emptyIcon="map-pin"
            [emptyMessage]="'No hay tarifas configuradas'"
            [emptyDescription]="'Agrega tu primera tarifa para este metodo'"
            [showEmptyAction]="true"
            [emptyActionText]="'Agregar Tarifa'"
            (actionClick)="onTableAction($event)"
            (emptyActionClick)="openRateWizard()"
          />
        </div>
      </div>

      @defer (when show_rate_wizard() && method()) {
        <app-add-rate-wizard-modal
          [method_id]="method()!.id"
          [existing_zones]="getAvailableZones()"
          [edit_rate]="edit_rate()"
          (close)="closeRateWizard()"
          (saved)="onRateSaved()"
        />
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .no-scrollbar {
        scrollbar-width: none;
        &::-webkit-scrollbar {
          display: none;
        }
      }
      :host ::ng-deep app-stats {
        min-width: 140px;
        @media (min-width: 768px) {
          min-width: auto;
        }
      }
    `,
  ]})
export class MethodDetailComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private shippingService = inject(ShippingMethodsService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
// ─── State ───
  method = signal<StoreShippingMethod | null>(null);
  zones_with_rates = signal<ZoneWithRates[]>([]);
  all_store_zones = signal<ShippingZone[]>([]);
  is_loading = signal<boolean>(true);
  search_term = signal<string>('');
  show_rate_wizard = signal<boolean>(false);
  edit_rate = signal<ShippingRate | null>(null);

  // ─── Computed ───
  filtered_zones = computed(() => {
    const term = this.search_term().toLowerCase();
    if (!term) return this.zones_with_rates();
    return this.zones_with_rates().filter(
      (zr) =>
        zr.zone.name.toLowerCase().includes(term) ||
        (zr.zone.display_name || '').toLowerCase().includes(term),
    );
  });

  active_rates_count = computed(
    () => this.zones_with_rates().filter((zr) => zr.rate.is_active).length,
  );

  header_actions = computed<StickyHeaderActionButton[]>(() => {
    const m = this.method();
    if (!m) return [];
    return [
      {
        id: 'configure',
        label: 'Configurar',
        variant: 'outline' as const,
        icon: 'settings'},
      {
        id: 'toggle',
        label: m.is_active ? 'Desactivar' : 'Activar',
        variant: (m.is_active ? 'outline-danger' : 'primary') as any,
        icon: m.is_active ? 'pause' : 'play'},
    ];
  });

  table_data = computed(() => {
    return this.filtered_zones().map((zr) => ({
      _original: zr,
      zone_name: zr.zone.name,
      countries_display: this.formatCountries(zr.zone.countries),
      rate_type_label: this.getRateTypeLabel(zr.rate.type),
      cost_display: this.formatCost(zr.rate),
      free_threshold_display: zr.rate.free_shipping_threshold
        ? `$${Number(zr.rate.free_shipping_threshold).toLocaleString('es-CO')}`
        : '—',
      status_label: zr.rate.is_active ? 'Activa' : 'Inactiva'}));
  });

  // ─── Table Configuration ───
  tableColumns: TableColumn[] = [
    { key: 'zone_name', label: 'Zona', sortable: true },
    { key: 'countries_display', label: 'Cobertura' },
    {
      key: 'rate_type_label',
      label: 'Tipo Tarifa',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          'Tarifa plana': '#3B82F6',
          'Por peso': '#F59E0B',
          'Por precio': '#6366F1',
          Calculado: '#6B7280',
          Gratis: '#10B981'}}},
    { key: 'cost_display', label: 'Costo' },
    { key: 'free_threshold_display', label: 'Envio Gratis' },
    {
      key: 'status_label',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          Activa: '#10B981',
          Inactiva: '#F59E0B'}}},
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'pencil',
      variant: 'info',
      action: (item: any) => this.editRate(item)},
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: any) =>
        this.confirmDeleteRate(item._original as ZoneWithRates)},
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'zone_name',
    subtitleKey: 'countries_display',
    avatarFallbackIcon: 'map-pin',
    avatarShape: 'circle',
    badgeKey: 'rate_type_label',
    badgeConfig: { type: 'custom' },
    detailKeys: [
      { key: 'cost_display', label: 'Costo' },
      { key: 'status_label', label: 'Estado' },
    ],
    footerKey: 'free_threshold_display',
    footerLabel: 'Envio gratis desde'};

  // ─── Lifecycle ───

  ngOnInit(): void {
    this.route.params.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const methodId = Number(params['methodId']);
      if (methodId) {
        this.loadMethodData(methodId);
      }
    });
  }
// ─── Data Loading ───

  loadMethodData(methodId: number): void {
    this.is_loading.set(true);

    // Load method details
    this.shippingService
      .getShippingMethod(methodId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (method) => this.method.set(method),
        error: () => {
          this.toastService.show({
            variant: 'error',
            description: 'Error al cargar el metodo'});
          this.router.navigate(['/admin/settings/shipping']);
        }});

    // Load zones and their rates for this method
    this.shippingService
      .getStoreZones()
      .pipe(
        switchMap((zones) => {
          this.all_store_zones.set(zones);
          if (zones.length === 0) return of([]);
          return forkJoin(
            zones.map((zone) =>
              this.shippingService
                .getStoreZoneRates(zone.id)
                .pipe(
                  map((rates) =>
                    rates
                      .filter((r) => r.shipping_method_id === methodId)
                      .map((rate) => ({ zone, rate }) as ZoneWithRates),
                  ),
                ),
            ),
          ).pipe(map((results) => results.flat()));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (zonesWithRates) => {
          this.zones_with_rates.set(zonesWithRates);
          this.is_loading.set(false);
        },
        error: () => this.is_loading.set(false)});
  }

  // ─── Header Actions ───

  onHeaderAction(actionId: string): void {
    if (actionId === 'toggle') {
      this.toggleMethod();
    }
  }

  async toggleMethod(): Promise<void> {
    const m = this.method();
    if (!m) return;

    const action = m.is_active ? 'desactivar' : 'activar';
    const confirmed = await this.dialogService.confirm({
      title: `${m.is_active ? 'Desactivar' : 'Activar'} metodo`,
      message: `¿Estas seguro de ${action} el metodo "${m.name}"?`,
      confirmText: m.is_active ? 'Desactivar' : 'Activar',
      confirmVariant: m.is_active ? 'danger' : 'primary'});

    if (!confirmed) return;

    const request$ = m.is_active
      ? this.shippingService.disableShippingMethod(m.id)
      : this.shippingService.enableStoreShippingMethod(m.id);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.method.set(updated);
        this.toastService.show({
          variant: 'success',
          description: `Metodo ${m.is_active ? 'desactivado' : 'activado'} correctamente`});
      },
      error: () => {
        this.toastService.show({
          variant: 'error',
          description: `Error al ${action} el metodo`});
      }});
  }

  // ─── Table Actions ───

  onTableAction(event: { action: TableAction; item: any }): void {
    // Actions are handled via the action callback in TableAction
    if (event.action.action) {
      event.action.action(event.item);
    }
  }

  editRate(item: any): void {
    const zr = item._original as ZoneWithRates;
    this.edit_rate.set(zr.rate);
    this.show_rate_wizard.set(true);
  }

  async confirmDeleteRate(zr: ZoneWithRates): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar tarifa',
      message: `¿Estas seguro de eliminar la tarifa de la zona "${zr.zone.name}"? Esta accion no se puede deshacer.`,
      confirmText: 'Eliminar',
      confirmVariant: 'danger'});

    if (!confirmed) return;

    this.shippingService
      .deleteRate(zr.rate.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.show({
            variant: 'success',
            description: 'Tarifa eliminada correctamente'});
          const m = this.method();
          if (m) this.loadMethodData(m.id);
        },
        error: () => {
          this.toastService.show({
            variant: 'error',
            description: 'Error al eliminar la tarifa'});
        }});
  }

  // ─── Rate Wizard ───

  openRateWizard(): void {
    this.edit_rate.set(null);
    this.show_rate_wizard.set(true);
  }

  closeRateWizard(): void {
    this.show_rate_wizard.set(false);
    this.edit_rate.set(null);
  }

  onRateSaved(): void {
    this.closeRateWizard();
    const m = this.method();
    if (m) this.loadMethodData(m.id);
  }

  getAvailableZones(): ShippingZone[] {
    const existingZoneIds = new Set(
      this.zones_with_rates().map((zr) => zr.zone.id),
    );
    return this.all_store_zones().filter((z) => !existingZoneIds.has(z.id));
  }

  // ─── Helpers ───

  getSubtitle(): string {
    const m = this.method();
    if (!m) return '';
    return this.formatDeliveryTime(m.min_days, m.max_days);
  }

  getTypeLabel(type: string): string {
    return this.shippingService.getShippingMethodTypeLabel(type);
  }

  formatDeliveryTime(min?: number | null, max?: number | null): string {
    if (!min && !max) return 'Sin estimacion';
    if (min && max) return `${min}-${max} dias habiles`;
    if (min) return `${min}+ dias habiles`;
    return `Hasta ${max} dias habiles`;
  }

  formatCountries(countries: string[]): string {
    if (!countries || countries.length === 0) return '—';
    const names: Record<string, string> = {
      CO: 'Colombia',
      MX: 'Mexico',
      US: 'Estados Unidos',
      DO: 'Rep. Dominicana',
      VE: 'Venezuela',
      AR: 'Argentina',
      CL: 'Chile',
      PE: 'Peru',
      PA: 'Panama',
      PR: 'Puerto Rico',
      ES: 'Espana'};
    const mapped = countries.map((c) => names[c] || c);
    if (mapped.length <= 2) return mapped.join(', ');
    return `${mapped.slice(0, 2).join(', ')} +${mapped.length - 2}`;
  }

  getRateTypeLabel(type: string): string {
    return this.shippingService.getZoneRateTypeLabel(type);
  }

  formatCost(rate: ShippingRate): string {
    if (rate.type === 'free') return 'Gratis';
    let cost = `$${Number(rate.base_cost).toLocaleString('es-CO')}`;
    if (
      rate.per_unit_cost &&
      (rate.type === 'weight_based' || rate.type === 'price_based')
    ) {
      const unit = rate.type === 'weight_based' ? 'kg' : '$';
      cost += ` + $${Number(rate.per_unit_cost).toLocaleString('es-CO')}/${unit}`;
    }
    return cost;
  }
}
