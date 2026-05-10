import { Component, input, output, signal, computed } from '@angular/core';
import { NgClass, NgStyle } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import {
  ItemListCardConfig,
  ItemListSize,
  TableAction,
} from './item-list.interfaces';

export type ItemListActionsDisplay = 'buttons' | 'dropdown';

@Component({
  selector: 'app-item-list',
  standalone: true,
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

  readonly itemClick = output<any>();
  readonly actionClick = output<{
    action: TableAction;
    item: any;
  }>();

  activeMenuIndex: number | null = null;

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
