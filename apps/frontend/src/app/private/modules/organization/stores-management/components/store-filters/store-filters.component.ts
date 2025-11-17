import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StoreType } from '../../../../super-admin/stores/interfaces/store.interface';
import { OrganizationStoresService } from '../../services/organization-stores.service';

// App shared components
import {
  ButtonComponent,
  IconComponent,
  InputComponent
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-store-filters',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    // App shared components
    ButtonComponent,
    IconComponent,
    InputComponent
  ],
  template: `
    <div class="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-6 mb-6">
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <!-- Left: Search and Filters -->
        <div class="flex flex-col sm:flex-row gap-3 flex-1">
          <!-- Search -->
          <div class="relative flex-1 max-w-md">
            <app-input
              [(ngModel)]="searchTerm"
              (ngModelChange)="onSearchChange()"
              placeholder="Buscar por nombre o código..."
              type="text"
            >
              <app-icon
                slot="prefix"
                name="search"
                [size]="16"
                color="var(--color-text-secondary)"
              />
              <app-icon
                *ngIf="searchTerm"
                slot="suffix"
                name="x"
                [size]="16"
                color="var(--color-text-secondary)"
                style="cursor: pointer"
                (click)="clearSearch()"
              />
            </app-input>
          </div>

          <!-- Store Type Filter -->
          <div>
            <select
              [(ngModel)]="selectedStoreType"
              (change)="applyFilters()"
              class="h-[var(--height-md)] px-3 py-2 border border-border rounded-[var(--radius-md)] bg-white text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            >
              <option value="">Todos los tipos</option>
              <option *ngFor="let option of storeTypeOptions" [value]="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>

          <!-- Status Filter -->
          <div>
            <select
              [(ngModel)]="selectedStatus"
              (change)="applyFilters()"
              class="h-[var(--height-md)] px-3 py-2 border border-border rounded-[var(--radius-md)] bg-white text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            >
              <option value="">Todos los estados</option>
              <option value="true">Activas</option>
              <option value="false">Inactivas</option>
            </select>
          </div>
        </div>

        <!-- Right: Actions -->
        <div class="flex items-center gap-3">
          <!-- Clear Filters Button -->
          <app-button
            (click)="clearFilters()"
            [disabled]="!hasActiveFilters()"
            variant="outline"
            size="md"
          >
            Limpiar Filtros
          </app-button>

          <!-- Refresh Button -->
          <app-button
            (click)="refresh.emit()"
            variant="ghost"
            size="md"
            title="Actualizar lista"
          >
            <app-icon name="refresh-cw" [size]="16" />
          </app-button>

          <!-- Create Store Button -->
          <app-button
            (click)="createStore.emit()"
            variant="primary"
            size="md"
          >
            <app-icon name="plus" [size]="16" />
            Nueva Tienda
          </app-button>
        </div>
      </div>

      <!-- Active Filters Display -->
      <div *ngIf="hasActiveFilters()" class="mt-4 pt-4 border-t border-border">
        <div class="flex flex-wrap gap-2 items-center">
          <span class="text-sm text-[var(--color-text-secondary)]">Filtros activos:</span>

          <!-- Search Filter -->
          <span *ngIf="searchTerm" class="inline-flex items-center px-3 py-1 rounded-full text-sm bg-[var(--color-primary)] bg-opacity-10 text-[var(--color-primary)]">
            <app-icon name="search" [size]="12" class="mr-1" />
            Búsqueda: "{{ searchTerm }}"
            <app-icon
              name="x"
              [size]="12"
              class="ml-2 cursor-pointer hover:text-[var(--color-primary)]"
              (click)="clearSearch()"
            />
          </span>

          <!-- Store Type Filter -->
          <span *ngIf="selectedStoreType" class="inline-flex items-center px-3 py-1 rounded-full text-sm bg-[var(--color-success)] bg-opacity-10 text-[var(--color-success)]">
            <app-icon name="filter" [size]="12" class="mr-1" />
            Tipo: {{ getStoreTypeLabel(selectedStoreType) }}
            <app-icon
              name="x"
              [size]="12"
              class="ml-2 cursor-pointer hover:text-[var(--color-success)]"
              (click)="selectedStoreType = ''; applyFilters()"
            />
          </span>

          <!-- Status Filter -->
          <span *ngIf="selectedStatus !== ''" class="inline-flex items-center px-3 py-1 rounded-full text-sm bg-[var(--color-warning)] bg-opacity-10 text-[var(--color-warning)]">
            <app-icon name="toggle-left" [size]="12" class="mr-1" />
            Estado: {{ selectedStatus === 'true' ? 'Activas' : 'Inactivas' }}
            <app-icon
              name="x"
              [size]="12"
              class="ml-2 cursor-pointer hover:text-[var(--color-warning)]"
              (click)="selectedStatus = ''; applyFilters()"
            />
          </span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class StoreFiltersComponent implements OnInit {
  @Input() loading = false;

  @Output() filterChange = new EventEmitter<{
    search?: string;
    store_type?: StoreType;
    is_active?: boolean;
  }>();

  @Output() refresh = new EventEmitter<void>();
  @Output() createStore = new EventEmitter<void>();

  searchTerm = '';
  selectedStoreType = '';
  selectedStatus = '';
  storeTypeOptions: Array<{ value: StoreType; label: string }> = [];

  // Debounce timer for search
  private searchDebounceTimer: any;

  constructor(private storesService: OrganizationStoresService) {}

  ngOnInit(): void {
    this.storeTypeOptions = this.storesService.getStoreTypeOptions();
  }

  onSearchChange(): void {
    // Clear existing timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    // Set new timer (500ms delay)
    this.searchDebounceTimer = setTimeout(() => {
      this.applyFilters();
    }, 500);
  }

  applyFilters(): void {
    const filters: any = {};

    if (this.searchTerm.trim()) {
      filters.search = this.searchTerm.trim();
    }

    if (this.selectedStoreType) {
      filters.store_type = this.selectedStoreType as StoreType;
    }

    if (this.selectedStatus !== '') {
      filters.is_active = this.selectedStatus === 'true';
    }

    this.filterChange.emit(filters);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.applyFilters();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStoreType = '';
    this.selectedStatus = '';
    this.applyFilters();
  }

  hasActiveFilters(): boolean {
    return !!(this.searchTerm || this.selectedStoreType || this.selectedStatus !== '');
  }

  getStoreTypeLabel(type: string): string {
    const typeLabels = {
      [StoreType.PHYSICAL]: 'Física',
      [StoreType.ONLINE]: 'Online',
      [StoreType.HYBRID]: 'Híbrida',
      [StoreType.POPUP]: 'Popup',
      [StoreType.KIOSKO]: 'Kiosko',
    };
    return typeLabels[type as StoreType] || type;
  }
}