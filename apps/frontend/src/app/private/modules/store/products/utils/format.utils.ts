import { Product, ProductState, ProductStats } from '../interfaces';

export class FormatUtils {
  /**
   * Format currency
   */
  static formatCurrency(amount: number, currency: string = '$'): string {
    return `${currency}${amount.toFixed(2)}`;
  }

  /**
   * Format product state for display
   */
  static formatProductState(state: ProductState): string {
    return state.charAt(0).toUpperCase() + state.slice(1);
  }

  /**
   * Format date
   */
  static formatDate(date: string | Date): string {
    const d = new Date(date);
    return d.toLocaleDateString();
  }

  /**
   * Format datetime
   */
  static formatDateTime(date: string | Date): string {
    const d = new Date(date);
    return d.toLocaleString();
  }

  /**
   * Format relative time (e.g., "2 days ago")
   */
  static formatRelativeTime(date: string | Date): string {
    const now = new Date();
    const past = new Date(date);
    const diffMs = now.getTime() - past.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  }

  /**
   * Format stock status
   */
  static formatStockStatus(quantity: number | undefined): {
    text: string;
    color: string;
  } {
    const qty = quantity || 0;

    if (qty === 0) {
      return { text: 'Out of Stock', color: 'red' };
    } else if (qty <= 5) {
      return { text: `Low Stock (${qty})`, color: 'yellow' };
    } else {
      return { text: `In Stock (${qty})`, color: 'green' };
    }
  }

  /**
   * Format product stats for display
   */
  static formatProductStats(
    stats: ProductStats,
  ): Array<{ label: string; value: string; color?: string }> {
    return [
      {
        label: 'Total Products',
        value: stats.total_products.toLocaleString(),
        color: 'blue',
      },
      {
        label: 'Active Products',
        value: stats.active_products.toLocaleString(),
        color: 'green',
      },
      {
        label: 'Inactive Products',
        value: stats.inactive_products.toLocaleString(),
        color: 'yellow',
      },
      {
        label: 'Archived Products',
        value: stats.archived_products.toLocaleString(),
        color: 'red',
      },
      {
        label: 'Low Stock Products',
        value: stats.low_stock_products.toLocaleString(),
        color: 'orange',
      },
      {
        label: 'Out of Stock',
        value: stats.out_of_stock_products.toLocaleString(),
        color: 'red',
      },
      {
        label: 'Total Value',
        value: this.formatCurrency(stats.total_value),
        color: 'green',
      },
      {
        label: 'Categories',
        value: stats.categories_count.toLocaleString(),
        color: 'purple',
      },
      {
        label: 'Brands',
        value: stats.brands_count.toLocaleString(),
        color: 'purple',
      },
    ];
  }

  /**
   * Truncate text
   */
  static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  /**
   * Format file size
   */
  static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
