import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedPermissionsResult {
  permissionsCreated: number;
  rolesCreated: number;
  assignmentsCreated: number;
}

export async function seedPermissionsAndRoles(
  prisma?: PrismaClient,
): Promise<SeedPermissionsResult> {
  const client = prisma || getPrismaClient();

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
      path: '/api/organization/onboarding/organization/create',
      method: 'POST',
    },
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
      path: '/api/store/products/bulk/upload',
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

    // Store Settings
    {
      name: 'store:settings:read',
      description: 'Leer configuración de tienda',
      path: '/api/store/settings',
      method: 'GET',
    },
    {
      name: 'store:settings:update',
      description: 'Actualizar configuración de tienda',
      path: '/api/store/settings',
      method: 'PATCH',
    },
    {
      name: 'store:settings:reset',
      description: 'Restablecer configuración de tienda',
      path: '/api/store/settings/reset',
      method: 'POST',
    },
    {
      name: 'store:settings:templates:read',
      description: 'Leer plantillas de configuración',
      path: '/api/store/settings/templates',
      method: 'GET',
    },
    {
      name: 'store:settings:templates:apply',
      description: 'Aplicar plantilla de configuración',
      path: '/api/store/settings/apply-template',
      method: 'POST',
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

  // Get valid permission names from our list
  const validPermissionNames = new Set(permissions.map((p) => p.name));

  // Delete permissions that are not in our list (to avoid conflicts)
  const deletedCount = await client.permissions.deleteMany({
    where: {
      name: {
        notIn: Array.from(validPermissionNames),
      },
    },
  });

  if (deletedCount.count > 0) {
    console.log(`   🧹 Cleaned up ${deletedCount.count} old permissions`);
  }

  // Create permissions
  let permissionsCreated = 0;
  for (const permission of permissions) {
    await client.permissions.upsert({
      where: { name: permission.name },
      update: {
        description: permission.description,
        path: permission.path,
        method: permission.method as any,
      },
      create: {
        name: permission.name,
        description: permission.description,
        path: permission.path,
        method: permission.method as any,
      },
    });
    permissionsCreated++;
  }

  // Mark critical permissions as system permissions
  await client.permissions.updateMany({
    where: {
      OR: [
        { name: { contains: 'super_admin' } },
        { name: { startsWith: 'system.' } },
        { name: { startsWith: 'security.' } },
        { name: { startsWith: 'rate.limiting.' } },
      ],
    },
    data: { is_system_permission: true } as any,
  });

  // Create roles
  const superAdminRole = await client.roles.upsert({
    where: { name: 'super_admin' },
    update: {},
    create: {
      name: 'super_admin',
      description: 'Super Administrador del sistema',
      is_system_role: true,
      organization_id: null as any,
    },
  });

  const ownerRole = await client.roles.upsert({
    where: { name: 'owner' },
    update: {},
    create: {
      name: 'owner',
      description: 'Propietario de la organización',
      is_system_role: true,
    },
  });

  const adminRole = await client.roles.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'Administrador de la organización',
      is_system_role: true,
    },
  });

  const managerRole = await client.roles.upsert({
    where: { name: 'manager' },
    update: {},
    create: {
      name: 'manager',
      description: 'Gerente de tienda',
      is_system_role: true,
    },
  });

  const supervisorRole = await client.roles.upsert({
    where: { name: 'supervisor' },
    update: {},
    create: {
      name: 'supervisor',
      description: 'Supervisor de tienda',
      is_system_role: true,
    },
  });

  const employeeRole = await client.roles.upsert({
    where: { name: 'employee' },
    update: {},
    create: {
      name: 'employee',
      description: 'Empleado de tienda',
      is_system_role: true,
    },
  });

  const customerRole = await client.roles.upsert({
    where: { name: 'customer' },
    update: {},
    create: {
      name: 'customer',
      description: 'Cliente de la tienda',
      is_system_role: true,
    },
  });

  // Ensure system roles have organization_id = null
  await client.roles.updateMany({
    where: { is_system_role: true },
    data: { organization_id: null } as any,
  });

  const rolesCreated = 7;

  // Assign permissions to roles
  const allPermissions = await client.permissions.findMany();
  let assignmentsCreated = 0;

  // Assign all permissions to super_admin
  for (const permission of allPermissions) {
    await client.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: superAdminRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: { role_id: superAdminRole.id, permission_id: permission.id },
    });
    assignmentsCreated++;
  }

  // Assign permissions to owner (full control of their organization)
  const ownerPermissions = allPermissions.filter(
    (p) =>
      !p.name.includes('super_admin') &&
      !p.name.includes('system.test') &&
      !p.name.includes('users.impersonate'),
  );

  for (const permission of ownerPermissions) {
    await client.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: ownerRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: { role_id: ownerRole.id, permission_id: permission.id },
    });
    assignmentsCreated++;
  }

  // Assign permissions to admin (operational management)
  const adminPermissions = allPermissions.filter(
    (p) =>
      (p.name.startsWith('organization:') ||
        p.name.startsWith('store:') ||
        p.name.startsWith('audit.') ||
        p.name.startsWith('email.') ||
        p.name.startsWith('domains.')) &&
      !p.name.includes('super_admin') &&
      !p.name.startsWith('system.') &&
      !p.name.startsWith('security.') &&
      !p.name.startsWith('rate.limiting.') &&
      !p.name.includes('users.impersonate') &&
      !p.name.includes('organization:organizations:delete'),
  );

  for (const permission of adminPermissions) {
    await client.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: adminRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: { role_id: adminRole.id, permission_id: permission.id },
    });
    assignmentsCreated++;
  }

  // Assign permissions to manager (full store management)
  const managerPermissions = allPermissions.filter(
    (p) =>
      p.name.startsWith('store:') ||
      p.name.includes('organization:users:read') ||
      p.name.includes('organization:users:search') ||
      p.name.includes('organization:stores:read') ||
      p.name.includes('organization:stores:settings') ||
      p.name.includes('organization:addresses:read') ||
      p.name.includes('audit.logs') ||
      p.name.includes('email.read') ||
      p.name.includes('email.send') ||
      p.name.includes('auth.login') ||
      p.name.includes('auth.logout') ||
      p.name.includes('auth.profile') ||
      p.name.includes('health.check') ||
      (!p.name.includes('super_admin') &&
        !p.name.includes('organization:roles:') &&
        !p.name.includes('organization:permissions:') &&
        !p.name.includes('organization:organizations:') &&
        !p.name.includes('organization:domains:') &&
        !p.name.includes('security.') &&
        !p.name.includes('rate.limiting.')),
  );

  for (const permission of managerPermissions) {
    await client.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: managerRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: { role_id: managerRole.id, permission_id: permission.id },
    });
    assignmentsCreated++;
  }

  // Assign basic permissions to supervisor
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
    await client.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: supervisorRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: { role_id: supervisorRole.id, permission_id: permission.id },
    });
    assignmentsCreated++;
  }

  // Assign minimum permissions to employee
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
    await client.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: employeeRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: { role_id: employeeRole.id, permission_id: permission.id },
    });
    assignmentsCreated++;
  }

  // Assign permissions to customer
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
    await client.role_permissions.upsert({
      where: {
        role_id_permission_id: {
          role_id: customerRole.id,
          permission_id: permission.id,
        },
      },
      update: {},
      create: { role_id: customerRole.id, permission_id: permission.id },
    });
    assignmentsCreated++;
  }

  return {
    permissionsCreated,
    rolesCreated,
    assignmentsCreated,
  };
}
