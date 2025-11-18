import { Product, ProductState } from '../interfaces';

export class ProductUtils {
  /**
   * Generate a slug from a product name
   */
  static generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Check if a product is low stock
   */
  static isLowStock(product: Product, threshold: number = 10): boolean {
    return (
      (product.stock_quantity || 0) <= threshold &&
      product.state === ProductState.ACTIVE
    );
  }

  /**
   * Check if a product is out of stock
   */
  static isOutOfStock(product: Product): boolean {
    return (
      (product.stock_quantity || 0) === 0 &&
      product.state === ProductState.ACTIVE
    );
  }

  /**
   * Get product status badge color
   */
  static getStatusColor(state: ProductState): string {
    switch (state) {
      case ProductState.ACTIVE:
        return 'green';
      case ProductState.INACTIVE:
        return 'yellow';
      case ProductState.ARCHIVED:
        return 'red';
      default:
        return 'gray';
    }
  }

  /**
   * Format product price
   */
  static formatPrice(price: number, currency: string = '$'): string {
    return `${currency}${price.toFixed(2)}`;
  }

  /**
   * Calculate total value of product stock
   */
  static calculateStockValue(product: Product): number {
    const quantity = product.stock_quantity || 0;
    return quantity * product.base_price;
  }
}
