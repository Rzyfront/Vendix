import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de la base de datos...');

  // 0. Crear Organización Principal para los usuarios de prueba
  console.log('🏢 Creando organización principal para el seed...');
  const seedOrganization = await prisma.organizations.upsert({
    where: { slug: 'vendix-corp' },
    update: {},
    create: {
      name: 'Vendix Corp',
      slug: 'vendix-corp',
      email: 'admin@vendix.com',
      state: 'active',
    },
  });

  // 1. Crear permisos
  console.log('📝 Creando permisos...');
  const permissions = [
    // Usuarios
    { name: 'users.read', description: 'Ver usuarios', path: '/api/users', method: 'GET' },
    { name: 'users.create', description: 'Crear usuarios', path: '/api/users', method: 'POST' },
    { name: 'users.update', description: 'Actualizar usuarios', path: '/api/users/:id', method: 'PUT' },
    { name: 'users.delete', description: 'Eliminar usuarios', path: '/api/users/:id', method: 'DELETE' },
    // ... (otros permisos)
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
    create: { name: 'super_admin', description: 'Super Administrador', is_system_role: true },
  });
  const ownerRole = await prisma.roles.upsert({
    where: { name: 'owner' },
    update: {},
    create: { name: 'owner', description: 'Propietario de la organización', is_system_role: true },
  });
  // ... (otros roles)

  // 3. Asignar permisos a roles (lógica simplificada)
  console.log('🔗 Asignando permisos a roles...');
  const allPermissions = await prisma.permissions.findMany();
  for (const permission of allPermissions) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: superAdminRole.id, permission_id: permission.id } },
      update: {},
      create: { role_id: superAdminRole.id, permission_id: permission.id },
    });
  }

  // 4. Crear usuarios de prueba
  console.log('👤 Creando usuarios de prueba...');
  const hashedPassword = await bcrypt.hash('password123', 10);

  const superAdminUser = await prisma.users.upsert({
    where: { username: 'superadmin' },
    update: {},
    create: {
      email: 'superadmin@vendix.com',
      password: hashedPassword,
      first_name: 'Super',
      last_name: 'Admin',
      username: 'superadmin',
      email_verified: true,
      state: 'active',
      organization_id: seedOrganization.id, // Asociar a la organización
    },
  });

  // Asignar rol
  await prisma.user_roles.upsert({
    where: { user_id_role_id: { user_id: superAdminUser.id, role_id: superAdminRole.id } },
    update: {},
    create: { user_id: superAdminUser.id, role_id: superAdminRole.id },
  });

  console.log('✅ Seed completado exitosamente!');
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });