import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent } from '../table/table.component';
import { ItemListComponent } from '../item-list/item-list.component';
import { EmptyStateComponent } from '../empty-state/empty-state.component';
import {
  TableColumn,
  TableAction,
  TableSize,
  SortDirection,
} from '../table/table.component';
import {
  ItemListCardConfig,
  ItemListSize,
} from '../item-list/item-list.interfaces';

// Re-export types for consumer convenience
export type { TableColumn, TableAction, TableSize, SortDirection };
export type { ItemListCardConfig, ItemListSize };

/**
 * ResponsiveDataViewComponent
 *
 * A wrapper component that automatically switches between:
 * - TableComponent for desktop views (>= 768px)
 * - ItemListComponent for mobile views (< 768px)
 *
 * This provides optimal UX across all device sizes.
 */
@Component({
  selector: 'app-responsive-data-view',
  standalone: true,
  imports: [CommonModule, TableComponent, ItemListComponent, EmptyStateComponent],
  template: `
    <!-- Empty State (shared between desktop and mobile) -->
    <app-empty-state
      *ngIf="!loading && data.length === 0"
      [icon]="emptyIcon"
      [title]="emptyTitle || emptyMessage"
      [description]="emptyDescription || ''"
      [actionButtonText]="emptyActionText || 'Crear Nuevo'"
      [actionButtonIcon]="emptyActionIcon || 'plus'"
      [showActionButton]="showEmptyAction"
      [showRefreshButton]="showEmptyRefresh"
      [showClearFilters]="showEmptyClearFilters"
      (actionClick)="emptyActionClick.emit()"
      (refreshClick)="emptyRefreshClick.emit()"
      (clearFiltersClick)="emptyClearFiltersClick.emit()"
    ></app-empty-state>

    <!-- Desktop: Table (hidden on mobile) -->
    <div class="hidden md:block" *ngIf="data.length > 0 || loading">
      <app-table
        [data]="data"
        [columns]="columns"
        [actions]="actions"
        [size]="tableSize"
        [loading]="loading"
        [emptyMessage]="emptyMessage"
        [showHeader]="showHeader"
        [striped]="striped"
        [hoverable]="hoverable"
        [bordered]="bordered"
        [compact]="compact"
        [sortable]="sortable"
        (sort)="sort.emit($event)"
        (rowClick)="rowClick.emit($event)"
      ></app-table>
    </div>

    <!-- Mobile: Item List (hidden on desktop) -->
    <div class="block md:hidden" *ngIf="data.length > 0 || loading">
      <app-item-list
        [data]="data"
        [cardConfig]="cardConfig"
        [actions]="actions"
        [loading]="loading"
        [emptyMessage]="emptyMessage"
        [emptyIcon]="emptyIcon"
        [size]="itemListSize"
        (itemClick)="rowClick.emit($event)"
        (actionClick)="actionClick.emit($event)"
      ></app-item-list>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class ResponsiveDataViewComponent {
  // Data
  @Input() data: any[] = [];

  // Table configuration
  @Input() columns: TableColumn[] = [];
  @Input() tableSize: TableSize = 'md';
  @Input() showHeader = true;
  @Input() striped = false;
  @Input() hoverable = true;
  @Input() bordered = false;
  @Input() compact = false;
  @Input() sortable = false;

  // Item List configuration
  @Input() cardConfig!: ItemListCardConfig;
  @Input() itemListSize: ItemListSize = 'md';
  @Input() emptyIcon = 'inbox';

  // Shared configuration
  @Input() actions?: TableAction[];
  @Input() loading = false;
  @Input() emptyMessage = 'No hay datos disponibles';

  // Empty state enhanced inputs
  @Input() emptyTitle?: string;
  @Input() emptyDescription?: string;
  @Input() emptyActionText?: string;
  @Input() emptyActionIcon?: string;
  @Input() showEmptyAction = false;
  @Input() showEmptyClearFilters = false;
  @Input() showEmptyRefresh = false;

  // Events
  @Output() sort = new EventEmitter<{
    column: string;
    direction: SortDirection;
  }>();
  @Output() rowClick = new EventEmitter<any>();
  @Output() actionClick = new EventEmitter<{ action: TableAction; item: any }>();
  @Output() emptyActionClick = new EventEmitter<void>();
  @Output() emptyClearFiltersClick = new EventEmitter<void>();
  @Output() emptyRefreshClick = new EventEmitter<void>();
}
