import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoreShippingMethod } from '../interfaces/shipping-methods.interface';
import {
  ButtonComponent,
  IconComponent,
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-shipping-methods-list',
  standalone: true,
  imports: [CommonModule, ResponsiveDataViewComponent],
  template: `
    <app-responsive-data-view
      [data]="shipping_methods"
      [columns]="table_columns"
      [cardConfig]="card_config"
      [actions]="table_actions"
      [loading]="is_loading"
      emptyMessage="No hay métodos de envío configurados"
      emptyIcon="truck"
    >
    </app-responsive-data-view>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class ShippingMethodsListComponent {
  @Input() shipping_methods: StoreShippingMethod[] = [];
  @Input() is_loading = false;

  @Output() edit = new EventEmitter<StoreShippingMethod>();
  @Output() toggle = new EventEmitter<StoreShippingMethod>();
  @Output() delete = new EventEmitter<StoreShippingMethod>();
  @Output() reorder = new EventEmitter<string[]>();

  card_config: ItemListCardConfig = {
    titleKey: 'name',
    titleTransform: (item: StoreShippingMethod) => item.name || 'Sin nombre',
    subtitleKey: 'type',
    subtitleTransform: (item: StoreShippingMethod) =>
      this.getTypeLabel(item.type),
    avatarFallbackIcon: 'truck',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status' },
    badgeTransform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
    detailKeys: [
      {
        key: 'provider_name',
        label: 'Proveedor',
        transform: (val: string) => val || 'Sin proveedor',
      },
      {
        key: 'created_at',
        label: 'Agregado',
        transform: (val: string) => new Date(val).toLocaleDateString(),
      },
    ],
  };

  table_columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Método de Envío',
      sortable: true,
      priority: 1,
      transform: (value: string) => value || 'Sin nombre',
    },
    {
      key: 'type',
      label: 'Tipo',
      sortable: true,
      priority: 3,
      transform: (value: string) => {
        return `
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            ${this.getTypeLabel(value)}
          </span>
        `;
      },
    },
    {
      key: 'is_active',
      label: 'Estado',
      sortable: true,
      priority: 1,
      transform: (value: boolean) => {
        const color = value ? 'green' : 'yellow';
        const label = value ? 'Activo' : 'Inactivo';
        return `
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-${color}-100 text-${color}-800">
            ${label}
          </span>
        `;
      },
    },
    {
      key: 'min_days',
      label: 'Tiempo',
      sortable: true,
      priority: 3,
      transform: (_value: any, item: StoreShippingMethod) => {
        return this.formatDeliveryTime(item?.min_days, item?.max_days);
      },
    },
    {
      key: 'created_at',
      label: 'Fecha Agregado',
      sortable: true,
      priority: 3,
      transform: (value: string) => {
        return `<span class="text-sm text-gray-900">${new Date(value).toLocaleDateString()}</span>`;
      },
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Configurar',
      icon: 'settings',
      variant: 'secondary',
      action: (row: StoreShippingMethod) => this.edit.emit(row),
      show: (row: StoreShippingMethod) => row.is_active,
    },
    {
      label: (row: StoreShippingMethod) =>
        row.is_active ? 'Desactivar' : 'Activar',
      icon: (row: StoreShippingMethod) =>
        row.is_active ? 'pause' : 'play',
      variant: 'primary',
      action: (row: StoreShippingMethod) => this.toggle.emit(row),
    },
    {
      label: 'Eliminar',
      icon: 'trash',
      variant: 'danger',
      action: (row: StoreShippingMethod) => this.delete.emit(row),
      show: (row: StoreShippingMethod) => !row.is_active,
    },
  ];

  private getTypeLabel(type: string): string {
    const label_map: Record<string, string> = {
      custom: 'Personalizado',
      pickup: 'Recogida',
      own_fleet: 'Flota propia',
      carrier: 'Transportadora',
      third_party_provider: 'Externo',
    };
    return label_map[type] || type;
  }

  private formatDeliveryTime(min_days?: number, max_days?: number): string {
    if (min_days == null && max_days == null) return 'Sin definir';
    if (min_days === max_days) return `${min_days} días`;
    if (!max_days) return `${min_days}+ días`;
    return `${min_days}-${max_days} días`;
  }
}
