import { Component, Input, Output, EventEmitter, TemplateRef, ContentChild, AfterContentInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

export interface TableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  template?: TemplateRef<any>;
  transform?: (value: any) => string;
  defaultValue?: string;
  badge?: boolean;
  badgeConfig?: {
    type?: 'status' | 'custom';
    colorKey?: string; // For status type, maps to predefined colors
    colorMap?: Record<string, string>; // For custom mapping of values to colors
    size?: 'sm' | 'md' | 'lg';
  };
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
  imports: [CommonModule, IconComponent],
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

  /**
   * Get CSS classes for badge based on configuration
   */
  getBadgeClasses(column: TableColumn, value: any): string {
    if (!column.badgeConfig) {
      // Default badge class if no config
      return 'status-badge-default';
    }

    const baseClass = 'status-badge';
    const sizeClass = `status-badge-${column.badgeConfig.size || 'md'}`;
    
    if (column.badgeConfig.type === 'status') {
      // For status type, use predefined color classes
      // Apply transform if exists to get display value, but use original for class
      const displayValue = column.transform ? column.transform(value) : value;
      const originalValue = value; // Use original value for CSS class
      
      // Handle UserState enum values and common status strings
      let statusValue = String(originalValue)?.toLowerCase() || 'default';
      
      // Handle boolean values for active/inactive status
      if (typeof originalValue === 'boolean') {
        statusValue = originalValue ? 'active' : 'inactive';
      }
      
      // Map common status variations to standard CSS classes
      const statusMap: Record<string, string> = {
        'active': 'active',
        'inactive': 'inactive',
        'pending_verification': 'pending',
        'pending': 'pending',
        'suspended': 'suspended',
        'archived': 'draft',
        'draft': 'draft',
        'completed': 'completed',
        'error': 'error',
        'warning': 'warning'
      };
      
      const colorClass = `status-${statusMap[statusValue] || 'default'}`;
      return `${baseClass} ${colorClass} ${sizeClass}`;
    } else if (column.badgeConfig.type === 'custom' && column.badgeConfig.colorMap) {
      // For custom type, we'll use inline styles instead of CSS classes
      return `${baseClass} ${sizeClass} status-badge-custom`;
    }
    
    return `${baseClass} ${sizeClass}`;
  }

  /**
   * Get background color for custom badges
   */
  getBadgeBackgroundColor(column: TableColumn, value: any): string | null {
    if (column.badgeConfig?.type === 'custom' && column.badgeConfig.colorMap) {
      const color = this.getBadgeColorFromMap(column, value);
      if (color) {
        // Convert the color to a soft/transparent version for background
        return this.makeColorSoft(color);
      }
    }
    return null;
  }

  /**
   * Get text color for custom badges
   */
  getBadgeTextColor(column: TableColumn, value: any): string | null {
    if (column.badgeConfig?.type === 'custom' && column.badgeConfig.colorMap) {
      return this.getBadgeColorFromMap(column, value);
    }
    return null;
  }

  /**
   * Get border color for custom badges
   */
  getBadgeBorderColor(column: TableColumn, value: any): string | null {
    if (column.badgeConfig?.type === 'custom' && column.badgeConfig.colorMap) {
      const color = this.getBadgeColorFromMap(column, value);
      if (color) {
        // Make border slightly more transparent than text
        return this.makeColorMoreTransparent(color);
      }
    }
    return null;
  }

  /**
   * Get color from the color map based on value
   * This method applies the column transform function if it exists before looking up the color
   */
  private getBadgeColorFromMap(column: TableColumn, value: any): string | null {
    if (column.badgeConfig?.colorMap) {
      // Apply transform function to get display value if exists
      const displayValue = column.transform ? column.transform(value) : value;
      
      // First try exact match with original value
      const exactValue = String(value);
      if (column.badgeConfig.colorMap[exactValue]) {
        return column.badgeConfig.colorMap[exactValue];
      }
      
      // Then try case-insensitive match with original value
      const valueStr = String(value).toLowerCase();
      if (column.badgeConfig.colorMap[valueStr]) {
        return column.badgeConfig.colorMap[valueStr];
      }
      
      // If we have a transform function, also try matching the transformed value
      if (column.transform && displayValue !== value) {
        const displayValueStr = String(displayValue).toLowerCase();
        if (column.badgeConfig.colorMap[displayValueStr]) {
          return column.badgeConfig.colorMap[displayValueStr];
        }
      }
      
      // Try to handle numeric values by converting to categories if applicable
      if (typeof value === 'number') {
        if (value >= 4) { // high rating
          return column.badgeConfig.colorMap['high'] || 
                 column.badgeConfig.colorMap['excellent'] || 
                 column.badgeConfig.colorMap['good'] || null;
        } else if (value >= 3) { // medium rating
          return column.badgeConfig.colorMap['medium'] || 
                 column.badgeConfig.colorMap['average'] || null;
        } else { // low rating
          return column.badgeConfig.colorMap['low'] || 
                 column.badgeConfig.colorMap['poor'] || null;
        }
      }
      
      // Handle string values that might contain numbers
      if (typeof value === 'string' && !isNaN(Number(value))) {
        const numValue = Number(value);
        if (numValue >= 4) {
          return column.badgeConfig.colorMap['high'] || 
                 column.badgeConfig.colorMap['excellent'] || 
                 column.badgeConfig.colorMap['good'] || null;
        } else if (numValue >= 3) {
          return column.badgeConfig.colorMap['medium'] || 
                 column.badgeConfig.colorMap['average'] || null;
        } else {
          return column.badgeConfig.colorMap['low'] || 
                 column.badgeConfig.colorMap['poor'] || null;
        }
      }
    }
    return null;
  }

  /**
   * Make a color softer by reducing its opacity
   */
  private makeColorSoft(color: string): string {
    // Convert hex to rgba with lower opacity
    if (color.startsWith('#')) {
      return this.hexToRgba(color, 0.15);
    } else if (color.startsWith('rgb') || color.startsWith('rgba')) {
      return color.replace(/[\d.]+\)$/, '0.15)');
    }
    return color;
  }

  /**
   * Make a color slightly more transparent
   */
  private makeColorMoreTransparent(color: string): string {
    if (color.startsWith('#')) {
      return this.hexToRgba(color, 0.3);
    } else if (color.startsWith('rgb') || color.startsWith('rgba')) {
      return color.replace(/[\d.]+\)$/, '0.3)');
    }
    return color;
  }

  /**
   * Convert hex color to rgba
   */
  private hexToRgba(hex: string, alpha: number): string {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Parse r, g, b values
    let r = 0, g = 0, b = 0;
    if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else if (hex.length === 3) {
      r = parseInt(hex.substring(0, 1) + hex.substring(0, 1), 16);
      g = parseInt(hex.substring(1, 2) + hex.substring(1, 2), 16);
      b = parseInt(hex.substring(2, 3) + hex.substring(2, 3), 16);
    }
    
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
