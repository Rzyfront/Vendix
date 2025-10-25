import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import { ButtonComponent, IconComponent } from '../../../../../shared/components';

// Import interfaces
import { StoreListItem } from '../interfaces/store.interface';

@Component({
  selector: 'app-store-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="bg-surface rounded-card shadow-card border border-border p-6 hover:shadow-lg transition-shadow duration-200">
      <!-- Header -->
      <div class="flex items-start justify-between mb-4">
        <div class="flex-1">
          <h3 class="text-lg font-semibold text-text-primary mb-1">{{ store.name }}</h3>
          <p class="text-sm text-text-secondary">{{ store.slug }}</p>
        </div>
        <div class="flex items-center gap-2">
          <span 
            class="px-2 py-1 text-xs font-medium rounded-full"
            [ngClass]="getStatusClasses(store.state)">
            {{ formatStatus(store.state) }}
          </span>
        </div>
      </div>

      <!-- Store Info -->
      <div class="space-y-3 mb-4">
        <div class="flex items-center gap-2 text-sm">
          <app-icon name="mail" [size]="16" class="text-text-secondary"></app-icon>
          <span class="text-text-primary">{{ store.email }}</span>
        </div>
        
        <div class="flex items-center gap-2 text-sm" *ngIf="store.phone">
          <app-icon name="phone" [size]="16" class="text-text-secondary"></app-icon>
          <span class="text-text-primary">{{ store.phone }}</span>
        </div>
        
        <div class="flex items-center gap-2 text-sm" *ngIf="store.city">
          <app-icon name="map-pin" [size]="16" class="text-text-secondary"></app-icon>
          <span class="text-text-primary">{{ store.city }}, {{ store.country }}</span>
        </div>
        
        <div class="flex items-center gap-2 text-sm">
          <app-icon name="building" [size]="16" class="text-text-secondary"></app-icon>
          <span class="text-text-primary">{{ store.organization_name }}</span>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div class="text-center">
          <p class="text-2xl font-bold text-text-primary">{{ store.products_count || 0 }}</p>
          <p class="text-xs text-text-secondary">Products</p>
        </div>
        <div class="text-center">
          <p class="text-2xl font-bold text-text-primary">{{ store.orders_count || 0 }}</p>
          <p class="text-xs text-text-secondary">Orders</p>
        </div>
        <div class="text-center">
          <p class="text-2xl font-bold text-text-primary">$ {{ formatCurrency(store.revenue || 0) }}</p>
          <p class="text-xs text-text-secondary">Revenue</p>
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
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class StoreCardComponent {
  @Input() store!: StoreListItem;

  constructor() {}

  formatStatus(status: string): string {
    const statusMap: { [key: string]: string } = {
      'active': 'Activo',
      'inactive': 'Inactivo',
      'draft': 'Borrador',
      'suspended': 'Suspendido',
      'archived': 'Archivado'
    };
    return statusMap[status] || status;
  }

  getStatusClasses(status: string): string {
    const baseClasses = 'px-2 py-1 text-xs font-medium rounded-full';
    
    const statusClasses: { [key: string]: string } = {
      'active': 'bg-green-100 text-green-800',
      'inactive': 'bg-yellow-100 text-yellow-800',
      'draft': 'bg-gray-100 text-gray-800',
      'suspended': 'bg-red-100 text-red-800',
      'archived': 'bg-purple-100 text-purple-800'
    };
    
    return `${baseClasses} ${statusClasses[status] || 'bg-gray-100 text-gray-800'}`;
  }

  formatCurrency(value: number): string {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    } else if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toFixed(0);
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