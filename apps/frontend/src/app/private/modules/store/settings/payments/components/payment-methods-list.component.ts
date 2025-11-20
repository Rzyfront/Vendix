import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StorePaymentMethod } from '../interfaces/payment-methods.interface';
import {
  ButtonComponent,
  IconComponent,
  TableComponent,
  TableColumn,
  TableAction,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-payment-methods-list',
  standalone: true,
  imports: [CommonModule, TableComponent],
  template: `
    <app-table
      [data]="payment_methods"
      [columns]="table_columns"
      [actions]="table_actions"
      [loading]="is_loading"
      empty_message="No payment methods configured"
    >
    </app-table>
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
export class PaymentMethodsListComponent {
  @Input() payment_methods: StorePaymentMethod[] = [];
  @Input() is_loading = false;

  @Output() edit = new EventEmitter<StorePaymentMethod>();
  @Output() toggle = new EventEmitter<StorePaymentMethod>();
  @Output() delete = new EventEmitter<StorePaymentMethod>();
  @Output() reorder = new EventEmitter<string[]>();

  table_columns: TableColumn[] = [
    {
      key: 'system_payment_method.display_name',
      label: 'Payment Method',
      sortable: true,
      transform: (value: any) => {
        return value;
      },
    },
    {
      key: 'system_payment_method.type',
      label: 'Type',
      sortable: true,
      transform: (value: string) => {
        return `
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            ${this.getPaymentMethodTypeLabel(value)}
          </span>
        `;
      },
    },
    {
      key: 'state',
      label: 'Status',
      sortable: true,
      transform: (value: string) => {
        const color = this.getStateColor(value);
        const label = this.getStateLabel(value);
        return `
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-${color}-100 text-${color}-800">
            ${label}
          </span>
        `;
      },
    },
    {
      key: 'display_order',
      label: 'Order',
      sortable: true,
      transform: (value: number) => {
        return `<span class="text-sm text-gray-900">#${value + 1}</span>`;
      },
    },
    {
      key: 'created_at',
      label: 'Added Date',
      sortable: true,
      transform: (value: string) => {
        return `<span class="text-sm text-gray-900">${new Date(value).toLocaleDateString()}</span>`;
      },
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Edit',
      icon: 'edit',
      variant: 'secondary',
      action: (row: StorePaymentMethod) => this.edit.emit(row),
      show: (row: StorePaymentMethod) => row.state !== 'archived',
    },
    {
      label: (row: StorePaymentMethod) =>
        row.state === 'enabled' ? 'Disable' : 'Enable',
      icon: (row: StorePaymentMethod) =>
        row.state === 'enabled' ? 'pause' : 'play',
      variant: 'primary',
      action: (row: StorePaymentMethod) => this.toggle.emit(row),
      show: (row: StorePaymentMethod) => row.state !== 'archived',
    },
    {
      label: 'Delete',
      icon: 'trash',
      variant: 'danger',
      action: (row: StorePaymentMethod) => this.delete.emit(row),
      show: (row: StorePaymentMethod) => row.state === 'disabled',
    },
  ];

  private getPaymentMethodIcon(type: string): string {
    const icon_map: Record<string, string> = {
      cash: 'money-bill',
      card: 'credit-card',
      paypal: 'globe',
      bank_transfer: 'university',
    };
    return icon_map[type] || 'payment';
  }

  private getPaymentMethodTypeLabel(type: string): string {
    const label_map: Record<string, string> = {
      cash: 'Cash',
      card: 'Credit/Debit Card',
      paypal: 'PayPal',
      bank_transfer: 'Bank Transfer',
    };
    return label_map[type] || type;
  }

  private getStateLabel(state: string): string {
    const label_map: Record<string, string> = {
      enabled: 'Enabled',
      disabled: 'Disabled',
      archived: 'Archived',
      requires_configuration: 'Requires Config',
    };
    return label_map[state] || state;
  }

  private getStateColor(state: string): string {
    const color_map: Record<string, string> = {
      enabled: 'green',
      disabled: 'yellow',
      archived: 'gray',
      requires_configuration: 'blue',
    };
    return color_map[state] || 'gray';
  }
}
