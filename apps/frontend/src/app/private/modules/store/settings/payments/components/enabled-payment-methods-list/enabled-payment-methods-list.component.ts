import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StorePaymentMethod } from '../../interfaces/payment-methods.interface';
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
  selector: 'app-enabled-payment-methods-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './enabled-payment-methods-list.component.html',
})
export class EnabledPaymentMethodsListComponent {
  // Inputs (Angular signals)
  readonly payment_methods = input.required<StorePaymentMethod[]>();
  readonly is_loading = input<boolean>(false);

  // Outputs
  readonly edit = output<StorePaymentMethod>();
  readonly toggle = output<StorePaymentMethod>();
  readonly delete = output<StorePaymentMethod>();
  readonly refresh = output<void>();

  // Search state
  search_term = '';

  // Computed filtered items
  readonly filtered_methods = computed(() => {
    const methods = this.payment_methods();
    if (!this.search_term) return methods;
    const term = this.search_term.toLowerCase();
    return methods.filter(
      (m) =>
        m.display_name?.toLowerCase().includes(term) ||
        m.system_payment_method?.provider?.toLowerCase().includes(term)
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
  // NOTA: Los transforms reciben el ITEM completo, no el valor de la key
  card_config: ItemListCardConfig = {
    titleKey: 'display_name',
    titleTransform: (item: StorePaymentMethod) =>
      item.display_name || 'Sin nombre',
    subtitleKey: 'system_payment_method.provider',
    subtitleTransform: (item: StorePaymentMethod) =>
      item.system_payment_method?.provider || 'Sistema',
    avatarFallbackIcon: 'credit-card',
    avatarShape: 'square',
    badgeKey: 'state',
    badgeConfig: {
      type: 'status',
      size: 'sm',
    },
    // badgeTransform recibe el VALOR (state string), no el item completo
    badgeTransform: (value: string) => this.getStateLabel(value),
    detailKeys: [
      {
        key: 'system_payment_method.type',
        label: 'Tipo',
      },
      {
        key: 'display_order',
        label: 'Orden',
      },
    ],
    // Footer requerido para que se muestren las acciones
    footerKey: 'created_at',
    footerLabel: 'Agregado',
    footerTransform: (val: string) =>
      val ? new Date(val).toLocaleDateString() : '-',
  };

  // Table columns for desktop
  table_columns: TableColumn[] = [
    {
      key: 'display_name',
      label: 'Método',
      sortable: true,
      priority: 1,
      transform: (value: string) => value || 'Sin nombre',
    },
    {
      key: 'system_payment_method.provider',
      label: 'Proveedor',
      priority: 2,
      defaultValue: '-',
    },
    {
      key: 'state',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: string) => this.getStateLabel(value),
    },
    {
      key: 'system_payment_method.type',
      label: 'Tipo',
      priority: 3,
      transform: (value: string) => this.getTypeLabel(value),
    },
  ];

  // Table actions
  table_actions: TableAction[] = [
    {
      label: 'Configurar',
      icon: 'settings',
      action: (method: StorePaymentMethod) => this.edit.emit(method),
      variant: 'primary',
    },
    {
      label: (method: StorePaymentMethod) =>
        method.state === 'enabled' ? 'Desactivar' : 'Activar',
      icon: (method: StorePaymentMethod) =>
        method.state === 'enabled' ? 'pause' : 'play',
      action: (method: StorePaymentMethod) => this.toggle.emit(method),
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
  private getStateLabel(state: string): string {
    const label_map: Record<string, string> = {
      enabled: 'Activo',
      disabled: 'Inactivo',
      archived: 'Archivado',
      requires_configuration: 'Requiere Config',
    };
    return label_map[state] || state;
  }

  private getTypeLabel(type: string): string {
    const type_map: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      paypal: 'PayPal',
      bank_transfer: 'Transferencia',
    };
    return type_map[type] || type;
  }
}
