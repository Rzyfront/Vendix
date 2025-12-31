import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';

// Create PostgreSQL connection pool
const connectionString = process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/vendix_db?schema=public';
const pool = new pg.Pool({ connectionString });

// Create adapter
const adapter = new PrismaPg(pool);

// Initialize Prisma client with adapter
const prisma = new PrismaClient({ adapter });

async function cleanDatabase() {
  try {
    // 1. Eliminar transacciones e inventario (más dependientes)
    await prisma.stock_transfer_items.deleteMany({});
    await prisma.stock_transfers.deleteMany({});
    await prisma.stock_reservations.deleteMany({});
    await prisma.inventory_movements.deleteMany({}); // Added
    await prisma.inventory_adjustments.deleteMany({}); // Added
    await prisma.inventory_transactions.deleteMany({});
    await prisma.inventory_serial_numbers.deleteMany({});
    await prisma.inventory_batches.deleteMany({});
    await prisma.stock_levels.deleteMany({});

    // 1.1 Eliminar órdenes de compra y devolución
    await prisma.return_order_items.deleteMany({}); // Added
    await prisma.return_orders.deleteMany({}); // Added
    await prisma.purchase_order_items.deleteMany({}); // Added
    await prisma.purchase_orders.deleteMany({}); // Added
    await prisma.supplier_products.deleteMany({}); // Added
    await prisma.suppliers.deleteMany({}); // Added

    // 1.2 Eliminar pagos y reembolsos
    await prisma.refund_items.deleteMany({}); // Added
    await prisma.refunds.deleteMany({}); // Added
    await prisma.payments.deleteMany({}); // Added
    await prisma.store_payment_methods.deleteMany({}); // Added
    await prisma.organization_payment_policies.deleteMany({}); // Added

    // Eliminar reseñas y asignaciones de impuestos
    await prisma.reviews.deleteMany({});
    await prisma.product_tax_assignments.deleteMany({});
    await prisma.tax_rates.deleteMany({});
    await prisma.tax_categories.deleteMany({});

    // Eliminar órdenes y sus items
    await prisma.order_item_taxes.deleteMany({}); // Added
    await prisma.order_items.deleteMany({}); // Added
    await prisma.orders.deleteMany({}); // Added
    await prisma.sales_order_items.deleteMany({});
    await prisma.sales_orders.deleteMany({});

    // 2. Eliminar imágenes, variantes y productos
    await prisma.product_images.deleteMany({});
    await prisma.product_variants.deleteMany({});
    await prisma.product_categories.deleteMany({}); // Added
    await prisma.products.deleteMany({});

    // 3. Eliminar categorías, marcas y ubicaciones
    await prisma.categories.deleteMany({});
    await prisma.brands.deleteMany({});
    await prisma.inventory_locations.deleteMany({});

    // 4. Eliminar relaciones de usuarios y datos personales
    await prisma.user_settings.deleteMany({}); // Added
    await prisma.user_sessions.deleteMany({}); // Added
    await prisma.password_reset_tokens.deleteMany({}); // Added
    await prisma.email_verification_tokens.deleteMany({}); // Added
    await prisma.api_keys.deleteMany({}); // Added
    await prisma.audit_logs.deleteMany({}); // Added
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
    await prisma.system_payment_methods.deleteMany({});
    await prisma.currencies.deleteMany({}); // Added just in case

  } catch (error) {
    throw error;
  }
}

cleanDatabase()
  .catch((e) => {
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });