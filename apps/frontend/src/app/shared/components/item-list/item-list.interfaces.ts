import { TableColumn, TableAction } from '../table/table.component';

/**
 * Configuration for a single detail field shown in the card's detail grid
 */
export interface ItemListDetailField {
  /** Key path to the data value (supports dot notation for nested objects) */
  key: string;
  /** Label to display above the value */
  label: string;
  /** Optional transform function to format the value */
  transform?: (value: any, item?: any) => string;
  /** Optional icon name to show next to the label */
  icon?: string;
  /** Optional informative icon to display next to the value (like an alert or info circle) */
  infoIcon?: string;
  /** Optional dynamic function to compute the info icon specifically per-item */
  infoIconTransform?: (value: any, item?: any) => string | undefined;
  /** Optional color for the infoIcon and the left border (e.g., 'primary', 'warning', 'danger', 'success') */
  infoIconVariant?: 'primary' | 'warning' | 'danger' | 'success' | 'default';
  /** Optional dynamic function to compute the color variant per-item */
  infoIconVariantTransform?: (value: any, item?: any) => 'primary' | 'warning' | 'danger' | 'success' | 'default' | undefined;
}

/**
 * Configuration for how items are displayed as cards in the ItemListComponent
 */
export interface ItemListCardConfig {
  /** Key path for the main title (e.g., 'name', 'first_name') */
  titleKey: string;
  /** Optional transform function to compute the title from the full item */
  titleTransform?: (item: any) => string;
  /** Key path for the subtitle (e.g., 'email') */
  subtitleKey?: string;
  /** Optional transform function to compute the subtitle from the full item */
  subtitleTransform?: (item: any) => string;
  /** Key path for avatar/image URL */
  avatarKey?: string;
  /** Fallback icon name when no avatar is available */
  avatarFallbackIcon?: string;
  /** Key path for the badge/status value */
  badgeKey?: string;
  /** Badge configuration (reuses TableColumn badgeConfig) */
  badgeConfig?: TableColumn['badgeConfig'];
  /** Transform function for badge display text */
  badgeTransform?: (value: any) => string;
  /** Array of detail fields to show in the 2-column grid */
  detailKeys?: ItemListDetailField[];
  /** Key path for the footer value (e.g., 'total_spend') */
  footerKey?: string;
  /** Label for the footer value */
  footerLabel?: string;
  /** Transform function for the footer value */
  footerTransform?: (value: any, item?: any) => string;
  /**
   * Avatar shape: 'circle' (default, for users/profiles) or 'square' (for products with images)
   * Only applies when avatarKey or avatarFallbackIcon is defined
   */
  avatarShape?: 'circle' | 'square';
  /**
   * Footer style: 'default' or 'prominent' (large value, e.g., price/total)
   */
  footerStyle?: 'default' | 'prominent';
}

/**
 * Size variants for the ItemListComponent
 */
export type ItemListSize = 'sm' | 'md' | 'lg';

// Re-export TableAction for convenience
export type { TableAction, TableColumn };
