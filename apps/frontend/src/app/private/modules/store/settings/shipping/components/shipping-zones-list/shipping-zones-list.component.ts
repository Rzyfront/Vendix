import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ShippingZone } from '../../interfaces/shipping-zones.interface';
import {
  InputsearchComponent,
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'app-shipping-zones-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InputsearchComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <div>
      <div
        class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border border-border min-h-[300px] overflow-hidden"
      >
        <!-- Header Section -->
        <div class="px-3 py-2.5 md:px-4 md:py-3 border-b border-border">
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <!-- Title -->
            <h3 class="text-sm font-semibold text-text-primary">
              {{ title() }} ({{ filtered_zones().length }})
            </h3>

            <!-- Search row -->
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-48 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar zona..."
                [debounceTime]="300"
                [ngModel]="search_term"
                (ngModelChange)="onSearchChange($event)"
              ></app-inputsearch>

              @if (show_create()) {
                <button
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  (click)="create.emit()"
                >
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  <span class="hidden sm:inline">Crear Zona</span>
                </button>
              }
            </div>
          </div>
        </div>

        <!-- Loading State -->
        @if (is_loading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary text-sm">Cargando zonas...</p>
          </div>
        }

        <!-- Empty State -->
        @if (!is_loading() && filtered_zones().length === 0) {
          <div class="p-8 text-center">
            <div
              class="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center"
            >
              <svg
                class="w-6 h-6 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <p class="text-sm text-text-secondary">{{ empty_message() }}</p>
            <p class="text-xs text-gray-400 mt-1">
              {{ empty_description() }}
            </p>
          </div>
        }

        <!-- Zones List -->
        @if (!is_loading() && filtered_zones().length > 0) {
          <div class="px-2 pb-2 pt-0 md:p-4">
            <app-responsive-data-view
              [data]="filtered_zones()"
              [columns]="table_columns"
              [actions]="table_actions()"
              [cardConfig]="card_config()"
              [loading]="is_loading()"
              emptyMessage="No hay zonas de envío"
              emptyIcon="map-pin"
            ></app-responsive-data-view>
          </div>
        }
      </div>
    </div>
  `,
})
export class ShippingZonesListComponent {
  // Inputs
  readonly zones = input.required<ShippingZone[]>();
  readonly is_loading = input<boolean>(false);
  readonly is_system = input<boolean>(false);
  readonly show_create = input<boolean>(false);
  readonly show_duplicate = input<boolean>(false);
  readonly show_source_badge = input<boolean>(false);
  readonly title = input<string>('Zonas de Envío');
  readonly subtitle = input<string>('');
  readonly empty_message = input<string>('No hay zonas');
  readonly empty_description = input<string>('');

  // Outputs
  readonly create = output<void>();
  readonly edit = output<ShippingZone>();
  readonly delete = output<ShippingZone>();
  readonly view_rates = output<ShippingZone>();
  readonly duplicate = output<ShippingZone>();
  readonly sync = output<ShippingZone>();

  // State
  search_term = '';

  // Computed
  readonly filtered_zones = computed(() => {
    const zones = this.zones();
    if (!this.search_term) return zones;
    const term = this.search_term.toLowerCase();
    return zones.filter(
      (z) =>
        z.name.toLowerCase().includes(term) ||
        z.display_name?.toLowerCase().includes(term) ||
        z.countries.some((c) => c.toLowerCase().includes(term))
    );
  });

  // Table columns
  table_columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Zona',
      sortable: true,
      priority: 1,
    },
    {
      key: 'countries',
      label: 'Países',
      priority: 2,
      transform: (value: string[]) => this.formatCountries(value),
    },
    {
      key: '_count.shipping_rates',
      label: 'Tarifas',
      priority: 2,
      defaultValue: '0',
    },
    {
      key: 'is_active',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: boolean) => (value ? 'Activa' : 'Inactiva'),
    },
  ];

  // Table actions — computed because they depend on is_system input
  readonly table_actions = computed<TableAction[]>(() => {
    if (this.is_system()) {
      return [
        {
          label: 'Ver',
          icon: 'eye',
          action: (zone: ShippingZone) => this.view_rates.emit(zone),
          variant: 'primary' as const,
        },
        ...(this.show_duplicate()
          ? [
              {
                label: 'Duplicar',
                icon: 'copy',
                action: (zone: ShippingZone) => this.duplicate.emit(zone),
                variant: 'ghost' as const,
              },
            ]
          : []),
      ];
    }

    return [
      {
        label: 'Tarifas',
        icon: 'tag',
        action: (zone: ShippingZone) => this.view_rates.emit(zone),
        variant: 'primary' as const,
      },
      {
        label: 'Editar',
        icon: 'edit',
        action: (zone: ShippingZone) => this.edit.emit(zone),
        variant: 'ghost' as const,
      },
      {
        label: 'Eliminar',
        icon: 'trash-2',
        action: (zone: ShippingZone) => this.delete.emit(zone),
        variant: 'danger' as const,
      },
    ];
  });

  // Card configuration — computed because it depends on show_source_badge input
  readonly card_config = computed<ItemListCardConfig>(() => {
    const config: ItemListCardConfig = {
      titleKey: 'name',
      subtitleKey: 'countries',
      subtitleTransform: (item: ShippingZone) =>
        this.formatCountries(item.countries),
      avatarFallbackIcon: this.is_system() ? 'globe' : 'map-pin',
      avatarShape: 'square',
      badgeKey: 'is_active',
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      badgeTransform: (value: boolean) => (value ? 'Activa' : 'Inactiva'),
      detailKeys: [
        {
          key: '_count.shipping_rates',
          label: 'Tarifas',
        },
      ],
      footerKey: 'created_at',
      footerLabel: 'Creada',
      footerTransform: (val: string) =>
        val ? new Date(val).toLocaleDateString() : '-',
    };

    if (this.show_source_badge()) {
      config.detailKeys = [
        ...(config.detailKeys || []),
        {
          key: 'source_type',
          label: 'Origen',
          transform: (val: string) =>
            val === 'system_copy' ? 'Del sistema' : 'Personalizada',
        },
      ];
    }

    return config;
  });

  // Event handlers
  onSearchChange(term: string): void {
    this.search_term = term;
  }

  // Helpers
  private readonly country_map: Record<string, string> = {
    DO: 'República Dominicana',
    US: 'Estados Unidos',
    CO: 'Colombia',
    MX: 'México',
    ES: 'España',
    AR: 'Argentina',
    CL: 'Chile',
    PE: 'Perú',
    VE: 'Venezuela',
    EC: 'Ecuador',
    GT: 'Guatemala',
    HN: 'Honduras',
    SV: 'El Salvador',
    NI: 'Nicaragua',
    CR: 'Costa Rica',
    PA: 'Panamá',
    PR: 'Puerto Rico',
    CU: 'Cuba',
    BR: 'Brasil',
    UY: 'Uruguay',
    PY: 'Paraguay',
    BO: 'Bolivia',
  };

  formatCountries(countries: string[]): string {
    if (!countries || countries.length === 0) return '-';
    const name = this.country_map[countries[0]] || countries[0];
    if (countries.length === 1) return name;
    return `${name} +${countries.length - 1}`;
  }
}
