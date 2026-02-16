import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SystemShippingMethod } from '../../interfaces/shipping-methods.interface';
import {
  InputsearchComponent,
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  DropdownAction,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'app-available-shipping-methods-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './available-shipping-methods-list.component.html',
})
export class AvailableShippingMethodsListComponent {
  // Inputs (Angular signals)
  readonly shipping_methods = input.required<SystemShippingMethod[]>();
  readonly is_loading = input<boolean>(false);
  readonly is_enabling = input<boolean>(false);

  // Outputs
  readonly enable = output<SystemShippingMethod>();
  readonly refresh = output<void>();

  // Search state
  search_term = '';

  // Computed filtered items
  readonly filtered_methods = computed(() => {
    const methods = this.shipping_methods();
    if (!this.search_term) return methods;
    const term = this.search_term.toLowerCase();
    return methods.filter(
      (m) =>
        m.name?.toLowerCase().includes(term) ||
        m.type?.toLowerCase().includes(term) ||
        m.provider_name?.toLowerCase().includes(term)
    );
  });

  // Dropdown actions
  dropdown_actions: DropdownAction[] = [
    {
      label: 'Actualizar',
      icon: 'refresh-cw',
      action: 'refresh',
    },
  ];

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
      label: 'Activar',
      icon: 'plus',
      action: (method: SystemShippingMethod) => this.enable.emit(method),
      variant: 'primary',
      disabled: () => this.is_enabling(),
    },
  ];

  // Event handlers
  onSearchChange(term: string): void {
    this.search_term = term;
  }

  onActionClick(action: string): void {
    if (action === 'refresh') {
      this.refresh.emit();
    }
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
    if (!min_days && !max_days) return '-';
    if (min_days === max_days) return `${min_days} días`;
    if (!max_days) return `${min_days}+ días`;
    return `${min_days}-${max_days} días`;
  }
}
