import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent } from '../table/table.component';
import { ItemListComponent } from '../item-list/item-list.component';
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
  imports: [CommonModule, TableComponent, ItemListComponent],
  template: `
    <!-- Desktop: Table (hidden on mobile) -->
    <div class="hidden md:block">
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
    <div class="block md:hidden">
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

  // Events
  @Output() sort = new EventEmitter<{
    column: string;
    direction: SortDirection;
  }>();
  @Output() rowClick = new EventEmitter<any>();
  @Output() actionClick = new EventEmitter<{ action: TableAction; item: any }>();
}
