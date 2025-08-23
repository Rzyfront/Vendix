import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de la base de datos...');
  
  // 1. Crear permisos
  console.log('📝 Creando permisos...');
  const permissions = [
    // Usuarios
    { name: 'users.read', description: 'Ver usuarios', path: '/api/users', method: 'GET' },
    { name: 'users.create', description: 'Crear usuarios', path: '/api/users', method: 'POST' },
    { name: 'users.update', description: 'Actualizar usuarios', path: '/api/users/:id', method: 'PUT' },
    { name: 'users.delete', description: 'Eliminar usuarios', path: '/api/users/:id', method: 'DELETE' },
    
    // Productos
    { name: 'products.read', description: 'Ver productos', path: '/api/products', method: 'GET' },
    { name: 'products.create', description: 'Crear productos', path: '/api/products', method: 'POST' },
    { name: 'products.update', description: 'Actualizar productos', path: '/api/products/:id', method: 'PUT' },
    { name: 'products.delete', description: 'Eliminar productos', path: '/api/products/:id', method: 'DELETE' },
    
    // Órdenes
    { name: 'orders.read', description: 'Ver órdenes', path: '/api/orders', method: 'GET' },
    { name: 'orders.create', description: 'Crear órdenes', path: '/api/orders', method: 'POST' },
    { name: 'orders.update', description: 'Actualizar órdenes', path: '/api/orders/:id', method: 'PUT' },
    { name: 'orders.delete', description: 'Eliminar órdenes', path: '/api/orders/:id', method: 'DELETE' },
    
    // Categorías
    { name: 'categories.read', description: 'Ver categorías', path: '/api/categories', method: 'GET' },
    { name: 'categories.create', description: 'Crear categorías', path: '/api/categories', method: 'POST' },
    { name: 'categories.update', description: 'Actualizar categorías', path: '/api/categories/:id', method: 'PUT' },
    { name: 'categories.delete', description: 'Eliminar categorías', path: '/api/categories/:id', method: 'DELETE' },
    
    // Marcas
    { name: 'brands.read', description: 'Ver marcas', path: '/api/brands', method: 'GET' },
    { name: 'brands.create', description: 'Crear marcas', path: '/api/brands', method: 'POST' },
    { name: 'brands.update', description: 'Actualizar marcas', path: '/api/brands/:id', method: 'PUT' },
    { name: 'brands.delete', description: 'Eliminar marcas', path: '/api/brands/:id', method: 'DELETE' },
    
    // Tiendas
    { name: 'stores.read', description: 'Ver tiendas', path: '/api/stores', method: 'GET' },
    { name: 'stores.create', description: 'Crear tiendas', path: '/api/stores', method: 'POST' },
    { name: 'stores.update', description: 'Actualizar tiendas', path: '/api/stores/:id', method: 'PUT' },
    { name: 'stores.delete', description: 'Eliminar tiendas', path: '/api/stores/:id', method: 'DELETE' },
    
    // Inventario
    { name: 'inventory.read', description: 'Ver inventario', path: '/api/inventory', method: 'GET' },
    { name: 'inventory.create', description: 'Crear inventario', path: '/api/inventory', method: 'POST' },
    { name: 'inventory.update', description: 'Actualizar inventario', path: '/api/inventory/:id', method: 'PUT' },
    { name: 'inventory.delete', description: 'Eliminar inventario', path: '/api/inventory/:id', method: 'DELETE' },
    
    // Pagos
    { name: 'payments.read', description: 'Ver pagos', path: '/api/payments', method: 'GET' },
    { name: 'payments.create', description: 'Crear pagos', path: '/api/payments', method: 'POST' },
    { name: 'payments.update', description: 'Actualizar pagos', path: '/api/payments/:id', method: 'PUT' },
    { name: 'payments.delete', description: 'Eliminar pagos', path: '/api/payments/:id', method: 'DELETE' },
    
    // Reembolsos
    { name: 'refunds.read', description: 'Ver reembolsos', path: '/api/refunds', method: 'GET' },
    { name: 'refunds.create', description: 'Crear reembolsos', path: '/api/refunds', method: 'POST' },
    { name: 'refunds.update', description: 'Actualizar reembolsos', path: '/api/refunds/:id', method: 'PUT' },
    { name: 'refunds.delete', description: 'Eliminar reembolsos', path: '/api/refunds/:id', method: 'DELETE' },
    
    // Clientes
    { name: 'customers.read', description: 'Ver clientes', path: '/api/customers', method: 'GET' },
    { name: 'customers.create', description: 'Crear clientes', path: '/api/customers', method: 'POST' },
    { name: 'customers.update', description: 'Actualizar clientes', path: '/api/customers/:id', method: 'PUT' },
    { name: 'customers.delete', description: 'Eliminar clientes', path: '/api/customers/:id', method: 'DELETE' },
    
    // Direcciones
    { name: 'addresses.read', description: 'Ver direcciones', path: '/api/addresses', method: 'GET' },
    { name: 'addresses.create', description: 'Crear direcciones', path: '/api/addresses', method: 'POST' },
    { name: 'addresses.update', description: 'Actualizar direcciones', path: '/api/addresses/:id', method: 'PUT' },
    { name: 'addresses.delete', description: 'Eliminar direcciones', path: '/api/addresses/:id', method: 'DELETE' },
    
    // Impuestos
    { name: 'taxes.read', description: 'Ver impuestos', path: '/api/taxes', method: 'GET' },
    { name: 'taxes.create', description: 'Crear impuestos', path: '/api/taxes', method: 'POST' },
    { name: 'taxes.update', description: 'Actualizar impuestos', path: '/api/taxes/:id', method: 'PUT' },
    { name: 'taxes.delete', description: 'Eliminar impuestos', path: '/api/taxes/:id', method: 'DELETE' },
    
    // Administración
    { name: 'admin.dashboard', description: 'Acceso al dashboard administrativo', path: '/api/admin/dashboard', method: 'GET' },
    { name: 'admin.analytics', description: 'Ver analytics y reportes', path: '/api/admin/analytics', method: 'GET' },
    { name: 'admin.settings', description: 'Configurar sistema', path: '/api/admin/settings', method: 'POST' },
  ];

  for (const permission of permissions) {
    await prisma.permissions.upsert({
      where: { name: permission.name },
      update: {},
      create: {
        name: permission.name,
        description: permission.description,
        path: permission.path,
        method: permission.method as any,
      },
    });
  }
  // 2. Crear roles
  console.log('👥 Creando roles...');
  const superAdminRole = await prisma.roles.upsert({
    where: { name: 'super_admin' },
    update: {},
    create: {
      name: 'super_admin',
      description: 'Super Administrador con acceso total al sistema',
      is_system_role: true,
    },
  });

  const ownerRole = await prisma.roles.upsert({
    where: { name: 'owner' },
    update: {},
    create: {
      name: 'owner',
      description: 'Propietario del negocio con acceso completo',
      is_system_role: true,
    },
  });

  const adminRole = await prisma.roles.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'Administrador del sistema con acceso completo',
    },
  });

  const managerRole = await prisma.roles.upsert({
    where: { name: 'manager' },
    update: {},
    create: {
      name: 'manager',
      description: 'Gerente con permisos de gestión',
    },
  });
  const supervisorRole = await prisma.roles.upsert({
    where: { name: 'supervisor' },
    update: {},
    create: {
      name: 'supervisor',
      description: 'Supervisor con permisos intermedios',
    },
  });

  const employeeRole = await prisma.roles.upsert({
    where: { name: 'employee' },
    update: {},
    create: {
      name: 'employee',
      description: 'Empleado con permisos limitados',
    },
  });

  const customerRole = await prisma.roles.upsert({
    where: { name: 'customer' },
    update: {},
    create: {
      name: 'customer',
      description: 'Cliente del sistema',
    },
  });

  // 3. Asignar permisos a roles
  console.log('🔗 Asignando permisos a roles...');
  
  // Super Admin y Owner: todos los permisos
  const allPermissions = await prisma.permissions.findMany();
  
  // Super Admin: todos los permisos
  for (const permission of allPermissions) {
    await prisma.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: superAdminRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: {
        role_id: superAdminRole.id,
        permission_id: permission.id,
      },
    });
  }

  // Owner: todos los permisos
  for (const permission of allPermissions) {
    await prisma.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: ownerRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: {
        role_id: ownerRole.id,
        permission_id: permission.id,
      },
    });  }
  
  // Admin: todos los permisos
  for (const permission of allPermissions) {
    await prisma.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: adminRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: {
        role_id: adminRole.id,
        permission_id: permission.id,
      },
    });
  }

  // Manager: permisos de gestión (sin delete de usuarios y configuración de sistema)
  const managerPermissions = allPermissions.filter(
    p => !p.name.includes('users.delete') && !p.name.includes('admin.settings')
  );
  for (const permission of managerPermissions) {
    await prisma.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: managerRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: {
        role_id: managerRole.id,
        permission_id: permission.id,
      },
    });
  }

  // Employee: permisos básicos de lectura y creación
  const employeePermissions = allPermissions.filter(
    p => p.name.includes('.read') || 
        p.name.includes('.create') || 
        p.name.includes('.update')
  );
  for (const permission of employeePermissions) {
    await prisma.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: employeeRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: {
        role_id: employeeRole.id,
        permission_id: permission.id,
      },
    });  }

  // Supervisor: permisos de lectura, creación, actualización y algunos delete
  const supervisorPermissions = allPermissions.filter(
    p => p.name.includes('.read') || 
        p.name.includes('.create') || 
        p.name.includes('.update') ||
        (p.name.includes('.delete') && !p.name.includes('users.delete'))
  );
  for (const permission of supervisorPermissions) {
    await prisma.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: supervisorRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: {
        role_id: supervisorRole.id,
        permission_id: permission.id,
      },
    });
  }

  // Customer: solo permisos de lectura de productos y gestión de órdenes propias
  const customerPermissions = allPermissions.filter(
    p => p.name.includes('products.read') || 
        p.name.includes('categories.read') ||
        p.name.includes('brands.read') ||
        p.name.includes('orders.create') ||
        p.name.includes('orders.read') ||
        p.name.includes('addresses.read') ||
        p.name.includes('addresses.create') ||
        p.name.includes('addresses.update')
  );
  for (const permission of customerPermissions) {
    await prisma.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: customerRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: {
        role_id: customerRole.id,
        permission_id: permission.id,      },
    });
  }
  
  // 4. Crear organizaciones de ejemplo
  console.log('🏢 Creando organizaciones...');
  
  const mainOrganization = await prisma.organizations.upsert({
    where: { slug: 'tech-solutions-corp' },
    update: {},
    create: {
      name: 'Tech Solutions Corp',
      slug: 'tech-solutions-corp',
      legal_name: 'Tech Solutions Corporation S.A. de C.V.',
      tax_id: 'TSC2024001234',
      email: 'contact@techsolutions.com',
      phone: '+52-55-1234-5678',
      website: 'https://techsolutions.com',
      description: 'Empresa líder en soluciones tecnológicas y e-commerce',
      state: 'active',
    },
  });

  const retailOrganization = await prisma.organizations.upsert({
    where: { slug: 'retail-plus' },
    update: {},
    create: {
      name: 'Retail Plus',
      slug: 'retail-plus',
      legal_name: 'Retail Plus México S.A. de C.V.',
      tax_id: 'RPM2024567890',
      email: 'info@retailplus.mx',
      phone: '+52-55-9876-5432',
      website: 'https://retailplus.mx',
      description: 'Cadena de tiendas retail con presencia nacional',
      state: 'active',
    },
  });

  // 5. Crear direcciones para organizaciones
  console.log('📍 Creando direcciones organizacionales...');
  
  // Dirección principal de Tech Solutions Corp
  await prisma.addresses.upsert({
    where: { id: 1 },
    update: {},
    create: {
      organization_id: mainOrganization.id,
      address_line1: 'Av. Paseo de la Reforma 250',
      address_line2: 'Piso 15, Torre A',
      city: 'Ciudad de México',
      state_province: 'CDMX',
      country_code: 'MEX',
      postal_code: '06500',
      phone_number: '+52-55-1234-5678',
      type: 'headquarters',
      latitude: 19.4326,
      longitude: -99.1332,
      is_primary: true,
    },
  });

  // Dirección de sucursal de Tech Solutions Corp
  await prisma.addresses.upsert({
    where: { id: 2 },
    update: {},
    create: {
      organization_id: mainOrganization.id,
      address_line1: 'Av. Universidad 1200',
      city: 'Guadalajara',
      state_province: 'Jalisco',
      country_code: 'MEX',
      postal_code: '44100',
      phone_number: '+52-33-2468-1357',
      type: 'branch_office',
      latitude: 20.6597,
      longitude: -103.3496,
      is_primary: false,
    },
  });

  // Dirección principal de Retail Plus
  await prisma.addresses.upsert({
    where: { id: 3 },
    update: {},
    create: {
      organization_id: retailOrganization.id,
      address_line1: 'Blvd. Adolfo López Mateos 2375',
      city: 'León',
      state_province: 'Guanajuato',
      country_code: 'MEX',
      postal_code: '37270',
      phone_number: '+52-477-123-4567',
      type: 'headquarters',
      latitude: 21.1619,
      longitude: -101.7111,
      is_primary: true,
    },
  });

  // 6. Crear usuarios de prueba
  console.log('👤 Creando usuarios de prueba...');

  // 1. Super Admin - vendixadmin
  console.log('  - Creando Super Admin...');
  const superAdminPassword = await bcrypt.hash('super1', 12);
  const superAdminUser = await prisma.users.upsert({
    where: { email: 'sa@vx.com' },
    update: {},
    create: {
      email: 'sa@vx.com',
      password: superAdminPassword,
      first_name: 'Vendix',
      last_name: 'SuperAdmin',
      username: 'vendixadmin',
      email_verified: true,
      state: 'active',
    },
  });
  await prisma.user_roles.upsert({
    where: {
      user_id_role_id: {
        user_id: superAdminUser.id,
        role_id: superAdminRole.id,
      },
    },
    update: {},
    create: {
      user_id: superAdminUser.id,
      role_id: superAdminRole.id,
    },
  });

  // 2. Owner
  console.log('  - Creando Owner...');
  const ownerPassword = await bcrypt.hash('owner1', 12);
  const ownerUser = await prisma.users.upsert({
    where: { email: 'owner@vx.com' },
    update: {},
    create: {
      email: 'owner@vx.com',
      password: ownerPassword,
      first_name: 'Business',
      last_name: 'Owner',
      username: 'owner',
      email_verified: true,
      state: 'active',
    },
  });
  await prisma.user_roles.upsert({
    where: {
      user_id_role_id: {
        user_id: ownerUser.id,
        role_id: ownerRole.id,
      },
    },
    update: {},
    create: {
      user_id: ownerUser.id,
      role_id: ownerRole.id,
    },
  });
  // 3. Admin
  console.log('  - Creando Admin...');
  const adminPassword = await bcrypt.hash('admin1', 12);
  const adminUser = await prisma.users.upsert({
    where: { email: 'admin@vx.com' },
    update: {},
    create: {
      email: 'admin@vx.com',
      password: adminPassword,
      first_name: 'System',
      last_name: 'Admin',
      username: 'systemadmin',
      email_verified: true,
      state: 'active',
    },
  });
  // Asignar rol admin al usuario
  await prisma.user_roles.upsert({
    where: {
      user_id_role_id: {
        user_id: adminUser.id,
        role_id: adminRole.id,
      },
    },
    update: {},
    create: {
      user_id: adminUser.id,
      role_id: adminRole.id,
    },  });
  // 4. Manager
  console.log('  - Creando Manager...');
  const managerPassword = await bcrypt.hash('mgr123', 12);
  const managerUser = await prisma.users.upsert({
    where: { email: 'mgr@vx.com' },
    update: {},
    create: {
      email: 'mgr@vx.com',
      password: managerPassword,
      first_name: 'Store',
      last_name: 'Manager',
      username: 'storemanager',
      email_verified: true,
      state: 'active',
    },
  });
  await prisma.user_roles.upsert({
    where: {
      user_id_role_id: {
        user_id: managerUser.id,
        role_id: managerRole.id,
      },
    },
    update: {},
    create: {
      user_id: managerUser.id,
      role_id: managerRole.id,
    },
  });
  // 5. Supervisor
  console.log('  - Creando Supervisor...');
  const supervisorPassword = await bcrypt.hash('sup123', 12);
  const supervisorUser = await prisma.users.upsert({
    where: { email: 'sup@vx.com' },
    update: {},
    create: {
      email: 'sup@vx.com',
      password: supervisorPassword,
      first_name: 'Team',
      last_name: 'Supervisor',
      username: 'teamsupervisor',
      email_verified: true,
      state: 'active',
    },
  });
  await prisma.user_roles.upsert({
    where: {
      user_id_role_id: {
        user_id: supervisorUser.id,
        role_id: supervisorRole.id,
      },
    },
    update: {},
    create: {
      user_id: supervisorUser.id,
      role_id: supervisorRole.id,
    },
  });
  // 6. Employee
  console.log('  - Creando Employee...');
  const employeePassword = await bcrypt.hash('emp123', 12);
  const employeeUser = await prisma.users.upsert({
    where: { email: 'emp@vx.com' },
    update: {},
    create: {
      email: 'emp@vx.com',
      password: employeePassword,
      first_name: 'Store',
      last_name: 'Employee',
      username: 'storeemployee',
      email_verified: true,
      state: 'active',
    },
  });
  await prisma.user_roles.upsert({
    where: {
      user_id_role_id: {
        user_id: employeeUser.id,
        role_id: employeeRole.id,
      },
    },
    update: {},
    create: {
      user_id: employeeUser.id,
      role_id: employeeRole.id,
    },
  });
  // 7. Customer
  console.log('  - Creando Customer...');
  const customerPassword = await bcrypt.hash('cust12', 12);
  const customerUser = await prisma.users.upsert({
    where: { email: 'cust@vx.com' },
    update: {},
    create: {
      email: 'cust@vx.com',
      password: customerPassword,
      first_name: 'Regular',
      last_name: 'Customer',
      username: 'regularcustomer',
      email_verified: true,
      state: 'active',
    },
  });
  await prisma.user_roles.upsert({
    where: {
      user_id_role_id: {
        user_id: customerUser.id,
        role_id: customerRole.id,
      },
    },
    update: {},
    create: {
      user_id: customerUser.id,
      role_id: customerRole.id,    },
  });

  // 7. Asignar usuarios a organizaciones
  console.log('🏢 Asignando usuarios a organizaciones...');
  
  // Super Admin en Tech Solutions Corp
  await prisma.organization_users.upsert({
    where: {
      user_id_role_id_organization_id: {
        user_id: superAdminUser.id,
        role_id: superAdminRole.id,
        organization_id: mainOrganization.id,
      },
    },
    update: {},
    create: {
      user_id: superAdminUser.id,
      role_id: superAdminRole.id,
      organization_id: mainOrganization.id,
      permissions: {
        "can_manage_all_stores": true,
        "can_view_analytics": true,
        "can_manage_organization": true
      },
      is_active: true,
    },
  });

  // Owner en Tech Solutions Corp
  await prisma.organization_users.upsert({
    where: {
      user_id_role_id_organization_id: {
        user_id: ownerUser.id,
        role_id: ownerRole.id,
        organization_id: mainOrganization.id,
      },
    },
    update: {},
    create: {
      user_id: ownerUser.id,
      role_id: ownerRole.id,
      organization_id: mainOrganization.id,
      permissions: {
        "can_manage_all_stores": true,
        "can_view_financial_data": true,
        "can_manage_organization": true
      },
      is_active: true,
    },
  });

  // Admin en ambas organizaciones
  await prisma.organization_users.upsert({
    where: {
      user_id_role_id_organization_id: {
        user_id: adminUser.id,
        role_id: adminRole.id,
        organization_id: mainOrganization.id,
      },
    },
    update: {},
    create: {
      user_id: adminUser.id,
      role_id: adminRole.id,
      organization_id: mainOrganization.id,
      permissions: {
        "can_manage_stores": true,
        "can_view_reports": true
      },
      is_active: true,
    },
  });

  await prisma.organization_users.upsert({
    where: {
      user_id_role_id_organization_id: {
        user_id: adminUser.id,
        role_id: adminRole.id,
        organization_id: retailOrganization.id,
      },
    },
    update: {},
    create: {
      user_id: adminUser.id,
      role_id: adminRole.id,
      organization_id: retailOrganization.id,
      permissions: {
        "can_manage_stores": true,
        "can_view_reports": true
      },
      is_active: true,
    },
  });

  // Manager en Tech Solutions Corp
  await prisma.organization_users.upsert({
    where: {
      user_id_role_id_organization_id: {
        user_id: managerUser.id,
        role_id: managerRole.id,
        organization_id: mainOrganization.id,
      },
    },
    update: {},
    create: {
      user_id: managerUser.id,
      role_id: managerRole.id,
      organization_id: mainOrganization.id,
      permissions: {
        "can_manage_specific_stores": true,
        "can_view_store_analytics": true
      },
      is_active: true,
    },
  });

  // 8. Crear tiendas de ejemplo
  console.log('🏪 Creando tiendas...');
  
  const techStoreOnline = await prisma.stores.upsert({
    where: { store_code: 'TECH-ONLINE-001' },
    update: {},
    create: {
      organization_id: mainOrganization.id,
      name: 'Tech Solutions Online',
      slug: 'tech-online',
      store_code: 'TECH-ONLINE-001',
      logo_url: 'https://techsolutions.com/logo.png',
      color_primary: '#2563eb',
      color_secondary: '#1e40af',
      domain: 'shop.techsolutions.com',
      timezone: 'America/Mexico_City',
      currency_code: 'MXN',
      operating_hours: {
        "monday": { "open": "00:00", "close": "23:59", "closed": false },
        "tuesday": { "open": "00:00", "close": "23:59", "closed": false },
        "wednesday": { "open": "00:00", "close": "23:59", "closed": false },
        "thursday": { "open": "00:00", "close": "23:59", "closed": false },
        "friday": { "open": "00:00", "close": "23:59", "closed": false },
        "saturday": { "open": "00:00", "close": "23:59", "closed": false },
        "sunday": { "open": "00:00", "close": "23:59", "closed": false }
      },
      store_type: 'online',
      is_active: true,
      manager_user_id: managerUser.id,
    },
  });

  const techStorePhysical = await prisma.stores.upsert({
    where: { store_code: 'TECH-GDL-001' },
    update: {},
    create: {
      organization_id: mainOrganization.id,
      name: 'Tech Solutions Guadalajara',
      slug: 'tech-guadalajara',
      store_code: 'TECH-GDL-001',
      logo_url: 'https://techsolutions.com/logo.png',
      color_primary: '#2563eb',
      color_secondary: '#1e40af',
      timezone: 'America/Mexico_City',
      currency_code: 'MXN',
      operating_hours: {
        "monday": { "open": "09:00", "close": "20:00", "closed": false },
        "tuesday": { "open": "09:00", "close": "20:00", "closed": false },
        "wednesday": { "open": "09:00", "close": "20:00", "closed": false },
        "thursday": { "open": "09:00", "close": "20:00", "closed": false },
        "friday": { "open": "09:00", "close": "20:00", "closed": false },
        "saturday": { "open": "10:00", "close": "18:00", "closed": false },
        "sunday": { "open": "11:00", "close": "17:00", "closed": false }
      },
      store_type: 'physical',
      is_active: true,
      manager_user_id: supervisorUser.id,
    },
  });

  const retailStore = await prisma.stores.upsert({
    where: { store_code: 'RETAIL-LEON-001' },
    update: {},
    create: {
      organization_id: retailOrganization.id,
      name: 'Retail Plus León Centro',
      slug: 'retail-leon-centro',
      store_code: 'RETAIL-LEON-001',
      logo_url: 'https://retailplus.mx/logo.png',
      color_primary: '#dc2626',
      color_secondary: '#b91c1c',
      timezone: 'America/Mexico_City',
      currency_code: 'MXN',
      operating_hours: {
        "monday": { "open": "08:00", "close": "21:00", "closed": false },
        "tuesday": { "open": "08:00", "close": "21:00", "closed": false },
        "wednesday": { "open": "08:00", "close": "21:00", "closed": false },
        "thursday": { "open": "08:00", "close": "21:00", "closed": false },
        "friday": { "open": "08:00", "close": "22:00", "closed": false },
        "saturday": { "open": "08:00", "close": "22:00", "closed": false },
        "sunday": { "open": "09:00", "close": "20:00", "closed": false }
      },
      store_type: 'hybrid',
      is_active: true,
    },
  });

  // 9. Asignar staff a tiendas
  console.log('👥 Asignando staff a tiendas...');
  
  // Manager como manager de la tienda online
  await prisma.store_staff.upsert({
    where: {
      user_id_role_id_store_id: {
        user_id: managerUser.id,
        role_id: managerRole.id,
        store_id: techStoreOnline.id,
      },
    },
    update: {},
    create: {
      user_id: managerUser.id,
      role_id: managerRole.id,
      store_id: techStoreOnline.id,
      permissions: {
        "can_manage_inventory": true,
        "can_process_orders": true,
        "can_view_analytics": true
      },
      is_active: true,
    },
  });

  // Supervisor como manager de la tienda física
  await prisma.store_staff.upsert({
    where: {
      user_id_role_id_store_id: {
        user_id: supervisorUser.id,
        role_id: supervisorRole.id,
        store_id: techStorePhysical.id,
      },
    },
    update: {},
    create: {
      user_id: supervisorUser.id,
      role_id: supervisorRole.id,
      store_id: techStorePhysical.id,
      permissions: {
        "can_manage_inventory": true,
        "can_process_orders": true,
        "can_supervise_staff": true
      },
      is_active: true,
    },
  });

  // Employee en la tienda física
  await prisma.store_staff.upsert({
    where: {
      user_id_role_id_store_id: {
        user_id: employeeUser.id,
        role_id: employeeRole.id,
        store_id: techStorePhysical.id,
      },
    },
    update: {},
    create: {
      user_id: employeeUser.id,
      role_id: employeeRole.id,
      store_id: techStorePhysical.id,
      permissions: {
        "can_process_sales": true,
        "can_view_products": true
      },
      is_active: true,
    },
  });

  // 10. Crear direcciones para tiendas físicas
  console.log('📍 Creando direcciones de tiendas...');
  
  // Dirección para Tech Solutions Guadalajara
  await prisma.addresses.upsert({
    where: { id: 4 },
    update: {},
    create: {
      store_id: techStorePhysical.id,
      address_line1: 'Av. Universidad 1200',
      address_line2: 'Local 15-B',
      city: 'Guadalajara',
      state_province: 'Jalisco',
      country_code: 'MEX',
      postal_code: '44100',
      phone_number: '+52-33-2468-1357',
      type: 'store_physical',
      latitude: 20.6597,
      longitude: -103.3496,
      is_primary: true,
    },
  });

  // Dirección para Retail Plus León
  await prisma.addresses.upsert({
    where: { id: 5 },
    update: {},
    create: {
      store_id: retailStore.id,
      address_line1: 'Blvd. Adolfo López Mateos 2375',
      address_line2: 'Plaza Centro León, Local 45',
      city: 'León',
      state_province: 'Guanajuato',
      country_code: 'MEX',
      postal_code: '37270',
      phone_number: '+52-477-123-4567',
      type: 'store_physical',
      latitude: 21.1619,
      longitude: -101.7111,
      is_primary: true,
    },
  });

  console.log('✅ Seed completado exitosamente!');
  console.log('');
  console.log('🏢 Organizaciones creadas:');
  console.log('  - Tech Solutions Corp (tech-solutions-corp)');
  console.log('  - Retail Plus (retail-plus)');
  console.log('');
  console.log('🏪 Tiendas creadas:');
  console.log('  - Tech Solutions Online (TECH-ONLINE-001) - Tienda online');
  console.log('  - Tech Solutions Guadalajara (TECH-GDL-001) - Tienda física');
  console.log('  - Retail Plus León Centro (RETAIL-LEON-001) - Tienda híbrida');
  console.log('');
  console.log('👤 Usuarios creados:');
  console.log('  - sa@vx.com (Super Admin) - Password: super1 - Username: vendixadmin');
  console.log('  - owner@vx.com (Owner) - Password: owner1');
  console.log('  - admin@vx.com (Admin) - Password: admin1');
  console.log('  - mgr@vx.com (Manager) - Password: mgr123');
  console.log('  - sup@vx.com (Supervisor) - Password: sup123');
  console.log('  - emp@vx.com (Employee) - Password: emp123');
  console.log('  - cust@vx.com (Customer) - Password: cust12');
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
