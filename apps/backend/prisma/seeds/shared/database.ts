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
  const deleteOperations = [
    // Products & Categories (deepest dependencies first)
    { name: 'product_images', model: client.product_images },
    { name: 'product_variants', model: client.product_variants },
    { name: 'product_tax_assignments', model: client.product_tax_assignments },
    { name: 'product_categories', model: client.product_categories },
    { name: 'products', model: client.products },
    { name: 'brands', model: client.brands },
    { name: 'categories', model: client.categories },
    { name: 'tax_rates', model: client.tax_rates },
    { name: 'tax_categories', model: client.tax_categories },
    // Users
    { name: 'user_settings', model: client.user_settings },
    { name: 'user_roles', model: client.user_roles },
    { name: 'users', model: client.users },
    // Organizations & Stores
    { name: 'store_settings', model: client.store_settings },
    { name: 'stores', model: client.stores },
    { name: 'organizations', model: client.organizations },
    // Permissions
    { name: 'role_permissions', model: client.role_permissions },
    { name: 'roles', model: client.roles },
    { name: 'permissions', model: client.permissions },
    // Templates
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
      { name: 'product_images', model: client.product_images },
      { name: 'product_variants', model: client.product_variants },
      { name: 'products', model: client.products },
      { name: 'brands', model: client.brands },
      { name: 'categories', model: client.categories },
      { name: 'tax_rates', model: client.tax_rates },
      { name: 'tax_categories', model: client.tax_categories },
    ],
    users: [
      { name: 'user_settings', model: client.user_settings },
      { name: 'user_roles', model: client.user_roles },
      { name: 'users', model: client.users },
    ],
    organizations: [
      { name: 'store_settings', model: client.store_settings },
      { name: 'stores', model: client.stores },
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
