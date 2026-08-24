import {
  Component,
  ChangeDetectionStrategy,
  input,
  model,
  output,
  signal,
  computed,
} from '@angular/core';
import { NgClass, NgStyle } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import {
  ItemListCardConfig,
  ItemListSize,
  RowSelectionState,
  TableAction,
} from './item-list.interfaces';

export type ItemListActionsDisplay = 'buttons' | 'dropdown';

@Component({
  selector: 'app-item-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, NgStyle, IconComponent],
  templateUrl: './item-list.component.html',
  styleUrl: './item-list.component.scss',
})
export class ItemListComponent {
  readonly data = input<any[]>([]);
  readonly cardConfig = input.required<ItemListCardConfig>();
  readonly actions = input<TableAction[]>();
  readonly loadingInput = input(false, { alias: 'loading' });
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());
  readonly emptyMessage = input('No hay datos disponibles');
  readonly emptyIcon = input('inbox');
  readonly size = input<ItemListSize>('md');
  readonly actionsDisplay = input<ItemListActionsDisplay>('buttons');
  readonly rowClass = input<(item: any, index: number) => string | undefined | null>(
    () => undefined
  );

  // --- Multi-selection (opt-in, additive) ---
  // `selectable` defaults to false: while it stays false the template renders
  // exactly the same DOM it rendered before this feature existed.
  readonly selectable = input<boolean>(false);
  /** Key (dot notation supported) that identifies a row. */
  readonly rowIdKey = input<string>('id');
  /**
   * Clave que IDENTIFICA la tarjeta para quien no la ve. Misma razón y misma
   * semántica que en `app-table`: los botones del pie son iconos, y «Eliminar»
   * repetido quince veces no dice qué se elimina.
   */
  readonly rowLabelKey = input<string | null>(null);
  /**
   * Two-way selection state owned by the PARENT, so it survives pagination and
   * the desktop/mobile switch. Never mutated in place — a NEW Set is published
   * on every change, otherwise signal change detection would not react.
   */
  readonly selectedIds = model<Set<string | number>>(new Set<string | number>());

  readonly itemClick = output<any>();
  readonly actionClick = output<{
    action: TableAction;
    item: any;
  }>();

  activeMenuIndex: number | null = null;

  // Progress ring (donut) geometry. Circle radius is 52 in a 120x120 viewBox.
  readonly donutRadius = 52;
  readonly donutCircumference = 2 * Math.PI * this.donutRadius;

  getDashOffset(percent: number): number {
    return this.donutCircumference * (1 - (percent || 0) / 100);
  }

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

  getTitle(item: any): string {
    const config = this.cardConfig();
    if (config.titleTransform) {
      return config.titleTransform(item);
    }
    const key = config.titleKey;
    if (key) {
      return this.getNestedValue(item, key) || '';
    }
    return '';
  }

  getSubtitle(item: any): string {
    const config = this.cardConfig();
    if (config.subtitleTransform) {
      return config.subtitleTransform(item);
    }
    const key = config.subtitleKey;
    if (key) {
      return this.getNestedValue(item, key) || '';
    }
    return '';
  }

  showAvatar(): boolean {
    const config = this.cardConfig();
    return !!(config.avatarKey || config.avatarFallbackIcon);
  }

  getAvatarUrl(item: any): string | null {
    const key = this.cardConfig().avatarKey;
    if (key) {
      return this.getNestedValue(item, key) || null;
    }
    return null;
  }

  onAvatarClick(item: any, event: MouseEvent): void {
    const avatarClick = this.cardConfig().avatarClick;
    if (!avatarClick || !this.getAvatarUrl(item)) {
      return;
    }
    event.stopPropagation();
    avatarClick(item, event);
  }

  getBadgeValue(item: any): any {
    const key = this.cardConfig().badgeKey;
    if (key) {
      return this.getNestedValue(item, key);
    }
    return null;
  }

  getBadgeText(item: any): string {
    const value = this.getBadgeValue(item);
    if (value === null || value === undefined) return '';
    const transform = this.cardConfig().badgeTransform;
    if (transform) {
      return transform(value);
    }
    return String(value);
  }

  getBadgeClasses(item: any): string {
    const value = this.getBadgeValue(item);
    const config = this.cardConfig();
    const badgeConfig = config.badgeConfig;
    if (!badgeConfig) {
      return 'status-badge status-badge-default status-badge-sm';
    }
    const baseClass = 'status-badge';
    const sizeClass = `status-badge-${badgeConfig.size || 'sm'}`;
    if (badgeConfig.type === 'status') {
      let statusValue = String(value)?.toLowerCase() || 'default';
      if (typeof value === 'boolean') {
        statusValue = value ? 'active' : 'inactive';
      }
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
    }
    return `${baseClass} ${sizeClass}`;
  }

  getBadgeStyle(item: any): { [key: string]: string } {
    const config = this.cardConfig();
    const badgeConfig = config.badgeConfig;
    if (!badgeConfig?.colorMap && !badgeConfig?.colorFn) {
      return {};
    }
    const rawValue = this.getRawBadgeValue(item);
    let color: string | null | undefined;
    // colorFn wins over colorMap when both are provided
    if (badgeConfig.colorFn) {
      color = badgeConfig.colorFn(rawValue, item);
    }
    if (!color && badgeConfig.colorMap) {
      const strValue = String(rawValue);
      let lookupValue = strValue;
      if (typeof rawValue === 'boolean') {
        lookupValue = rawValue ? 'active' : 'inactive';
      }
      color =
        badgeConfig.colorMap[lookupValue] ??
        badgeConfig.colorMap[lookupValue.toLowerCase()];
    }
    if (color) {
      let bg = color;
      if (color.startsWith('#') && color.length === 7) {
        bg = `${color}26`;
      }
      return {
        'background-color': bg,
        color: color,
        border: `1px solid ${color}40`,
      };
    }
    return {};
  }

  /**
   * Returns the raw (untransformed) badge value from the item, so colorFn /
   * colorMap can decide based on the underlying number/boolean rather than
   * the formatted display string.
   */
  private getRawBadgeValue(item: any): any {
    const config = this.cardConfig();
    if (!config.badgeKey) return undefined;
    const keys = config.badgeKey.split('.');
    let current = item;
    for (const k of keys) {
      if (current == null) return undefined;
      current = current[k];
    }
    return current;
  }

  getDetailValue(item: any, field: any): string {
    const value = this.getNestedValue(item, field.key);
    if (value === null || value === undefined) return '-';
    if (field.transform) {
      return field.transform(value, item);
    }
    return String(value);
  }

  getInfoIcon(item: any, field: any): string | undefined {
    if (field.infoIconTransform) {
      const value = this.getNestedValue(item, field.key);
      return field.infoIconTransform(value, item);
    }
    return field.infoIcon;
  }

  getInfoIconVariant(item: any, field: any): string | undefined {
    if (field.infoIconVariantTransform) {
      const value = this.getNestedValue(item, field.key);
      return field.infoIconVariantTransform(value, item);
    }
    return field.infoIconVariant;
  }

  getFooterValue(item: any): string {
    const config = this.cardConfig();
    const footerKey = config.footerKey;
    if (!footerKey) return '';
    const value = this.getNestedValue(item, footerKey);
    if (value === null || value === undefined) return '-';
    const transform = config.footerTransform;
    if (transform) {
      return transform(value, item);
    }
    return String(value);
  }

  onItemClick(item: any): void {
    this.itemClick.emit(item);
  }

  // ─── Multi-selection helpers (same names/semantics as TableComponent) ──
  /** Resolve the selection key of a row (`null` when the row has no usable id). */
  getRowId(item: any): string | number | null {
    const id = this.getNestedValue(item, this.rowIdKey());
    if (id === null || id === undefined || id === '') {
      return null;
    }
    return id as string | number;
  }

  isRowSelected(item: any): boolean {
    const id = this.getRowId(item);
    return id === null ? false : this.selectedIds().has(id);
  }

  toggleRow(item: any): void {
    const id = this.getRowId(item);
    if (id === null) {
      return;
    }
    // New Set on every mutation: mutating in place does not notify the signal.
    const next = new Set(this.selectedIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedIds.set(next);
  }

  /** Ids of the cards currently rendered (the page slice given in `data`). */
  readonly visibleRowIds = computed<(string | number)[]>(() => {
    const ids: (string | number)[] = [];
    for (const item of this.data()) {
      const id = this.getRowId(item);
      if (id !== null) {
        ids.push(id);
      }
    }
    return ids;
  });

  /** Tri-state computed over the VISIBLE cards only, never the whole universe. */
  readonly headerSelectionState = computed<RowSelectionState>(() => {
    const ids = this.visibleRowIds();
    if (ids.length === 0) {
      return 'none';
    }
    const selected = this.selectedIds();
    let hits = 0;
    for (const id of ids) {
      if (selected.has(id)) {
        hits++;
      }
    }
    if (hits === 0) {
      return 'none';
    }
    return hits === ids.length ? 'all' : 'some';
  });

  /**
   * Add/remove every VISIBLE id, preserving ids selected on other pages: the
   * parent paginates, so an id outside `data()` must never be dropped here.
   */
  toggleAllVisible(): void {
    const ids = this.visibleRowIds();
    if (ids.length === 0) {
      return;
    }
    const next = new Set(this.selectedIds());
    if (this.headerSelectionState() === 'all') {
      for (const id of ids) {
        next.delete(id);
      }
    } else {
      for (const id of ids) {
        next.add(id);
      }
    }
    this.selectedIds.set(next);
  }

  toggleMenu(index: number, event: Event): void {
    event.stopPropagation();
    this.activeMenuIndex = this.activeMenuIndex === index ? null : index;
  }

  closeMenu(): void {
    this.activeMenuIndex = null;
  }

  executeAction(action: TableAction, item: any, event: Event): void {
    event.stopPropagation();
    this.activeMenuIndex = null;
    if (action.disabled?.(item)) {
      return;
    }
    action.action(item);
    this.actionClick.emit({ action, item });
  }

  isActionVisible(action: TableAction, item: any): boolean {
    return action.show ? action.show(item) : true;
  }

  isActionDisabled(action: TableAction, item: any): boolean {
    return action.disabled ? action.disabled(item) : false;
  }

  /**
   * Nombre accesible del botón de acción: la etiqueta más la tarjeta, cuando la
   * tarjeta se puede nombrar. Ver `rowLabelKey`.
   */
  /**
   * Nombre accesible del disparador del menú de desborde.
   *
   * Sin esto son N botones «Acciones» idénticos: el `title` da nombre, pero no
   * dice de qué tarjeta, que es justo lo que un lector de pantalla necesita
   * cuando detrás del menú hay un «Eliminar».
   */
  getMenuTriggerAccessibleName(item: any): string {
    const key = this.rowLabelKey();
    if (!key) return 'Acciones';
    const raw = this.getNestedValue(item, key);
    const name = raw === null || raw === undefined ? '' : String(raw).trim();
    return name ? `Más acciones: ${name}` : 'Acciones';
  }

  getActionAccessibleName(action: TableAction, item: any): string {
    const label = this.getActionLabel(action, item);
    const key = this.rowLabelKey();
    if (!key) return label;
    const raw = this.getNestedValue(item, key);
    const name = raw === null || raw === undefined ? '' : String(raw).trim();
    return name ? `${label}: ${name}` : label;
  }

  getActionLabel(action: TableAction, item: any): string {
    return typeof action.label === 'function'
      ? action.label(item)
      : action.label;
  }

  getActionTooltip(action: TableAction, item: any): string {
    if (action.tooltip) {
      return typeof action.tooltip === 'function'
        ? action.tooltip(item)
        : action.tooltip;
    }
    return this.getActionLabel(action, item);
  }

  getActionIcon(action: TableAction, item: any): string {
    const icon =
      typeof action.icon === 'function' ? action.icon(item) : action.icon;
    return icon || '';
  }

  getActionVariant(action: TableAction, item: any): string {
    const variant =
      typeof action.variant === 'function'
        ? action.variant(item)
        : action.variant || 'ghost';
    return `action-${variant}`;
  }

  getMenuItemVariant(action: TableAction, item: any): string {
    const variant =
      typeof action.variant === 'function'
        ? action.variant(item)
        : action.variant || 'ghost';
    return `menu-item-${variant}`;
  }

  getVisibleActions(item: any): TableAction[] {
    const acts = this.actions();
    if (!acts) return [];
    return acts.filter((action) => this.isActionVisible(action, item));
  }

  getMenuActions(item: any): TableAction[] {
    const visibleActions = this.getVisibleActions(item);
    return this.actionsDisplay() === 'dropdown'
      ? visibleActions
      : visibleActions.slice(2);
  }

  getSizeClasses(): string {
    const sizeMap = {
      sm: 'item-list-sm',
      md: 'item-list-md',
      lg: 'item-list-lg',
    };
    return sizeMap[this.size()];
  }
}
