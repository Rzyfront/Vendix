import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Usaremos any para flexibilidad en el seed

async function main() {
  console.log('🌱 Iniciando seed mejorado de la base de datos para Fase 2...');

  // Limpiar datos existentes (opcional - comentar en producción)
  console.log('🧹 Limpiando datos existentes...');
  await prisma.role_permissions.deleteMany({});
  await prisma.user_roles.deleteMany({});
  await prisma.store_users.deleteMany({});
  await prisma.domain_settings.deleteMany({});
  await prisma.addresses.deleteMany({});
  await prisma.users.deleteMany({});
  await prisma.stores.deleteMany({});
  await prisma.organizations.deleteMany({});
  await prisma.roles.deleteMany({});
  await prisma.permissions.deleteMany({});

  // 1. Crear permisos expandidos para todos los módulos
  console.log('📝 Creando permisos expandidos...');
  const permissions = [
    // Usuarios
    { name: 'users.read', description: 'Ver usuarios', path: '/api/users', method: 'GET' },
    { name: 'users.create', description: 'Crear usuarios', path: '/api/users', method: 'POST' },
    { name: 'users.update', description: 'Actualizar usuarios', path: '/api/users/:id', method: 'PUT' },
    { name: 'users.delete', description: 'Eliminar usuarios', path: '/api/users/:id', method: 'DELETE' },
    { name: 'users.profile', description: 'Ver perfil de usuario', path: '/api/users/profile', method: 'GET' },
    
    // Direcciones
    { name: 'addresses.read', description: 'Ver direcciones', path: '/api/addresses', method: 'GET' },
    { name: 'addresses.create', description: 'Crear direcciones', path: '/api/addresses', method: 'POST' },
    { name: 'addresses.update', description: 'Actualizar direcciones', path: '/api/addresses/:id', method: 'PUT' },
    { name: 'addresses.delete', description: 'Eliminar direcciones', path: '/api/addresses/:id', method: 'DELETE' },
    
    // Organizaciones
    { name: 'organizations.read', description: 'Ver organizaciones', path: '/api/organizations', method: 'GET' },
    { name: 'organizations.create', description: 'Crear organizaciones', path: '/api/organizations', method: 'POST' },
    { name: 'organizations.update', description: 'Actualizar organizaciones', path: '/api/organizations/:id', method: 'PUT' },
    { name: 'organizations.delete', description: 'Eliminar organizaciones', path: '/api/organizations/:id', method: 'DELETE' },
    { name: 'organizations.settings', description: 'Gestionar configuración de organizaciones', path: '/api/organizations/:id/settings', method: 'PUT' },
    
    // Tiendas
    { name: 'stores.read', description: 'Ver tiendas', path: '/api/stores', method: 'GET' },
    { name: 'stores.create', description: 'Crear tiendas', path: '/api/stores', method: 'POST' },
    { name: 'stores.update', description: 'Actualizar tiendas', path: '/api/stores/:id', method: 'PUT' },
    { name: 'stores.delete', description: 'Eliminar tiendas', path: '/api/stores/:id', method: 'DELETE' },
    { name: 'stores.settings', description: 'Gestionar configuración de tiendas', path: '/api/stores/:id/settings', method: 'PUT' },
    
    // Roles
    { name: 'roles.read', description: 'Ver roles', path: '/api/roles', method: 'GET' },
    { name: 'roles.create', description: 'Crear roles', path: '/api/roles', method: 'POST' },
    { name: 'roles.update', description: 'Actualizar roles', path: '/api/roles/:id', method: 'PUT' },
    { name: 'roles.delete', description: 'Eliminar roles', path: '/api/roles/:id', method: 'DELETE' },
    { name: 'roles.permissions', description: 'Gestionar permisos de roles', path: '/api/roles/:id/permissions', method: 'PUT' },
    
    // Permisos
    { name: 'permissions.read', description: 'Ver permisos', path: '/api/permissions', method: 'GET' },
    { name: 'permissions.create', description: 'Crear permisos', path: '/api/permissions', method: 'POST' },
    { name: 'permissions.update', description: 'Actualizar permisos', path: '/api/permissions/:id', method: 'PUT' },
    { name: 'permissions.delete', description: 'Eliminar permisos', path: '/api/permissions/:id', method: 'DELETE' },
    
    // Dominios
    { name: 'domains.read', description: 'Ver dominios', path: '/api/domains', method: 'GET' },
    { name: 'domains.create', description: 'Crear dominios', path: '/api/domains', method: 'POST' },
    { name: 'domains.update', description: 'Actualizar dominios', path: '/api/domains/:id', method: 'PUT' },
    { name: 'domains.delete', description: 'Eliminar dominios', path: '/api/domains/:id', method: 'DELETE' },
    { name: 'domains.verify', description: 'Verificar dominios', path: '/api/domains/:id/verify', method: 'POST' },
    
    // Productos
    { name: 'products.read', description: 'Ver productos', path: '/api/products', method: 'GET' },
    { name: 'products.create', description: 'Crear productos', path: '/api/products', method: 'POST' },
    { name: 'products.update', description: 'Actualizar productos', path: '/api/products/:id', method: 'PUT' },
    { name: 'products.delete', description: 'Eliminar productos', path: '/api/products/:id', method: 'DELETE' },
    
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
    
    // Inventario
    { name: 'inventory.read', description: 'Ver inventario', path: '/api/inventory', method: 'GET' },
    { name: 'inventory.update', description: 'Actualizar inventario', path: '/api/inventory/:id', method: 'PUT' },
    { name: 'inventory.transactions', description: 'Ver transacciones de inventario', path: '/api/inventory/transactions', method: 'GET' },
    
    // Pedidos
    { name: 'orders.read', description: 'Ver pedidos', path: '/api/orders', method: 'GET' },
    { name: 'orders.create', description: 'Crear pedidos', path: '/api/orders', method: 'POST' },
    { name: 'orders.update', description: 'Actualizar pedidos', path: '/api/orders/:id', method: 'PUT' },
    { name: 'orders.delete', description: 'Eliminar pedidos', path: '/api/orders/:id', method: 'DELETE' },
    
    // Pagos
    { name: 'payments.read', description: 'Ver pagos', path: '/api/payments', method: 'GET' },
    { name: 'payments.process', description: 'Procesar pagos', path: '/api/payments/:id/process', method: 'POST' },
    { name: 'payments.refund', description: 'Reembolsar pagos', path: '/api/payments/:id/refund', method: 'POST' },
    
    // Auditoría
    { name: 'audit.read', description: 'Ver logs de auditoría', path: '/api/audit', method: 'GET' },
    
    // Autenticación
    { name: 'auth.login', description: 'Iniciar sesión', path: '/api/auth/login', method: 'POST' },
    { name: 'auth.register', description: 'Registrarse', path: '/api/auth/register', method: 'POST' },
    { name: 'auth.refresh', description: 'Refrescar token', path: '/api/auth/refresh', method: 'POST' },
    { name: 'auth.logout', description: 'Cerrar sesión', path: '/api/auth/logout', method: 'POST' },
    { name: 'auth.password.reset', description: 'Restablecer contraseña', path: '/api/auth/password/reset', method: 'POST' },
    { name: 'auth.verify.email', description: 'Verificar email', path: '/api/auth/verify-email', method: 'POST' },
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
    create: { name: 'super_admin', description: 'Super Administrador del sistema', is_system_role: true },
  });
  const ownerRole = await prisma.roles.upsert({
    where: { name: 'owner' },
    update: {},
    create: { name: 'owner', description: 'Propietario de la organización', is_system_role: true },
  });
  const adminRole = await prisma.roles.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', description: 'Administrador de la organización', is_system_role: true },
  });
  const managerRole = await prisma.roles.upsert({
    where: { name: 'manager' },
    update: {},
    create: { name: 'manager', description: 'Gerente de tienda', is_system_role: true },
  });
  const supervisorRole = await prisma.roles.upsert({
    where: { name: 'supervisor' },
    update: {},
    create: { name: 'supervisor', description: 'Supervisor de tienda', is_system_role: true },
  });
  const employeeRole = await prisma.roles.upsert({
    where: { name: 'employee' },
    update: {},
    create: { name: 'employee', description: 'Empleado de tienda', is_system_role: true },
  });
  const customerRole = await prisma.roles.upsert({
    where: { name: 'customer' },
    update: {},
    create: { name: 'customer', description: 'Cliente de la tienda', is_system_role: true },
  });

  // 3. Asignar permisos a roles
  console.log('🔗 Asignando permisos a roles...');
  const allPermissions = await prisma.permissions.findMany();
  
  // Asignar todos los permisos al super_admin
  for (const permission of allPermissions) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: superAdminRole.id, permission_id: permission.id } },
      update: {},
      create: { role_id: superAdminRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos al owner (gestión completa de su organización)
  const ownerPermissions = allPermissions.filter(p =>
    !p.name.includes('super_admin') &&
    !p.name.includes('domains.delete') &&
    !p.name.includes('organizations.delete')
  );
  
  for (const permission of ownerPermissions) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: ownerRole.id, permission_id: permission.id } },
      update: {},
      create: { role_id: ownerRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos al admin (gestión operativa)
  const adminPermissions = allPermissions.filter(p =>
    p.name.includes('users.') ||
    p.name.includes('stores.') ||
    p.name.includes('products.') ||
    p.name.includes('categories.') ||
    p.name.includes('inventory.') ||
    p.name.includes('orders.') ||
    p.name.includes('payments.') ||
    p.name.includes('addresses.')
  );
  
  for (const permission of adminPermissions) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: adminRole.id, permission_id: permission.id } },
      update: {},
      create: { role_id: adminRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos al manager (gestión de tienda)
  const managerPermissions = allPermissions.filter(p =>
    p.name.includes('products.') ||
    p.name.includes('categories.') ||
    p.name.includes('inventory.') ||
    p.name.includes('orders.') ||
    p.name.includes('payments.') ||
    p.name.includes('users.read') ||
    p.name.includes('stores.read')
  );
  
  for (const permission of managerPermissions) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: managerRole.id, permission_id: permission.id } },
      update: {},
      create: { role_id: managerRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos básicos al supervisor
  const supervisorPermissions = allPermissions.filter(p =>
    p.name.includes('orders.') ||
    p.name.includes('payments.read') ||
    p.name.includes('inventory.read') ||
    p.name.includes('products.read')
  );
  
  for (const permission of supervisorPermissions) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: supervisorRole.id, permission_id: permission.id } },
      update: {},
      create: { role_id: supervisorRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos mínimos al employee
  const employeePermissions = allPermissions.filter(p =>
    p.name.includes('orders.create') ||
    p.name.includes('orders.read') ||
    p.name.includes('payments.process') ||
    p.name.includes('products.read')
  );
  
  for (const permission of employeePermissions) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: employeeRole.id, permission_id: permission.id } },
      update: {},
      create: { role_id: employeeRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos al customer
  const customerPermissions = allPermissions.filter(p =>
    p.name.includes('auth.') ||
    p.name.includes('products.read') ||
    p.name.includes('categories.read') ||
    p.name.includes('orders.create') ||
    p.name.includes('orders.read') ||
    p.name.includes('addresses.') ||
    p.name.includes('users.profile')
  );
  
  for (const permission of customerPermissions) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: customerRole.id, permission_id: permission.id } },
      update: {},
      create: { role_id: customerRole.id, permission_id: permission.id },
    });
  }

  // 4. Crear múltiples organizaciones
  console.log('🏢 Creando organizaciones de prueba...');
  const organizations = [
    {
      name: 'Vendix Corp',
      slug: 'vendix-corp',
      email: 'admin@vendix.com',
      legal_name: 'Vendix Corporation S.A.S.',
      tax_id: '900123456-7',
      phone: '+57-1-1234567',
      website: 'https://vendix.com',
      description: 'Corporación principal de Vendix - Plataforma multitenant',
      state: 'active'
    },
    {
      name: 'Tech Solutions S.A.',
      slug: 'tech-solutions',
      email: 'contacto@techsolutions.co',
      legal_name: 'Tech Solutions Sociedad Anónima',
      tax_id: '800987654-3',
      phone: '+57-4-7654321',
      website: 'https://techsolutions.co',
      description: 'Empresa de tecnología y soluciones digitales',
      state: 'active'
    },
    {
      name: 'Fashion Retail Group',
      slug: 'fashion-retail',
      email: 'info@fashionretail.com',
      legal_name: 'Fashion Retail Group Ltda.',
      tax_id: '811223344-5',
      phone: '+57-2-3344556',
      website: 'https://fashionretail.com',
      description: 'Grupo de retail especializado en moda',
      state: 'active'
    },
    {
      name: 'Gourmet Foods',
      slug: 'gourmet-foods',
      email: 'ventas@gourmetfoods.com',
      legal_name: 'Gourmet Foods Internacional',
      tax_id: '822334455-6',
      phone: '+57-5-4455667',
      website: 'https://gourmetfoods.com',
      description: 'Distribuidor de alimentos gourmet',
      state: 'draft'
    },
    {
      name: 'Home & Living',
      slug: 'home-living',
      email: 'servicio@homeliving.co',
      legal_name: 'Home & Living Colombia',
      tax_id: '833445566-7',
      phone: '+57-6-5566778',
      website: 'https://homeliving.co',
      description: 'Tienda especializada en hogar y decoración',
      state: 'suspended'
    }
  ];

  const createdOrganizations: any[] = [];
  for (const org of organizations) {
    const createdOrg = await prisma.organizations.upsert({
      where: { slug: org.slug },
      update: {},
      create: {
        name: org.name,
        slug: org.slug,
        email: org.email,
        legal_name: org.legal_name,
        tax_id: org.tax_id,
        phone: org.phone,
        website: org.website,
        description: org.description,
        state: org.state as any,
      },
    });
    createdOrganizations.push(createdOrg);
  }

  const vendixOrg: any = createdOrganizations[0];
  const techSolutionsOrg: any = createdOrganizations[1];
  const fashionRetailOrg: any = createdOrganizations[2];
  const gourmetFoodsOrg: any = createdOrganizations[3];
  const homeLivingOrg: any = createdOrganizations[4];

  // 5. Crear múltiples tiendas para cada organización
  console.log('🏬 Creando tiendas de prueba...');
  const stores = [
    // Tiendas para Vendix Corp
    {
      name: 'Tienda Principal Vendix',
      slug: 'tienda-principal',
      organization_id: vendixOrg.id,
      store_code: 'VNDX001',
      store_type: 'online',
      is_active: true,
      timezone: 'America/Bogota'
    },
    {
      name: 'Vendix Centro',
      slug: 'vendix-centro',
      organization_id: vendixOrg.id,
      store_code: 'VNDX002',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota'
    },
    
    // Tiendas para Tech Solutions
    {
      name: 'Tech Solutions Bogotá',
      slug: 'tech-bogota',
      organization_id: techSolutionsOrg.id,
      store_code: 'TECH001',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota'
    },
    {
      name: 'Tech Solutions Medellín',
      slug: 'tech-medellin',
      organization_id: techSolutionsOrg.id,
      store_code: 'TECH002',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota'
    },
    {
      name: 'Tienda Online Tech',
      slug: 'tech-online',
      organization_id: techSolutionsOrg.id,
      store_code: 'TECH003',
      store_type: 'online',
      is_active: true,
      timezone: 'America/Bogota'
    },
    
    // Tiendas para Fashion Retail
    {
      name: 'Fashion Retail Norte',
      slug: 'fashion-norte',
      organization_id: fashionRetailOrg.id,
      store_code: 'FSHN001',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota'
    },
    {
      name: 'Fashion E-commerce',
      slug: 'fashion-online',
      organization_id: fashionRetailOrg.id,
      store_code: 'FSHN002',
      store_type: 'online',
      is_active: true,
      timezone: 'America/Bogota'
    },
    
    // Tiendas para Gourmet Foods
    {
      name: 'Gourmet Foods Principal',
      slug: 'gourmet-principal',
      organization_id: gourmetFoodsOrg.id,
      store_code: 'GRMT001',
      store_type: 'physical',
      is_active: false,
      timezone: 'America/Bogota'
    },
    
    // Tiendas para Home & Living
    {
      name: 'Home & Living Centro',
      slug: 'home-centro',
      organization_id: homeLivingOrg.id,
      store_code: 'HOME001',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota'
    }
  ];

  const createdStores: any[] = [];
  for (const store of stores) {
    const createdStore = await prisma.stores.upsert({
      where: { organization_id_slug: { organization_id: store.organization_id, slug: store.slug } },
      update: {},
      create: {
        name: store.name,
        slug: store.slug,
        organization_id: store.organization_id,
        store_code: store.store_code,
        store_type: store.store_type as any,
        is_active: store.is_active,
        timezone: store.timezone,
      },
    });
    createdStores.push(createdStore);
  }

  const vendixStore1: any = createdStores[0];
  const vendixStore2: any = createdStores[1];
  const techStore1: any = createdStores[2];
  const techStore2: any = createdStores[3];
  const techStore3: any = createdStores[4];
  const fashionStore1: any = createdStores[5];
  const fashionStore2: any = createdStores[6];
  const gourmetStore1: any = createdStores[7];
  const homeStore1: any = createdStores[8];

  // 6. Crear usuarios con diferentes roles
  console.log('👤 Creando usuarios de prueba con diferentes roles...');
  const hashedPassword = await bcrypt.hash('1125634q', 10);
  
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
      roles: [superAdminRole.id]
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
      roles: [ownerRole.id]
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
      roles: [ownerRole.id]
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
      roles: [adminRole.id]
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
      roles: [adminRole.id]
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
      roles: [managerRole.id]
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
      roles: [managerRole.id]
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
      roles: [supervisorRole.id]
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
      roles: [supervisorRole.id]
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
      roles: [employeeRole.id]
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
      roles: [employeeRole.id]
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
      roles: [customerRole.id]
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
      roles: [customerRole.id]
    },
    
    // Usuarios pendientes de verificación
    {
      email: 'nuevo@example.com',
      password: hashedPassword,
      first_name: 'Nuevo',
      last_name: 'Usuario',
      username: 'nuevo.usuario',
      email_verified: false,
      state: 'pending_verification',
      organization_id: vendixOrg.id,
      roles: [customerRole.id]
    }
  ];

  const createdUsers: any[] = [];
  for (const user of users) {
    const createdUser = await prisma.users.upsert({
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
        organization_id: user.organization_id,
      },
    });
    
    // Asignar roles
    for (const roleId of user.roles) {
      await prisma.user_roles.upsert({
        where: { user_id_role_id: { user_id: createdUser.id, role_id: roleId } },
        update: {},
        create: { user_id: createdUser.id, role_id: roleId },
      });
    }
    
    createdUsers.push(createdUser);
  }

  const superAdminUser: any = createdUsers[0];
  const techOwner: any = createdUsers[1];
  const fashionOwner: any = createdUsers[2];
  const techAdmin: any = createdUsers[3];
  const fashionAdmin: any = createdUsers[4];
  const techManager: any = createdUsers[5];
  const fashionManager: any = createdUsers[6];
  const techSupervisor: any = createdUsers[7];
  const fashionSupervisor: any = createdUsers[8];
  const techEmployee1: any = createdUsers[9];
  const techEmployee2: any = createdUsers[10];
  const customer1: any = createdUsers[11];
  const customer2: any = createdUsers[12];

  // 7. Crear relaciones store_users
  console.log('🔗 Asignando usuarios a tiendas...');
  const storeUsers = [
    { store_id: techStore1.id, user_id: techManager.id },
    { store_id: techStore1.id, user_id: techSupervisor.id },
    { store_id: techStore1.id, user_id: techEmployee1.id },
    { store_id: techStore1.id, user_id: techEmployee2.id },
    { store_id: techStore1.id, user_id: customer1.id },
    
    { store_id: techStore2.id, user_id: techManager.id },
    { store_id: techStore2.id, user_id: customer1.id },
    
    { store_id: techStore3.id, user_id: techManager.id },
    { store_id: techStore3.id, user_id: customer1.id },
    
    { store_id: fashionStore1.id, user_id: fashionManager.id },
    { store_id: fashionStore1.id, user_id: fashionSupervisor.id },
    { store_id: fashionStore1.id, user_id: customer2.id },
    
    { store_id: fashionStore2.id, user_id: fashionManager.id },
    { store_id: fashionStore2.id, user_id: customer2.id },
    
    { store_id: vendixStore1.id, user_id: superAdminUser.id },
    { store_id: vendixStore2.id, user_id: superAdminUser.id },
  ];

  for (const storeUser of storeUsers) {
    await prisma.store_users.upsert({
      where: { store_id_user_id: { store_id: storeUser.store_id, user_id: storeUser.user_id } },
      update: {},
      create: {
        store_id: storeUser.store_id,
        user_id: storeUser.user_id,
      },
    });
  }

  // 8. Configurar dominios
  console.log('🌐 Configurando dominios...');
  const domainSettings = [
    // Dominio principal de Vendix
    {
      hostname: 'vendix.com',
      organization_id: vendixOrg.id,
      store_id: null,
      domain_type: 'vendix_core',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        branding: {
          name: 'Vendix Corp',
          primary_color: '#7ED7A5',
          secondary_color: '#2F6F4E',
          background_color: '#F4F4F4',
          accent_color: '#FFFFFF',
          border_color: '#B0B0B0',
          text_color: '#222222',
          theme: 'light',
          logo_url: null,
          favicon_url: null,
        },
        security: {
          cors_origins: ['http://vendix.com', 'https://vendix.com', 'http://api.vendix.com'],
          session_timeout: 3600000,
          max_login_attempts: 5
        },
        app: 'VENDIX_LANDING',
      }
    },
    
    // Dominios de organizaciones
    {
      hostname: 'techsolutions.co',
      organization_id: techSolutionsOrg.id,
      store_id: null,
      domain_type: 'organization_root',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        branding: {
          name: 'Tech Solutions',
          primary_color: '#4A90E2',
          secondary_color: '#2C5282',
          background_color: '#F7FAFC',
          accent_color: '#FFFFFF',
          border_color: '#CBD5E0',
          text_color: '#2D3748',
          theme: 'light',
        },
        security: {
          cors_origins: ['https://techsolutions.co', 'https://admin.techsolutions.co'],
          session_timeout: 7200000,
          max_login_attempts: 3
        },
        app: 'ORG_LANDING',
      }
    },
    {
      hostname: 'admin.techsolutions.co',
      organization_id: techSolutionsOrg.id,
      store_id: null,
      domain_type: 'organization_subdomain',
      is_primary: false,
      status: 'active',
      ssl_status: 'issued',
      config: {
        app: 'ORG_ADMIN',
      }
    },
    
    {
      hostname: 'fashionretail.com',
      organization_id: fashionRetailOrg.id,
      store_id: null,
      domain_type: 'organization_root',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        branding: {
          name: 'Fashion Retail',
          primary_color: '#E53E3E',
          secondary_color: '#C53030',
          background_color: '#FFF5F5',
          accent_color: '#FFFFFF',
          border_color: '#FED7D7',
          text_color: '#2D3748',
          theme: 'light',
        },
        app: 'ORG_LANDING',
      }
    },
    
    // Dominios de tiendas
    {
      hostname: 'tienda.techsolutions.co',
      organization_id: techSolutionsOrg.id,
      store_id: techStore3.id,
      domain_type: 'store_subdomain',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        app: 'STORE_ECOMMERCE',
      }
    },
    {
      hostname: 'moda.fashionretail.com',
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore2.id,
      domain_type: 'store_subdomain',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        app: 'STORE_ECOMMERCE',
      }
    },
    
    // Dominio pendiente de verificación
    {
      hostname: 'gourmetfoods.com',
      organization_id: gourmetFoodsOrg.id,
      store_id: null,
      domain_type: 'organization_root',
      is_primary: true,
      status: 'pending_dns',
      ssl_status: 'pending',
      config: {
        app: 'ORG_LANDING',
      }
    }
  ];

  for (const domain of domainSettings) {
    await prisma.domain_settings.create({
      data: {
        hostname: domain.hostname,
        organization_id: domain.organization_id,
        store_id: domain.store_id,
        domain_type: domain.domain_type as any,
        is_primary: domain.is_primary,
        status: domain.status as any,
        ssl_status: domain.ssl_status as any,
        config: domain.config,
      },
    });
  }

  // 9. Crear direcciones
  console.log('📍 Creando direcciones...');
  const addresses = [
    // Direcciones de organizaciones
    {
      address_line1: 'Carrera 15 # 88-64',
      address_line2: 'Piso 8',
      city: 'Bogotá',
      state_province: 'Bogotá D.C.',
      country_code: 'COL',
      postal_code: '110221',
      phone_number: '+57-1-1234567',
      type: 'headquarters',
      is_primary: true,
      organization_id: vendixOrg.id,
    },
    {
      address_line1: 'Calle 10 # 42-28',
      address_line2: 'Edificio Tech Tower',
      city: 'Medellín',
      state_province: 'Antioquia',
      country_code: 'COL',
      postal_code: '050021',
      phone_number: '+57-4-7654321',
      type: 'headquarters',
      is_primary: true,
      organization_id: techSolutionsOrg.id,
    },
    {
      address_line1: 'Avenida 68 # 22-45',
      city: 'Bogotá',
      state_province: 'Bogotá D.C.',
      country_code: 'COL',
      postal_code: '110231',
      phone_number: '+57-2-3344556',
      type: 'headquarters',
      is_primary: true,
      organization_id: fashionRetailOrg.id,
    },
    
    // Direcciones de tiendas
    {
      address_line1: 'Centro Comercial Santafé',
      address_line2: 'Local 205, Nivel 2',
      city: 'Bogotá',
      state_province: 'Bogotá D.C.',
      country_code: 'COL',
      postal_code: '110221',
      phone_number: '+57-1-9876543',
      type: 'store_physical',
      is_primary: true,
      store_id: techStore1.id,
    },
    {
      address_line1: 'Centro Comercial Oviedo',
      address_line2: 'Local 112',
      city: 'Medellín',
      state_province: 'Antioquia',
      country_code: 'COL',
      postal_code: '050021',
      phone_number: '+57-4-8765432',
      type: 'store_physical',
      is_primary: true,
      store_id: techStore2.id,
    },
    {
      address_line1: 'Centro Comercial Andino',
      address_line2: 'Local 305, Nivel 3',
      city: 'Bogotá',
      state_province: 'Bogotá D.C.',
      country_code: 'COL',
      postal_code: '110231',
      phone_number: '+57-1-7654321',
      type: 'store_physical',
      is_primary: true,
      store_id: fashionStore1.id,
    },
    
    // Direcciones de usuarios
    {
      address_line1: 'Carrera 7 # 125-30',
      address_line2: 'Apartamento 501',
      city: 'Bogotá',
      state_province: 'Bogotá D.C.',
      country_code: 'COL',
      postal_code: '110111',
      phone_number: '+57-300-1234567',
      type: 'home',
      is_primary: true,
      user_id: customer1.id,
    },
    {
      address_line1: 'Calle 85 # 12-45',
      address_line2: 'Apartamento 202',
      city: 'Medellín',
      state_province: 'Antioquia',
      country_code: 'COL',
      postal_code: '050022',
      phone_number: '+57-301-9876543',
      type: 'home',
      is_primary: true,
      user_id: customer2.id,
    },
  ];

  for (const address of addresses) {
    await prisma.addresses.create({
      data: {
        address_line1: address.address_line1,
        address_line2: address.address_line2,
        city: address.city,
        state_province: address.state_province,
        country_code: address.country_code,
        postal_code: address.postal_code,
        phone_number: address.phone_number,
        type: address.type as any,
        is_primary: address.is_primary,
        organization_id: address.organization_id,
        store_id: address.store_id,
        user_id: address.user_id,
      },
    });
  }

  // 10. Configurar settings de organizaciones y tiendas
  console.log('⚙️ Configurando settings...');
  
  // Settings de organizaciones
  await prisma.organization_settings.upsert({
    where: { organization_id: techSolutionsOrg.id },
    update: {},
    create: {
      organization_id: techSolutionsOrg.id,
      config: {
        features: {
          multi_store: true,
          advanced_analytics: true,
          custom_domains: true,
          api_access: true
        },
        billing: {
          plan: 'premium',
          billing_cycle: 'monthly',
          payment_method: 'credit_card'
        },
        notifications: {
          email: true,
          sms: false,
          push: true
        }
      }
    },
  });

  await prisma.organization_settings.upsert({
    where: { organization_id: fashionRetailOrg.id },
    update: {},
    create: {
      organization_id: fashionRetailOrg.id,
      config: {
        features: {
          multi_store: true,
          advanced_analytics: false,
          custom_domains: true,
          api_access: false
        },
        billing: {
          plan: 'standard',
          billing_cycle: 'monthly',
          payment_method: 'bank_transfer'
        },
        notifications: {
          email: true,
          sms: true,
          push: false
        }
      }
    },
  });

  // Settings de tiendas
  await prisma.store_settings.upsert({
    where: { store_id: techStore1.id },
    update: {},
    create: {
      store_id: techStore1.id,
      settings: {
        currency: 'COP',
        language: 'es',
        timezone: 'America/Bogota',
        business_hours: {
          monday: { open: '09:00', close: '19:00' },
          tuesday: { open: '09:00', close: '19:00' },
          wednesday: { open: '09:00', close: '19:00' },
          thursday: { open: '09:00', close: '19:00' },
          friday: { open: '09:00', close: '20:00' },
          saturday: { open: '10:00', close: '18:00' },
          sunday: { open: '11:00', close: '16:00' }
        },
        shipping: {
          enabled: true,
          free_shipping_threshold: 100000,
          shipping_zones: ['Bogotá', 'Medellín', 'Cali']
        },
        payments: {
          accepted_methods: ['credit_card', 'debit_card', 'cash'],
          cash_on_delivery: true
        }
      }
    },
  });

  await prisma.store_settings.upsert({
    where: { store_id: fashionStore1.id },
    update: {},
    create: {
      store_id: fashionStore1.id,
      settings: {
        currency: 'COP',
        language: 'es',
        timezone: 'America/Bogota',
        business_hours: {
          monday: { open: '10:00', close: '20:00' },
          tuesday: { open: '10:00', close: '20:00' },
          wednesday: { open: '10:00', close: '20:00' },
          thursday: { open: '10:00', close: '20:00' },
          friday: { open: '10:00', close: '21:00' },
          saturday: { open: '10:00', close: '21:00' },
          sunday: { open: '11:00', close: '19:00' }
        },
        shipping: {
          enabled: true,
          free_shipping_threshold: 150000,
          shipping_zones: ['Nacional']
        },
        payments: {
          accepted_methods: ['credit_card', 'debit_card'],
          cash_on_delivery: false
        }
      }
    },
  });

  console.log('🎉 Seed mejorado completado exitosamente!');
  console.log('');
  console.log('📊 RESUMEN DEL SEED:');
  console.log(`🏢 Organizaciones creadas: ${createdOrganizations.length}`);
  console.log(`🏬 Tiendas creadas: ${createdStores.length}`);
  console.log(`👤 Usuarios creados: ${createdUsers.length}`);
  console.log(`🔗 Relaciones store_users: ${storeUsers.length}`);
  console.log(`🌐 Dominios configurados: ${domainSettings.length}`);
  console.log(`📍 Direcciones creadas: ${addresses.length}`);
  console.log('');
  console.log('🔑 CREDENCIALES DE PRUEBA:');
  console.log('Super Admin: superadmin@vendix.com / 1125634q');
  console.log('Tech Owner: owner@techsolutions.co / 1125634q');
  console.log('Fashion Owner: owner@fashionretail.com / 1125634q');
  console.log('Customer: cliente1@example.com / 1125634q');
  console.log('');
  console.log('🌐 URLS DE PRUEBA:');
  console.log('Vendix: vendix.com');
  console.log('Tech Solutions: techsolutions.co');
  console.log('Fashion Retail: fashionretail.com');
  console.log('Tienda Online Tech: tienda.techsolutions.co');
  console.log('Tienda Online Fashion: moda.fashionretail.com');
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });