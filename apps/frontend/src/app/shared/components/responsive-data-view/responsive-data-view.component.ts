import { Component, Input, input, output } from '@angular/core';

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
  imports: [TableComponent, ItemListComponent, EmptyStateComponent],
  template: `
    <!-- Empty State (shared between desktop and mobile) -->
    @if (!loading && data.length === 0) {
      <app-empty-state
        [icon]="emptyIcon()"
        [title]="emptyTitle() || emptyMessage()"
        [description]="emptyDescription() || ''"
        [actionButtonText]="emptyActionText() || 'Crear Nuevo'"
        [actionButtonIcon]="emptyActionIcon() || 'plus'"
        [showActionButton]="showEmptyAction()"
        [showRefreshButton]="showEmptyRefresh()"
        [showClearFilters]="showEmptyClearFilters()"
        (actionClick)="emptyActionClick.emit()"
        (refreshClick)="emptyRefreshClick.emit()"
        (clearFiltersClick)="emptyClearFiltersClick.emit()"
      ></app-empty-state>
    }
    
    <!-- Desktop: Table (hidden on mobile) -->
    @if (data.length > 0 || loading) {
      <div class="hidden md:block">
        <app-table
          [data]="data"
          [columns]="columns()"
          [actions]="actions()"
          [size]="tableSize()"
          [loading]="loading"
          [emptyMessage]="emptyMessage()"
          [showHeader]="showHeader()"
          [striped]="striped()"
          [hoverable]="hoverable()"
          [bordered]="bordered()"
          [compact]="compact()"
          [sortable]="sortable()"
          (sort)="sort.emit($event)"
          (rowClick)="rowClick.emit($event)"
        ></app-table>
      </div>
    }
    
    <!-- Mobile: Item List (hidden on desktop) -->
    @if (data.length > 0 || loading) {
      <div class="block md:hidden">
        <app-item-list
          [data]="data"
          [cardConfig]="cardConfig()"
          [actions]="actions()"
          [loading]="loading"
          [emptyMessage]="emptyMessage()"
          [emptyIcon]="emptyIcon()"
          [size]="itemListSize()"
          (itemClick)="rowClick.emit($event)"
          (actionClick)="actionClick.emit($event)"
        ></app-item-list>
      </div>
    }
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
  readonly columns = input<TableColumn[]>([]);
  readonly tableSize = input<TableSize>('md');
  readonly showHeader = input(true);
  readonly striped = input(false);
  readonly hoverable = input(true);
  readonly bordered = input(false);
  readonly compact = input(false);
  readonly sortable = input(false);

  // Item List configuration
  readonly cardConfig = input.required<ItemListCardConfig>();
  readonly itemListSize = input<ItemListSize>('md');
  readonly emptyIcon = input('inbox');

  // Shared configuration
  readonly actions = input<TableAction[]>();
  @Input() loading = false;
  readonly emptyMessage = input('No hay datos disponibles');

  // Empty state enhanced inputs
  readonly emptyTitle = input<string>();
  readonly emptyDescription = input<string>();
  readonly emptyActionText = input<string>();
  readonly emptyActionIcon = input<string>();
  readonly showEmptyAction = input(false);
  readonly showEmptyClearFilters = input(false);
  readonly showEmptyRefresh = input(false);

  // Events
  readonly sort = output<{
    column: string;
    direction: SortDirection;
}>();
  readonly rowClick = output<any>();
  readonly actionClick = output<{
    action: TableAction;
    item: any;
}>();
  readonly emptyActionClick = output<void>();
  readonly emptyClearFiltersClick = output<void>();
  readonly emptyRefreshClick = output<void>();
}
