import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';
import * as bcrypt from 'bcrypt';

export interface SeedUsersResult {
  usersCreated: number;
  rolesAssigned: number;
  settingsCreated: number;
}

/**
 * DEPENDENCIES: This seed function must be called AFTER:
 * 1. seedOrganizationsAndStores() - Organizations must exist
 * 2. seedPermissionsAndRoles() - Roles must exist
 *
 * Creates users with their roles and user_settings configurations
 * Password for all users: '1125634q'
 */
export async function seedUsers(
  prisma?: PrismaClient,
): Promise<SeedUsersResult> {
  const client = prisma || getPrismaClient();

  // Hash the password (same for all users)
  const hashedPassword = await bcrypt.hash('1125634q', 10);

  // Fetch required organizations
  const vendixOrg = await client.organizations.findUnique({
    where: { slug: 'vendix-corp' },
  });
  const techSolutionsOrg = await client.organizations.findUnique({
    where: { slug: 'tech-solutions' },
  });
  const fashionRetailOrg = await client.organizations.findUnique({
    where: { slug: 'fashion-retail' },
  });

  if (!vendixOrg || !techSolutionsOrg || !fashionRetailOrg) {
    throw new Error(
      'Required organizations not found. Please run seedOrganizationsAndStores() first.',
    );
  }

  // Fetch required roles
  const superAdminRole = await client.roles.findUnique({
    where: { name: 'super_admin' },
  });
  const ownerRole = await client.roles.findUnique({
    where: { name: 'owner' },
  });
  const adminRole = await client.roles.findUnique({
    where: { name: 'admin' },
  });
  const managerRole = await client.roles.findUnique({
    where: { name: 'manager' },
  });
  const supervisorRole = await client.roles.findUnique({
    where: { name: 'supervisor' },
  });
  const employeeRole = await client.roles.findUnique({
    where: { name: 'employee' },
  });
  const customerRole = await client.roles.findUnique({
    where: { name: 'customer' },
  });

  if (
    !superAdminRole ||
    !ownerRole ||
    !adminRole ||
    !managerRole ||
    !supervisorRole ||
    !employeeRole ||
    !customerRole
  ) {
    throw new Error(
      'Required roles not found. Please run seedPermissionsAndRoles() first.',
    );
  }

  // Define users with their roles
  const users = [
    // Super Admin (Vendix Corp)
    {
      email: 'superadmin@vendix.com',
      password: hashedPassword,
      first_name: 'Super',
      last_name: 'Admin',
      username: 'superadmin',
      email_verified: true,
      state: 'active',
      organization_id: vendixOrg.id,
      roles: [superAdminRole.id],
    },

    // Owners
    {
      email: 'owner@techsolutions.co',
      password: hashedPassword,
      first_name: 'Carlos',
      last_name: 'Rodríguez',
      username: 'carlos.rodriguez',
      email_verified: true,
      state: 'active',
      organization_id: techSolutionsOrg.id,
      roles: [ownerRole.id],
    },
    {
      email: 'owner@fashionretail.com',
      password: hashedPassword,
      first_name: 'María',
      last_name: 'González',
      username: 'maria.gonzalez',
      email_verified: true,
      state: 'active',
      organization_id: fashionRetailOrg.id,
      roles: [ownerRole.id],
    },

    // Admins
    {
      email: 'admin@techsolutions.co',
      password: hashedPassword,
      first_name: 'Ana',
      last_name: 'Martínez',
      username: 'ana.martinez',
      email_verified: true,
      state: 'active',
      organization_id: techSolutionsOrg.id,
      roles: [adminRole.id],
    },
    {
      email: 'admin@fashionretail.com',
      password: hashedPassword,
      first_name: 'Pedro',
      last_name: 'López',
      username: 'pedro.lopez',
      email_verified: true,
      state: 'active',
      organization_id: fashionRetailOrg.id,
      roles: [adminRole.id],
    },

    // Managers
    {
      email: 'manager@tech-bogota.com',
      password: hashedPassword,
      first_name: 'Laura',
      last_name: 'Ramírez',
      username: 'laura.ramirez',
      email_verified: true,
      state: 'active',
      organization_id: techSolutionsOrg.id,
      roles: [managerRole.id],
    },
    {
      email: 'manager@fashion-norte.com',
      password: hashedPassword,
      first_name: 'Diego',
      last_name: 'Silva',
      username: 'diego.silva',
      email_verified: true,
      state: 'active',
      organization_id: fashionRetailOrg.id,
      roles: [managerRole.id],
    },

    // Supervisors
    {
      email: 'supervisor@tech-bogota.com',
      password: hashedPassword,
      first_name: 'Sofia',
      last_name: 'Hernández',
      username: 'sofia.hernandez',
      email_verified: true,
      state: 'active',
      organization_id: techSolutionsOrg.id,
      roles: [supervisorRole.id],
    },
    {
      email: 'supervisor@fashion-norte.com',
      password: hashedPassword,
      first_name: 'Andrés',
      last_name: 'Castro',
      username: 'andres.castro',
      email_verified: true,
      state: 'active',
      organization_id: fashionRetailOrg.id,
      roles: [supervisorRole.id],
    },

    // Employees
    {
      email: 'employee1@tech-bogota.com',
      password: hashedPassword,
      first_name: 'Juan',
      last_name: 'Pérez',
      username: 'juan.perez',
      email_verified: true,
      state: 'active',
      organization_id: techSolutionsOrg.id,
      roles: [employeeRole.id],
    },
    {
      email: 'employee2@tech-bogota.com',
      password: hashedPassword,
      first_name: 'Catalina',
      last_name: 'Rojas',
      username: 'catalina.rojas',
      email_verified: true,
      state: 'active',
      organization_id: techSolutionsOrg.id,
      roles: [employeeRole.id],
    },

    // Customers
    {
      email: 'cliente1@example.com',
      password: hashedPassword,
      first_name: 'Miguel',
      last_name: 'Santos',
      username: 'miguel.santos',
      email_verified: true,
      state: 'active',
      organization_id: techSolutionsOrg.id,
      roles: [customerRole.id],
    },
    {
      email: 'cliente2@example.com',
      password: hashedPassword,
      first_name: 'Isabella',
      last_name: 'Vargas',
      username: 'isabella.vargas',
      email_verified: true,
      state: 'active',
      organization_id: fashionRetailOrg.id,
      roles: [customerRole.id],
    },

    // Pending verification user
    {
      email: 'nuevo@example.com',
      password: hashedPassword,
      first_name: 'Nuevo',
      last_name: 'Usuario',
      username: 'nuevo.usuario',
      email_verified: false,
      state: 'pending_verification',
      organization_id: vendixOrg.id,
      roles: [customerRole.id],
    },
  ];

  const createdUsers: any[] = [];
  let rolesAssigned = 0;
  let settingsCreated = 0;

  for (const user of users) {
    // Create or update user
    const createdUser = await client.users.upsert({
      where: { username: user.username },
      update: {},
      create: {
        email: user.email,
        password: user.password,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        email_verified: user.email_verified,
        state: user.state as any,
        organizations: {
          connect: { id: user.organization_id },
        },
      },
    });

    // Assign roles
    for (const roleId of user.roles) {
      await client.user_roles.upsert({
        where: {
          user_id_role_id: { user_id: createdUser.id, role_id: roleId },
        },
        update: {},
        create: { user_id: createdUser.id, role_id: roleId },
      });
      rolesAssigned++;
    }

    // Configure user_settings based on role
    let app = 'VENDIX_LANDING';
    let panel_ui: any = {};

    if (user.roles.includes(superAdminRole.id)) {
      app = 'VENDIX_ADMIN';
      panel_ui = {
        VENDIX_ADMIN: {
          superadmin: true,
          tenants: true,
          dashboard: true,
          user_management: true,
          billing: true,
          system_analytics: true,
        },
      };
    } else if (user.roles.includes(ownerRole.id)) {
      app = 'ORG_ADMIN';
      panel_ui = {
        ORG_ADMIN: {
          dashboard: true,
          stores: true,
          users: true,
          audit: true,
          settings: true,
          analytics: true,
          reports: true,
          inventory: true,
          billing: true,
          ecommerce: true,
          orders: true,
        },
        STORE_ADMIN: {
          // Main modules - all enabled
          dashboard: true,
          pos: true,
          products: true,
          ecommerce: true,
          // Orders - ALL enabled (including submodules)
          orders: true,
          orders_sales: true,
          orders_purchase_orders: true,
          // Inventory - ALL enabled
          inventory: true,
          inventory_pop: true,
          inventory_adjustments: true,
          inventory_locations: true,
          inventory_suppliers: true,
          inventory_movements: true,
          // Customers - ALL enabled
          customers: true,
          customers_all: true,
          customers_reviews: true,
          // Marketing - ALL enabled
          marketing: true,
          marketing_promotions: true,
          marketing_coupons: true,
          // Analytics - ALL enabled
          analytics: true,
          analytics_sales: true,
          analytics_traffic: true,
          analytics_performance: true,
          // Settings - ALL enabled
          settings: true,
          settings_general: true,
          settings_payments: true,
          settings_appearance: true,
          settings_security: true,
          settings_domains: true,
        },
      };
    } else if (user.roles.includes(adminRole.id)) {
      app = 'ORG_ADMIN';
      panel_ui = {
        ORG_ADMIN: {
          dashboard: true,
          stores: true,
          users: true,
          audit: true,
          settings: true,
          analytics: true,
          reports: true,
          inventory: true,
          billing: true,
          ecommerce: true,
          orders: true,
        },
        STORE_ADMIN: {
          // Main modules - all enabled
          dashboard: true,
          pos: true,
          products: true,
          ecommerce: true,
          // Orders - ALL enabled (including submodules)
          orders: true,
          orders_sales: true,
          orders_purchase_orders: true,
          // Inventory - ALL enabled
          inventory: true,
          inventory_pop: true,
          inventory_adjustments: true,
          inventory_locations: true,
          inventory_suppliers: true,
          inventory_movements: true,
          // Customers - ALL enabled
          customers: true,
          customers_all: true,
          customers_reviews: true,
          // Marketing - ALL enabled
          marketing: true,
          marketing_promotions: true,
          marketing_coupons: true,
          // Analytics - ALL enabled
          analytics: true,
          analytics_sales: true,
          analytics_traffic: true,
          analytics_performance: true,
          // Settings - ALL enabled
          settings: true,
          settings_general: true,
          settings_payments: true,
          settings_appearance: true,
          settings_security: true,
          settings_domains: true,
        },
      };
    } else if (user.roles.includes(managerRole.id)) {
      app = 'STORE_ADMIN';
      panel_ui = {
        STORE_ADMIN: {
          // Main modules - all enabled
          dashboard: true,
          pos: true,
          products: true,
          ecommerce: true,
          // Orders - ALL enabled (including submodules)
          orders: true,
          orders_sales: true,
          orders_purchase_orders: true,
          // Inventory - ALL enabled
          inventory: true,
          inventory_pop: true,
          inventory_adjustments: true,
          inventory_locations: true,
          inventory_suppliers: true,
          inventory_movements: true,
          // Customers - ALL enabled
          customers: true,
          customers_all: true,
          customers_reviews: true,
          // Marketing - ALL enabled
          marketing: true,
          marketing_promotions: true,
          marketing_coupons: true,
          // Analytics - ALL enabled
          analytics: true,
          analytics_sales: true,
          analytics_traffic: true,
          analytics_performance: true,
          // Settings - ALL enabled
          settings: true,
          settings_general: true,
          settings_payments: true,
          settings_appearance: true,
          settings_security: true,
          settings_domains: true,
        },
      };
    } else if (user.roles.includes(customerRole.id)) {
      app = 'STORE_ECOMMERCE';
      panel_ui = {
        STORE_ECOMMERCE: {
          profile: true,
          history: true,
          dashboard: true,
          favorites: true,
          orders: true,
          settings: true,
        },
      };
    } else {
      // Other roles (supervisor, employee, etc.)
      app = 'VENDIX_LANDING';
      panel_ui = {
        VENDIX_LANDING: {
          dashboard: false,
        },
      };
    }

    // Create user settings
    await client.user_settings.upsert({
      where: { user_id: createdUser.id },
      update: {},
      create: {
        user_id: createdUser.id,
        app_type: app as any, // app_type enum value (VENDIX_ADMIN, ORG_ADMIN, STORE_ADMIN, etc.)
        config: {
          panel_ui,
          preferences: {
            language: 'es',
            theme: 'default',
          },
        },
      },
    });
    settingsCreated++;

    createdUsers.push(createdUser);
  }

  return {
    usersCreated: createdUsers.length,
    rolesAssigned,
    settingsCreated,
  };
}
