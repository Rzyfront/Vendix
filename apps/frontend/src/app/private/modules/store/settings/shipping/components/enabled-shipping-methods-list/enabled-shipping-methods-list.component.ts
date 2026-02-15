import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StoreShippingMethod } from '../../interfaces/shipping-methods.interface';
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
  selector: 'app-enabled-shipping-methods-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './enabled-shipping-methods-list.component.html',
})
export class EnabledShippingMethodsListComponent {
  // Inputs (Angular signals)
  readonly shipping_methods = input.required<StoreShippingMethod[]>();
  readonly is_loading = input<boolean>(false);

  // Outputs
  readonly edit = output<StoreShippingMethod>();
  readonly toggle = output<StoreShippingMethod>();
  readonly delete = output<StoreShippingMethod>();
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
    titleTransform: (item: StoreShippingMethod) =>
      item.name || 'Sin nombre',
    subtitleKey: 'type',
    subtitleTransform: (item: StoreShippingMethod) =>
      this.getTypeLabel(item.type),
    avatarFallbackIcon: 'truck',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'status',
      size: 'sm',
    },
    badgeTransform: (value: boolean) => value ? 'Activo' : 'Inactivo',
    detailKeys: [
      {
        key: 'provider_name',
        label: 'Proveedor',
      },
      {
        key: 'display_order',
        label: 'Orden',
      },
    ],
    footerKey: 'created_at',
    footerLabel: 'Agregado',
    footerTransform: (val: string) =>
      val ? new Date(val).toLocaleDateString() : '-',
  };

  // Table columns for desktop
  table_columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Método',
      sortable: true,
      priority: 1,
      transform: (value: string) => value || 'Sin nombre',
    },
    {
      key: 'type',
      label: 'Tipo',
      priority: 2,
      transform: (value: string) => this.getTypeLabel(value),
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
      transform: (value: boolean) => value ? 'Activo' : 'Inactivo',
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
      label: 'Configurar',
      icon: 'settings',
      action: (method: StoreShippingMethod) => this.edit.emit(method),
      variant: 'primary',
    },
    {
      label: (method: StoreShippingMethod) =>
        method.is_active ? 'Desactivar' : 'Activar',
      icon: (method: StoreShippingMethod) =>
        method.is_active ? 'pause' : 'play',
      action: (method: StoreShippingMethod) => this.toggle.emit(method),
      variant: 'ghost',
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
}
