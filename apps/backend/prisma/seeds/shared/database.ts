import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './client';

/**
 * Database cleanup and reset utilities
 * WARNING: These functions will DELETE data. Use with caution!
 */

/**
 * Clear all seeded data from the database
 * This removes data in reverse dependency order to avoid foreign key errors
 *
 * @param prisma - Optional PrismaClient instance
 * @returns Object with counts of deleted records per table
 */
export async function clearDatabase(prisma?: PrismaClient) {
  const client = prisma || getPrismaClient();

  console.log('🧹 Clearing database...');

  const results: Record<string, number> = {};

  // Define deletion order (reverse of dependencies)
  // CRITICAL: Must delete child tables BEFORE parent tables to avoid foreign key constraint errors
  const deleteOperations = [
    // ============================================
    // LEVEL 1: Leaf tables (no dependents) - deepest dependencies first
    // ============================================

    // Order-related items (must delete before anything else)
    { name: 'sales_order_items', model: client.sales_order_items },
    { name: 'purchase_order_items', model: client.purchase_order_items },
    { name: 'return_order_items', model: client.return_order_items },
    { name: 'refund_items', model: client.refund_items },
    { name: 'order_item_taxes', model: client.order_item_taxes },
    { name: 'order_items', model: client.order_items },
    { name: 'orders', model: client.orders },

    // Sales and purchase orders (have Restrict FK to users and addresses)
    { name: 'sales_order_items', model: client.sales_order_items },
    { name: 'sales_orders', model: client.sales_orders },
    { name: 'purchase_order_items', model: client.purchase_order_items },
    { name: 'purchase_orders', model: client.purchase_orders },
    { name: 'return_order_items', model: client.return_order_items },
    { name: 'return_orders', model: client.return_orders },

    // Payments and refunds
    { name: 'refund_items', model: client.refund_items },
    { name: 'refunds', model: client.refunds },
    { name: 'payments', model: client.payments },

    // Review and feedback (must delete before products and users)
    { name: 'reviews', model: client.reviews },

    // Cart and wishlist (must delete before products and users)
    { name: 'cart_items', model: client.cart_items },
    { name: 'carts', model: client.carts },
    { name: 'wishlist_items', model: client.wishlist_items },
    { name: 'wishlists', model: client.wishlists },

    // Login attempts (has Restrict FK to stores - CRITICAL)
    { name: 'login_attempts', model: client.login_attempts },

    // Inventory (must delete before products, users, stores)
    { name: 'inventory_serial_numbers', model: client.inventory_serial_numbers },
    { name: 'inventory_batches', model: client.inventory_batches },
    { name: 'inventory_movements', model: client.inventory_movements },
    { name: 'inventory_transactions', model: client.inventory_transactions },
    { name: 'stock_reservations', model: client.stock_reservations },
    { name: 'inventory_adjustments', model: client.inventory_adjustments },
    { name: 'stock_levels', model: client.stock_levels },
    { name: 'inventory_locations', model: client.inventory_locations },

    // Stock transfers (must delete before users, stores, products)
    { name: 'stock_transfer_items', model: client.stock_transfer_items },
    { name: 'stock_transfers', model: client.stock_transfers },

    // Supplier products (must delete before products and suppliers)
    { name: 'supplier_products', model: client.supplier_products },

    // ============================================
    // LEVEL 2: Product-related tables
    // ============================================
    { name: 'product_images', model: client.product_images },
    { name: 'product_variants', model: client.product_variants },
    { name: 'product_tax_assignments', model: client.product_tax_assignments },
    { name: 'product_categories', model: client.product_categories },
    { name: 'products', model: client.products },
    { name: 'brands', model: client.brands },
    { name: 'categories', model: client.categories },
    { name: 'tax_rates', model: client.tax_rates },
    { name: 'tax_categories', model: client.tax_categories },

    // ============================================
    // LEVEL 3: Addresses (has Restrict FK to orgs, stores, users)
    // ============================================
    { name: 'addresses', model: client.addresses },

    // ============================================
    // LEVEL 4: Store-related tables
    // ============================================
    { name: 'store_payment_methods', model: client.store_payment_methods },
    { name: 'store_settings', model: client.store_settings },
    { name: 'store_users', model: client.store_users },
    { name: 'stores', model: client.stores },

    // ============================================
    // LEVEL 5: User-related tables
    // ============================================
    { name: 'password_reset_tokens', model: client.password_reset_tokens },
    { name: 'email_verification_tokens', model: client.email_verification_tokens },
    { name: 'refresh_tokens', model: client.refresh_tokens },
    { name: 'user_sessions', model: client.user_sessions },
    { name: 'user_settings', model: client.user_settings },
    { name: 'user_roles', model: client.user_roles },
    { name: 'api_keys', model: client.api_keys },
    { name: 'users', model: client.users },

    // ============================================
    // LEVEL 6: Organization (parent tables)
    // ============================================
    { name: 'domain_settings', model: client.domain_settings },
    { name: 'audit_logs', model: client.audit_logs },
    { name: 'suppliers', model: client.suppliers },
    { name: 'organization_settings', model: client.organization_settings },
    { name: 'organization_payment_policies', model: client.organization_payment_policies },
    { name: 'organizations', model: client.organizations },

    // ============================================
    // LEVEL 7: Permission system
    // ============================================
    { name: 'role_permissions', model: client.role_permissions },
    { name: 'roles', model: client.roles },
    { name: 'permissions', model: client.permissions },

    // ============================================
    // LEVEL 8: System tables (no dependencies)
    // ============================================
    { name: 'system_payment_methods', model: client.system_payment_methods },
    { name: 'currencies', model: client.currencies },
    { name: 'default_templates', model: client.default_templates },
  ];

  for (const operation of deleteOperations) {
    try {
      const result = await (operation.model as any).deleteMany({});
      results[operation.name] = result.count;
      if (result.count > 0) {
        console.log(`   ✓ Deleted ${result.count} ${operation.name}`);
      }
    } catch (error) {
      console.error(`   ✗ Error deleting ${operation.name}:`, error);
      results[operation.name] = -1;
    }
  }

  console.log('✅ Database cleared');
  return results;
}

