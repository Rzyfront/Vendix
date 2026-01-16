import { getPrismaClient, disconnectPrisma } from './seeds/shared/client';
import { seedDefaultTemplates } from './seeds/default-templates.seed';
import { seedPermissionsAndRoles } from './seeds/permissions-roles.seed';
import { seedOrganizationsAndStores } from './seeds/organizations-stores.seed';
import { seedSystemPaymentMethods } from './seeds/system-payment-methods.seed';
import { seedUsers } from './seeds/users.seed';
import { seedProductsAndCategories } from './seeds/products-categories.seed';
import { seedDomains } from './seeds/domains.seed';
import { seedAddresses } from './seeds/addresses.seed';
import { seedInventoryLocations } from './seeds/inventory-locations.seed';
import { seedTestOrders } from './seeds/test-orders.seed';

/**
 * Seed modules registry
 * Modules are executed in order - dependencies must be satisfied by previous modules
 *
 * Execution order and dependencies:
 * 1. defaultTemplates - No dependencies
 * 2. permissionsAndRoles - No dependencies
 * 3. systemPaymentMethods - No dependencies
 * 4. organizationsAndStores - No dependencies
 * 5. users - Depends on: organizationsAndStores, permissionsAndRoles
 * 6. productsAndCategories - Depends on: organizationsAndStores
 * 7. domains - Depends on: organizationsAndStores
 * 8. addresses - Depends on: organizationsAndStores, users
 * 9. inventoryLocations - Depends on: organizationsAndStores
 * 10. testOrders - Depends on: organizationsAndStores, users, productsAndCategories
 *
 * Cada módulo debe:
 * - Exportar una función async que acepta PrismaClient opcional
 * - Manejar sus propios errores y logs
 * - Ser idempotente (puede ejecutarse múltiples veces)
 */
const seedModules = [
  {
    name: 'Default Templates',
    fn: seedDefaultTemplates,
    description: 'System configuration templates',
  },
  {
    name: 'Permissions & Roles',
    fn: seedPermissionsAndRoles,
    description: 'System permissions and role definitions',
  },
  {
    name: 'System Payment Methods',
    fn: seedSystemPaymentMethods,
    description: 'System-wide payment methods',
  },
  {
    name: 'Organizations & Stores',
    fn: seedOrganizationsAndStores,
    description: 'Organizations and store instances',
  },
  {
    name: 'Users',
    fn: seedUsers,
    description: 'User accounts with role assignments',
  },
  {
    name: 'Products & Categories',
    fn: seedProductsAndCategories,
    description: 'Product catalog with categories and variants',
  },
  {
    name: 'Domains',
    fn: seedDomains,
    description: 'Domain settings for organizations and stores',
  },
  {
    name: 'Addresses',
    fn: seedAddresses,
    description: 'Addresses for organizations, stores, and users',
  },
  {
    name: 'Inventory Locations',
    fn: seedInventoryLocations,
    description: 'Inventory locations (warehouses and stores)',
  },
  {
    name: 'Test Orders',
    fn: seedTestOrders,
    description: 'Test orders and product reviews',
  },
];

/**
 * Main seed entry point
 * Executes all registered seed modules in sequence
 */
async function main() {
  const startTime = Date.now();
  console.log('🌱 Starting seed process...');
  console.log(`📋 Registered seed modules: ${seedModules.length}`);
  console.log('');

  const prisma = getPrismaClient();
  const results: Array<{
    name: string;
    description: string;
    result?: any;
    error?: string;
  }> = [];

  for (const module of seedModules) {
    console.log(`▶️  [${module.name}] ${module.description}`);
    try {
      const result = await module.fn(prisma);
      results.push({ name: module.name, description: module.description, result });
      console.log(`✅ Completed: ${module.name}\n`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        name: module.name,
        description: module.description,
        error: errorMessage,
      });
      console.error(`❌ Failed: ${module.name}`);
      console.error(`   Error: ${errorMessage}\n`);
      // Continue with other seeds even if one fails
    }
  }

  await disconnectPrisma();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`${'═'.repeat(70)}`);
  console.log(`📊 Seed Summary (completed in ${duration}s)`);
  console.log(`${'═'.repeat(70)}`);

  const successCount = results.filter((r) => !r.error).length;
  const failureCount = results.filter((r) => r.error).length;

  results.forEach((result) => {
    if (result.error) {
      console.log(`   ❌ ${result.name}: ${result.error}`);
    } else {
      const stats = Object.entries(result.result || {})
        .filter(([_, v]) => typeof v === 'number' && v > 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      console.log(`   ✅ ${result.name}${stats ? ` (${stats})` : ''}`);
    }
  });

  console.log(`${'═'.repeat(70)}`);
  console.log(`Total: ${successCount} succeeded, ${failureCount} failed`);
  console.log(`${'═'.repeat(70)}`);

  if (failureCount > 0) {
    process.exit(1);
  }
}

// Execute seed if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Seed process failed with unhandled error:');
    console.error(error);
    process.exit(1);
  });
}

// Export for programmatic usage
export { main as seedDatabase };
export * from './seeds/shared/database';
export * from './seeds/shared/client';
export * from './seeds/default-templates.seed';
export * from './seeds/permissions-roles.seed';
export * from './seeds/system-payment-methods.seed';
export * from './seeds/organizations-stores.seed';
export * from './seeds/users.seed';
export * from './seeds/products-categories.seed';
export * from './seeds/domains.seed';
export * from './seeds/addresses.seed';
export * from './seeds/inventory-locations.seed';
export * from './seeds/test-orders.seed';
