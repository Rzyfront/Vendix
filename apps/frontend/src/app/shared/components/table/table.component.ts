import {
  Component,
  Input,
  Output,
  EventEmitter,
  TemplateRef,
  ContentChild,
  AfterContentInit,
  OnDestroy, // ← add
  ChangeDetectorRef, // ← add
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
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
  mobilePriority?: number; // 1 = alta, 2 = media, 3 = baja prioridad en móvil
  hidden?: boolean; // Nueva propiedad para ocultar columnas responsivamente
}

export interface TableAction {
  label: string | ((item: any) => string);
  icon?: string | ((item: any) => string);
  action: (item: any) => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
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
  styleUrl: './table.component.scss',
})
export class TableComponent implements AfterContentInit, OnDestroy {
  @Input() data: any[] = [];
  @Input() columns: TableColumn[] = [];
  @Input() actions?: TableAction[];
  @Input() size: TableSize = 'md';
  @Input() loading = false;
  @Input() emptyMessage = 'No hay datos disponibles';
  @Input() showHeader = true;
  @Input() striped = true;
  @Input() hoverable = true;
  @Input() bordered = false;
  @Input() compact = false;
  @Input() sortable = false;
  @Input() customClasses = '';
  @Input() mobileBreakpoint = 768; // Nuevo input configurable
  @Input() filterForm: FormGroup | null = null; // Soporte para formularios Reactive externos

  // Scroll and layout configuration
  @Input() maxHeight = '600px';
  @Input() enableScroll = true;
  @Input() stickyHeader = true;

  @Output() sort = new EventEmitter<{
    column: string;
    direction: SortDirection;
  }>();
  @Output() rowClick = new EventEmitter<any>();

  @ContentChild('actionsTemplate') actionsTemplate?: TemplateRef<any>;

  sortColumn: string | null = null;
  sortDirection: SortDirection = null;

  // Nuevas propiedades para responsive
  isMobileView: boolean = false;
  isTabletView: boolean = false;
  isDesktopView: boolean = false;
  private resizeListener?: () => void;

  constructor(private cdr: ChangeDetectorRef) {
    this.checkViewport();
  }
  ngAfterContentInit(): void {
    // Validar que las columnas tengan las propiedades necesarias
    this.columns.forEach((col) => {
      if (!col.key || !col.label) {
        console.warn(
          'Columna inválida: cada columna debe tener key y label',
          col,
        );
      }
    });

    // Automáticamente hacer verdes los botones de editar
    if (this.actions) {
      this.actions.forEach((action) => {
        const label =
          typeof action.label === 'function' ? action.label({}) : action.label;
        const icon =
          typeof action.icon === 'function' ? action.icon({}) : action.icon;

        // Si es botón de editar (por label o icono), forzar variante success
        if (
          (label && label.toLowerCase().includes('editar')) ||
          (icon && icon === 'edit') ||
          action.icon === 'edit'
        ) {
          action.variant = 'success';
        }
      });
    }
  }

  ngOnDestroy(): void {
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
  }

  private checkViewport(): void {
    if (typeof window !== 'undefined') {
      const width = window.innerWidth;

      // ✅ Breakpoints corregidos
      this.isMobileView = width <= 767; // Mobile: <= 767px
      this.isTabletView = width >= 768 && width <= 1023; // Tablet: 768-1023px
      this.isDesktopView = width >= 1024; // Desktop: >= 1024px

      this.resizeListener = () => {
        const new_width = window.innerWidth;
        const new_mobile_view = new_width <= 767;
        // const new_tablet_view = new_width >= 768 && new_width <= 1023;
        // const new_desktop_view = new_width >= 1024;

        if (new_mobile_view !== this.isMobileView) {
          this.isMobileView = new_mobile_view;
          // this.isTabletView = new_tablet_view;
          // this.isDesktopView = new_desktop_view;
          this.cdr.markForCheck();
        }
      };

      window.addEventListener('resize', this.resizeListener);
    }
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
      direction: this.sortDirection!,
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

  getActionLabel(action: TableAction, item: any): string {
    return typeof action.label === 'function'
      ? action.label(item)
      : action.label;
  }

  getActionIcon(action: TableAction, item: any): string {
    const icon =
      typeof action.icon === 'function' ? action.icon(item) : action.icon;
    return icon || '';
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
      'overflow-hidden',
    ];

    const sizeClasses = {
      sm: ['text-xs'],
      md: ['text-sm'],
      lg: ['text-base'],
    };

    const classes = [...baseClasses, ...sizeClasses[this.size]];

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
      'border-border',
    ];

