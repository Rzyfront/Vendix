import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  selector: 'app-available-payment-methods-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './available-payment-methods-list.component.html',
})
export class AvailablePaymentMethodsListComponent {
  // Inputs (Angular signals)
  readonly payment_methods = input.required<any[]>();
  readonly is_loading = input<boolean>(false);
  readonly is_enabling = input<boolean>(false);

  // Outputs
  readonly enable = output<any>();
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
        m.type?.toLowerCase().includes(term) ||
        m.provider?.toLowerCase().includes(term)
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
    subtitleKey: 'type',
    subtitleTransform: (item: any) => this.getTypeLabel(item.type),
    avatarFallbackIcon: 'plus-circle',
    avatarShape: 'square',
    badgeKey: 'provider',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        system: '#64748b',
        organization: '#7c3aed',
      },
    },
    // badgeTransform recibe el VALOR (provider string), no el item completo
    badgeTransform: (value: string) =>
      value === 'system' ? 'Sistema' : 'Organización',
    detailKeys: [
      {
        key: 'description',
        label: 'Descripción',
      },
    ],
    // Footer requerido para que se muestren las acciones
    footerKey: 'type',
    footerLabel: 'Tipo',
    footerTransform: (val: string) => this.getTypeLabel(val),
  };

  // Table columns for desktop
  table_columns: TableColumn[] = [
    {
      key: 'display_name',
      label: 'Método',
      sortable: true,
      priority: 1,
    },
    {
      key: 'provider',
      label: 'Origen',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          system: '#64748b',
          organization: '#7c3aed',
        },
      },
      transform: (value: string) =>
        value === 'system' ? 'Sistema' : 'Organización',
    },
    {
      key: 'type',
      label: 'Tipo',
      priority: 2,
      transform: (value: string) => this.getTypeLabel(value),
    },
  ];

  // Table actions
  table_actions: TableAction[] = [
    {
      label: 'Activar',
      icon: 'plus',
      action: (method: any) => this.enable.emit(method),
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
      cash: 'Efectivo',
      card: 'Tarjeta',
      paypal: 'PayPal',
      bank_transfer: 'Transferencia',
    };
    return type_map[type] || type;
  }
}
