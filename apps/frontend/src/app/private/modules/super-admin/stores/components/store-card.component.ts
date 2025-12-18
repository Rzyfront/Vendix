import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components';

// Import interfaces
import { StoreListItem, StoreType } from '../interfaces/store.interface';

@Component({
  selector: 'app-store-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div
      class="bg-surface rounded-card shadow-card border border-border p-6 hover:shadow-lg transition-shadow duration-200"
    >
      <!-- Header -->
      <div class="flex items-start justify-between mb-4">
        <div class="flex-1">
          <h3 class="text-lg font-semibold text-text-primary mb-1">
            {{ store.name }}
          </h3>
          <p class="text-sm text-text-secondary">{{ store.slug }}</p>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="px-2 py-1 text-xs font-medium rounded-full"
            [ngClass]="getStatusClasses(store.is_active)"
          >
            {{ formatActiveStatus(store.is_active) }}
          </span>
          <span
            class="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800"
          >
            {{ formatStoreType(store.store_type) }}
          </span>
        </div>
      </div>

      <!-- Store Info -->
      <div class="space-y-3 mb-4">
        <div class="flex items-center gap-2 text-sm">
          <app-icon
            name="building"
            [size]="16"
            class="text-text-secondary"
          ></app-icon>
          <span class="text-text-primary">{{
            store.organizations?.name || 'N/A'
          }}</span>
        </div>

        <div class="flex items-center gap-2 text-sm" *ngIf="store.store_code">
          <app-icon
            name="tag"
            [size]="16"
            class="text-text-secondary"
          ></app-icon>
          <span class="text-text-primary">{{ store.store_code }}</span>
        </div>

        <div
          class="flex items-center gap-2 text-sm"
          *ngIf="store.addresses && store.addresses.length > 0"
        >
          <app-icon
            name="map-pin"
            [size]="16"
            class="text-text-secondary"
          ></app-icon>
          <span class="text-text-primary">
            {{ getPrimaryAddress(store.addresses)?.city || 'N/A' }},
            {{ getPrimaryAddress(store.addresses)?.state_province || 'N/A' }}
          </span>
        </div>

        <div class="flex items-center gap-2 text-sm">
          <app-icon
            name="clock"
            [size]="16"
            class="text-text-secondary"
          ></app-icon>
          <span class="text-text-primary">{{ store.timezone }}</span>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div class="text-center">
          <p class="text-2xl font-bold text-text-primary">
            {{ store._count?.products || 0 }}
          </p>
          <p class="text-xs text-text-secondary">Products</p>
        </div>
        <div class="text-center">
          <p class="text-2xl font-bold text-text-primary">
            {{ store._count?.orders || 0 }}
          </p>
          <p class="text-xs text-text-secondary">Orders</p>
        </div>
        <div class="text-center">
          <p class="text-2xl font-bold text-text-primary">
            {{ store._count?.store_users || 0 }}
          </p>
          <p class="text-xs text-text-secondary">Users</p>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex gap-2">
        <app-button
          variant="outline"
          size="sm"
          (clicked)="viewStore()"
          class="flex-1"
        >
          <app-icon name="eye" [size]="16" slot="icon"></app-icon>
          View
        </app-button>

        <app-button
          variant="primary"
          size="sm"
          (clicked)="editStore()"
          class="flex-1"
        >
          <app-icon name="edit" [size]="16" slot="icon"></app-icon>
          Edit
        </app-button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StoreCardComponent {
  @Input() store!: StoreListItem;

  constructor() {}

  formatStoreType(type: StoreType): string {
    const typeMap: { [key in StoreType]: string } = {
      [StoreType.PHYSICAL]: 'Física',
      [StoreType.ONLINE]: 'Online',
      [StoreType.HYBRID]: 'Híbrida',
      [StoreType.POPUP]: 'Temporal',
      [StoreType.KIOSKO]: 'Kiosco',
    };
    return typeMap[type] || type;
  }

  formatActiveStatus(isActive: boolean): string {
    return isActive ? 'Activo' : 'Inactivo';
  }

  getStatusClasses(isActive: boolean): string {
    const baseClasses = 'px-2 py-1 text-xs font-medium rounded-full';

    if (isActive) {
      return `${baseClasses} bg-green-100 text-green-800`;
    } else {
      return `${baseClasses} bg-yellow-100 text-yellow-800`;
    }
  }

  formatCurrency(value: number): string {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    } else if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toFixed(0);
  }

  getPrimaryAddress(addresses: any[]): any {
    if (!addresses || addresses.length === 0) return null;
    return addresses.find((addr) => addr.is_primary) || addresses[0];
  }

  viewStore(): void {
    // Emit event or navigate to store details
    console.log('View store:', this.store);
  }

  editStore(): void {
    // Emit event or navigate to edit store
    console.log('Edit store:', this.store);
  }
}
