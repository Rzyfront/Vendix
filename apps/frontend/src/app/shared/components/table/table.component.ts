import { Component, Input, Output, EventEmitter, TemplateRef, ContentChild, AfterContentInit } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface TableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  template?: TemplateRef<any>;
  transform?: (value: any) => string;
  defaultValue?: string;
}

export interface TableAction {
  label: string;
  icon?: string;
  action: (item: any) => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: (item: any) => boolean;
  show?: (item: any) => boolean;
}

export type TableSize = 'sm' | 'md' | 'lg';
export type SortDirection = 'asc' | 'desc' | null;

@Component({
  selector: 'app-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './table.component.html',
  styleUrl: './table.component.scss'
})
export class TableComponent implements AfterContentInit {
  @Input() data: any[] = [];
  @Input() columns: TableColumn[] = [];
  @Input() actions?: TableAction[];
  @Input() size: TableSize = 'md';
  @Input() loading = false;
  @Input() emptyMessage = 'No hay datos disponibles';
  @Input() showHeader = true;
  @Input() striped = false;
  @Input() hoverable = true;
  @Input() bordered = false;
  @Input() compact = false;
  @Input() sortable = false;
  @Input() customClasses = '';

  @Output() sort = new EventEmitter<{ column: string; direction: SortDirection }>();
  @Output() rowClick = new EventEmitter<any>();

  @ContentChild('actionsTemplate') actionsTemplate?: TemplateRef<any>;

  sortColumn: string | null = null;
  sortDirection: SortDirection = null;

  ngAfterContentInit(): void {
    // Validar que las columnas tengan las propiedades necesarias
    this.columns.forEach(col => {
      if (!col.key || !col.label) {
        console.warn('Columna inválida: cada columna debe tener key y label', col);
      }
    });
  }

  onSort(column: TableColumn): void {
    if (!this.sortable || !column.sortable) {
      return;
    }

    if (this.sortColumn === column.key) {
      // Cambiar dirección: asc -> desc -> null
      if (this.sortDirection === 'asc') {
        this.sortDirection = 'desc';
      } else if (this.sortDirection === 'desc') {
        this.sortDirection = null;
        this.sortColumn = null;
      } else {
        this.sortDirection = 'asc';
      }
    } else {
      this.sortColumn = column.key;
      this.sortDirection = 'asc';
    }

    this.sort.emit({
      column: this.sortColumn!,
      direction: this.sortDirection!
    });
  }

  onRowClick(item: any): void {
    this.rowClick.emit(item);
  }

  executeAction(action: TableAction, item: any): void {
    if (action.disabled?.(item)) {
      return;
    }
    action.action(item);
  }

  isActionVisible(action: TableAction, item: any): boolean {
    return action.show ? action.show(item) : true;
  }

  isActionDisabled(action: TableAction, item: any): boolean {
    return action.disabled ? action.disabled(item) : false;
  }

  getSortIcon(column: TableColumn): string {
    if (this.sortColumn !== column.key) {
      return 'M7 16l-4-4m0 0l4-4m-4 4h18';
    }
    
    if (this.sortDirection === 'asc') {
      return 'M5 15l7-7 7 7';
    }
    
    return 'M19 9l-7 7-7-7';
  }

  getTableClasses(): string {
    const baseClasses = [
      'w-full',
      'border-collapse',
      'bg-surface',
      'overflow-hidden'
    ];

    const sizeClasses = {
      sm: ['text-xs'],
      md: ['text-sm'],
      lg: ['text-base']
    };

    const classes = [
      ...baseClasses,
      ...sizeClasses[this.size]
    ];

    if (this.bordered) {
      classes.push('border', 'border-border');
    }

    if (this.customClasses) {
      classes.push(this.customClasses);
    }

    return classes.join(' ');
  }

  getHeaderClasses(): string {
    const baseClasses = [
      'bg-muted/20',
      'font-semibold',
      'text-text-primary',
      'border-b',
      'border-border'
    ];

    const sizeClasses = {
      sm: ['px-3', 'py-2'],
      md: ['px-4', 'py-3'],
      lg: ['px-6', 'py-4']
    };

    return [...baseClasses, ...sizeClasses[this.size]].join(' ');
  }

  getRowClasses(index: number): string {
    const baseClasses = [
      'border-b',
      'border-border',
      'transition-colors',
      'duration-150'
    ];

    const sizeClasses = {
      sm: ['px-3', 'py-2'],
      md: ['px-4', 'py-3'],
      lg: ['px-6', 'py-4']
    };

    if (this.striped && index % 2 !== 0) {
      baseClasses.push('bg-muted/10');
    }

    if (this.hoverable) {
      baseClasses.push('hover:bg-muted/20');
    }

    return [...baseClasses, ...sizeClasses[this.size]].join(' ');
  }

  getCellClasses(column: TableColumn): string {
    const alignClasses = {
      left: ['text-left'],
      center: ['text-center'],
      right: ['text-right']
    };

    const widthClass = column.width ? [`w-[${column.width}]`] : [];

    return [...alignClasses[column.align || 'left'], ...widthClass].join(' ');
  }

  getActionClasses(action: TableAction, item: any): string {
    const baseClasses = [
      'inline-flex',
      'items-center',
      'gap-1',
      'px-2',
      'py-1',
      'rounded',
      'text-xs',
      'font-medium',
      'transition-all',
      'duration-150',
      'focus:outline-none',
      'focus:ring-2',
      'focus:ring-offset-1'
    ];

    const variantClasses = {
      primary: [
        'bg-primary',
        'text-white',
        'hover:bg-primary/90',
        'focus:ring-primary/50'
      ],
      secondary: [
        'bg-muted',
        'text-text-primary',
        'hover:bg-muted/80',
        'focus:ring-muted/50'
      ],
      danger: [
        'bg-red-600',
        'text-white',
        'hover:bg-red-700',
        'focus:ring-red-500'
      ],
      ghost: [
        'text-text-secondary',
        'hover:bg-muted/20',
        'hover:text-text-primary',
        'focus:ring-muted/50'
      ]
    };

    const disabledClasses = this.isActionDisabled(action, item) 
      ? ['opacity-50', 'cursor-not-allowed']
      : ['cursor-pointer'];

    return [
      ...baseClasses,
      ...variantClasses[action.variant || 'ghost'],
      ...disabledClasses
    ].join(' ');
  }

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj: any, path: string): any {
    if (!path || !obj) return obj;

    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }
}
