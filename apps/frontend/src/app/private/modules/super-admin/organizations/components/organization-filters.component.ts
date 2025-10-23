import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-organization-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bg-white p-4 rounded-lg border border-border">
      <div class="flex flex-col md:flex-row gap-4">
        <!-- Search Input -->
        <div class="flex-1">
          <div class="relative">
            <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted"></i>
            <input
              type="text"
              placeholder="Search organizations..."
              class="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              [(ngModel)]="searchTerm"
              (input)="onSearchChange()"
            />
          </div>
        </div>

        <!-- Status Filter -->
        <div class="md:w-48">
          <select
            class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            [(ngModel)]="selectedStatus"
            (change)="onStatusFilterChange()">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
            <option value="draft">Draft</option>
          </select>
        </div>

        <!-- Clear Filters Button -->
        <button
          *ngIf="hasActiveFilters"
          class="px-4 py-2 rounded-lg font-medium border border-border text-text-primary hover:bg-gray-50"
          (click)="clearFilters()">
          <i class="fas fa-times mr-2"></i>
          Clear Filters
        </button>
      </div>

      <!-- Active Filters Display -->
      <div *ngIf="hasActiveFilters" class="mt-3 flex items-center gap-2">
        <span class="text-sm text-text-muted">Active filters:</span>
        <div class="flex gap-2">
          <span
            *ngIf="searchTerm"
            class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
            Search: {{ searchTerm }}
            <button
              class="ml-1 hover:text-primary/80"
              (click)="clearSearch()">
              <i class="fas fa-times text-xs"></i>
            </button>
          </span>
          <span
            *ngIf="selectedStatus"
            class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
            Status: {{ selectedStatus }}
            <button
              class="ml-1 hover:text-primary/80"
              (click)="clearStatus()">
              <i class="fas fa-times text-xs"></i>
            </button>
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
export class OrganizationFiltersComponent {
  @Input() searchTerm = '';
  @Input() selectedStatus = '';
  @Output() searchChange = new EventEmitter<string>();
  @Output() statusFilterChange = new EventEmitter<string>();
  @Output() filtersCleared = new EventEmitter<void>();

  get hasActiveFilters(): boolean {
    return !!(this.searchTerm || this.selectedStatus);
  }

  onSearchChange(): void {
    this.searchChange.emit(this.searchTerm);
  }

  onStatusFilterChange(): void {
    this.statusFilterChange.emit(this.selectedStatus);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = '';
    this.filtersCleared.emit();
    this.searchChange.emit('');
    this.statusFilterChange.emit('');
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.searchChange.emit('');
  }

  clearStatus(): void {
    this.selectedStatus = '';
    this.statusFilterChange.emit('');
  }
}