    const sizeClasses = {
      sm: ['px-3', 'py-2'],
      md: ['px-4', 'py-3'],
      lg: ['px-6', 'py-4'],
    };

    return [...baseClasses, ...sizeClasses[this.size]].join(' ');
  }

  getRowClasses(index: number): string {
    const baseClasses = [
      'border-b',
      'border-border',
      'transition-colors',
      'duration-150',
    ];

    const sizeClasses = {
      sm: ['px-3', 'py-2'],
      md: ['px-4', 'py-3'],
      lg: ['px-6', 'py-4'],
    };

    if (this.striped && index % 2 !== 0) {
      baseClasses.push('bg-muted/10');
    }

    if (this.hoverable) {
      baseClasses.push('hover:bg-muted/20');
    }

    return [...baseClasses, ...sizeClasses[this.size]].join(' ');
  }

  getMobileCardClasses(index: number): string {
    let classes = 'mobile-card';

    if (this.striped && index % 2 !== 0) {
      classes += ' bg-muted/10';
    }

    return classes;
  }

  getCellClasses(column: TableColumn): string {
    const alignClasses = {
      left: ['text-left'],
      center: ['text-center'],
      right: ['text-right'],
    };

    const widthClass = column.width ? [`w-[${column.width}]`] : [];

    return [...alignClasses[column.align || 'left'], ...widthClass].join(' ');
  }

  getActionClasses(action: TableAction, item: any): string {
    const baseClasses = [
      'inline-flex',
      'items-center',
      'gap-1',
      'text-xs',
      'font-medium',
      'transition-all',
      'duration-150',
      'focus:outline-none',
      'focus:ring-2',
      'focus:ring-offset-1',
    ];

    // Ajustes específicos para móvil
    if (this.isMobileView) {
      baseClasses.push('px-6', 'py-2', 'rounded-full'); // Más grandes y en forma de píldora
    } else {
      baseClasses.push('px-2', 'py-1', 'rounded'); // Normal en desktop
    }

    const variantClasses = {
      primary: [
        'bg-primary',
        'text-white',
        'hover:bg-primary/90',
        'focus:ring-primary/50',
      ],
      secondary: [
        'bg-muted',
        'text-text-primary',
        'hover:bg-muted/80',
        'focus:ring-muted/50',
      ],
      danger: [
        'bg-red-600',
        'text-white',
        'hover:bg-red-700',
        'focus:ring-red-500',
      ],
      success: [
        'bg-green-600',
        'text-white',
        'hover:bg-green-700',
        'focus:ring-green-500/50',
      ],
      ghost: [
        'text-text-secondary',
        'hover:bg-muted/20',
        'hover:text-text-primary',
        'focus:ring-muted/50',
      ],
    };

    const disabledClasses = this.isActionDisabled(action, item)
      ? ['opacity-50', 'cursor-not-allowed']
      : ['cursor-pointer'];

    return [
      ...baseClasses,
      ...variantClasses[action.variant || 'ghost'],
      ...disabledClasses,
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
        active: 'active',
        inactive: 'inactive',
        pending_verification: 'pending',
        pending: 'pending',
        suspended: 'suspended',
        archived: 'draft',
        draft: 'draft',
        completed: 'completed',
        error: 'error',
        warning: 'warning',
      };

      const colorClass = `status-${statusMap[statusValue] || 'default'}`;
      return `${baseClass} ${colorClass} ${sizeClass}`;
    } else if (
      column.badgeConfig.type === 'custom' &&
      column.badgeConfig.colorMap
    ) {
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
        if (value >= 4) {
          // high rating
          return (
            column.badgeConfig.colorMap['high'] ||
            column.badgeConfig.colorMap['excellent'] ||
            column.badgeConfig.colorMap['good'] ||
            null
          );
        } else if (value >= 3) {
          // medium rating
          return (
            column.badgeConfig.colorMap['medium'] ||
            column.badgeConfig.colorMap['average'] ||
            null
          );
        } else {
          // low rating
          return (
            column.badgeConfig.colorMap['low'] ||
            column.badgeConfig.colorMap['poor'] ||
            null
          );
        }
      }

      // Handle string values that might contain numbers
      if (typeof value === 'string' && !isNaN(Number(value))) {
        const numValue = Number(value);
        if (numValue >= 4) {
          return (
            column.badgeConfig.colorMap['high'] ||
            column.badgeConfig.colorMap['excellent'] ||
            column.badgeConfig.colorMap['good'] ||
            null
          );
        } else if (numValue >= 3) {
          return (
            column.badgeConfig.colorMap['medium'] ||
            column.badgeConfig.colorMap['average'] ||
            null
          );
        } else {
          return (
            column.badgeConfig.colorMap['low'] ||
            column.badgeConfig.colorMap['poor'] ||
            null
          );
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
    let r = 0,
      g = 0,
      b = 0;
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

  /**
   * Get columns to show in mobile view based on priority
   */
  getMobileColumns(): TableColumn[] {
    return this.columns; // Devuelve todas las columnas en lugar de filtrar por prioridad
  }

  /**
   * Get responsive columns with intelligent priority system for any table type
   */
  getResponsiveColumns(): TableColumn[] {
    if (!this.isMobileView) {
      const screenWidth =
        typeof window !== 'undefined' ? window.innerWidth : 1024;
      const breakpoints = this.getResponsiveBreakpoints(this.columns.length);

      let maxColumns: number;

      // Determinar cantidad máxima de columnas por breakpoint
      if (screenWidth < 1024) {
        maxColumns = breakpoints.small;
      } else if (screenWidth < 1440) {
        maxColumns = breakpoints.medium;
      } else {
        maxColumns = breakpoints.large;
      }

      // Ordenar por prioridad inteligente y tomar las N más importantes
      return this.columns
        .map((col) => ({ ...col, priority: this.getColumnPriority(col) }))
        .sort((a, b) => a.priority - b.priority)
        .slice(0, maxColumns)
        .map((col) => ({
          ...col,
          width: this.getAdaptiveWidth(col, maxColumns),
        }));
    }

    return this.columns;
  }

  /**
   * Enhanced intelligent priority system with more patterns and better scoring
   */
  private getColumnPriority(column: TableColumn): number {
    const key = column.key.toLowerCase();
    const label = column.label.toLowerCase();

    // PRIORIDAD 1: Identificadores principales (máxima importancia)
    if (
      key === 'id' ||
      key === 'code' ||
      key === 'sku' ||
      key.includes('name') ||
      key.includes('title') ||
      key.includes('nombre') ||
      key.includes('título') ||
      label.includes('nombre') ||
      label.includes('código')
    ) {
      return 1;
    }

    // PRIORIDAD 2: Información de contacto (alta importancia)
    if (
      key.includes('email') ||
      key.includes('mail') ||
      key.includes('phone') ||
      key.includes('teléfono') ||
      key.includes('contact') ||
      key.includes('contacto') ||
      key.includes('mobile') ||
      key.includes('celular')
    ) {
      return 2;
    }

    // PRIORIDAD 3: Estados y categorías (importancia media-alta)
    if (
      key.includes('state') ||
      key.includes('status') ||
      key.includes('estado') ||
      key.includes('estatus') ||
      key.includes('type') ||
      key.includes('tipo') ||
      key.includes('category') ||
      key.includes('categoría') ||
      key.includes('role') ||
      key.includes('rol') ||
      key.includes('active') ||
      key.includes('activo') ||
      key.includes('enabled') ||
      key.includes('habilitado')
    ) {
      return 3;
    }

    // PRIORIDAD 4: Información financiera/valores (importancia media)
    if (
      key.includes('price') ||
      key.includes('precio') ||
      key.includes('cost') ||
      key.includes('costo') ||
      key.includes('amount') ||
      key.includes('monto') ||
      key.includes('total') ||
      key.includes('subtotal') ||
      key.includes('value') ||
      key.includes('valor') ||
      key.includes('quantity') ||
      key.includes('cantidad') ||
      key.includes('stock') ||
      key.includes('inventario')
    ) {
      return 4;
    }

    // PRIORIDAD 5: Fechas importantes (importancia media)
    if (
      key.includes('created') ||
      key.includes('creado') ||
      key.includes('updated') ||
      key.includes('actualizado') ||
      key.includes('modified') ||
      key.includes('modificado') ||
      key.includes('date') ||
      key.includes('fecha') ||
      key.includes('time') ||
      key.includes('hora') ||
      key.includes('login') ||
      key.includes('acceso') ||
      key.includes('last') ||
      key.includes('último')
    ) {
      return 5;
    }

    // PRIORIDAD 6: Ubicación/dirección (importancia media-baja)
    if (
      key.includes('address') ||
      key.includes('dirección') ||
      key.includes('location') ||
      key.includes('ubicación') ||
      key.includes('city') ||
      key.includes('ciudad') ||
      key.includes('country') ||
      key.includes('país') ||
      key.includes('state') ||
      key.includes('provincia')
    ) {
      return 6;
    }

    // PRIORIDAD 7: Información descriptiva (baja importancia)
    if (
      key.includes('description') ||
      key.includes('descripción') ||
      key.includes('notes') ||
      key.includes('notas') ||
      key.includes('comment') ||
      key.includes('comentario') ||
      key.includes('observation') ||
      key.includes('observación') ||
      key.includes('detail') ||
      key.includes('detalle')
    ) {
      return 7;
    }

    // PRIORIDAD 8: Información técnica/metadata (muy baja importancia)
    if (
      key.includes('internal') ||
      key.includes('meta') ||
      key.includes('system') ||
      key.includes('sistema') ||
      key.startsWith('_') ||
      key.includes('uuid') ||
      key.includes('hash') ||
      key.includes('token')
    ) {
      return 8;
    }

    // DEFAULT: Prioridad media para campos no reconocidos
    return 4;
  }

  /**
   * Get responsive breakpoints with smoother transitions
   */
  private getResponsiveBreakpoints(totalColumns: number) {
    // Sistema de breakpoints más granular para transiciones suaves
    if (totalColumns <= 3) {
      return { small: totalColumns, medium: totalColumns, large: totalColumns };
    }

    if (totalColumns <= 5) {
      return { small: 3, medium: 4, large: totalColumns };
    }

    if (totalColumns <= 8) {
      return { small: 4, medium: 6, large: totalColumns };
    }

    if (totalColumns <= 12) {
      return { small: 5, medium: 8, large: 10 };
    }

    // Para tablas muy grandes, mostrar máximo 12 columnas en pantallas grandes
    return { small: 6, medium: 9, large: 12 };
  }

  /**
   * Get standardized max height based on screen size (following Context.md guidelines)
   */
  getMaxHeight(): string {
    if (typeof window === 'undefined') return '600px';

    const width = window.innerWidth;

    // Extra large screens (2xl): 1280px+
    if (width >= 1280) {
      return '800px';
    }

    // Large screens (xl): 1024px+
    if (width >= 1024) {
      return '700px';
    }

    // Default: 600px for smaller screens
    return '600px';
  }

  /**
   * Enhanced adaptive width calculation with better spacing logic
   */
  private getAdaptiveWidth(column: TableColumn, visibleCount: number): string {
    const key = column.key.toLowerCase();
    const priority = this.getColumnPriority(column);

    // Base widths más precisas por tipo de dato y prioridad
    let baseWidth = 110; // Base más conservadora

    // Ajustes por tipo de contenido
    if (
      key.includes('name') ||
      key.includes('title') ||
      key.includes('nombre') ||
      key.includes('título')
    ) {
      baseWidth = 150; // Nombres necesitan más espacio
    } else if (key.includes('email') || key.includes('mail')) {
      baseWidth = 190; // Emails son largos
    } else if (
      key.includes('description') ||
      key.includes('descripción') ||
      key.includes('comment')
    ) {
      baseWidth = 180; // Descripciones variables
    } else if (key.includes('address') || key.includes('dirección')) {
      baseWidth = 170; // Direcciones son largas
    } else if (
      key.includes('date') ||
      key.includes('fecha') ||
      key.includes('created') ||
      key.includes('updated')
    ) {
      baseWidth = 125; // Fechas tienen formato estándar
    } else if (
      key.includes('phone') ||
      key.includes('teléfono') ||
      key.includes('mobile')
    ) {
      baseWidth = 130; // Números de teléfono
    } else if (
      key.includes('price') ||
      key.includes('precio') ||
      key.includes('cost') ||
      key.includes('amount')
    ) {
      baseWidth = 110; // Valores monetarios
    } else if (
      key.includes('state') ||
      key.includes('status') ||
      key.includes('estado') ||
      key.includes('type')
    ) {
      baseWidth = 105; // Estados cortos
    } else if (
      key.includes('quantity') ||
      key.includes('cantidad') ||
      key.includes('stock')
    ) {
      baseWidth = 95; // Números pequeños
    }

    // Ajustes por cantidad de columnas visibles (más sofisticado)
    if (visibleCount >= 8) {
      // Muchas columnas: comprimir más
      baseWidth = Math.max(baseWidth * 0.75, 85);
    } else if (visibleCount >= 6) {
      // Columnas moderadas: ligero compresión
      baseWidth = Math.max(baseWidth * 0.85, 90);
    } else if (visibleCount >= 4) {
      // Columnas razonables: ancho normal
      baseWidth = baseWidth * 0.95;
    } else if (visibleCount <= 2) {
      // Muy pocas columnas: dar más espacio
      baseWidth = baseWidth * 1.2;
    }

    // Ajuste final por prioridad (columnas más importantes tienen leve preferencia)
    if (priority <= 2) {
      baseWidth = baseWidth * 1.05; // 5% más para alta prioridad
    }

    // Redondear a múltiplos de 5 para consistencia
    const rounded = Math.round(baseWidth / 5) * 5;

    return `${Math.max(rounded, 80)}px`; // Mínimo 80px para legibilidad
  }

  /**
   * Get the badge column value for mobile cards
   */
  getBadgeValue(item: any): string {
    const badgeColumn = this.columns.find((c) => c.badge);
    if (!badgeColumn) return '';

    const value = this.getNestedValue(item, badgeColumn.key);
    return badgeColumn.transform ? badgeColumn.transform(value) : value;
  }

  /**
   * Get the title for mobile cards (first column value)
   */
  getCardTitle(item: any): any {
    return this.columns[0]
      ? this.getNestedValue(item, this.columns[0].key)
      : '';
  }

  /**
   * Get the badge column
   */
  getBadgeColumn(): TableColumn | undefined {
    return this.columns.find((c) => c.badge);
  }
}
