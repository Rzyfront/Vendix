import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SystemShippingMethod } from '../interfaces/shipping-methods.interface';
import {
  ModalComponent,
  InputsearchComponent,
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  IconComponent,
  ButtonComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-shipping-methods-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      title="Agregar Método de Envío"
      subtitle="Selecciona un método disponible para agregar a tu tienda"
      size="lg"
      (closed)="close.emit()"
    >
      <div slot="header">
        <div
          class="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100"
        >
          <app-icon name="truck" size="20" class="text-blue-600"></app-icon>
        </div>
      </div>

      <!-- Search -->
      <div class="mb-4">
        <app-inputsearch
          class="w-full"
          size="sm"
          placeholder="Buscar método de envío..."
          [debounceTime]="300"
          [ngModel]="search_term()"
          (ngModelChange)="onSearchChange($event)"
        ></app-inputsearch>
      </div>

      <!-- Loading State -->
      @if (is_loading) {
        <div class="p-6 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary text-sm">Cargando métodos disponibles...</p>
        </div>
      }

      <!-- Empty State -->
      @if (!is_loading && filtered_methods().length === 0) {
        <div class="p-8 text-center">
          <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-green-50 flex items-center justify-center">
            <app-icon name="check-circle" [size]="24" class="text-green-500"></app-icon>
          </div>
          <p class="text-sm text-text-secondary">¡Todos los métodos están activados!</p>
          <p class="text-xs text-gray-400 mt-1">No hay más métodos disponibles para agregar</p>
        </div>
      }

      <!-- Methods List -->
      @if (!is_loading && filtered_methods().length > 0) {
        <app-responsive-data-view
          [data]="filtered_methods()"
          [columns]="table_columns"
          [actions]="table_actions"
          [cardConfig]="card_config"
          [loading]="is_loading"
          emptyMessage="No hay métodos disponibles"
          emptyIcon="truck"
        ></app-responsive-data-view>
      }

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="ghost" (clicked)="close.emit()">
          Cancelar
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ShippingMethodsModalComponent {
  @Input() available_methods: SystemShippingMethod[] = [];
  @Input() is_loading = false;
  @Input() is_enabling = false;

  @Output() enable = new EventEmitter<SystemShippingMethod>();
  @Output() close = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();

  // Search state as signal
  search_term = signal('');

  // Computed filtered items
  filtered_methods = computed(() => {
    const methods = this.available_methods;
    const term = this.search_term().toLowerCase();
    if (!term) return methods;
    return methods.filter(
      (m) =>
        m.name?.toLowerCase().includes(term) ||
        m.type?.toLowerCase().includes(term) ||
        m.provider_name?.toLowerCase().includes(term)
    );
  });

  // Card configuration for mobile
  card_config: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    subtitleTransform: (item: SystemShippingMethod) =>
      item.description || 'Sin descripción',
    avatarFallbackIcon: 'plus-circle',
    avatarShape: 'square',
    badgeKey: 'type',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        custom: '#64748b',
        pickup: '#22c55e',
        own_fleet: '#3b82f6',
        carrier: '#f59e0b',
        third_party_provider: '#7c3aed',
      },
    },
    badgeTransform: (value: string) => this.getTypeLabel(value),
    detailKeys: [
      {
        key: 'provider_name',
        label: 'Proveedor',
        transform: (val: string) => val || 'Propio',
      },
      {
        key: 'min_days',
        label: 'Tiempo estimado',
        icon: 'clock',
        transform: (_val: number, item: SystemShippingMethod) =>
          this.formatDeliveryTime(item?.min_days, item?.max_days),
      },
    ],
    footerKey: 'min_days',
    footerLabel: 'Entrega',
    footerTransform: (_val: number, item: SystemShippingMethod) =>
      this.formatDeliveryTime(item?.min_days, item?.max_days),
  };

  // Table columns for desktop
  table_columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Método',
      sortable: true,
      priority: 1,
    },
    {
      key: 'type',
      label: 'Tipo',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          custom: '#64748b',
          pickup: '#22c55e',
          own_fleet: '#3b82f6',
          carrier: '#f59e0b',
          third_party_provider: '#7c3aed',
        },
      },
      transform: (value: string) => this.getTypeLabel(value),
    },
    {
      key: 'min_days',
      label: 'Tiempo',
      priority: 3,
      defaultValue: '-',
    },
  ];

  // Table actions
  table_actions: TableAction[] = [
    {
      label: 'Agregar',
      icon: 'plus',
      action: (method: SystemShippingMethod) => this.enable.emit(method),
      variant: 'primary',
      disabled: () => this.is_enabling,
    },
  ];

  // Event handlers
  onSearchChange(term: string): void {
    this.search_term.set(term);
  }

  // Helper methods
  private getTypeLabel(type: string): string {
    const type_map: Record<string, string> = {
      custom: 'Personalizado',
      pickup: 'Recogida',
      own_fleet: 'Flota propia',
      carrier: 'Transportadora',
      third_party_provider: 'Externo',
    };
    return type_map[type] || type;
  }

  private formatDeliveryTime(min_days?: number, max_days?: number): string {
    if (min_days == null && max_days == null) return '-';
    if (min_days === max_days) return `${min_days} días`;
    if (!max_days) return `${min_days}+ días`;
    return `${min_days}-${max_days} días`;
  }
}
