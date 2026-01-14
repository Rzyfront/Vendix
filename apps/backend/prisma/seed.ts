import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';
import * as bcrypt from 'bcryptjs';

// Create PostgreSQL connection pool
const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://username:password@localhost:5432/vendix_db?schema=public';
const pool = new pg.Pool({ connectionString });

// Create adapter
const adapter = new PrismaPg(pool);

// Initialize Prisma client with adapter
const prisma = new PrismaClient({ adapter });

// Usaremos any para flexibilidad en el seed

async function main() {


  // Limpiar datos existentes (opcional - comentar en producción)

  // Omitir limpieza por ahora para evitar errores de foreign key
  // await prisma.role_permissions.deleteMany({});
  // await prisma.user_roles.deleteMany({});
  // await prisma.store_users.deleteMany({});
  // await prisma.domain_settings.deleteMany({});
  // await prisma.sales_orders.deleteMany({});
  // await prisma.addresses.deleteMany({});

  const permissions = [
    // Autenticación
    {
      name: 'auth.register.owner',
      description: 'Registrar propietario',
      path: '/api/auth/register-owner',
      method: 'POST',
    },
    {
      name: 'auth.register.customer',
      description: 'Registrar cliente',
      path: '/api/auth/register-customer',
      method: 'POST',
    },
    {
      name: 'auth.register.staff',
      description: 'Registrar personal',
      path: '/api/auth/register-staff',
      method: 'POST',
    },
    {
      name: 'auth.login',
      description: 'Iniciar sesión',
      path: '/api/auth/login',
      method: 'POST',
    },
    {
      name: 'auth.refresh',
      description: 'Refrescar token',
      path: '/api/auth/refresh',
      method: 'POST',
    },
    {
      name: 'auth.profile',
      description: 'Ver perfil',
      path: '/api/auth/profile',
      method: 'GET',
    },
    {
      name: 'auth.logout',
      description: 'Cerrar sesión',
      path: '/api/auth/logout',
      method: 'POST',
    },
    {
      name: 'auth.me',
      description: 'Obtener usuario actual',
      path: '/api/auth/me',
      method: 'GET',
    },
    {
      name: 'auth.verify.email',
      description: 'Verificar email',
      path: '/api/auth/verify-email',
      method: 'POST',
    },
    {
      name: 'auth.resend.verification',
      description: 'Reenviar verificación',
      path: '/api/auth/resend-verification',
      method: 'POST',
    },
    {
      name: 'auth.forgot.owner.password',
      description: 'Olvidé contraseña propietario',
      path: '/api/auth/forgot-owner-password',
      method: 'POST',
    },
    {
      name: 'auth.reset.owner.password',
      description: 'Restablecer contraseña propietario',
      path: '/api/auth/reset-owner-password',
      method: 'POST',
    },
    {
      name: 'auth.change.password',
      description: 'Cambiar contraseña',
      path: '/api/auth/change-password',
      method: 'POST',
    },
    {
      name: 'auth:sessions',
      description: 'Sesiones activas',
      path: '/api/auth/sessions',
      method: 'GET',
    },
    {
      name: 'auth.revoke.session',
      description: 'Revocar sesión',
      path: '/api/auth/sessions/:sessionId',
      method: 'DELETE',
    },
    {
      name: 'organization:onboarding:read',
      description: 'Ver estado de onboarding',
      path: '/api/organization/onboarding/status',
      method: 'GET',
    },
    {
      name: 'organization:onboarding:update',
      description: 'Actualizar/Completar onboarding',
      path: '/api/organization/onboarding/complete',
      method: 'POST',
    },

    // Audit
    {
      name: 'organization:audit:read',
      description: 'Leer logs de auditoría',
      path: '/api/superadmin/admin/audit',
      method: 'GET',
    },

    // Domains
    {
      name: 'organization:domains:create',
      description: 'Crear dominios',
      path: '/api/organization/domains',
      method: 'POST',
    },
    {
      name: 'organization:domains:read',
      description: 'Leer dominios',
      path: '/api/organization/domains',
      method: 'GET',
    },
    {
      name: 'organization:domains:update',
      description: 'Actualizar dominios',
      path: '/api/organization/domains',
      method: 'PUT',
    },
    {
      name: 'organization:domains:delete',
      description: 'Eliminar dominios',
      path: '/api/organization/domains',
      method: 'DELETE',
    },
    {
      name: 'organization:domains:verify',
      description: 'Verificar dominios',
      path: '/api/organization/domains/verify',
      method: 'POST',
    },
    {
      name: 'organization:onboarding:create:organization',
      description: 'Crear organización en onboarding',
      path: '/api/organization/onboarding/organization/create', // Assuming wizard path or similar? The controller has organization/:id/complete etc. Let's check wizard again. 
      method: 'POST',
    },
    // Wait, let's map carefully.
    // OnboardingController has:
    // GET organization/onboarding/status
    // GET organization/onboarding/organization/:organizationId/status
    // POST organization/onboarding/organization/:organizationId/complete
    // PUT organization/onboarding/organization/:organizationId/reset
    // GET organization/onboarding/store/:storeId/status
    // POST organization/onboarding/store/:storeId/complete
    // POT organization/onboarding/store/:storeId/reset

    // OnboardingWizardController has:
    // GET organization/onboarding-wizard/status
    // POST organization/onboarding-wizard/verify-email-status
    // POST organization/onboarding-wizard/select-app-type
    // POST organization/onboarding-wizard/setup-user
    // POST organization/onboarding-wizard/setup-organization
    // POST organization/onboarding-wizard/setup-store
    // POST organization/onboarding-wizard/setup-app-config
    // POST organization/onboarding-wizard/complete

    // The seed entries auth.onboarding.* correspond roughly to the Wizard steps.
    // auth.onboarding.status -> Wizard status
    // auth.onboarding.create.organization -> Wizard setup-organization?
    // auth.onboarding.setup.organization -> Wizard setup-organization?
    // auth.onboarding.create.store -> Wizard setup-store?
    // auth.onboarding.complete -> Wizard complete?

    // I will rename generally to organization:onboarding:wizard:* to be safe and clearer.
    {
      name: 'organization:onboarding:wizard:status',
      description: 'Ver estado onboarding wizard',
      path: '/api/organization/onboarding-wizard/status',
      method: 'GET',
    },
    {
      name: 'organization:onboarding:wizard:setup:organization',
      description: 'Configurar organización en wizard',
      path: '/api/organization/onboarding-wizard/setup-organization',
      method: 'POST',
    },
    {
      name: 'organization:onboarding:wizard:setup:store',
      description: 'Configurar tienda en wizard',
      path: '/api/organization/onboarding-wizard/setup-store',
      method: 'POST',
    },
    {
      name: 'organization:onboarding:wizard:complete',
      description: 'Completar onboarding wizard',
      path: '/api/organization/onboarding-wizard/complete',
      method: 'POST',
    },
    {
      name: 'organization:onboarding:wizard:setup:user',
      description: 'Configurar usuario en wizard',
      path: '/api/organization/onboarding-wizard/setup-user',
      method: 'POST',
    },
    {
      name: 'organization:onboarding:wizard:select-app-type',
      description: 'Seleccionar tipo de app en wizard',
      path: '/api/organization/onboarding-wizard/select-app-type',
      method: 'POST',
    },

    // Usuarios
    {
      name: 'organization:users:create',
      description: 'Crear usuario',
      path: '/api/organization/users',
      method: 'POST',
    },
    {
      name: 'organization:users:read',
      description: 'Leer usuarios',
      path: '/api/organization/users',
      method: 'GET',
    },
    {
      name: 'organization:users:stats',
      description: 'Estadísticas de usuarios',
      path: '/api/organization/users/stats',
      method: 'GET',
    },
    {
      name: 'organization:users:read:one',
      description: 'Leer usuario específico',
      path: '/api/organization/users/:id',
      method: 'GET',
    },
    {
      name: 'organization:users:update',
      description: 'Actualizar usuario',
      path: '/api/organization/users/:id',
      method: 'PATCH',
    },
    {
      name: 'organization:users:delete',
      description: 'Eliminar usuario',
      path: '/api/organization/users/:id',
      method: 'DELETE',
    },
    {
      name: 'organization:users:archive',
      description: 'Archivar usuario',
      path: '/api/organization/users/:id/archive',
      method: 'POST',
    },
    {
      name: 'organization:users:reactivate',
      description: 'Reactivar usuario',
      path: '/api/organization/users/:id/reactivate',
      method: 'POST',
    },
    {
      name: 'organization:users:verify-email',
      description: 'Verificar email de usuario',
      path: '/api/organization/users/:id/verify-email',
      method: 'POST',
    },
    {
      name: 'organization:users:reset-password',
      description: 'Restablecer contraseña de usuario',
      path: '/api/organization/users/:id/reset-password',
      method: 'POST',
    },

    // Organizaciones
    {
      name: 'organization:organizations:create',
      description: 'Crear organización',
      path: '/api/organization/organizations',
      method: 'POST',
    },
    {
      name: 'organization:organizations:read',
      description: 'Leer organizaciones',
      path: '/api/organization/organizations',
      method: 'GET',
    },
    {
      name: 'organization:organizations:read:one',
      description: 'Leer organización específica',
      path: '/api/organization/organizations/:id',
      method: 'GET',
    },
    {
      name: 'organization:organizations:read:slug',
      description: 'Leer organización por slug',
      path: '/api/organization/organizations/slug/:slug',
      method: 'GET',
    },
    {
      name: 'organization:organizations:update',
      description: 'Actualizar organización',
      path: '/api/organization/organizations/:id',
      method: 'PATCH',
    },
    {
      name: 'organization:organizations:delete',
      description: 'Eliminar organización',
      path: '/api/organization/organizations/:id',
      method: 'DELETE',
    },
    {
      name: 'organization:organizations:stats',
      description: 'Estadísticas de organización',
      path: '/api/organization/organizations/:id/stats',
      method: 'GET',
    },

    // Tiendas
    {
      name: 'organization:stores:create',
      description: 'Crear tienda',
      path: '/api/organization/stores',
      method: 'POST',
    },
    {
      name: 'organization:stores:read',
      description: 'Leer tiendas',
      path: '/api/organization/stores',
      method: 'GET',
    },
    {
      name: 'organization:stores:read:one',
      description: 'Leer tienda específica',
      path: '/api/organization/stores/:id',
      method: 'GET',
    },
    {
      name: 'organization:stores:update',
      description: 'Actualizar tienda',
      path: '/api/organization/stores/:id',
      method: 'PATCH',
    },
    {
      name: 'organization:stores:delete',
      description: 'Eliminar tienda',
      path: '/api/organization/stores/:id',
      method: 'DELETE',
    },
    {
      name: 'organization:stores:settings:update',
      description: 'Actualizar configuración de tienda',
      path: '/api/organization/stores/:id/settings',
      method: 'PATCH',
    },
    {
      name: 'organization:stores:stats',
      description: 'Estadísticas de tienda',
      path: '/api/organization/stores/:id/stats',
      method: 'GET',
    },

    // Clientes (Tienda)
    {
      name: 'store:customers:create',
      description: 'Crear cliente en tienda',
      path: '/api/store/customers',
      method: 'POST',
    },
    {
      name: 'store:customers:read',
      description: 'Leer clientes de tienda',
      path: '/api/store/customers',
      method: 'GET',
    },
    {
      name: 'store:customers:update',
      description: 'Actualizar cliente en tienda',
      path: '/api/store/customers/:id',
      method: 'PATCH',
    },
    {
      name: 'store:customers:delete',
      description: 'Eliminar cliente de tienda',
      path: '/api/store/customers/:id',
      method: 'DELETE',
    },

    // Productos
    {
      name: 'store:products:create',
      description: 'Crear producto',
      path: '/api/store/products',
      method: 'POST',
    },
    {
      name: 'store:products:bulk:upload',
      description: 'Carga masiva de productos',
      path: '/api/store/products/bulk/upload/csv',
      method: 'POST',
    },
    {
      name: 'store:products:bulk:template',
      description: 'Descargar plantilla de carga masiva',
      path: '/api/store/products/bulk/template/download',
      method: 'GET',
    },
    {
      name: 'store:products:read',
      description: 'Leer productos',
      path: '/api/store/products',
      method: 'GET',
    },
    {
      name: 'store:products:read:one',
      description: 'Leer producto específico',
      path: '/api/store/products/:id',
      method: 'GET',
    },
    {
      name: 'store:products:read:store',
      description: 'Leer productos de tienda',
      path: '/api/store/products/store/:storeId',
      method: 'GET',
    },
    {
      name: 'store:products:read:slug',
      description: 'Leer producto por slug',
      path: '/api/store/products/slug/:slug/store/:storeId',
      method: 'GET',
    },
    {
      name: 'store:products:update',
      description: 'Actualizar producto',
      path: '/api/store/products/:id',
      method: 'PATCH',
    },
    {
      name: 'store:products:deactivate',
      description: 'Desactivar producto',
      path: '/api/store/products/:id/deactivate',
      method: 'PATCH',
    },
    {
      name: 'store:products:admin_delete',
      description: 'Eliminar producto (admin)',
      path: '/api/store/products/:id',
      method: 'DELETE',
    },
    {
      name: 'store:products:variants:create',
      description: 'Crear variante de producto',
      path: '/api/store/products/:id/variants',
      method: 'POST',
    },
    {
      name: 'store:products:variants:update',
      description: 'Actualizar variante de producto',
      path: '/api/store/products/variants/:variantId',
      method: 'PATCH',
    },
    {
      name: 'store:products:variants:delete',
      description: 'Eliminar variante de producto',
      path: '/api/store/products/variants/:variantId',
      method: 'DELETE',
    },
    {
      name: 'store:products:images:add',
      description: 'Agregar imagen a producto',
      path: '/api/store/products/:id/images',
      method: 'POST',
    },
    {
      name: 'store:products:images:remove',
      description: 'Eliminar imagen de producto',
      path: '/api/store/products/images/:imageId',
      method: 'DELETE',
    },

    // Órdenes
    {
      name: 'store:orders:create',
      description: 'Crear orden',
      path: '/api/store/orders',
      method: 'POST',
    },
    {
      name: 'store:orders:read',
      description: 'Leer órdenes',
      path: '/api/store/orders',
      method: 'GET',
    },
    {
      name: 'store:orders:read:one',
      description: 'Leer orden específica',
      path: '/api/store/orders/:id',
      method: 'GET',
    },
    {
      name: 'store:orders:update',
      description: 'Actualizar orden',
      path: '/api/store/orders/:id',
      method: 'PATCH',
    },
    {
      name: 'store:orders:delete',
      description: 'Eliminar orden',
      path: '/api/store/orders/:id',
      method: 'DELETE',
    },

    // Categorías
    {
      name: 'store:categories:create',
      description: 'Crear categoría',
      path: '/api/store/categories',
      method: 'POST',
    },
    {
      name: 'store:categories:read',
      description: 'Leer categorías',
      path: '/api/store/categories',
      method: 'GET',
    },
    {
      name: 'store:categories:read:one',
      description: 'Leer categoría específica',
      path: '/api/store/categories/:id',
      method: 'GET',
    },
    {
      name: 'store:categories:update',
      description: 'Actualizar categoría',
      path: '/api/store/categories/:id',
      method: 'PATCH',
    },
    {
      name: 'store:categories:delete',
      description: 'Eliminar categoría',
      path: '/api/store/categories/:id',
      method: 'DELETE',
    },

    // Marcas
    {
      name: 'store:brands:create',
      description: 'Crear marca',
      path: '/api/store/brands',
      method: 'POST',
    },
    {
      name: 'store:brands:read',
      description: 'Leer marcas',
      path: '/api/store/brands',
      method: 'GET',
    },
    {
      name: 'store:brands:read:store',
      description: 'Leer marcas de tienda',
      path: '/api/store/brands/store/:storeId',
      method: 'GET',
    },
    {
      name: 'store:brands:read:one',
      description: 'Leer marca específica',
      path: '/api/store/brands/:id',
      method: 'GET',
    },
    {
      name: 'store:brands:read:slug',
      description: 'Leer marca por slug',
      path: '/api/store/brands/slug/:slug/store/:storeId',
      method: 'GET',
    },
    {
      name: 'store:brands:update',
      description: 'Actualizar marca',
      path: '/api/store/brands/:id',
      method: 'PATCH',
    },
    {
      name: 'store:brands:activate',
      description: 'Activar marca',
      path: '/api/store/brands/:id/activate',
      method: 'PATCH',
    },
    {
      name: 'store:brands:deactivate',
      description: 'Desactivar marca',
      path: '/api/store/brands/:id/deactivate',
      method: 'PATCH',
    },
    {
      name: 'store:brands:admin_delete',
      description: 'Eliminar marca (admin)',
      path: '/api/store/brands/:id',
      method: 'DELETE',
    },

    // Proveedores
    {
      name: 'store:suppliers:create',
      description: 'Crear proveedor',
      path: '/api/store/inventory/suppliers',
      method: 'POST',
    },
    {
      name: 'store:suppliers:read',
      description: 'Leer proveedores',
      path: '/api/store/inventory/suppliers',
      method: 'GET',
    },
    {
      name: 'store:suppliers:update',
      description: 'Actualizar proveedor',
      path: '/api/store/inventory/suppliers/:id',
      method: 'PATCH',
    },
    {
      name: 'store:suppliers:delete',
      description: 'Eliminar proveedor',
      path: '/api/store/inventory/suppliers/:id',
      method: 'DELETE',
    },

    // Direcciones (Tienda)
    {
      name: 'store:addresses:create',
      description: 'Crear dirección de tienda',
      path: '/api/store/addresses',
      method: 'POST',
    },
    {
      name: 'store:addresses:read',
      description: 'Leer direcciones de tienda',
      path: '/api/store/addresses',
      method: 'GET',
    },
    {
      name: 'store:addresses:update',
      description: 'Actualizar dirección de tienda',
      path: '/api/store/addresses/:id',
      method: 'PATCH',
    },
    {
      name: 'store:addresses:delete',
      description: 'Eliminar dirección de tienda',
      path: '/api/store/addresses/:id',
      method: 'DELETE',
    },

    // Direcciones
    {
      name: 'organization:addresses:create',
      description: 'Crear dirección',
      path: '/api/organization/addresses',
      method: 'POST',
    },
    {
      name: 'organization:addresses:read',
      description: 'Leer direcciones',
      path: '/api/organization/addresses',
      method: 'GET',
    },
    {
      name: 'organization:addresses:read:store',
      description: 'Leer direcciones de tienda',
      path: '/api/organization/addresses/store/:storeId',
      method: 'GET',
    },
    {
      name: 'organization:addresses:read:one',
      description: 'Leer dirección específica',
      path: '/api/organization/addresses/:id',
      method: 'GET',
    },
    {
      name: 'organization:addresses:update',
      description: 'Actualizar dirección',
      path: '/api/organization/addresses/:id',
      method: 'PATCH',
    },
    {
      name: 'organization:addresses:delete',
      description: 'Eliminar dirección',
      path: '/api/organization/addresses/:id',
      method: 'DELETE',
    },

    // Roles
    {
      name: 'organization:roles:create',
      description: 'Crear rol',
      path: '/api/organization/roles',
      method: 'POST',
    },
    {
      name: 'organization:roles:read',
      description: 'Leer roles',
      path: '/api/organization/roles',
      method: 'GET',
    },
    {
      name: 'organization:roles:stats',
      description: 'Estadísticas de roles',
      path: '/api/organization/roles/stats',
      method: 'GET',
    },
    {
      name: 'organization:roles:read:one',
      description: 'Leer rol específico',
      path: '/api/organization/roles/:id',
      method: 'GET',
    },
    {
      name: 'organization:roles:update',
      description: 'Actualizar rol',
      path: '/api/organization/roles/:id',
      method: 'PATCH',
    },
    {
      name: 'organization:roles:delete',
      description: 'Eliminar rol',
      path: '/api/organization/roles/:id',
      method: 'DELETE',
    },
    {
      name: 'organization:roles:permissions:read',
      description: 'Leer permisos de rol',
      path: '/api/organization/roles/:id/permissions',
      method: 'GET',
    },
    {
      name: 'organization:roles:permissions:assign',
      description: 'Asignar permisos a rol',
      path: '/api/organization/roles/:id/permissions',
      method: 'POST',
    },
    {
      name: 'organization:roles:permissions:remove',
      description: 'Remover permisos de rol',
      path: '/api/organization/roles/:id/permissions',
      method: 'DELETE',
    },
    {
      name: 'organization:roles:assign:user',
      description: 'Asignar rol a usuario',
      path: '/api/organization/roles/assign-to-user',
      method: 'POST',
    },
    {
      name: 'organization:roles:remove:user',
      description: 'Remover rol de usuario',
      path: '/api/organization/roles/remove-from-user',
      method: 'POST',
    },
    {
      name: 'organization:roles:user:permissions',
      description: 'Ver permisos de usuario',
      path: '/api/organization/roles/user/:userId/permissions',
      method: 'GET',
    },
    {
      name: 'organization:roles:user:roles',
      description: 'Ver roles de usuario',
      path: '/api/organization/roles/user/:userId/roles',
      method: 'GET',
    },

    // Permisos
    {
      name: 'organization:permissions:create',
      description: 'Crear permiso',
      path: '/api/superadmin/permissions',
      method: 'POST',
    },
    {
      name: 'organization:permissions:read',
      description: 'Leer permisos',
      path: '/api/superadmin/permissions',
      method: 'GET',
    },
    {
      name: 'organization:permissions:read:one',
      description: 'Leer permiso específico',
      path: '/api/superadmin/permissions/:id',
      method: 'GET',
    },
    {
      name: 'organization:permissions:update',
      description: 'Actualizar permiso',
      path: '/api/superadmin/permissions/:id',
      method: 'PATCH',
    },
    {
      name: 'organization:permissions:delete',
      description: 'Eliminar permiso',
      path: '/api/superadmin/permissions/:id',
      method: 'DELETE',
    },
    {
      name: 'organization:permissions:search:name',
      description: 'Buscar permiso por nombre',
      path: '/api/superadmin/permissions/search/by-name/:name',
      method: 'GET',
    },
    {
      name: 'organization:permissions:search:path',
      description: 'Buscar permiso por ruta y método',
      path: '/api/superadmin/permissions/search/by-path-method',
      method: 'GET',
    },

    // Dominios (Super Admin)
    {
      name: 'domains.create',
      description: 'Crear configuración de dominio',
      path: '/api/superadmin/domains',
      method: 'POST',
    },
    {
      name: 'domains.read',
      description: 'Leer configuraciones de dominio',
      path: '/api/superadmin/domains',
      method: 'GET',
    },
    {
      name: 'domains.read.hostname',
      description: 'Leer configuración por hostname',
      path: '/api/superadmin/domains/hostname/:hostname',
      method: 'GET',
    },
    {
      name: 'domains.read.one',
      description: 'Leer configuración por ID',
      path: '/api/superadmin/domains/:id',
      method: 'GET',
    },
    {
      name: 'domains.update',
      description: 'Actualizar configuración de dominio',
      path: '/api/superadmin/domains/hostname/:hostname',
      method: 'PUT',
    },
    {
      name: 'domains.delete',
      description: 'Eliminar configuración de dominio',
      path: '/api/superadmin/domains/hostname/:hostname',
      method: 'DELETE',
    },
    {
      name: 'domains.duplicate',
      description: 'Duplicar configuración de dominio',
      path: '/api/superadmin/domains/hostname/:hostname/duplicate',
      method: 'POST',
    },
    {
      name: 'domains.read.organization',
      description: 'Leer configuraciones por organización',
      path: '/api/superadmin/domains/organization/:organizationId',
      method: 'GET',
    },
    {
      name: 'domains.read.store',
      description: 'Leer configuraciones por tienda',
      path: '/api/superadmin/domains/store/:storeId',
      method: 'GET',
    },
    {
      name: 'domains.validate',
      description: 'Validar hostname',
      path: '/api/superadmin/domains/validate-hostname',
      method: 'POST',
    },
    {
      name: 'domains.verify',
      description: 'Verificar configuración DNS',
      path: '/api/superadmin/domains/hostname/:hostname/verify',
      method: 'POST',
    },
    {
      name: 'domains.resolve',
      description: 'Resolver configuración de dominio (público)',
      path: '/api/public/domains/resolve/:hostname',
      method: 'GET',
    },
    {
      name: 'domains.check',
      description: 'Verificar disponibilidad de hostname (público)',
      path: '/api/public/domains/check/:hostname',
      method: 'GET',
    },

    // Impuestos
    {
      name: 'store:taxes:create',
      description: 'Crear categoría de impuesto',
      path: '/api/taxes',
      method: 'POST',
    },
    {
      name: 'store:taxes:read',
      description: 'Leer categorías de impuestos',
      path: '/api/taxes',
      method: 'GET',
    },
    {
      name: 'store:taxes:read:one',
      description: 'Leer categoría de impuesto específica',
      path: '/api/taxes/:id',
      method: 'GET',
    },
    {
      name: 'store:taxes:update',
      description: 'Actualizar categoría de impuesto',
      path: '/api/taxes/:id',
      method: 'PATCH',
    },
    {
      name: 'store:taxes:delete',
      description: 'Eliminar categoría de impuesto',
      path: '/api/taxes/:id',
      method: 'DELETE',
    },

    // Auditoría
    {
      name: 'audit.logs',
      description: 'Leer logs de auditoría',
      path: '/api/audit/logs',
      method: 'GET',
    },
    {
      name: 'audit.stats',
      description: 'Leer estadísticas de auditoría',
      path: '/api/audit/stats',
      method: 'GET',
    },

    // Logs de seguridad
    {
      name: 'security.logs.failed',
      description: 'Leer logs de login fallidos',
      path: '/api/security-logs/failed-logins',
      method: 'GET',
    },
    {
      name: 'security.logs.locks',
      description: 'Leer logs de bloqueo de cuentas',
      path: '/api/security-logs/account-locks',
      method: 'GET',
    },
    {
      name: 'security.logs.password',
      description: 'Leer logs de cambios de contraseña',
      path: '/api/security-logs/password-changes',
      method: 'GET',
    },
    {
      name: 'security.logs.suspicious',
      description: 'Leer logs de actividad sospechosa',
      path: '/api/security-logs/suspicious-activity',
      method: 'GET',
    },
    {
      name: 'security.summary',
      description: 'Leer resumen de seguridad',
      path: '/api/security-logs/security-summary',
      method: 'GET',
    },

    // Rate Limiting
    {
      name: 'rate.limiting.status',
      description: 'Ver estado de rate limiting',
      path: '/api/rate-limiting/status',
      method: 'GET',
    },
    {
      name: 'rate.limiting.attempts',
      description: 'Ver intentos de rate limiting',
      path: '/api/rate-limiting/attempts',
      method: 'GET',
    },
    {
      name: 'rate.limiting.reset',
      description: 'Resetear contador de rate limiting',
      path: '/api/rate-limiting/reset',
      method: 'POST',
    },
    {
      name: 'rate.limiting.config',
      description: 'Actualizar configuración de rate limiting',
      path: '/api/rate-limiting/config',
      method: 'PUT',
    },
    {
      name: 'rate.limiting.unblock',
      description: 'Desbloquear IP',
      path: '/api/rate-limiting/blocked',
      method: 'DELETE',
    },

    // Email
    {
      name: 'email.config',
      description: 'Ver configuración de email',
      path: '/api/email/config',
      method: 'GET',
    },
    {
      name: 'email.test',
      description: 'Probar servicio de email',
      path: '/api/email/test',
      method: 'POST',
    },
    {
      name: 'email.test.template',
      description: 'Probar template de email',
      path: '/api/email/test-template',
      method: 'POST',
    },
    {
      name: 'email.switch.provider',
      description: 'Cambiar proveedor de email',
      path: '/api/email/switch-provider',
      method: 'POST',
    },

    // Sistema
    {
      name: 'system.health',
      description: 'Ver salud del sistema',
      path: '/api',
      method: 'GET',
    },
    {
      name: 'system.test',
      description: 'Endpoints de prueba',
      path: '/api/test',
      method: 'GET',
    },
    // Login Attempts
    {
      name: 'organization:login_attempts:read',
      description: 'Leer intentos de login',
      path: '/organization/login-attempts',
      method: 'GET',
    },
    // Payment Policies
    {
      name: 'organization:payment_policies:read',
      description: 'Leer políticas de pago',
      path: '/organization/payment-policies',
      method: 'GET',
    },
    {
      name: 'organization:payment_policies:update',
      description: 'Actualizar políticas de pago',
      path: '/organization/payment-policies',
      method: 'PUT',
    },
    // User Sessions
    {
      name: 'organization:user_sessions:read',
      description: 'Leer sesiones de usuario',
      path: '/organization/sessions',
      method: 'GET',
    },
    {
      name: 'organization:user_sessions:delete',
      description: 'Eliminar sesiones de usuario',
      path: '/organization/sessions',
      method: 'DELETE',
    },
    // Inventario
    {
      name: 'store:inventory:adjustments:create',
      description: 'Crear ajuste de inventario',
      path: '/api/inventory/adjustments',
      method: 'POST',
    },
    {
      name: 'store:inventory:adjustments:read',
      description: 'Leer ajustes de inventario',
      path: '/api/inventory/adjustments',
      method: 'GET',
    },
    {
      name: 'store:inventory:adjustments:approve',
      description: 'Aprobar ajuste de inventario',
      path: '/api/inventory/adjustments/:id/approve',
      method: 'PATCH',
    },
    {
      name: 'store:inventory:adjustments:delete',
      description: 'Eliminar ajuste de inventario',
      path: '/api/inventory/adjustments/:id',
      method: 'DELETE',
    },
    {
      name: 'store:inventory:transactions:create',
      description: 'Crear transacción de inventario',
      path: '/api/inventory/transactions',
      method: 'POST',
    },
    {
      name: 'store:inventory:transactions:read',
      description: 'Leer transacciones de inventario',
      path: '/api/inventory/transactions',
      method: 'GET',
    },
    // Suppliers
    {
      name: 'store:suppliers:create',
      description: 'Crear proveedor',
      path: '/api/store/inventory/suppliers',
      method: 'POST',
    },
    {
      name: 'store:suppliers:read',
      description: 'Leer proveedores',
      path: '/api/store/inventory/suppliers',
      method: 'GET',
    },
    {
      name: 'store:suppliers:update',
      description: 'Actualizar proveedor',
      path: '/api/store/inventory/suppliers/:id',
      method: 'PATCH',
    },
    {
      name: 'store:suppliers:delete',
      description: 'Eliminar proveedor',
      path: '/api/store/inventory/suppliers/:id',
      method: 'DELETE',
    },
    // Store Addresses
    {
      name: 'store:addresses:create',
      description: 'Crear dirección de tienda',
      path: '/api/store/addresses',
      method: 'POST',
    },
    {
      name: 'store:addresses:read',
      description: 'Leer direcciones de tienda',
      path: '/api/store/addresses',
      method: 'GET',
    },
    {
      name: 'store:addresses:update',
      description: 'Actualizar dirección de tienda',
      path: '/api/store/addresses/:id',
      method: 'PATCH',
    },
    {
      name: 'store:addresses:delete',
      description: 'Eliminar dirección de tienda',
      path: '/api/store/addresses/:id',
      method: 'DELETE',
    },
    // Store Management
    {
      name: 'store:stores:create',
      description: 'Crear tienda (Store Level)',
      path: '/api/store/stores',
      method: 'POST',
    },
    {
      name: 'store:stores:read',
      description: 'Leer tienda (Store Level)',
      path: '/api/store/stores',
      method: 'GET',
    },
    {
      name: 'store:stores:update',
      description: 'Actualizar tienda (Store Level)',
      path: '/api/store/stores/:id',
      method: 'PATCH',
    },
    {
      name: 'store:stores:delete',
      description: 'Eliminar tienda (Store Level)',
      path: '/api/store/stores/:id',
      method: 'DELETE',
    },
    // Organization Settings
    {
      name: 'organization:settings:read',
      description: 'Leer configuración de organización',
      path: '/organization/settings',
      method: 'GET',
    },
    {
      name: 'organization:settings:update',
      description: 'Actualizar configuración de organización',
      path: '/organization/settings',
      method: 'PUT',
    },
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

  // Marcar permisos críticos como permisos del sistema
  await prisma.permissions.updateMany({
    where: {
      OR: [
        { name: { contains: 'super_admin' } },
        { name: { startsWith: 'system.' } },
        { name: { startsWith: 'security.' } },
        { name: { startsWith: 'rate.limiting.' } },
      ],
    },
    // @ts-ignore is_system_permission exists in model
    data: { is_system_permission: true },
  });

  // 2. Crear roles

  const superAdminRole = await prisma.roles.upsert({
    where: { name: 'super_admin' },
    update: {},
    create: {
      name: 'super_admin',
      description: 'Super Administrador del sistema',
      is_system_role: true,
      // @ts-ignore
      organization_id: null,
    },
  });
  const ownerRole = await prisma.roles.upsert({
    where: { name: 'owner' },
    update: {},
    create: {
      name: 'owner',
      description: 'Propietario de la organización',
      is_system_role: true,
    },
  });
  const adminRole = await prisma.roles.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'Administrador de la organización',
      is_system_role: true,
    },
  });
  const managerRole = await prisma.roles.upsert({
    where: { name: 'manager' },
    update: {},
    create: {
      name: 'manager',
      description: 'Gerente de tienda',
      is_system_role: true,
    },
  });
  const supervisorRole = await prisma.roles.upsert({
    where: { name: 'supervisor' },
    update: {},
    create: {
      name: 'supervisor',
      description: 'Supervisor de tienda',
      is_system_role: true,
    },
  });
  const employeeRole = await prisma.roles.upsert({
    where: { name: 'employee' },
    update: {},
    create: {
      name: 'employee',
      description: 'Empleado de tienda',
      is_system_role: true,
    },
  });
  const customerRole = await prisma.roles.upsert({
    where: { name: 'customer' },
    update: {},
    create: {
      name: 'customer',
      description: 'Cliente de la tienda',
      is_system_role: true,
    },
  });

  // Asignar organization_id = null a roles del sistema (por si acaso)
  await prisma.roles.updateMany({
    where: { is_system_role: true },
    // @ts-ignore organization_id exists in model
    data: { organization_id: null },
  });

  // 3. Asignar permisos a roles

  const allPermissions = await prisma.permissions.findMany();

  // Asignar todos los permisos al super_admin
  for (const permission of allPermissions) {
    await prisma.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: superAdminRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: { role_id: superAdminRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos al owner (control total de su organización)
  const ownerPermissions = allPermissions.filter(
    (p) =>
      !p.name.includes('super_admin') && // Excluir permisos de superadmin
      !p.name.includes('system.test') && // Excluir endpoints de sistema
      !p.name.includes('users.impersonate'), // Excluir impersonación
  );

  for (const permission of ownerPermissions) {
    await prisma.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: ownerRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: { role_id: ownerRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos al admin (gestión operativa)
  const adminPermissions = allPermissions.filter(
    (p) =>
      // Permitir acceso a todos los dominios de negocio
      (p.name.startsWith('organization:') ||
        p.name.startsWith('store:') ||
        p.name.startsWith('audit.') ||
        p.name.startsWith('email.') ||
        p.name.startsWith('domains.')) &&
      // Exclusiones de seguridad
      !p.name.includes('super_admin') &&
      !p.name.startsWith('system.') &&
      !p.name.startsWith('security.') &&
      !p.name.startsWith('rate.limiting.') &&
      !p.name.includes('users.impersonate') &&
      // Excluir eliminación de la organización (reservado para Owner)
      !p.name.includes('organization:organizations:delete'),
  );

  for (const permission of adminPermissions) {
    await prisma.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: adminRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: { role_id: adminRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos al manager (gestión completa de tienda)
  const managerPermissions = allPermissions.filter(
    (p) =>
      // Acceso completo a todo el dominio store
      p.name.startsWith('store:') ||
      // Gestión limitada de usuarios (solo lectura para contexto)
      p.name.includes('organization:users:read') ||
      p.name.includes('organization:users:search') ||
      // Configuración básica de tienda y organización
      p.name.includes('organization:stores:read') ||
      p.name.includes('organization:stores:settings') ||
      // Contexto organizacional necesario
      p.name.includes('organization:addresses:read') ||
      // Utilidades y seguridad básica
      p.name.includes('audit.logs') ||
      p.name.includes('email.read') ||
      p.name.includes('email.send') ||
      p.name.includes('auth.login') ||
      p.name.includes('auth.logout') ||
      p.name.includes('auth.profile') ||
      p.name.includes('health.check') ||
      // Exclusiones explícitas de roles superiores
      (!p.name.includes('super_admin') &&
        !p.name.includes('organization:roles:') &&
        !p.name.includes('organization:permissions:') &&
        !p.name.includes('organization:organizations:') && // Nada de org management
        !p.name.includes('organization:domains:') &&
        !p.name.includes('security.') &&
        !p.name.includes('rate.limiting.')),
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
      create: { role_id: managerRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos básicos al supervisor
  const supervisorPermissions = allPermissions.filter(
    (p) =>
      p.name.includes('store:orders:') ||
      p.name.includes('store:payments:read') ||
      (p.name.startsWith('store:inventory:') && p.name.includes(':read')) ||
      p.name.includes('store:products:read') ||
      p.name.includes('store:categories:read') ||
      p.name.includes('store:brands:read') ||
      p.name.includes('store:suppliers:read') ||
      p.name.includes('organization:users:read') ||
      p.name.includes('organization:stores:read') ||
      p.name.includes('organization:addresses:read') ||
      p.name.includes('store:addresses:read') ||
      p.name.includes('store:taxes:read'),
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
      create: { role_id: supervisorRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos mínimos al employee
  const employeePermissions = allPermissions.filter(
    (p) =>
      p.name.includes('store:orders:create') ||
      p.name.includes('store:orders:read') ||
      p.name.includes('store:payments:process') ||
      p.name.includes('store:products:read') ||
      p.name.includes('store:categories:read') ||
      p.name.includes('store:brands:read') ||
      p.name.includes('store:customers:read') ||
      p.name.includes('organization:addresses:read') ||
      p.name.includes('store:addresses:read') ||
      p.name.includes('store:taxes:read'),
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
      create: { role_id: employeeRole.id, permission_id: permission.id },
    });
  }

  // Asignar permisos al customer
  const customerPermissions = allPermissions.filter(
    (p) =>
      p.name.includes('auth.login') ||
      p.name.includes('auth.register.customer') ||
      p.name.includes('auth.profile') ||
      p.name.includes('auth.me') ||
      p.name.includes('auth.verify.email') ||
      p.name.includes('auth.resend.verification') ||
      p.name.includes('auth.forgot.owner.password') ||
      p.name.includes('auth.reset.owner.password') ||
      p.name.includes('auth.change.password') ||
      p.name.includes('auth.sessions') ||
      p.name.includes('auth.revoke.session') ||
      p.name.includes('auth.logout') ||
      p.name.includes('store:products:read') ||
      p.name.includes('store:products:read:store') ||
      p.name.includes('store:products:read:slug') ||
      p.name.includes('store:categories:read') ||
      p.name.includes('store:brands:read') ||
      p.name.includes('store:brands:read:store') ||
      p.name.includes('store:brands:read:slug') ||
      p.name.includes('store:orders:create') ||
      p.name.includes('store:orders:read') ||
      p.name.includes('store:orders:read:one') ||
      p.name.includes('organization:addresses:create') ||
      p.name.includes('organization:addresses:read') ||
      p.name.includes('organization:addresses:read:one') ||
      p.name.includes('organization:addresses:update') ||
      p.name.includes('organization:addresses:delete') ||
      p.name.includes('domains.resolve') ||
      p.name.includes('domains.check') ||
      p.name.includes('system.health'),
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
      create: { role_id: customerRole.id, permission_id: permission.id },
    });
  }

  // 3.5. Crear métodos de pago del sistema


  const systemMethods: any[] = [
    {
      name: 'cash',
      display_name: 'Efectivo',
      description: 'Pago en efectivo en punto de venta',
      type: 'cash',
      provider: 'internal',
      is_active: true,
      requires_config: false,
      supported_currencies: ['USD', 'MXN', 'EUR', 'COP'],
      min_amount: 0,
    },
    {
      name: 'stripe_card',
      display_name: 'Tarjeta de Crédito/Débito (Stripe)',
      description: 'Pagos con tarjeta procesados por Stripe',
      type: 'card',
      provider: 'stripe',
      logo_url: 'https://cdn.vendix.com/logos/stripe.png',
      is_active: true,
      requires_config: true,
      config_schema: {
        type: 'object',
        required: ['publishable_key', 'secret_key'],
        properties: {
          publishable_key: {
            type: 'string',
            description: 'Stripe Publishable Key',
          },
          secret_key: {
            type: 'string',
            description: 'Stripe Secret Key',
          },
          webhook_secret: {
            type: 'string',
            description: 'Stripe Webhook Secret',
          },
        },
      },
      supported_currencies: ['USD', 'MXN', 'EUR', 'COP'],
      processing_fee_type: 'percentage',
      processing_fee_value: 2.9,
    },
    {
      name: 'paypal',
      display_name: 'PayPal',
      description: 'Pagos a través de PayPal',
      type: 'paypal',
      provider: 'paypal',
      logo_url: 'https://cdn.vendix.com/logos/paypal.png',
      is_active: true,
      requires_config: true,
      config_schema: {
        type: 'object',
        required: ['client_id', 'client_secret'],
        properties: {
          client_id: {
            type: 'string',
            description: 'PayPal Client ID',
          },
          client_secret: {
            type: 'string',
            description: 'PayPal Client Secret',
          },
          mode: {
            type: 'string',
            enum: ['sandbox', 'live'],
            description: 'PayPal Environment Mode',
          },
        },
      },
      supported_currencies: ['USD', 'EUR', 'COP'],
      processing_fee_type: 'percentage',
      processing_fee_value: 3.4,
    },
    {
      name: 'bank_transfer',
      display_name: 'Transferencia Bancaria',
      description: 'Pago mediante transferencia bancaria',
      type: 'bank_transfer',
      provider: 'internal',
      is_active: true,
      requires_config: true,
      config_schema: {
        type: 'object',
        required: ['bank_name', 'account_number'],
        properties: {
          bank_name: {
            type: 'string',
            description: 'Nombre del banco',
          },
          account_number: {
            type: 'string',
            description: 'Número de cuenta',
          },
          account_holder: {
            type: 'string',
            description: 'Titular de la cuenta',
          },
          swift_code: {
            type: 'string',
            description: 'Código SWIFT/BIC',
          },
          clabe: {
            type: 'string',
            description: 'CLABE interbancaria (México)',
          },
        },
      },
      supported_currencies: ['USD', 'MXN', 'COP'],
    },
    {
      name: 'payment_vouchers',
      display_name: 'Vouchers de Pago',
      description: 'Vouchers o cupones de pago prepagados',
      type: 'voucher',
      provider: 'internal',
      is_active: true,
      requires_config: true,
      config_schema: {
        type: 'object',
        required: ['allow_validation'],
        properties: {
          allow_validation: {
            type: 'boolean',
            description: 'Permitir validación de vouchers',
          },
          require_verification: {
            type: 'boolean',
            description: 'Requerir verificación de vouchers',
          },
          voucher_prefix: {
            type: 'string',
            description: 'Prefijo para códigos de voucher',
          },
          min_amount: {
            type: 'number',
            description: 'Monto mínimo del voucher',
          },
          max_amount: {
            type: 'number',
            description: 'Monto máximo del voucher',
          },
        },
      },
      supported_currencies: ['USD', 'MXN', 'EUR', 'COP'],
      processing_fee_type: 'fixed',
      processing_fee_value: 0,
    },
  ];

  for (const method of systemMethods) {
    const existing = await prisma.system_payment_methods.findUnique({
      where: { name: method.name },
    });

    if (existing) {

      continue;
    }

    await prisma.system_payment_methods.create({
      data: method,
    });


  }

  // 4. Crear múltiples organizaciones

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
      state: 'active',
    },
    {
      name: 'Tech Solutions S.A.',
      slug: 'tech-solutions',
      email: 'contacto@techsolutions.co',
      legal_name: 'Tech Solutions Sociedad Anónima',
      tax_id: '800987654-3',
      phone: '+57-4-7654321',
      website: 'https://techsolutions.vendix.com',
      description: 'Empresa de tecnología y soluciones digitales',
      state: 'active',
    },
    {
      name: 'Fashion Retail Group',
      slug: 'fashion-retail',
      email: 'info@fashionretail.com',
      legal_name: 'Fashion Retail Group Ltda.',
      tax_id: '811223344-5',
      phone: '+57-2-3344556',
      website: 'https://fashionretail.vendix.com',
      description: 'Grupo de retail especializado en moda',
      state: 'active',
    },
    {
      name: 'Gourmet Foods',
      slug: 'gourmet-foods',
      email: 'ventas@gourmetfoods.com',
      legal_name: 'Gourmet Foods Internacional',
      tax_id: '822334455-6',
      phone: '+57-5-4455667',
      website: 'https://gourmetfoods.vendix.com',
      description: 'Distribuidor de alimentos gourmet',
      state: 'draft',
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
      state: 'suspended',
    },
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

  const stores = [
    // Tiendas para Vendix Corp
    {
      name: 'Tienda Principal Vendix',
      slug: 'tienda-principal',
      organization_id: vendixOrg.id,
      store_code: 'VNDX001',
      store_type: 'online',
      is_active: true,
      timezone: 'America/Bogota',
    },
    {
      name: 'Vendix Centro',
      slug: 'vendix-centro',
      organization_id: vendixOrg.id,
      store_code: 'VNDX002',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota',
    },

    // Tiendas para Tech Solutions
    {
      name: 'Tech Solutions Bogotá',
      slug: 'tech-bogota',
      organization_id: techSolutionsOrg.id,
      store_code: 'TECH001',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota',
    },
    {
      name: 'Tech Solutions Medellín',
      slug: 'tech-medellin',
      organization_id: techSolutionsOrg.id,
      store_code: 'TECH002',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota',
    },
    {
      name: 'Tienda Online Tech',
      slug: 'tech-online',
      organization_id: techSolutionsOrg.id,
      store_code: 'TECH003',
      store_type: 'online',
      is_active: true,
      timezone: 'America/Bogota',
    },

    // Tiendas para Fashion Retail
    {
      name: 'Fashion Retail Norte',
      slug: 'fashion-norte',
      organization_id: fashionRetailOrg.id,
      store_code: 'FSHN001',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota',
    },
    {
      name: 'Fashion E-commerce',
      slug: 'fashion-online',
      organization_id: fashionRetailOrg.id,
      store_code: 'FSHN002',
      store_type: 'online',
      is_active: true,
      timezone: 'America/Bogota',
    },

    // Tiendas para Gourmet Foods
    {
      name: 'Gourmet Foods Principal',
      slug: 'gourmet-principal',
      organization_id: gourmetFoodsOrg.id,
      store_code: 'GRMT001',
      store_type: 'physical',
      is_active: false,
      timezone: 'America/Bogota',
    },

    // Tiendas para Home & Living
    {
      name: 'Home & Living Centro',
      slug: 'home-centro',
      organization_id: homeLivingOrg.id,
      store_code: 'HOME001',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota',
    },
  ];

  const createdStores: any[] = [];
  for (const store of stores) {
    const createdStore = await prisma.stores.upsert({
      where: {
        organization_id_slug: {
          organization_id: store.organization_id,
          slug: store.slug,
        },
      },
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
      roles: [customerRole.id],
    },
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
        organizations: {
          connect: { id: user.organization_id },
        },
      },
    });
    // Asignar roles
    for (const roleId of user.roles) {
      await prisma.user_roles.upsert({
        where: {
          user_id_role_id: { user_id: createdUser.id, role_id: roleId },
        },
        update: {},
        create: { user_id: createdUser.id, role_id: roleId },
      });
    }
    // Configuración de user_settings según rol
    let app = 'VENDIX_LANDING';
    let panel_ui = {};

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
        }
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
        }
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
        }
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
        }
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
        }
      };
    } else {
      // Otros roles (supervisor, employee, etc.)
      app = 'VENDIX_LANDING';
      panel_ui = {
        VENDIX_LANDING: {
          dashboard: false,
        }
      };
    }

    await prisma.user_settings.upsert({
      where: { user_id: createdUser.id },
      update: {},
      create: {
        user_id: createdUser.id,
        config: {
          app,
          panel_ui: panel_ui,
          preferences: {
            language: 'es',
            theme: 'aura'
          }
        },
      },
    });
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
      where: {
        store_id_user_id: {
          store_id: storeUser.store_id,
          user_id: storeUser.user_id,
        },
      },
      update: {},
      create: {
        store_id: storeUser.store_id,
        user_id: storeUser.user_id,
      },
    });
  }

  // 8. Configurar dominios

  const domainSettings = [
    // Dominio principal de Vendix (.online - PRODUCCIÓN DEFAULT)
    {
      hostname: 'vendix.online',
      organization_id: vendixOrg.id,
      store_id: null,
      domain_type: 'vendix_core',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        branding: {
          name: 'Vendix',
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
          cors_origins: [
            'http://vendix.online',
            'https://vendix.online',
            'http://api.vendix.online',
            'https://api.vendix.online',
          ],
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
        app: 'VENDIX_LANDING',
      },
    },

    // Dominio de Vendix (.com)
    {
      hostname: 'vendix.com',
      organization_id: vendixOrg.id,
      store_id: null,
      domain_type: 'vendix_core',
      is_primary: false,
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
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
        app: 'VENDIX_LANDING',
      },
    },

    // Dominios de organizaciones
    {
      hostname: 'techsolutions.vendix.com',
      organization_id: techSolutionsOrg.id,
      store_id: null,
      domain_type: 'organization',
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
          cors_origins: [
            'https://techsolutions.vendix.com',
            'https://admin-techsolutions.vendix.com',
          ],
          session_timeout: 7200000,
          max_login_attempts: 3,
        },
        app: 'ORG_LANDING',
      },
    },
    {
      hostname: 'admin-techsolutions.vendix.com',
      organization_id: techSolutionsOrg.id,
      store_id: null,
      domain_type: 'organization',
      is_primary: false,
      status: 'active',
      ssl_status: 'issued',
      config: {
        app: 'ORG_ADMIN',
      },
    },

    {
      hostname: 'fashionretail.vendix.com',
      organization_id: fashionRetailOrg.id,
      store_id: null,
      domain_type: 'organization',
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
      },
    },

    // Dominios de tiendas
    {
      hostname: 'tienda-techsolutions.vendix.com',
      organization_id: techSolutionsOrg.id,
      store_id: techStore3.id,
      domain_type: 'ecommerce',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        app: 'STORE_ECOMMERCE',
      },
    },
    {
      hostname: 'moda-fashionretail.vendix.com',
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore2.id,
      domain_type: 'ecommerce',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        app: 'STORE_ECOMMERCE',
      },
    },

    // Dominio pendiente de verificación
    {
      hostname: 'gourmetfoods.vendix.com',
      organization_id: gourmetFoodsOrg.id,
      store_id: null,
      domain_type: 'organization',
      is_primary: true,
      status: 'pending_dns',
      ssl_status: 'pending',
      config: {
        app: 'ORG_LANDING',
      },
    },
  ];

  for (const domain of domainSettings) {
    // Inferir ownership basado en el hostname
    let ownership = 'custom_domain'; // default
    if (
      domain.hostname.endsWith('.vendix.com') ||
      domain.hostname.endsWith('.vendix.online')
    ) {
      const parts = domain.hostname.split('.');
      if (parts.length === 2) {
        ownership = 'vendix_core'; // vendix.com o vendix.online
      } else {
        ownership = 'vendix_subdomain'; // subdominio.vendix.com o subdominio.vendix.online
      }
    } else {
      const parts = domain.hostname.split('.');
      if (parts.length > 2) {
        ownership = 'custom_subdomain'; // subdominio.dominio.com
      } else {
        ownership = 'custom_domain'; // dominio.com
      }
    }

    await prisma.domain_settings.create({
      data: {
        hostname: domain.hostname,
        store_id: domain.store_id,
        domain_type: domain.domain_type as any,
        is_primary: domain.is_primary,
        status: domain.status as any,
        ssl_status: domain.ssl_status as any,
        ownership: ownership as any,
        config: domain.config,
      },
    });
  }

  // 9. Crear direcciones

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
        store_id: address.store_id,
        user_id: address.user_id,
      },
    });
  }

  // 10. Configurar settings de organizaciones y tiendas


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
          api_access: true,
        },
        billing: {
          plan: 'premium',
          billing_cycle: 'monthly',
          payment_method: 'credit_card',
        },
        notifications: {
          email: true,
          sms: false,
          push: true,
        },
      },
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
          api_access: false,
        },
        billing: {
          plan: 'standard',
          billing_cycle: 'monthly',
          payment_method: 'bank_transfer',
        },
        notifications: {
          email: true,
          sms: true,
          push: false,
        },
      },
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
          sunday: { open: '11:00', close: '16:00' },
        },
        shipping: {
          enabled: true,
          free_shipping_threshold: 100000,
          shipping_zones: ['Bogotá', 'Medellín', 'Cali'],
        },
        payments: {
          accepted_methods: ['credit_card', 'debit_card', 'cash'],
          cash_on_delivery: true,
        },
      },
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
          sunday: { open: '11:00', close: '19:00' },
        },
        shipping: {
          enabled: true,
          free_shipping_threshold: 150000,
          shipping_zones: ['Nacional'],
        },
        payments: {
          accepted_methods: ['credit_card', 'debit_card'],
          cash_on_delivery: false,
        },
      },
    },
  });

  // 11. Crear categorías de impuestos

  const taxCategories = [
    {
      name: 'IVA General',
      description: 'Impuesto al valor agregado general 19%',
      rate: 0.19,
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'IVA Reducido',
      description: 'Impuesto al valor agregado reducido 5%',
      rate: 0.05,
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'Exento de IVA',
      description: 'Productos exentos de IVA',
      rate: 0,
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'IVA General Fashion',
      description: 'Impuesto al valor agregado general 19%',
      rate: 0.19,
      organization_id: fashionRetailOrg.id,
    },
  ];

  const createdTaxCategories: any[] = [];
  for (const taxCategory of taxCategories) {
    const createdTaxCategory = await prisma.tax_categories.upsert({
      where: { name: taxCategory.name },
      update: {},
      create: {
        name: taxCategory.name,
        description: taxCategory.description,
        store_id:
          taxCategory.organization_id === techSolutionsOrg.id
            ? techStore1.id
            : fashionStore1.id,
      },
    });
    createdTaxCategories.push(createdTaxCategory);
  }

  // Crear tax rates

  const createdTaxRates: any[] = [];
  for (const taxCategory of taxCategories) {
    const createdTaxRate = await prisma.tax_rates.create({
      data: {
        tax_category_id:
          createdTaxCategories.find((t) => t.name === taxCategory.name)?.id ||
          0,
        store_id:
          taxCategory.organization_id === techSolutionsOrg.id
            ? techStore1.id
            : fashionStore1.id,
        rate: taxCategory.rate,
        name: taxCategory.name,
      },
    });
    createdTaxRates.push(createdTaxRate);
  }

  // 12. Crear categorías

  const categories = [
    // Categorías para Tech Solutions
    {
      name: 'Laptops',
      slug: 'laptops',
      description:
        'Computadoras portátiles de diferentes marcas y especificaciones',
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'Smartphones',
      slug: 'smartphones',
      description: 'Teléfonos inteligentes de última generación',
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'Accesorios',
      slug: 'accesorios',
      description: 'Accesorios para dispositivos electrónicos',
      organization_id: techSolutionsOrg.id,
    },
    {
      name: 'Cargadores y Cables',
      slug: 'cargadores-cables',
      description: 'Cargadores, cables y adaptadores',
      organization_id: techSolutionsOrg.id,
    },

    // Categorías para Fashion Retail
    {
      name: 'Ropa Masculina',
      slug: 'ropa-masculina',
      description: 'Vestimenta para hombres',
      organization_id: fashionRetailOrg.id,
    },
    {
      name: 'Ropa Femenina',
      slug: 'ropa-femenina',
      description: 'Vestimenta para mujeres',
      organization_id: fashionRetailOrg.id,
    },
    {
      name: 'Calzado',
      slug: 'calzado',
      description: 'Zapatos y botas para toda la familia',
      organization_id: fashionRetailOrg.id,
    },
    {
      name: 'Accesorios de Moda',
      slug: 'accesorios-moda',
      description: 'Bolsos, cinturones y otros accesorios',
      organization_id: fashionRetailOrg.id,
    },
  ];

  const createdCategories: any[] = [];
  for (const category of categories) {
    const createdCategory = await prisma.categories.create({
      data: {
        name: category.name,
        slug: category.slug,
        description: category.description,
        store_id:
          category.organization_id === techSolutionsOrg.id
            ? techStore1.id
            : fashionStore1.id,
      },
    });
    createdCategories.push(createdCategory);
  }

  // Update parent-child relationships
  const techAccesoriosCategory = createdCategories.find(
    (c) => c.slug === 'accesorios' && c.organization_id === techSolutionsOrg.id,
  );
  const techCargadoresCategory = createdCategories.find(
    (c) =>
      c.slug === 'cargadores-cables' &&
      c.organization_id === techSolutionsOrg.id,
  );

  // Parent-child relationships handled differently or not needed for now

  // 12. Crear marcas

  const brands = [
    // Marcas para Tech Solutions
    {
      name: 'Apple',
      slug: 'apple',
      description: 'Productos Apple originales',
      organization_id: techSolutionsOrg.id,
      is_featured: true,
    },
    {
      name: 'Samsung',
      slug: 'samsung',
      description: 'Dispositivos y accesorios Samsung',
      organization_id: techSolutionsOrg.id,
      is_featured: true,
    },
    {
      name: 'Dell',
      slug: 'dell',
      description: 'Computadoras y monitores Dell',
      organization_id: techSolutionsOrg.id,
      is_featured: false,
    },
    {
      name: 'HP',
      slug: 'hp',
      description: 'Equipos de cómputo HP',
      organization_id: techSolutionsOrg.id,
      is_featured: false,
    },

    // Marcas para Fashion Retail
    {
      name: 'Nike',
      slug: 'nike',
      description: 'Ropa y calzado deportivo Nike',
      organization_id: fashionRetailOrg.id,
      is_featured: true,
    },
    {
      name: 'Adidas',
      slug: 'adidas',
      description: 'Artículos deportivos Adidas',
      organization_id: fashionRetailOrg.id,
      is_featured: true,
    },
    {
      name: 'Zara',
      slug: 'zara',
      description: 'Moda contemporánea Zara',
      organization_id: fashionRetailOrg.id,
      is_featured: false,
    },
    {
      name: 'Gucci',
      slug: 'gucci',
      description: 'Artículos de lujo Gucci',
      organization_id: fashionRetailOrg.id,
      is_featured: false,
    },
  ];

  const createdBrands: any[] = [];
  for (const brand of brands) {
    const createdBrand = await prisma.brands.upsert({
      where: { name: brand.name },
      update: {},
      create: {
        name: brand.name,
        description: brand.description,
      },
    });
    createdBrands.push(createdBrand);
  }

  // 13. Crear ubicaciones de inventario

  const locations = [
    // Ubicaciones para Tech Solutions
    {
      name: 'Bodega Principal Bogotá',
      code: 'TECH-BOG-001',
      type: 'warehouse',
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      is_active: true,
      addresses: 'Calle 10 # 42-28, Bodega 1',
    },
    {
      name: 'Tienda Tech Bogotá',
      code: 'TECH-BOG-STORE',
      type: 'store',
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      is_active: true,
      addresses: 'Centro Comercial Santafé, Local 205',
    },
    {
      name: 'Bodega Medellín',
      code: 'TECH-MED-001',
      type: 'warehouse',
      organization_id: techSolutionsOrg.id,
      store_id: techStore2.id,
      is_active: true,
      addresses: 'Calle 50 # 30-20, Bodega Central',
    },

    // Ubicaciones para Fashion Retail
    {
      name: 'Bodega Principal',
      code: 'FASH-BOG-001',
      type: 'warehouse',
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore1.id,
      is_active: true,
      addresses: 'Avenida 68 # 22-45, Bodega 2',
    },
    {
      name: 'Tienda Fashion Norte',
      code: 'FASH-BOG-STORE',
      type: 'store',
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore1.id,
      is_active: true,
      addresses: 'Centro Comercial Andino, Local 305',
    },
  ];

  const createdLocations: any[] = [];
  for (const location of locations) {
    const createdLocation = await prisma.inventory_locations.upsert({
      where: {
        organization_id_code: {
          organization_id: location.organization_id,
          code: location.code,
        },
      },
      update: {},
      create: {
        name: location.name,
        code: location.code,
        type: location.type as any,
        store_id: location.store_id,
        organization_id: location.organization_id,
        is_active: location.is_active,
      },
    });
    createdLocations.push(createdLocation);
  }

  const techWarehouseBog = createdLocations.find(
    (l) => l.code === 'TECH-BOG-001',
  );
  const techStoreBog = createdLocations.find(
    (l) => l.code === 'TECH-BOG-STORE',
  );
  const techWarehouseMed = createdLocations.find(
    (l) => l.code === 'TECH-MED-001',
  );
  const fashionWarehouse = createdLocations.find(
    (l) => l.code === 'FASH-BOG-001',
  );
  const fashionStore = createdLocations.find(
    (l) => l.code === 'FASH-BOG-STORE',
  );

  // 14. Crear productos

  const products = [
    // Productos para Tech Solutions
    {
      name: 'MacBook Pro 14"',
      slug: 'macbook-pro-14',
      description: 'Laptop MacBook Pro de 14 pulgadas con chip M3 Pro',
      sku: 'MBP14-M3-512',
      base_price: 4500000,
      cost_price: 3500000,
      weight: 1.6,
      dimensions: { length: 31.26, width: 22.12, height: 1.55 },
      track_inventory: true,
      stock_quantity: 25,
      min_stock_level: 5,
      max_stock_level: 50,
      reorder_point: 10,
      reorder_quantity: 20,
      requires_serial_numbers: true,
      requires_batch_tracking: true,
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      category_id: createdCategories.find(
        (c) =>
          c.slug === 'laptops' && c.organization_id === techSolutionsOrg.id,
      )?.id,
      brand_id: createdBrands.find(
        (b) => b.slug === 'apple' && b.organization_id === techSolutionsOrg.id,
      )?.id,
      status: 'active',
    },
    {
      name: 'iPhone 15 Pro',
      slug: 'iphone-15-pro',
      description: 'iPhone 15 Pro con 256GB de almacenamiento',
      sku: 'IP15P-256-BLK',
      base_price: 5200000,
      cost_price: 4200000,
      weight: 0.221,
      dimensions: { length: 14.67, width: 7.05, height: 0.81 },
      track_inventory: true,
      stock_quantity: 30,
      min_stock_level: 8,
      max_stock_level: 60,
      reorder_point: 15,
      reorder_quantity: 25,
      requires_serial_numbers: true,
      requires_batch_tracking: false,
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      category_id: createdCategories.find(
        (c) =>
          c.slug === 'smartphones' && c.organization_id === techSolutionsOrg.id,
      )?.id,
      brand_id: createdBrands.find(
        (b) => b.slug === 'apple' && b.organization_id === techSolutionsOrg.id,
      )?.id,
      status: 'active',
    },
    {
      name: 'Samsung Galaxy S24',
      slug: 'samsung-galaxy-s24',
      description: 'Samsung Galaxy S24 con 256GB',
      sku: 'SGS24-256-BLU',
      base_price: 3800000,
      cost_price: 3000000,
      weight: 0.167,
      dimensions: { length: 14.7, width: 7.0, height: 0.79 },
      track_inventory: true,
      stock_quantity: 45,
      min_stock_level: 10,
      max_stock_level: 80,
      reorder_point: 20,
      reorder_quantity: 30,
      requires_serial_numbers: true,
      requires_batch_tracking: false,
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      category_id: createdCategories.find(
        (c) =>
          c.slug === 'smartphones' && c.organization_id === techSolutionsOrg.id,
      )?.id,
      brand_id: createdBrands.find(
        (b) =>
          b.slug === 'samsung' && b.organization_id === techSolutionsOrg.id,
      )?.id,
      status: 'active',
    },
    {
      name: 'Cargador USB-C 65W',
      slug: 'cargador-usb-c-65w',
      description: 'Cargador USB-C de 65 watts con GaN',
      sku: 'CHG-USB65-GAN',
      base_price: 150000,
      cost_price: 80000,
      weight: 0.12,
      dimensions: { length: 6.5, width: 6.5, height: 2.8 },
      track_inventory: true,
      stock_quantity: 100,
      min_stock_level: 20,
      max_stock_level: 200,
      reorder_point: 40,
      reorder_quantity: 50,
      requires_serial_numbers: false,
      requires_batch_tracking: true,
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      category_id: createdCategories.find(
        (c) =>
          c.slug === 'cargadores-cables' &&
          c.organization_id === techSolutionsOrg.id,
      )?.id,
      brand_id: createdBrands.find(
        (b) =>
          b.slug === 'samsung' && b.organization_id === techSolutionsOrg.id,
      )?.id,
      status: 'active',
    },

    // Productos para Fashion Retail
    {
      name: 'Nike Air Max 90',
      slug: 'nike-air-max-90',
      description: 'Zapatillas Nike Air Max 90 clásicas',
      sku: 'NAM90-42-BLK',
      base_price: 380000,
      cost_price: 220000,
      weight: 0.35,
      dimensions: { length: 30, width: 20, height: 12 },
      track_inventory: true,
      stock_quantity: 60,
      min_stock_level: 15,
      max_stock_level: 100,
      reorder_point: 25,
      reorder_quantity: 40,
      requires_serial_numbers: false,
      requires_batch_tracking: true,
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore1.id,
      category_id: createdCategories.find(
        (c) =>
          c.slug === 'calzado' && c.organization_id === fashionRetailOrg.id,
      )?.id,
      brand_id: createdBrands.find(
        (b) => b.slug === 'nike' && b.organization_id === fashionRetailOrg.id,
      )?.id,
      status: 'active',
    },
    {
      name: 'Camiseta Adidas Clásica',
      slug: 'camiseta-adidas-clasica',
      description: 'Camiseta deportiva Adidas con logo clásico',
      sku: 'CAD-CLAS-M-BLK',
      base_price: 120000,
      cost_price: 65000,
      weight: 0.18,
      dimensions: { length: 28, width: 25, height: 2 },
      track_inventory: true,
      stock_quantity: 80,
      min_stock_level: 20,
      max_stock_level: 150,
      reorder_point: 30,
      reorder_quantity: 50,
      requires_serial_numbers: false,
      requires_batch_tracking: true,
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore1.id,
      category_id: createdCategories.find(
        (c) =>
          c.slug === 'ropa-masculina' &&
          c.organization_id === fashionRetailOrg.id,
      )?.id,
      brand_id: createdBrands.find(
        (b) => b.slug === 'adidas' && b.organization_id === fashionRetailOrg.id,
      )?.id,
      status: 'active',
    },
  ];

  const createdProducts: any[] = [];
  for (const product of products) {
    const createdProduct = await prisma.products.upsert({
      where: {
        store_id_sku: {
          store_id: product.store_id,
          sku: product.sku || '',
        },
      },
      update: {},
      create: {
        name: product.name,
        description: product.description,
        sku: product.sku,
        base_price: product.base_price,
        slug: product.name.toLowerCase().replace(/\s+/g, '-'),
        store_id: product.store_id,
        product_categories: product.category_id
          ? {
            create: {
              category_id: product.category_id,
            },
          }
          : undefined,
        brand_id: product.brand_id,
      },
    });
    createdProducts.push(createdProduct);
  }

  // Asignar categorías de impuestos a productos

  for (const product of products) {
    const createdProduct = createdProducts.find((p) => p.sku === product.sku);
    if (createdProduct) {
      const taxCategory = createdTaxCategories.find((t) =>
        product.organization_id === techSolutionsOrg.id
          ? t.name === 'IVA General'
          : t.name === 'IVA General Fashion',
      );
      if (taxCategory) {
        await prisma.product_tax_assignments.upsert({
          where: {
            product_id_tax_category_id: {
              product_id: createdProduct.id,
              tax_category_id: taxCategory.id,
            },
          },
          update: {},
          create: {
            product_id: createdProduct.id,
            tax_category_id: taxCategory.id,
          },
        });
      }
    }
  }

  // 15. Crear imágenes de productos

  const productImages = [
    // Imágenes para MacBook Pro
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      image_url:
        'https://images.apple.com/v/macbook-pro-14/aos/compare/mbp-14-space-gray__d7tfgy9fh0om_large.jpg',
      alt_text: 'MacBook Pro 14" Space Gray',
      is_main: true,
      sort_order: 1,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      image_url:
        'https://images.apple.com/v/macbook-pro-14/aos/compare/mbp-14-silver__b5ys8q2q0y2a_large.jpg',
      alt_text: 'MacBook Pro 14" Silver',
      is_main: false,
      sort_order: 2,
    },

    // Imágenes para iPhone 15 Pro
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      image_url:
        'https://www.apple.com/newsroom/images/2023/09/Apple-unveils-iPhone-15-pro-and-iPhone-15-pro-max/article/Apple-iPhone-15-Pro-lineup-hero-230912.jpg.landing-medium.jpg',
      alt_text: 'iPhone 15 Pro Black Titanium',
      is_main: true,
      sort_order: 1,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      image_url:
        'https://store.storeimages.c-apple.com/8756/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-1inch-blue-titanium?wid=5120&hei=2880&fmt=webp&qlt=70&.v=1692923777972',
      alt_text: 'iPhone 15 Pro Blue Titanium',
      is_main: false,
      sort_order: 2,
    },

    // Imágenes para Samsung Galaxy S24
    {
      product_id: createdProducts.find((p) => p.sku === 'SGS24-256-BLU')?.id,
      image_url:
        'https://images.samsung.com/is/image/samsung/p6pim/latin/feature/sm-s906bzkaxto/feature-large-539503735?$FB_TYPE_B_PNG$',
      alt_text: 'Samsung Galaxy S24 Blue',
      is_main: true,
      sort_order: 1,
    },

    // Imágenes para Nike Air Max
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      image_url:
        'https://static.nike.com/a/images/t_PDP_864_v1/f_auto,b_rgb:f5f5f5/8a44cbe5-e4a2-435e-a54c-87e269eb2b0e/air-max-90-shoes-5KqXQW.png',
      alt_text: 'Nike Air Max 90 Black',
      is_main: true,
      sort_order: 1,
    },

    // Imágenes para Camiseta Adidas
    {
      product_id: createdProducts.find((p) => p.sku === 'CAD-CLAS-M-BLK')?.id,
      image_url:
        'https://assets.adidas.com/images/w_600,f_auto,q_auto/5d2b0b7c53674c6daaa9af1c0111e8f1_9366/Camiseta-Clasica-Negro_HQ2421_01_standard.jpg',
      alt_text: 'Camiseta Adidas Clasica Negra',
      is_main: true,
      sort_order: 1,
    },
  ];

  for (const image of productImages) {
    if (image.product_id) {
      await prisma.product_images.create({
        data: {
          product_id: image.product_id,
          image_url: image.image_url,
          is_main: image.is_main,
        },
      });
    }
  }

  // 16. Crear variantes de productos

  const productVariants = [
    // Variantes para MacBook Pro
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      name: 'MacBook Pro 14" - Space Gray',
      sku: 'MBP14-M3-512-SG',
      base_price: 4500000,
      cost_price: 3500000,
      stock_quantity: 10,
      attributes: { color: 'Space Gray', storage: '512GB', ram: '18GB' },
      organization_id: techSolutionsOrg.id,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      name: 'MacBook Pro 14" - Silver',
      sku: 'MBP14-M3-512-SLV',
      base_price: 4500000,
      cost_price: 3500000,
      stock_quantity: 15,
      attributes: { color: 'Silver', storage: '512GB', ram: '18GB' },
      organization_id: techSolutionsOrg.id,
    },

    // Variantes para iPhone 15 Pro
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      name: 'iPhone 15 Pro - Black Titanium',
      sku: 'IP15P-256-BT',
      base_price: 5200000,
      cost_price: 4200000,
      stock_quantity: 12,
      attributes: { color: 'Black Titanium', storage: '256GB' },
      organization_id: techSolutionsOrg.id,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      name: 'iPhone 15 Pro - White Titanium',
      sku: 'IP15P-256-WT',
      base_price: 5200000,
      cost_price: 4200000,
      stock_quantity: 8,
      attributes: { color: 'White Titanium', storage: '256GB' },
      organization_id: techSolutionsOrg.id,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      name: 'iPhone 15 Pro - Blue Titanium',
      sku: 'IP15P-256-BLT',
      base_price: 5200000,
      cost_price: 4200000,
      stock_quantity: 10,
      attributes: { color: 'Blue Titanium', storage: '256GB' },
      organization_id: techSolutionsOrg.id,
    },

    // Variantes para Nike Air Max
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      name: 'Nike Air Max 90 - Talla 42',
      sku: 'NAM90-42-BLK',
      base_price: 380000,
      cost_price: 220000,
      stock_quantity: 20,
      attributes: { size: '42', color: 'Black' },
      organization_id: fashionRetailOrg.id,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      name: 'Nike Air Max 90 - Talla 43',
      sku: 'NAM90-43-BLK',
      base_price: 380000,
      cost_price: 220000,
      stock_quantity: 25,
      attributes: { size: '43', color: 'Black' },
      organization_id: fashionRetailOrg.id,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      name: 'Nike Air Max 90 - Talla 44',
      sku: 'NAM90-44-BLK',
      base_price: 380000,
      cost_price: 220000,
      stock_quantity: 15,
      attributes: { size: '44', color: 'Black' },
      organization_id: fashionRetailOrg.id,
    },

    // Variantes para Camiseta Adidas
    {
      product_id: createdProducts.find((p) => p.sku === 'CAD-CLAS-M-BLK')?.id,
      name: 'Camiseta Adidas - M',
      sku: 'CAD-CLAS-M-BLK',
      base_price: 120000,
      cost_price: 65000,
      stock_quantity: 30,
      attributes: { size: 'M', color: 'Black' },
      organization_id: fashionRetailOrg.id,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'CAD-CLAS-M-BLK')?.id,
      name: 'Camiseta Adidas - L',
      sku: 'CAD-CLAS-L-BLK',
      base_price: 120000,
      cost_price: 65000,
      stock_quantity: 25,
      attributes: { size: 'L', color: 'Black' },
      organization_id: fashionRetailOrg.id,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'CAD-CLAS-M-BLK')?.id,
      name: 'Camiseta Adidas - XL',
      sku: 'CAD-CLAS-XL-BLK',
      base_price: 120000,
      cost_price: 65000,
      stock_quantity: 25,
      attributes: { size: 'XL', color: 'Black' },
      organization_id: fashionRetailOrg.id,
    },
  ];

  const createdVariants: any[] = [];
  for (const variant of productVariants) {
    if (variant.product_id) {
      // Check if variant exists
      const existing = await prisma.product_variants.findFirst({
        where: {
          product_id: variant.product_id,
          sku: variant.sku,
        },
      });

      let createdVariant;
      if (existing) {
        createdVariant = existing;
      } else {
        createdVariant = await prisma.product_variants.create({
          data: {
            product_id: variant.product_id,
            sku: variant.sku,
          },
        });
      }
      createdVariants.push(createdVariant);
    }
  }

  // 16. Crear niveles de stock iniciales

  const stockLevels = [
    // Stock para productos Tech Solutions
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      product_variant_id: null,
      location_id: techWarehouseBog?.id,
      organization_id: techSolutionsOrg.id,
      quantity_available: 20,
      quantity_reserved: 0,
      quantity_on_order: 5,
      min_stock_level: 5,
      max_stock_level: 50,
      reorder_point: 10,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      product_variant_id: null,
      location_id: techWarehouseBog?.id,
      organization_id: techSolutionsOrg.id,
      quantity_available: 25,
      quantity_reserved: 5,
      quantity_on_order: 10,
      min_stock_level: 8,
      max_stock_level: 60,
      reorder_point: 15,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'SGS24-256-BLU')?.id,
      product_variant_id: null,
      location_id: techWarehouseBog?.id,
      organization_id: techSolutionsOrg.id,
      quantity_available: 40,
      quantity_reserved: 5,
      quantity_on_order: 15,
      min_stock_level: 10,
      max_stock_level: 80,
      reorder_point: 20,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'CHG-USB65-GAN')?.id,
      product_variant_id: null,
      location_id: techWarehouseBog?.id,
      organization_id: techSolutionsOrg.id,
      quantity_available: 80,
      quantity_reserved: 20,
      quantity_on_order: 30,
      min_stock_level: 20,
      max_stock_level: 200,
      reorder_point: 40,
    },

    // Stock para productos Fashion Retail
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      product_variant_id: null,
      location_id: fashionWarehouse?.id,
      organization_id: fashionRetailOrg.id,
      quantity_available: 50,
      quantity_reserved: 10,
      quantity_on_order: 20,
      min_stock_level: 15,
      max_stock_level: 100,
      reorder_point: 25,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'CAD-CLAS-M-BLK')?.id,
      product_variant_id: null,
      location_id: fashionWarehouse?.id,
      organization_id: fashionRetailOrg.id,
      quantity_available: 70,
      quantity_reserved: 10,
      quantity_on_order: 25,
      min_stock_level: 20,
      max_stock_level: 150,
      reorder_point: 30,
    },
  ];

  for (const stockLevel of stockLevels) {
    if (stockLevel.product_id && stockLevel.location_id) {
      await prisma.stock_levels.upsert({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: stockLevel.product_id,
            product_variant_id: stockLevel.product_variant_id || 0,
            location_id: stockLevel.location_id,
          },
        },
        update: {},
        create: {
          product_id: stockLevel.product_id,
          product_variant_id: stockLevel.product_variant_id,
          location_id: stockLevel.location_id,
          quantity_available: stockLevel.quantity_available,
          quantity_reserved: stockLevel.quantity_reserved,
          quantity_on_hand:
            stockLevel.quantity_available + stockLevel.quantity_reserved,

          reorder_point: stockLevel.reorder_point,
          max_stock: stockLevel.max_stock_level,
        },
      });
    }
  }

  // 17. Crear lotes de inventario

  const inventoryBatches = [
    {
      batch_number: 'BATCH-MBP-2024-001',
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      product_variant_id: null,
      location_id: techWarehouseBog?.id,
      organization_id: techSolutionsOrg.id,
      quantity: 20,
      quantity_available: 20,
      unit_cost: 3500000,
      expiration_date: null,
      manufacture_date: new Date('2024-01-15'),
      notes: 'Lote inicial MacBook Pro M3',
    },
    {
      batch_number: 'BATCH-IP15-2024-001',
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      product_variant_id: null,
      location_id: techWarehouseBog?.id,
      organization_id: techSolutionsOrg.id,
      quantity: 25,
      quantity_available: 25,
      unit_cost: 4200000,
      expiration_date: null,
      manufacture_date: new Date('2024-02-01'),
      notes: 'Lote inicial iPhone 15 Pro',
    },
    {
      batch_number: 'BATCH-CHG-2024-001',
      product_id: createdProducts.find((p) => p.sku === 'CHG-USB65-GAN')?.id,
      product_variant_id: null,
      location_id: techWarehouseBog?.id,
      organization_id: techSolutionsOrg.id,
      quantity: 80,
      quantity_available: 80,
      unit_cost: 80000,
      expiration_date: null,
      manufacture_date: new Date('2024-01-20'),
      notes: 'Lote inicial cargadores USB-C',
    },
    {
      batch_number: 'BATCH-NIKE-2024-001',
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      product_variant_id: null,
      location_id: fashionWarehouse?.id,
      organization_id: fashionRetailOrg.id,
      quantity: 50,
      quantity_available: 50,
      unit_cost: 220000,
      expiration_date: null,
      manufacture_date: new Date('2024-01-10'),
      notes: 'Lote inicial Nike Air Max 90',
    },
  ];

  const createdBatches: any[] = [];
  for (const batch of inventoryBatches) {
    if (batch.product_id && batch.location_id) {
      const createdBatch = await prisma.inventory_batches.upsert({
        where: {
          product_id_batch_number: {
            product_id: batch.product_id,
            batch_number: batch.batch_number,
          },
        },
        update: {},
        create: {
          batch_number: batch.batch_number,
          product_id: batch.product_id,
          product_variant_id: batch.product_variant_id,
          location_id: batch.location_id,
          quantity: batch.quantity,

          expiration_date: batch.expiration_date,
          manufacturing_date: batch.manufacture_date,
        },
      });
      createdBatches.push(createdBatch);
    }
  }

  // 18. Crear números de serie para productos que lo requieren

  const serialNumbers: any[] = [];

  // Números de serie para MacBook Pro
  const macbookBatch = createdBatches.find(
    (b) => b.batch_number === 'BATCH-MBP-2024-001',
  );
  if (macbookBatch) {
    for (let i = 1; i <= 20; i++) {
      serialNumbers.push({
        serial_number: `MBP-M3-2024-${String(i).padStart(4, '0')}`,
        batch_id: macbookBatch.id,
        product_id: macbookBatch.product_id,
        product_variant_id: null,
        location_id: techWarehouseBog?.id,
        status: 'in_stock',
        cost: 3500000,
      });
    }
  }

  // Números de serie para iPhone 15 Pro
  const iphoneBatch = createdBatches.find(
    (b) => b.batch_number === 'BATCH-IP15-2024-001',
  );
  if (iphoneBatch) {
    for (let i = 1; i <= 25; i++) {
      serialNumbers.push({
        serial_number: `IP15P-2024-${String(i).padStart(4, '0')}`,
        batch_id: iphoneBatch.id,
        product_id: iphoneBatch.product_id,
        product_variant_id: null,
        location_id: techWarehouseBog?.id,
        status: 'in_stock',
        cost: 4200000,
      });
    }
  }

  for (const serialNumber of serialNumbers) {
    await prisma.inventory_serial_numbers.upsert({
      where: {
        serial_number: serialNumber.serial_number,
      },
      update: {},
      create: {
        serial_number: serialNumber.serial_number,
        batch_id: serialNumber.batch_id,
        product_id: serialNumber.product_id,
        product_variant_id: serialNumber.product_variant_id,
        location_id: serialNumber.location_id,
        status: serialNumber.status as any,
        cost: serialNumber.cost,
      },
    });
  }

  // 19. Crear órdenes de prueba


  // Primero crear las direcciones para las órdenes
  const orderAddresses = [
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

  const createdOrderAddresses: any[] = [];
  for (const address of orderAddresses) {
    const createdAddress = await prisma.addresses.create({
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
        user_id: address.user_id,
      },
    });
    createdOrderAddresses.push(createdAddress);
  }

  const orders = [
    {
      order_number: 'ORD-2024-001',
      customer_id: customer1.id,
      organization_id: techSolutionsOrg.id,
      status: 'shipped',
      shipping_address_id: createdOrderAddresses[0]?.id,
      approved_by_user_id: techAdmin.id,
      created_by_user_id: techAdmin.id,
    },
    {
      order_number: 'ORD-2024-002',
      customer_id: customer2.id,
      organization_id: fashionRetailOrg.id,
      status: 'confirmed',
      shipping_address_id: createdOrderAddresses[1]?.id,
      approved_by_user_id: fashionAdmin.id,
      created_by_user_id: fashionAdmin.id,
    },
    {
      order_number: 'ORD-2024-003',
      customer_id: customer1.id,
      organization_id: techSolutionsOrg.id,
      status: 'draft',
      shipping_address_id: createdOrderAddresses[0]?.id,
      approved_by_user_id: techAdmin.id,
      created_by_user_id: techAdmin.id,
    },
  ];

  const createdOrders: any[] = [];
  for (const order of orders) {
    const createdOrder = await prisma.sales_orders.create({
      data: {
        order_number: order.order_number,
        customer_id: order.customer_id,
        organization_id: order.organization_id,
        status: order.status as any,
        shipping_address_id: order.shipping_address_id,
        approved_by_user_id: order.approved_by_user_id,
        created_by_user_id: order.created_by_user_id,
      },
    });
    createdOrders.push(createdOrder);
  }

  // Crear reseñas de productos

  const reviews = [
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      user_id: customer1.id,
      rating: 5,
      comment:
        'El iPhone 15 Pro es increíble, la cámara es fantástica y la batería dura todo el día. Totalmente recomendado.',
      state: 'approved',
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      user_id: customer2.id,
      rating: 4,
      comment:
        'Muy cómodas y de buena calidad. El único detalle es que son un poco pequeñas para la talla indicada.',
      state: 'approved',
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      user_id: customer1.id,
      rating: 5,
      comment:
        'Rendimiento excepcional, pantalla brillante y teclado cómodo. Perfecta para trabajo y creatividad.',
      state: 'approved',
    },
  ];

  for (const review of reviews) {
    if (review.product_id && review.user_id) {
      await prisma.reviews.create({
        data: {
          product_id: review.product_id,
          user_id: review.user_id,
          rating: review.rating,
          comment: review.comment,
          state: review.state as any,
        },
      });
    }
  }

  // 20. Crear transacciones de inventario iniciales

  const inventoryTransactions = [
    {
      product_id: createdProducts.find((p) => p.sku === 'MBP14-M3-512')?.id,
      product_variant_id: null,
      location_id: techWarehouseBog?.id,
      organization_id: techSolutionsOrg.id,
      transaction_type: 'initial',
      quantity: 20,
      reference_type: 'BATCH',
      reference_id: createdBatches.find(
        (b) => b.batch_number === 'BATCH-MBP-2024-001',
      )?.id,
      notes: 'Stock inicial MacBook Pro',
      unit_cost: 3500000,
      batch_id: createdBatches.find(
        (b) => b.batch_number === 'BATCH-MBP-2024-001',
      )?.id,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'IP15P-256-BLK')?.id,
      product_variant_id: null,
      location_id: techWarehouseBog?.id,
      organization_id: techSolutionsOrg.id,
      transaction_type: 'initial',
      quantity: 25,
      reference_type: 'BATCH',
      reference_id: createdBatches.find(
        (b) => b.batch_number === 'BATCH-IP15-2024-001',
      )?.id,
      notes: 'Stock inicial iPhone 15 Pro',
      unit_cost: 4200000,
      batch_id: createdBatches.find(
        (b) => b.batch_number === 'BATCH-IP15-2024-001',
      )?.id,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'CHG-USB65-GAN')?.id,
      product_variant_id: null,
      location_id: techWarehouseBog?.id,
      organization_id: techSolutionsOrg.id,
      transaction_type: 'initial',
      quantity: 80,
      reference_type: 'BATCH',
      reference_id: createdBatches.find(
        (b) => b.batch_number === 'BATCH-CHG-2024-001',
      )?.id,
      notes: 'Stock inicial cargadores USB-C',
      unit_cost: 80000,
      batch_id: createdBatches.find(
        (b) => b.batch_number === 'BATCH-CHG-2024-001',
      )?.id,
    },
    {
      product_id: createdProducts.find((p) => p.sku === 'NAM90-42-BLK')?.id,
      product_variant_id: null,
      location_id: fashionWarehouse?.id,
      organization_id: fashionRetailOrg.id,
      transaction_type: 'initial',
      quantity: 50,
      reference_type: 'BATCH',
      reference_id: createdBatches.find(
        (b) => b.batch_number === 'BATCH-NIKE-2024-001',
      )?.id,
      notes: 'Stock inicial Nike Air Max 90',
      unit_cost: 220000,
      batch_id: createdBatches.find(
        (b) => b.batch_number === 'BATCH-NIKE-2024-001',
      )?.id,
    },
  ];

  for (const transaction of inventoryTransactions) {
    if (transaction.product_id && transaction.location_id) {
      await prisma.inventory_transactions.create({
        data: {
          product_id: transaction.product_id,
          product_variant_id: transaction.product_variant_id,

          type: transaction.transaction_type as any,
          quantity_change: transaction.quantity,

          notes: transaction.notes,
        },
      });
    }
  }




































}

main()
  .catch((e) => {

    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
