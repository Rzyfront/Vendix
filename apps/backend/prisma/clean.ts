import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanDatabase() {
  console.log('🧹 Iniciando limpieza completa de la base de datos...');

  try {
    // Limpiar en orden para respetar las relaciones de clave foránea
    console.log('🗑️  Eliminando datos existentes...');

    // 1. Eliminar transacciones e inventario (más dependientes)
    await prisma.stock_transfer_items.deleteMany({});
    await prisma.stock_transfers.deleteMany({});
    await prisma.stock_reservations.deleteMany({});
    await prisma.inventory_transactions.deleteMany({});
    await prisma.inventory_serial_numbers.deleteMany({});
    await prisma.inventory_batches.deleteMany({});
    await prisma.stock_levels.deleteMany({});

    // Eliminar reseñas y asignaciones de impuestos
    await prisma.reviews.deleteMany({});
    await prisma.product_tax_assignments.deleteMany({});
    await prisma.tax_rates.deleteMany({});
    await prisma.tax_categories.deleteMany({});

    // Eliminar órdenes y sus items
    await prisma.sales_order_items.deleteMany({});
    await prisma.sales_orders.deleteMany({});
    
    // 2. Eliminar imágenes, variantes y productos
    await prisma.product_images.deleteMany({});
    await prisma.product_variants.deleteMany({});
    await prisma.products.deleteMany({});
    
    // 3. Eliminar categorías, marcas y ubicaciones
    await prisma.categories.deleteMany({});
    await prisma.brands.deleteMany({});
    await prisma.inventory_locations.deleteMany({});
    
    // 4. Eliminar relaciones de usuarios
    await prisma.role_permissions.deleteMany({});
    await prisma.user_roles.deleteMany({});
    await prisma.store_users.deleteMany({});
    
    // 5. Eliminar configuraciones y dominios
    await prisma.domain_settings.deleteMany({});
    await prisma.addresses.deleteMany({});
    await prisma.store_settings.deleteMany({});
    await prisma.organization_settings.deleteMany({});
    await prisma.refresh_tokens.deleteMany({});
    await prisma.login_attempts.deleteMany({});
    
    // 6. Eliminar datos de tablas principales
    await prisma.users.deleteMany({});
    await prisma.stores.deleteMany({});
    await prisma.organizations.deleteMany({});
    await prisma.roles.deleteMany({});
    await prisma.permissions.deleteMany({});

    console.log('✅ Base de datos limpiada exitosamente');
    console.log('');
    console.log('📋 Tablas limpiadas:');
    console.log('  - stock_transfer_items');
    console.log('  - stock_transfers');
    console.log('  - stock_reservations');
    console.log('  - inventory_transactions');
    console.log('  - inventory_serial_numbers');
    console.log('  - inventory_batches');
    console.log('  - stock_levels');
    console.log('  - reviews');
    console.log('  - product_tax_assignments');
    console.log('  - tax_rates');
    console.log('  - tax_categories');
    console.log('  - sales_order_items');
    console.log('  - sales_orders');
    console.log('  - product_images');
    console.log('  - product_variants');
    console.log('  - products');
    console.log('  - categories');
    console.log('  - brands');
    console.log('  - inventory_locations');
    console.log('  - role_permissions');
    console.log('  - user_roles');
    console.log('  - store_users');
    console.log('  - domain_settings');
    console.log('  - addresses');
    console.log('  - store_settings');
    console.log('  - organization_settings');
    console.log('  - refresh_tokens');
    console.log('  - login_attempts');
    console.log('  - users');
    console.log('  - stores');
    console.log('  - organizations');
    console.log('  - roles');
    console.log('  - permissions');

  } catch (error) {
    console.error('❌ Error durante la limpieza de la base de datos:', error);
    throw error;
  }
}

cleanDatabase()
  .catch((e) => {
    console.error('❌ Error fatal:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });