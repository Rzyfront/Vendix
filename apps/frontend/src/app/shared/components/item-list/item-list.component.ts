import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import {
  ItemListCardConfig,
  ItemListSize,
  TableAction,
} from './item-list.interfaces';

@Component({
  selector: 'app-item-list',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './item-list.component.html',
  styleUrl: './item-list.component.scss',
})
export class ItemListComponent {
  @Input() data: any[] = [];
  @Input() cardConfig!: ItemListCardConfig;
  @Input() actions?: TableAction[];
  @Input() loading = false;
  @Input() emptyMessage = 'No hay datos disponibles';
  @Input() emptyIcon = 'inbox';
  @Input() size: ItemListSize = 'md';

  @Output() itemClick = new EventEmitter<any>();
  @Output() actionClick = new EventEmitter<{ action: TableAction; item: any }>();

  activeMenuIndex: number | null = null;

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
   * Get the title for a card item
   */
  getTitle(item: any): string {
    if (this.cardConfig.titleTransform) {
      return this.cardConfig.titleTransform(item);
    }
    return this.getNestedValue(item, this.cardConfig.titleKey) || '';
  }

  /**
   * Get the subtitle for a card item
   */
  getSubtitle(item: any): string {
    if (this.cardConfig.subtitleTransform) {
      return this.cardConfig.subtitleTransform(item);
    }
    if (this.cardConfig.subtitleKey) {
      return this.getNestedValue(item, this.cardConfig.subtitleKey) || '';
    }
    return '';
  }

  /**
   * Check if avatar should be displayed
   * Avatar is optional - only shown if avatarKey or avatarFallbackIcon is configured
   */
  showAvatar(): boolean {
    return !!(this.cardConfig.avatarKey || this.cardConfig.avatarFallbackIcon);
  }

  /**
   * Get avatar URL for a card item
   */
  getAvatarUrl(item: any): string | null {
    if (this.cardConfig.avatarKey) {
      return this.getNestedValue(item, this.cardConfig.avatarKey) || null;
    }
    return null;
  }

  /**
   * Get badge value for a card item
   */
  getBadgeValue(item: any): any {
    if (this.cardConfig.badgeKey) {
      return this.getNestedValue(item, this.cardConfig.badgeKey);
    }
    return null;
  }

  /**
   * Get formatted badge text
   */
  getBadgeText(item: any): string {
    const value = this.getBadgeValue(item);
    if (value === null || value === undefined) return '';

    if (this.cardConfig.badgeTransform) {
      return this.cardConfig.badgeTransform(value);
    }
    return String(value);
  }

  /**
   * Get badge CSS classes based on configuration
   */
  getBadgeClasses(item: any): string {
    const value = this.getBadgeValue(item);
    if (!this.cardConfig.badgeConfig) {
      return 'status-badge status-badge-default status-badge-sm';
    }

    const baseClass = 'status-badge';
    const sizeClass = `status-badge-${this.cardConfig.badgeConfig.size || 'sm'}`;

    if (this.cardConfig.badgeConfig.type === 'status') {
      let statusValue = String(value)?.toLowerCase() || 'default';

      // Handle boolean values
      if (typeof value === 'boolean') {
        statusValue = value ? 'active' : 'inactive';
      }

      // Map common status variations
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

  /**
   * Get inline styles for custom badges (hex colors)
   */
  getBadgeStyle(item: any): { [key: string]: string } {
    if (this.cardConfig.badgeConfig?.type === 'custom' && this.cardConfig.badgeConfig.colorMap) {
      const value = this.getBadgeValue(item);
      const strValue = String(value);

      // Check for direct match or boolean match (like getBadgeClasses)
      let lookupValue = strValue;
      if (typeof value === 'boolean') {
        lookupValue = value ? 'active' : 'inactive';
      }

      // Try exact match first, then lowercase
      let color = this.cardConfig.badgeConfig.colorMap[lookupValue];
      if (!color) {
        color = this.cardConfig.badgeConfig.colorMap[lookupValue.toLowerCase()];
      }

      if (color) {
        // Assume hex color. Create a tint for background.
        // If it's not hex, this might fail, but config usually has hex.
        // We simulate Tailwind's bg-opacity-10 by a simple hex manipulation if possible,
        // or just use the color as text and a default light bg if we can't parse.
        // Simple hex opacity: add '26' for ~15% opacity
        let bg = color;
        if (color.startsWith('#') && color.length === 7) {
          bg = `${color}26`;
        }

        return {
          'background-color': bg,
          'color': color,
          'border': `1px solid ${color}40`
        };
      }
    }
    return {};
  }

  /**
   * Get detail field value
   */
  getDetailValue(item: any, field: { key: string; transform?: (value: any, item?: any) => string }): string {
    const value = this.getNestedValue(item, field.key);
    if (value === null || value === undefined) return '-';

    if (field.transform) {
      return field.transform(value, item);
    }
    return String(value);
  }

  /**
   * Get footer value for a card item
   */
  getFooterValue(item: any): string {
    if (!this.cardConfig.footerKey) return '';

    const value = this.getNestedValue(item, this.cardConfig.footerKey);
    if (value === null || value === undefined) return '-';

    if (this.cardConfig.footerTransform) {
      return this.cardConfig.footerTransform(value, item);
    }
    return String(value);
  }

  /**
   * Handle item click
   */
  onItemClick(item: any): void {
    this.itemClick.emit(item);
  }

  /**
   * Toggle actions menu
   */
  toggleMenu(index: number, event: Event): void {
    event.stopPropagation();
    this.activeMenuIndex = this.activeMenuIndex === index ? null : index;
  }

  /**
   * Close menu when clicking outside
   */
  closeMenu(): void {
    this.activeMenuIndex = null;
  }

  /**
   * Execute an action
   */
  executeAction(action: TableAction, item: any, event: Event): void {
    event.stopPropagation();
    this.activeMenuIndex = null;

    if (action.disabled?.(item)) {
      return;
    }

    action.action(item);
    this.actionClick.emit({ action, item });
  }

  /**
   * Check if action is visible
   */
  isActionVisible(action: TableAction, item: any): boolean {
    return action.show ? action.show(item) : true;
  }

  /**
   * Check if action is disabled
   */
  isActionDisabled(action: TableAction, item: any): boolean {
    return action.disabled ? action.disabled(item) : false;
  }

  /**
   * Get action label
   */
  getActionLabel(action: TableAction, item: any): string {
    return typeof action.label === 'function'
      ? action.label(item)
      : action.label;
  }

  /**
   * Get action icon
   */
  getActionIcon(action: TableAction, item: any): string {
    const icon =
      typeof action.icon === 'function' ? action.icon(item) : action.icon;
    return icon || '';
  }

  /**
   * Get visible actions for an item (excluding menu actions)
   */
  getVisibleActions(item: any): TableAction[] {
    if (!this.actions) return [];
    return this.actions.filter((action) => this.isActionVisible(action, item));
  }

  /**
   * Get size-specific classes
   */
  getSizeClasses(): string {
    const sizeMap = {
      sm: 'item-list-sm',
      md: 'item-list-md',
      lg: 'item-list-lg',
    };
    return sizeMap[this.size];
  }
}