/**
 * Reset the database by clearing all data and re-seeding
 * This is a convenience function that combines clearDatabase with seed execution
 *
 * @param seedFunction - Function to call after clearing (e.g., main seed function)
 * @param prisma - Optional PrismaClient instance
 */
export async function resetDatabase(
  seedFunction: () => Promise<void>,
  prisma?: PrismaClient
) {
  console.log('🔄 Resetting database...');
  await clearDatabase(prisma);
  console.log('🌱 Re-seeding database...');
  await seedFunction();
  console.log('✅ Database reset complete');
}

/**
 * Clear specific module data
 * Useful for selectively resetting parts of the database
 *
 * @param module - Name of module to clear ('products', 'users', 'organizations', etc.)
 * @param prisma - Optional PrismaClient instance
 */
export async function clearModule(
  module: string,
  prisma?: PrismaClient
) {
  const client = prisma || getPrismaClient();

  const moduleMaps: Record<string, Array<{ name: string; model: any }>> = {
    products: [
      // Order-related dependencies
      { name: 'order_items', model: client.order_items },
      { name: 'sales_order_items', model: client.sales_order_items },
      { name: 'purchase_order_items', model: client.purchase_order_items },
      { name: 'return_order_items', model: client.return_order_items },
      { name: 'cart_items', model: client.cart_items },
      { name: 'wishlist_items', model: client.wishlist_items },
      { name: 'reviews', model: client.reviews },
      // Inventory dependencies
      { name: 'inventory_serial_numbers', model: client.inventory_serial_numbers },
      { name: 'inventory_batches', model: client.inventory_batches },
      { name: 'inventory_movements', model: client.inventory_movements },
      { name: 'inventory_transactions', model: client.inventory_transactions },
      { name: 'stock_reservations', model: client.stock_reservations },
      { name: 'inventory_adjustments', model: client.inventory_adjustments },
      { name: 'stock_levels', model: client.stock_levels },
      { name: 'stock_transfer_items', model: client.stock_transfer_items },
      { name: 'supplier_products', model: client.supplier_products },
      // Product tables
      { name: 'product_images', model: client.product_images },
      { name: 'product_variants', model: client.product_variants },
      { name: 'products', model: client.products },
      { name: 'product_tax_assignments', model: client.product_tax_assignments },
      { name: 'product_categories', model: client.product_categories },
      { name: 'brands', model: client.brands },
      { name: 'categories', model: client.categories },
      { name: 'tax_rates', model: client.tax_rates },
      { name: 'tax_categories', model: client.tax_categories },
    ],
    users: [
      // Order dependencies (have Restrict FK to users)
      { name: 'sales_orders', model: client.sales_orders },
      { name: 'purchase_orders', model: client.purchase_orders },
      { name: 'stock_transfers', model: client.stock_transfers },
      { name: 'inventory_adjustments', model: client.inventory_adjustments },
      { name: 'inventory_movements', model: client.inventory_movements },
      { name: 'inventory_transactions', model: client.inventory_transactions },
      { name: 'stock_reservations', model: client.stock_reservations },
      { name: 'api_keys', model: client.api_keys },
      { name: 'password_reset_tokens', model: client.password_reset_tokens },
      { name: 'email_verification_tokens', model: client.email_verification_tokens },
      { name: 'refresh_tokens', model: client.refresh_tokens },
      { name: 'user_sessions', model: client.user_sessions },
      { name: 'user_settings', model: client.user_settings },
      { name: 'user_roles', model: client.user_roles },
      { name: 'carts', model: client.carts },
      { name: 'wishlists', model: client.wishlists },
      { name: 'reviews', model: client.reviews },
      { name: 'refunds', model: client.refunds },
      { name: 'users', model: client.users },
    ],
    organizations: [
      // Address dependencies (must be deleted first)
      { name: 'addresses', model: client.addresses },
      // Store dependencies
      { name: 'login_attempts', model: client.login_attempts },
      { name: 'inventory_locations', model: client.inventory_locations },
      { name: 'stock_levels', model: client.stock_levels },
      { name: 'store_payment_methods', model: client.store_payment_methods },
      { name: 'store_settings', model: client.store_settings },
      { name: 'store_users', model: client.store_users },
      { name: 'stores', model: client.stores },
      { name: 'carts', model: client.carts },
      { name: 'wishlists', model: client.wishlists },
      { name: 'products', model: client.products },
      { name: 'categories', model: client.categories },
      { name: 'tax_categories', model: client.tax_categories },
      { name: 'tax_rates', model: client.tax_rates },
      { name: 'suppliers', model: client.suppliers },
      { name: 'domain_settings', model: client.domain_settings },
      { name: 'organization_settings', model: client.organization_settings },
      { name: 'organization_payment_policies', model: client.organization_payment_policies },
      { name: 'organizations', model: client.organizations },
    ],
    permissions: [
      { name: 'user_roles', model: client.user_roles },
      { name: 'role_permissions', model: client.role_permissions },
      { name: 'roles', model: client.roles },
      { name: 'permissions', model: client.permissions },
    ],
    templates: [
      { name: 'default_templates', model: client.default_templates },
    ],
  };

  const operations = moduleMaps[module];
  if (!operations) {
    throw new Error(`Unknown module: ${module}. Available modules: ${Object.keys(moduleMaps).join(', ')}`);
  }

  console.log(`🧹 Clearing ${module} module...`);
  const results: Record<string, number> = {};

  for (const operation of operations) {
    try {
      const result = await operation.model.deleteMany({});
      results[operation.name] = result.count;
      console.log(`   ✓ Deleted ${result.count} ${operation.name}`);
    } catch (error) {
      console.error(`   ✗ Error deleting ${operation.name}:`, error);
      results[operation.name] = -1;
    }
  }

  console.log(`✅ ${module} module cleared`);
  return results;
}

/**
 * Get database statistics
 * Returns count of records in each table
 *
 * @param prisma - Optional PrismaClient instance
 */
export async function getDatabaseStats(prisma?: PrismaClient) {
  const client = prisma || getPrismaClient();

  const stats: Record<string, number> = {};

  const countOperations = [
    { name: 'organizations', model: client.organizations },
    { name: 'stores', model: client.stores },
    { name: 'users', model: client.users },
    { name: 'roles', model: client.roles },
    { name: 'permissions', model: client.permissions },
    { name: 'products', model: client.products },
    { name: 'categories', model: client.categories },
    { name: 'product_variants', model: client.product_variants },
    { name: 'tax_categories', model: client.tax_categories },
    { name: 'default_templates', model: client.default_templates },
  ];

  for (const operation of countOperations) {
    try {
      stats[operation.name] = await (operation.model as any).count();
    } catch (error) {
      stats[operation.name] = -1;
    }
  }

  return stats;
}
