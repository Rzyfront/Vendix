import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';
import { syncRolePermissions } from './shared/sync-role-permissions';

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
      path: '/api/organization/onboarding/complete/:id',
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
      name: 'organization:onboarding:update',
      description: 'Actualizar/Completar onboarding',
      path: '/api/organization/onboarding/complete',
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
      description: 'Leer usuarios (listado y detalle)',
      path: '/api/organization/users',
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
      name: 'organization:organizations:read',
      description: 'Leer organizaciones',
      path: '/api/organization/organizations',
      method: 'GET',
    },
    {
      name: 'organization:organizations:update',
      description: 'Actualizar organización',
      path: '/api/organization/organizations/:id',
      method: 'PATCH',
    },

    // Organizations Payment Policies (usado en store/payments)
    {
      name: 'organizations:read',
      description: 'Leer políticas de pago de organización',
      path: '/api/organizations/:organizationId/payment-policies',
      method: 'GET',
    },
    {
      name: 'organizations:update',
      description: 'Actualizar políticas de pago de organización',
      path: '/api/organizations/:organizationId/payment-policies',
      method: 'POST',
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
      name: 'store:products:delete',
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

    // Cotizaciones
    {
      name: 'store:quotations:create',
      description: 'Crear cotización',
      path: '/api/store/quotations',
      method: 'POST',
    },
    {
      name: 'store:quotations:read',
      description: 'Leer cotizaciones',
      path: '/api/store/quotations',
      method: 'GET',
    },
    {
      name: 'store:quotations:read:one',
      description: 'Leer cotización específica',
      path: '/api/store/quotations/:id',
      method: 'GET',
    },
    {
      name: 'store:quotations:update',
      description: 'Actualizar cotización',
      path: '/api/store/quotations/:id',
      method: 'PATCH',
    },
    {
      name: 'store:quotations:delete',
      description: 'Eliminar cotización',
      path: '/api/store/quotations/:id',
      method: 'DELETE',
    },
    {
      name: 'store:quotations:convert',
      description: 'Convertir cotización a orden',
      path: '/api/store/quotations/:id/convert',
      method: 'POST',
    },

    // Planes Separé (Layaway)
    {
      name: 'store:layaway:create',
      description: 'Crear plan separé y registrar pagos',
      path: '/api/store/layaway',
      method: 'POST',
    },
    {
      name: 'store:layaway:read',
      description: 'Leer planes separé y estadísticas',
      path: '/api/store/layaway',
      method: 'GET',
    },
    {
      name: 'store:layaway:update',
      description: 'Modificar cuotas, cancelar o completar planes separé',
      path: '/api/store/layaway/:id',
      method: 'PATCH',
    },

    // Créditos
    {
      name: 'store:credits:create',
      description: 'Crear créditos y registrar pagos de cuotas',
      path: '/api/store/credits',
      method: 'POST',
    },
    {
      name: 'store:credits:read',
      description: 'Leer créditos, estadísticas y reportes',
      path: '/api/store/credits',
      method: 'GET',
    },
    {
      name: 'store:credits:update',
      description: 'Perdonar cuotas y cancelar créditos',
      path: '/api/store/credits/:id',
      method: 'PATCH',
    },

    // Reservas
    {
      name: 'store:reservations:create',
      description: 'Crear reserva',
      path: '/api/store/reservations',
      method: 'POST',
    },
    {
      name: 'store:reservations:read',
      description: 'Ver reservas',
      path: '/api/store/reservations',
      method: 'GET',
    },
    {
      name: 'store:reservations:read:one',
      description: 'Ver detalle de reserva',
      path: '/api/store/reservations/:id',
      method: 'GET',
    },
    {
      name: 'store:reservations:update',
      description: 'Actualizar reserva',
      path: '/api/store/reservations/:id',
      method: 'PATCH',
    },
    {
      name: 'store:reservations:delete',
      description: 'Eliminar reserva',
      path: '/api/store/reservations/:id',
      method: 'DELETE',
    },
    {
      name: 'store:reservations:schedules:manage',
      description: 'Gestionar horarios de servicio',
      path: '/api/store/reservations/schedules/service/:productId',
      method: 'PUT',
    },

    // Remisiones
    {
      name: 'store:dispatch_notes:create',
      description: 'Crear remisión',
      path: '/api/store/dispatch-notes',
      method: 'POST',
    },
    {
      name: 'store:dispatch_notes:read',
      description: 'Leer remisiones',
      path: '/api/store/dispatch-notes',
      method: 'GET',
    },
    {
      name: 'store:dispatch_notes:read:one',
      description: 'Leer remisión específica',
      path: '/api/store/dispatch-notes/:id',
      method: 'GET',
    },
    {
      name: 'store:dispatch_notes:update',
      description: 'Actualizar remisión',
      path: '/api/store/dispatch-notes/:id',
      method: 'PATCH',
    },
    {
      name: 'store:dispatch_notes:delete',
      description: 'Eliminar remisión',
      path: '/api/store/dispatch-notes/:id',
      method: 'DELETE',
    },
    {
      name: 'store:dispatch_notes:confirm',
      description: 'Confirmar remisión',
      path: '/api/store/dispatch-notes/:id/confirm',
      method: 'POST',
    },
    {
      name: 'store:dispatch_notes:deliver',
      description: 'Entregar remisión',
      path: '/api/store/dispatch-notes/:id/deliver',
      method: 'POST',
    },
    {
      name: 'store:dispatch_notes:void',
      description: 'Anular remisión',
      path: '/api/store/dispatch-notes/:id/void',
      method: 'POST',
    },
    {
      name: 'store:dispatch_notes:invoice',
      description: 'Facturar remisión',
      path: '/api/store/dispatch-notes/:id/invoice',
      method: 'POST',
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

    // Cupones
    {
      name: 'store:coupons:create',
      description: 'Crear cupón',
      path: '/api/store/coupons',
      method: 'POST',
    },
    {
      name: 'store:coupons:read',
      description: 'Leer cupones',
      path: '/api/store/coupons',
      method: 'GET',
    },
    {
      name: 'store:coupons:read:one',
      description: 'Leer cupón específico',
      path: '/api/store/coupons/:id',
      method: 'GET',
    },
    {
      name: 'store:coupons:update',
      description: 'Actualizar cupón',
      path: '/api/store/coupons/:id',
      method: 'PATCH',
    },
    {
      name: 'store:coupons:delete',
      description: 'Eliminar cupón',
      path: '/api/store/coupons/:id',
      method: 'DELETE',
    },
    {
      name: 'store:coupons:validate',
      description: 'Validar cupón',
      path: '/api/store/coupons/validate',
      method: 'POST',
    },

    // Reseñas
    {
      name: 'store:reviews:read',
      description: 'Leer reseñas',
      path: '/api/store/reviews',
      method: 'GET',
    },
    {
      name: 'store:reviews:read:stats',
      description: 'Ver estadísticas de reseñas',
      path: '/api/store/reviews/stats',
      method: 'GET',
    },
    {
      name: 'store:reviews:read:one',
      description: 'Leer reseña específica',
      path: '/api/store/reviews/:id',
      method: 'GET',
    },
    {
      name: 'store:reviews:moderate',
      description: 'Moderar reseñas (aprobar/rechazar/ocultar)',
      path: '/api/store/reviews/:id/approve',
      method: 'PATCH',
    },
    {
      name: 'store:reviews:delete',
      description: 'Eliminar reseña',
      path: '/api/store/reviews/:id',
      method: 'DELETE',
    },
    {
      name: 'store:reviews:respond',
      description: 'Responder a reseñas',
      path: '/api/store/reviews/:id/response',
      method: 'POST',
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

    // Proveedores (legacy domain: store/suppliers)
    {
      name: 'store:suppliers:create',
      description: 'Crear proveedor',
      path: '/api/store/inventory/suppliers/unique-create/legacy',
      method: 'POST',
    },
    {
      name: 'store:suppliers:update',
      description: 'Actualizar proveedor',
      path: '/api/store/inventory/suppliers/:id/:id',
      method: 'PATCH',
    },
    {
      name: 'store:suppliers:delete',
      description: 'Eliminar proveedor',
      path: '/api/store/inventory/suppliers/:id/:id',
      method: 'DELETE',
    },

    // Direcciones (Tienda)
    {
      name: 'store:addresses:create',
      description: 'Crear dirección de tienda',
      path: '/api/store/addresses/unique-create',
      method: 'POST',
    },
    {
      name: 'store:addresses:read',
      description: 'Leer direcciones de tienda',
      path: '/api/store/addresses/unique-read',
      method: 'GET',
    },
    {
      name: 'store:addresses:update',
      description: 'Actualizar dirección de tienda',
      path: '/api/store/addresses/:id/:id',
      method: 'PATCH',
    },
    {
      name: 'store:addresses:delete',
      description: 'Eliminar dirección de tienda',
      path: '/api/store/addresses/:id/:id',
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
    {
      name: 'store:settings:fiscal_status:read',
      description: 'Leer estado fiscal de tienda',
      path: '/api/store/settings/fiscal-status',
      method: 'GET',
    },
    {
      name: 'store:settings:fiscal_status:write',
      description: 'Gestionar estado fiscal de tienda',
      path: '/api/store/settings/fiscal-status',
      method: 'POST',
    },

    // Metadata y Recolección de Datos
    {
      name: 'store:settings:write',
      description: 'Escribir configuración de tienda (metadata, templates, email)',
      path: '/api/store/settings',
      method: 'POST',
    },
    {
      name: 'store:metadata:read',
      description: 'Leer campos de metadata',
      path: '/api/store/metadata-fields',
      method: 'GET',
    },
    {
      name: 'store:metadata:write',
      description: 'Gestionar campos de metadata',
      path: '/api/store/metadata-fields',
      method: 'POST',
    },
    {
      name: 'store:data_collection:templates:read',
      description: 'Leer plantillas de recolección de datos',
      path: '/api/store/data-collection/templates',
      method: 'GET',
    },
    {
      name: 'store:data_collection:templates:write',
      description: 'Gestionar plantillas de recolección de datos',
      path: '/api/store/data-collection/templates',
      method: 'POST',
    },
    {
      name: 'store:data_collection:submissions:read',
      description: 'Leer formularios enviados de recolección de datos',
      path: '/api/store/data-collection/submissions',
      method: 'GET',
    },
    {
      name: 'store:data_collection:submissions:write',
      description: 'Gestionar formularios de recolección de datos',
      path: '/api/store/data-collection/submissions',
      method: 'POST',
    },
    {
      name: 'store:customers:history:read',
      description: 'Leer historial de consultas del cliente',
      path: '/api/store/customers/:customerId/history',
      method: 'GET',
    },
    {
      name: 'store:customers:history:write',
      description: 'Agregar notas al historial del cliente',
      path: '/api/store/customers/:customerId/history/:bookingId/notes',
      method: 'POST',
    },
    {
      name: 'store:email_templates:read',
      description: 'Leer plantillas de email',
      path: '/api/store/email-templates',
      method: 'GET',
    },
    {
      name: 'store:email_templates:write',
      description: 'Gestionar plantillas de email',
      path: '/api/store/email-templates/:eventType',
      method: 'PUT',
    },
    {
      name: 'store:reservations:write',
      description: 'Escribir reservas (check-in, submissions)',
      path: '/api/store/reservations/:id/check-in',
      method: 'PATCH',
    },

    // Store Domains
    {
      name: 'store:domains:create',
      description: 'Crear dominio de tienda',
      path: '/api/store/domains',
      method: 'POST',
    },
    {
      name: 'store:domains:read',
      description: 'Leer dominios de tienda',
      path: '/api/store/domains',
      method: 'GET',
    },
    {
      name: 'store:domains:update',
      description: 'Actualizar dominio de tienda',
      path: '/api/store/domains/:id',
      method: 'PATCH',
    },
    {
      name: 'store:domains:delete',
      description: 'Eliminar dominio de tienda',
      path: '/api/store/domains/:id',
      method: 'DELETE',
    },

    // Store Ecommerce
    {
      name: 'store:ecommerce:read',
      description: 'Leer configuración de ecommerce',
      path: '/api/store/ecommerce/settings',
      method: 'GET',
    },
    {
      name: 'store:ecommerce:update',
      description: 'Actualizar configuración de ecommerce',
      path: '/api/store/ecommerce/settings',
      method: 'PATCH',
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
      name: 'organization:roles:permissions:read',
      description: 'Leer permisos de rol',
      path: '/api/organization/roles/:id/permissions',
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
    // Stock Transfers
    {
      name: 'store:stock-transfers:create',
      description: 'Crear transferencia de inventario',
      path: '/api/store/stock-transfers',
      method: 'POST',
    },
    {
      name: 'store:stock-transfers:cross-store',
      description:
        'Policy: crear/aprobar transferencias cross-store entre bodegas de distintas tiendas (solo modo organizational). Se evalúa dentro del mismo endpoint POST /api/store/stock-transfers.',
      path: '/policy/stock-transfers/cross-store',
      method: 'POST',
    },
    {
      name: 'store:stock-transfers:read',
      description: 'Leer transferencias de inventario',
      path: '/api/store/stock-transfers',
      method: 'GET',
    },
    {
      name: 'store:stock-transfers:update',
      description: 'Actualizar transferencia de inventario',
      path: '/api/store/stock-transfers/:id',
      method: 'PATCH',
    },
    {
      name: 'store:stock-transfers:delete',
      description: 'Eliminar transferencia de inventario',
      path: '/api/store/stock-transfers/:id',
      method: 'DELETE',
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
    {
      name: 'organization:inventory:set-mode',
      description:
        'Cambiar el modo de inventario de la organización (organizational/independent)',
      path: '/organization/settings/inventory/mode',
      method: 'PATCH',
    },
    // Sección `inventory` de organization_settings (Plan Unificado P3.2)
    // — `costing_method` con precedencia ORG > STORE > default. LIFO rechazado a
    // nivel DTO. ORG_ADMIN/owner heredan ambos por el filtro `organization:*`.
    {
      name: 'organization:settings:inventory:read',
      description:
        'Leer la sección inventory de organization_settings (costing_method, mode, alerts)',
      path: '/organization/settings/inventory',
      method: 'GET',
    },
    {
      name: 'organization:settings:inventory:write',
      description:
        'Actualizar la sección inventory de organization_settings (sólo costing_method por ahora; LIFO rechazado)',
      path: '/organization/settings/inventory',
      method: 'PUT',
    },
    // Inventario org-native (Plan P2 — write parity)
    // Locaciones de inventario a nivel organización (incluye central warehouses).
    {
      name: 'organization:inventory:locations:create',
      description: 'Crear ubicaciones de inventario a nivel organización',
      path: '/api/organization/inventory/locations',
      method: 'POST',
    },
    {
      name: 'organization:inventory:locations:update',
      description: 'Actualizar ubicaciones de inventario a nivel organización',
      path: '/api/organization/inventory/locations/:id',
      method: 'PATCH',
    },
    {
      name: 'organization:inventory:locations:delete',
      description: 'Eliminar ubicaciones de inventario a nivel organización',
      path: '/api/organization/inventory/locations/:id',
      method: 'DELETE',
    },
    // Proveedores a nivel organización (CRUD canónico — store mantiene sólo lectura).
    {
      name: 'organization:inventory:suppliers:create',
      description: 'Crear proveedores a nivel organización',
      path: '/api/organization/inventory/suppliers',
      method: 'POST',
    },
    {
      name: 'organization:inventory:suppliers:update',
      description: 'Actualizar proveedores a nivel organización',
      path: '/api/organization/inventory/suppliers/:id',
      method: 'PATCH',
    },
    {
      name: 'organization:inventory:suppliers:delete',
      description: 'Soft-delete de proveedores a nivel organización',
      path: '/api/organization/inventory/suppliers/:id',
      method: 'DELETE',
    },
    // Ajustes de inventario a nivel organización (delegan a la lógica de store).
    {
      name: 'organization:inventory:adjustments:read',
      description: 'Leer ajustes de inventario a nivel organización',
      path: '/api/organization/inventory/adjustments',
      method: 'GET',
    },
    {
      name: 'organization:inventory:adjustments:create',
      description: 'Crear ajustes de inventario a nivel organización',
      path: '/api/organization/inventory/adjustments',
      method: 'POST',
    },
    {
      name: 'organization:inventory:adjustments:approve',
      description: 'Aprobar ajustes de inventario a nivel organización',
      path: '/api/organization/inventory/adjustments/:id/approve',
      method: 'PATCH',
    },
    {
      name: 'organization:inventory:adjustments:delete',
      description: 'Cancelar/eliminar ajustes de inventario pendientes',
      path: '/api/organization/inventory/adjustments/:id',
      method: 'DELETE',
    },
    // Ledger de transacciones de inventario consolidado por organización.
    {
      name: 'organization:inventory:transactions:read',
      description:
        'Leer el ledger de transacciones de inventario a nivel organización',
      path: '/api/organization/inventory/transactions',
      method: 'GET',
    },
    // Listado consolidado de números de serie a nivel organización (read-only).
    {
      name: 'organization:inventory:serial-numbers:read',
      description:
        'Leer números de serie de inventario consolidados a nivel organización',
      path: '/api/organization/inventory/serial-numbers',
      method: 'GET',
    },
    // Transferencias de inventario org-native — ciclo completo (TWO-STEP §13#1).
    {
      name: 'organization:inventory:transfers:create',
      description:
        'Crear transferencias de inventario cross-store / cross-warehouse',
      path: '/api/organization/inventory/transfers',
      method: 'POST',
    },
    {
      name: 'organization:inventory:transfers:read',
      description: 'Leer transferencias de inventario a nivel organización',
      path: '/api/organization/inventory/transfers',
      method: 'GET',
    },
    {
      name: 'organization:inventory:transfers:approve',
      description:
        'Aprobar una transferencia (no mueve stock — sólo marca aprobada)',
      path: '/api/organization/inventory/transfers/:id/approve',
      method: 'PATCH',
    },
    {
      name: 'organization:inventory:transfers:dispatch',
      description:
        'Despachar una transferencia (decrementa stock de la ubicación origen)',
      path: '/api/organization/inventory/transfers/:id/dispatch',
      method: 'PATCH',
    },
    {
      name: 'organization:inventory:transfers:complete',
      description:
        'Completar una transferencia (incrementa stock de la ubicación destino)',
      path: '/api/organization/inventory/transfers/:id/complete',
      method: 'PATCH',
    },
    {
      name: 'organization:inventory:transfers:cancel',
      description:
        'Cancelar una transferencia en cualquier estado previo a completed',
      path: '/api/organization/inventory/transfers/:id/cancel',
      method: 'PATCH',
    },
    // Lotes de inventario consolidados a nivel organización (read-only, foco en caducidad).
    {
      name: 'organization:inventory:batches:read',
      description: 'Leer lotes de inventario a nivel organización',
      path: '/api/organization/inventory/batches',
      method: 'GET',
    },
    // Operating Scope wizard (Phase 4)
    {
      name: 'organization:settings:operating_scope:read',
      description:
        'Leer el operating_scope vigente, partner flag y audit log reciente',
      path: '/organization/settings/operating-scope',
      method: 'GET',
    },
    {
      name: 'organization:settings:operating_scope:write',
      description:
        'Migrar operating_scope (STORE ↔ ORGANIZATION) vía wizard con audit log',
      path: '/organization/settings/operating-scope/apply',
      method: 'POST',
    },
    {
      name: 'organization:settings:fiscal_scope:read',
      description:
        'Leer el fiscal_scope vigente, operating_scope y audit log reciente',
      path: '/organization/settings/fiscal-scope',
      method: 'GET',
    },
    {
      name: 'organization:settings:fiscal_scope:write',
      description:
        'Migrar fiscal_scope (STORE ↔ ORGANIZATION) vía wizard con audit log',
      path: '/organization/settings/fiscal-scope/apply',
      method: 'POST',
    },
    {
      name: 'organization:settings:fiscal_status:read',
      description: 'Leer estado fiscal de organización',
      path: '/organization/settings/fiscal-status',
      method: 'GET',
    },
    {
      name: 'organization:settings:fiscal_status:write',
      description: 'Gestionar estado fiscal de organización',
      path: '/organization/settings/fiscal-status',
      method: 'POST',
    },

    // Notificaciones (Tienda)
    {
      name: 'store:notifications:read',
      description: 'Leer notificaciones de tienda',
      path: '/api/store/notifications',
      method: 'GET',
    },
    {
      name: 'store:notifications:update',
      description: 'Actualizar notificaciones (marcar leídas, suscripciones)',
      path: '/api/store/notifications',
      method: 'PATCH',
    },

    // POS Access
    {
      name: 'store:pos:access',
      description: 'Acceder al estado de validación de horario POS',
      path: '/api/store/settings/schedule-status',
      method: 'GET',
    },

    // Facturación (Invoicing)
    {
      name: 'invoicing:read',
      description: 'Leer facturación',
      path: '/api/store/invoicing',
      method: 'GET',
    },
    {
      name: 'invoicing:write',
      description: 'Crear/Actualizar facturación',
      path: '/api/store/invoicing',
      method: 'POST',
    },
    {
      name: 'invoicing:delete',
      description: 'Eliminar facturación',
      path: '/api/store/invoicing/:id',
      method: 'DELETE',
    },
    // Promociones
    {
      name: 'store:promotions:read',
      description: 'Leer promociones',
      path: '/api/store/promotions',
      method: 'GET',
    },
    {
      name: 'store:promotions:create',
      description: 'Crear promoción',
      path: '/api/store/promotions',
      method: 'POST',
    },
    {
      name: 'store:promotions:update',
      description: 'Actualizar promoción',
      path: '/api/store/promotions/:id',
      method: 'PATCH',
    },
    {
      name: 'store:promotions:delete',
      description: 'Eliminar promoción',
      path: '/api/store/promotions/:id',
      method: 'DELETE',
    },
    {
      name: 'store:promotions:manage',
      description:
        'Gestionar estado de promociones (activar, pausar, cancelar)',
      path: '/api/store/promotions/:id/activate',
      method: 'POST',
    },

    {
      name: 'store:accounting:account_mappings:create',
      description: 'Crear mapeo de cuentas contables',
      path: '/api/store/accounting/account-mappings',
      method: 'POST',
    },
    {
      name: 'store:accounting:account_mappings:read',
      description: 'Leer mapeo de cuentas contables',
      path: '/api/store/accounting/account-mappings',
      method: 'GET',
    },
    {
      name: 'store:accounting:account_mappings:update',
      description: 'Actualizar mapeo de cuentas contables',
      path: '/api/store/accounting/account-mappings',
      method: 'PATCH',
    },
    {
      name: 'store:accounting:chart_of_accounts:create',
      description: 'Crear plan de cuentas',
      path: '/api/store/accounting/chart-of-accounts',
      method: 'POST',
    },
    {
      name: 'store:accounting:chart_of_accounts:delete',
      description: 'Eliminar plan de cuentas',
      path: '/api/store/accounting/chart-of-accounts',
      method: 'DELETE',
    },
    {
      name: 'store:accounting:chart_of_accounts:read',
      description: 'Leer plan de cuentas',
      path: '/api/store/accounting/chart-of-accounts',
      method: 'GET',
    },
    {
      name: 'store:accounting:chart_of_accounts:update',
      description: 'Actualizar plan de cuentas',
      path: '/api/store/accounting/chart-of-accounts',
      method: 'PATCH',
    },
    {
      name: 'store:accounting:fiscal_periods:create',
      description: 'Crear períodos fiscales',
      path: '/api/store/accounting/fiscal-periods',
      method: 'POST',
    },
    {
      name: 'store:accounting:fiscal_periods:delete',
      description: 'Eliminar períodos fiscales',
      path: '/api/store/accounting/fiscal-periods',
      method: 'DELETE',
    },
    {
      name: 'store:accounting:fiscal_periods:read',
      description: 'Leer períodos fiscales',
      path: '/api/store/accounting/fiscal-periods',
      method: 'GET',
    },
    {
      name: 'store:accounting:fiscal_periods:update',
      description: 'Actualizar períodos fiscales',
      path: '/api/store/accounting/fiscal-periods',
      method: 'PATCH',
    },
    {
      name: 'store:accounting:journal_entries:create',
      description: 'Crear asientos contables',
      path: '/api/store/accounting/journal-entries',
      method: 'POST',
    },
    {
      name: 'store:accounting:journal_entries:delete',
      description: 'Eliminar asientos contables',
      path: '/api/store/accounting/journal-entries',
      method: 'DELETE',
    },
    {
      name: 'store:accounting:journal_entries:post',
      description: 'Publicar asientos contables',
      path: '/api/store/accounting/journal-entries',
      method: 'PATCH',
    },
    {
      name: 'store:accounting:journal_entries:read',
      description: 'Leer asientos contables',
      path: '/api/store/accounting/journal-entries',
      method: 'GET',
    },
    {
      name: 'store:accounting:journal_entries:update',
      description: 'Actualizar asientos contables',
      path: '/api/store/accounting/journal-entries/:id',
      method: 'PATCH',
    },
    {
      name: 'store:accounting:journal_entries:void',
      description: 'Anular asientos contables',
      path: '/api/store/accounting/journal-entries/:id/void',
      method: 'PATCH',
    },
    {
      name: 'store:accounting:reports:read',
      description: 'Leer reportes contables',
      path: '/api/store/accounting/reports',
      method: 'GET',
    },
    {
      name: 'store:analytics:read',
      description: 'Leer análisis',
      path: '/api/store/analytics',
      method: 'GET',
    },
    {
      name: 'store:reports:read',
      description: 'Ver reportes generales',
      path: '/api/store/reports',
      method: 'GET',
    },
    {
      name: 'store:expenses:approve',
      description: 'Approve expenses',
      path: '/api/store/expenses',
      method: 'PATCH',
    },
    {
      name: 'store:expenses:cancel',
      description: 'Cancel expenses',
      path: '/api/store/expenses/:id/cancel',
      method: 'PATCH',
    },
    {
      name: 'store:expenses:create',
      description: 'Create expenses',
      path: '/api/store/expenses',
      method: 'POST',
    },
    {
      name: 'store:expenses:delete',
      description: 'Delete expenses',
      path: '/api/store/expenses',
      method: 'DELETE',
    },
    {
      name: 'store:expenses:pay',
      description: 'Pay expenses',
      path: '/api/store/expenses/:id/pay',
      method: 'PATCH',
    },
    {
      name: 'store:expenses:read',
      description: 'Read expenses',
      path: '/api/store/expenses',
      method: 'GET',
    },
    {
      name: 'store:expenses:reject',
      description: 'Reject expenses',
      path: '/api/store/expenses/:id/reject',
      method: 'PATCH',
    },
    {
      name: 'store:expenses:update',
      description: 'Update expenses',
      path: '/api/store/expenses/:id',
      method: 'PATCH',
    },
    {
      name: 'store:expenses:refund',
      description: 'Refund expenses',
      path: '/api/store/expenses/:id/refund',
      method: 'POST',
    },
    {
      name: 'store:inventory:inventory:create',
      description: 'Create inventory inventory',
      path: '/api/store/inventory/inventory',
      method: 'POST',
    },
    {
      name: 'store:inventory:inventory:read',
      description: 'Read inventory inventory',
      path: '/api/store/inventory/inventory',
      method: 'GET',
    },
    {
      name: 'store:inventory:locations:create',
      description: 'Create inventory locations',
      path: '/api/store/inventory/locations',
      method: 'POST',
    },
    {
      name: 'store:inventory:locations:delete',
      description: 'Delete inventory locations',
      path: '/api/store/inventory/locations',
      method: 'DELETE',
    },
    {
      name: 'store:inventory:locations:read',
      description: 'Read inventory locations',
      path: '/api/store/inventory/locations',
      method: 'GET',
    },
    {
      name: 'store:inventory:locations:update',
      description: 'Update inventory locations',
      path: '/api/store/inventory/locations',
      method: 'PATCH',
    },
    {
      name: 'store:inventory:set-default-location',
      description: 'Set a specific inventory location as the store default',
      path: '/api/store/inventory/locations/:id/set-default',
      method: 'PATCH',
    },
    {
      name: 'store:inventory:movements:create',
      description: 'Create inventory movements',
      path: '/api/store/inventory/movements',
      method: 'POST',
    },
    {
      name: 'store:inventory:movements:read',
      description: 'Read inventory movements',
      path: '/api/store/inventory/movements',
      method: 'GET',
    },
    {
      name: 'store:inventory:serial_numbers:create',
      description: 'Create inventory serial numbers',
      path: '/api/store/inventory/serial-numbers',
      method: 'POST',
    },
    {
      name: 'store:inventory:serial_numbers:delete',
      description: 'Delete inventory serial numbers',
      path: '/api/store/inventory/serial-numbers',
      method: 'DELETE',
    },
    {
      name: 'store:inventory:serial_numbers:read',
      description: 'Read inventory serial numbers',
      path: '/api/store/inventory/serial-numbers',
      method: 'GET',
    },
    {
      name: 'store:inventory:serial_numbers:update',
      description: 'Update inventory serial numbers',
      path: '/api/store/inventory/serial-numbers',
      method: 'PATCH',
    },
    {
      name: 'store:inventory:stock_levels:read',
      description: 'Read inventory stock levels',
      path: '/api/store/inventory/stock-levels',
      method: 'GET',
    },
    {
      name: 'store:inventory:suppliers:create',
      description: 'Create inventory suppliers',
      path: '/api/store/inventory/suppliers/unique-create',
      method: 'POST',
    },
    {
      name: 'store:inventory:suppliers:delete',
      description: 'Delete inventory suppliers',
      path: '/api/store/inventory/suppliers',
      method: 'DELETE',
    },
    {
      name: 'store:inventory:suppliers:read',
      description: 'Read inventory suppliers',
      path: '/api/store/inventory/suppliers/unique-read',
      method: 'GET',
    },
    {
      name: 'store:inventory:suppliers:update',
      description: 'Update inventory suppliers',
      path: '/api/store/inventory/suppliers',
      method: 'PATCH',
    },
    {
      name: 'store:orders:order_flow:create',
      description: 'Create orders order flow',
      path: '/api/store/orders/order-flow',
      method: 'POST',
    },
    {
      name: 'store:orders:order_flow:read',
      description: 'Read orders order flow',
      path: '/api/store/orders/order-flow',
      method: 'GET',
    },
    {
      name: 'store:orders:purchase_orders:approve',
      description: 'Approve orders purchase orders',
      path: '/api/store/orders/purchase-orders',
      method: 'PATCH',
    },
    {
      name: 'store:orders:purchase_orders:cancel',
      description: 'Cancel orders purchase orders',
      path: '/api/store/orders/purchase-orders/:id/cancel',
      method: 'PATCH',
    },
    {
      name: 'store:orders:purchase_orders:create',
      description: 'Create orders purchase orders',
      path: '/api/store/orders/purchase-orders',
      method: 'POST',
    },
    {
      name: 'store:orders:purchase_orders:delete',
      description: 'Delete orders purchase orders',
      path: '/api/store/orders/purchase-orders',
      method: 'DELETE',
    },
    {
      name: 'store:orders:purchase_orders:read',
      description: 'Read orders purchase orders',
      path: '/api/store/orders/purchase-orders',
      method: 'GET',
    },
    {
      name: 'store:orders:purchase_orders:receive',
      description: 'Receive orders purchase orders',
      path: '/api/store/orders/purchase-orders/:id/receive',
      method: 'PATCH',
    },
    {
      name: 'store:orders:purchase_orders:update',
      description: 'Update orders purchase orders',
      path: '/api/store/orders/purchase-orders/:id',
      method: 'PATCH',
    },
    {
      name: 'store:orders:purchase_orders:pay',
      description: 'Register payments for purchase orders',
      path: '/api/store/orders/purchase-orders/:id/payments',
      method: 'POST',
    },
    {
      name: 'store:orders:purchase_orders:attach',
      description: 'Upload and manage purchase order attachments',
      path: '/api/store/orders/purchase-orders/:id/attachments',
      method: 'POST',
    },
    {
      name: 'store:orders:return_orders:cancel',
      description: 'Cancel orders return orders',
      path: '/api/store/orders/return-orders',
      method: 'PATCH',
    },
    {
      name: 'store:orders:return_orders:create',
      description: 'Create orders return orders',
      path: '/api/store/orders/return-orders',
      method: 'POST',
    },
    {
      name: 'store:orders:return_orders:delete',
      description: 'Delete orders return orders',
      path: '/api/store/orders/return-orders',
      method: 'DELETE',
    },
    {
      name: 'store:orders:return_orders:process',
      description: 'Process orders return orders',
      path: '/api/store/orders/return-orders/:id/process',
      method: 'PATCH',
    },
    {
      name: 'store:orders:return_orders:read',
      description: 'Read orders return orders',
      path: '/api/store/orders/return-orders',
      method: 'GET',
    },
    {
      name: 'store:orders:return_orders:update',
      description: 'Update orders return orders',
      path: '/api/store/orders/return-orders/:id',
      method: 'PATCH',
    },
    {
      name: 'store:orders:sales_orders:cancel',
      description: 'Cancel orders sales orders',
      path: '/api/store/orders/sales-orders',
      method: 'PATCH',
    },
    {
      name: 'store:orders:sales_orders:confirm',
      description: 'Confirm orders sales orders',
      path: '/api/store/orders/sales-orders',
      method: 'GET',
    },
    {
      name: 'store:orders:sales_orders:create',
      description: 'Create orders sales orders',
      path: '/api/store/orders/sales-orders',
      method: 'POST',
    },
    {
      name: 'store:orders:sales_orders:delete',
      description: 'Delete orders sales orders',
      path: '/api/store/orders/sales-orders',
      method: 'DELETE',
    },
    {
      name: 'store:orders:sales_orders:invoice',
      description: 'Invoice orders sales orders',
      path: '/api/store/orders/sales-orders/:id/invoice',
      method: 'PATCH',
    },
    {
      name: 'store:orders:sales_orders:read',
      description: 'Read orders sales orders',
      path: '/api/store/orders/sales-orders/unique-read',
      method: 'GET',
    },
    {
      name: 'store:orders:sales_orders:ship',
      description: 'Ship orders sales orders',
      path: '/api/store/orders/sales-orders/:id/ship',
      method: 'PATCH',
    },
    {
      name: 'store:orders:sales_orders:update',
      description: 'Update orders sales orders',
      path: '/api/store/orders/sales-orders/:id',
      method: 'PATCH',
    },
    {
      name: 'store:promotions:cancel',
      description: 'Cancel promotions',
      path: '/api/store/promotions',
      method: 'PATCH',
    },

    // Cajas
    {
      name: 'store:cash_registers:read',
      description: 'Leer cajas y sesiones',
      path: '/api/store/cash-registers/unique-read',
      method: 'GET',
    },
    {
      name: 'store:cash_registers:create',
      description: 'Crear caja',
      path: '/api/store/cash-registers/unique-create',
      method: 'POST',
    },
    {
      name: 'store:cash_registers:update',
      description: 'Actualizar caja',
      path: '/api/store/cash-registers/:id/unique-update',
      method: 'PUT',
    },
    {
      name: 'store:cash_registers:delete',
      description: 'Eliminar/desactivar caja',
      path: '/api/store/cash-registers/:id/unique-delete',
      method: 'DELETE',
    },
    {
      name: 'store:cash_registers:open_session',
      description: 'Abrir sesión de caja',
      path: '/api/store/cash-registers/sessions/open',
      method: 'POST',
    },
    {
      name: 'store:cash_registers:close_session',
      description: 'Cerrar sesión de caja',
      path: '/api/store/cash-registers/sessions/:id/close',
      method: 'POST',
    },
    {
      name: 'store:cash_registers:movements',
      description: 'Gestionar movimientos de caja (entrada/salida de efectivo)',
      path: '/api/store/cash-registers/sessions/:id/movements',
      method: 'POST',
    },
    {
      name: 'store:cash_registers:reports',
      description: 'Ver reportes de sesión de caja',
      path: '/api/store/cash-registers/sessions/:id/report',
      method: 'GET',
    },

    // Nómina - Empleados
    {
      name: 'store:payroll:employees:create',
      description: 'Crear empleados',
      path: '/api/store/payroll/employees',
      method: 'POST',
    },
    {
      name: 'store:payroll:employees:read',
      description: 'Leer empleados',
      path: '/api/store/payroll/employees',
      method: 'GET',
    },
    {
      name: 'store:payroll:employees:update',
      description: 'Actualizar empleados',
      path: '/api/store/payroll/employees',
      method: 'PATCH',
    },
    {
      name: 'store:payroll:employees:bulk:upload',
      description: 'Carga masiva de empleados',
      path: '/api/store/payroll/employees/bulk/upload',
      method: 'POST',
    },
    {
      name: 'store:payroll:employees:bulk:template',
      description: 'Descargar plantilla carga masiva empleados',
      path: '/api/store/payroll/employees/bulk/template/download',
      method: 'GET',
    },
    // Nómina - Liquidaciones
    {
      name: 'store:payroll:runs:create',
      description: 'Crear liquidaciones de nómina',
      path: '/api/store/payroll/runs',
      method: 'POST',
    },
    {
      name: 'store:payroll:runs:read',
      description: 'Leer liquidaciones de nómina',
      path: '/api/store/payroll/runs',
      method: 'GET',
    },
    {
      name: 'store:payroll:runs:manage',
      description:
        'Gestionar liquidaciones (calcular, aprobar, enviar, pagar, cancelar)',
      path: '/api/store/payroll/runs',
      method: 'PATCH',
    },
    // Nómina - Reglas
    {
      name: 'store:payroll:rules:read',
      description: 'Leer reglas de nómina',
      path: '/api/store/payroll/rules',
      method: 'GET',
    },
    {
      name: 'store:payroll:rules:update',
      description: 'Actualizar reglas de nómina',
      path: '/api/store/payroll/rules',
      method: 'PATCH',
    },
    // Nómina - Adelantos
    {
      name: 'store:payroll:advances:read',
      description: 'Leer adelantos de empleados',
      path: '/api/store/payroll/advances',
      method: 'GET',
    },
    {
      name: 'store:payroll:advances:create',
      description: 'Crear adelantos de empleados',
      path: '/api/store/payroll/advances',
      method: 'POST',
    },
    {
      name: 'store:payroll:advances:approve',
      description: 'Aprobar/rechazar adelantos',
      path: '/api/store/payroll/advances/:id/approve',
      method: 'PATCH',
    },
    {
      name: 'store:payroll:advances:manage',
      description: 'Gestionar adelantos (cancelar, pagos manuales)',
      path: '/api/store/payroll/advances/:id/cancel',
      method: 'PATCH',
    },
    // Nómina - Liquidaciones de empleado (prestaciones sociales)
    {
      name: 'store:payroll:settlements:read',
      description: 'Leer liquidaciones de empleado',
      path: '/api/store/payroll/settlements',
      method: 'GET',
    },
    {
      name: 'store:payroll:settlements:create',
      description: 'Crear liquidaciones de empleado',
      path: '/api/store/payroll/settlements',
      method: 'POST',
    },
    {
      name: 'store:payroll:settlements:manage',
      description:
        'Gestionar liquidaciones (recalcular, aprobar, pagar, cancelar)',
      path: '/api/store/payroll/settlements',
      method: 'PATCH',
    },

    {
      name: 'superadmin:stores:create',
      description: 'Create stores',
      path: '/api/store/stores/unique-create',
      method: 'POST',
    },
    {
      name: 'superadmin:stores:delete',
      description: 'Delete stores',
      path: '/api/store/stores',
      method: 'DELETE',
    },
    {
      name: 'superadmin:stores:read',
      description: 'Read stores',
      path: '/api/store/stores/unique-read',
      method: 'GET',
    },
    {
      name: 'superadmin:stores:update',
      description: 'Update stores',
      path: '/api/store/stores',
      method: 'PATCH',
    },

    // ──── Cuentas por Cobrar (Cartera) ────
    {
      name: 'store:accounts_receivable:read',
      description: 'Ver cuentas por cobrar',
      path: '/api/store/accounts-receivable',
      method: 'GET',
    },
    {
      name: 'store:accounts_receivable:payment',
      description: 'Registrar cobro en cartera',
      path: '/api/store/accounts-receivable/:id/payment',
      method: 'POST',
    },
    {
      name: 'store:accounts_receivable:agreement',
      description: 'Crear acuerdo de pago',
      path: '/api/store/accounts-receivable/:id/agreement',
      method: 'POST',
    },
    {
      name: 'store:accounts_receivable:write_off',
      description: 'Castigo de cartera',
      path: '/api/store/accounts-receivable/:id/write-off',
      method: 'POST',
    },

    // ──── Cuentas por Pagar (CxP) ────
    {
      name: 'store:accounts_payable:read',
      description: 'Ver cuentas por pagar',
      path: '/api/store/accounts-payable',
      method: 'GET',
    },
    {
      name: 'store:accounts_payable:payment',
      description: 'Registrar pago a proveedor',
      path: '/api/store/accounts-payable/:id/payment',
      method: 'POST',
    },
    {
      name: 'store:accounts_payable:schedule',
      description: 'Programar pago a proveedor',
      path: '/api/store/accounts-payable/:id/schedule',
      method: 'POST',
    },
    {
      name: 'store:accounts_payable:export',
      description: 'Exportar lote bancario de CxP',
      path: '/api/store/accounts-payable/batch-export',
      method: 'POST',
    },
    {
      name: 'store:accounts_payable:write_off',
      description: 'Castigo de CxP',
      path: '/api/store/accounts-payable/:id/write-off',
      method: 'POST',
    },

    // ──── Wallets ────
    {
      name: 'store:wallets:read',
      description: 'Ver wallets de clientes',
      path: '/api/store/wallets',
      method: 'GET',
    },
    {
      name: 'store:wallets:topup',
      description: 'Recargar wallet de cliente',
      path: '/api/store/wallets/:customerId/topup',
      method: 'POST',
    },
    {
      name: 'store:wallets:adjust',
      description: 'Ajustar wallet de cliente',
      path: '/api/store/wallets/:customerId/adjust',
      method: 'POST',
    },

    // ──── Comisiones ────
    {
      name: 'store:commissions:read',
      description: 'Ver reglas y cálculos de comisiones',
      path: '/api/store/commissions',
      method: 'GET',
    },
    {
      name: 'store:commissions:manage',
      description: 'Gestionar reglas de comisiones',
      path: '/api/store/commissions/rules',
      method: 'POST',
    },

    // ──── Cola Virtual ────
    {
      name: 'store:customer_queue:read',
      description: 'Ver cola virtual de clientes',
      path: '/api/store/customer-queue',
      method: 'GET',
    },
    {
      name: 'store:customer_queue:manage',
      description: 'Gestionar cola virtual (seleccionar, consumir, cancelar)',
      path: '/api/store/customer-queue/:id',
      method: 'POST',
    },

    // ──── Exógenos (DIAN) ────
    {
      name: 'exogenous:read',
      description: 'Leer reportes exógenos',
      path: '/api/store/exogenous/reports',
      method: 'GET',
    },
    {
      name: 'exogenous:write',
      description: 'Generar y enviar reportes exógenos',
      path: '/api/store/exogenous/reports/generate',
      method: 'POST',
    },

    // ──── Paystubs (Nómina) ────
    {
      name: 'payroll:read',
      description: 'Leer comprobantes de nómina',
      path: '/api/store/payroll/items/:id/payslip',
      method: 'GET',
    },
    {
      name: 'payroll:write',
      description: 'Generar comprobantes de nómina',
      path: '/api/store/payroll/runs/:id/generate-payslips',
      method: 'POST',
    },

    // ──── ICA ────
    {
      name: 'taxes:ica:read',
      description: 'Leer tasas y calcular ICA',
      path: '/api/store/taxes/ica/rates',
      method: 'GET',
    },
    {
      name: 'taxes:ica:report',
      description: 'Generar reportes de ICA',
      path: '/api/store/taxes/ica/report',
      method: 'GET',
    },

    // ──── Retención en la Fuente ────
    {
      name: 'withholding:read',
      description: 'Leer conceptos y valores de retención',
      path: '/api/store/withholding-tax/concepts',
      method: 'GET',
    },
    {
      name: 'withholding:write',
      description: 'Crear y actualizar conceptos de retención',
      path: '/api/store/withholding-tax/concepts',
      method: 'POST',
    },
    {
      name: 'withholding:delete',
      description: 'Eliminar conceptos de retención',
      path: '/api/store/withholding-tax/concepts/:id',
      method: 'DELETE',
    },

    // ──── Conciliación Bancaria ────
    {
      name: 'store:accounting:bank_reconciliation:read',
      description: 'Leer cuentas bancarias, transacciones y conciliaciones',
      path: '/api/store/accounting/bank-reconciliation/accounts',
      method: 'GET',
    },
    {
      name: 'store:accounting:bank_reconciliation:create',
      description:
        'Crear cuentas bancarias, importar transacciones y conciliaciones',
      path: '/api/store/accounting/bank-reconciliation/accounts',
      method: 'POST',
    },
    {
      name: 'store:accounting:bank_reconciliation:update',
      description: 'Actualizar cuentas bancarias, matcher y conciliaciones',
      path: '/api/store/accounting/bank-reconciliation/reconciliations/:id/auto-match',
      method: 'POST',
    },
    {
      name: 'store:accounting:bank_reconciliation:delete',
      description: 'Eliminar cuentas bancarias, transacciones y conciliaciones',
      path: '/api/store/accounting/bank-reconciliation/accounts/:id',
      method: 'DELETE',
    },

    // ──── Presupuestos ────
    {
      name: 'store:accounting:budgets:read',
      description: 'Leer presupuestos y reportes de variación',
      path: '/api/store/accounting/budgets',
      method: 'GET',
    },
    {
      name: 'store:accounting:budgets:create',
      description: 'Crear presupuestos',
      path: '/api/store/accounting/budgets',
      method: 'POST',
    },
    {
      name: 'store:accounting:budgets:update',
      description: 'Actualizar, aprobar, activar y cerrar presupuestos',
      path: '/api/store/accounting/budgets/:id',
      method: 'PATCH',
    },
    {
      name: 'store:accounting:budgets:delete',
      description: 'Eliminar presupuestos',
      path: '/api/store/accounting/budgets/:id',
      method: 'DELETE',
    },

    // ──── Consolidación Contable ────
    {
      name: 'store:accounting:consolidation:read',
      description: 'Leer sesiones, transacciones y reportes de consolidación',
      path: '/api/store/accounting/consolidation/sessions',
      method: 'GET',
    },
    {
      name: 'store:accounting:consolidation:write',
      description: 'Crear, iniciar y gestionar sesiones de consolidación',
      path: '/api/store/accounting/consolidation/sessions',
      method: 'POST',
    },

    // ──── Activos Fijos ────
    {
      name: 'store:accounting:fixed_assets:read',
      description: 'Leer activos fijos, categorías y reportes',
      path: '/api/store/accounting/fixed-assets',
      method: 'GET',
    },
    {
      name: 'store:accounting:fixed_assets:write',
      description: 'Crear, actualizar, depreciar y retirar activos fijos',
      path: '/api/store/accounting/fixed-assets',
      method: 'POST',
    },
    {
      name: 'store:accounting:fixed_assets:delete',
      description: 'Eliminar activos fijos y categorías',
      path: '/api/store/accounting/fixed-assets/:id',
      method: 'DELETE',
    },

    // ===== SaaS Subscriptions =====
    // Store-level: tienda ve/gestiona su propia suscripción
    {
      name: 'subscriptions:read',
      description: 'Ver la suscripción de la tienda',
      path: '/api/store/subscriptions/*',
      method: 'GET',
    },
    {
      name: 'subscriptions:write',
      description: 'Suscribir, cambiar o cancelar plan de la tienda',
      path: '/api/store/subscriptions/*',
      method: 'POST',
    },

    // Reseller (organización partner)
    {
      name: 'reseller:plans:read',
      description: 'Ver overrides de planes del partner',
      path: '/api/organization/reseller/plans',
      method: 'GET',
    },
    {
      name: 'reseller:plans:write',
      description: 'Crear/actualizar/eliminar overrides de planes del partner',
      path: '/api/organization/reseller/plans',
      method: 'POST',
    },
    {
      name: 'reseller:commissions:read',
      description: 'Ver comisiones y payouts del partner',
      path: '/api/organization/reseller/commissions/*',
      method: 'GET',
    },
    {
      name: 'reseller:branding:read',
      description: 'Ver configuración de branding del partner',
      path: '/api/organization/reseller/branding',
      method: 'GET',
    },
    {
      name: 'reseller:branding:write',
      description: 'Actualizar configuración de branding del partner',
      path: '/api/organization/reseller/branding',
      method: 'PUT',
    },

    // Superadmin: gestión global de SaaS
    {
      name: 'superadmin:subscriptions:read',
      description: 'Ver suscripciones activas y dunning',
      path: '/api/superadmin/subscriptions/*',
      method: 'GET',
    },
    {
      name: 'superadmin:subscriptions:update',
      description: 'Acciones de gestión sobre suscripciones (remind, force cancel)',
      path: '/api/superadmin/subscriptions/dunning/:id/*',
      method: 'POST',
    },
    {
      name: 'superadmin:subscriptions:plans:read',
      description: 'Ver planes SaaS',
      path: '/api/superadmin/subscriptions/plans',
      method: 'GET',
    },
    {
      name: 'superadmin:subscriptions:plans:create',
      description: 'Crear planes SaaS',
      path: '/api/superadmin/subscriptions/plans',
      method: 'POST',
    },
    {
      name: 'superadmin:subscriptions:plans:update',
      description: 'Actualizar planes SaaS',
      path: '/api/superadmin/subscriptions/plans/:id',
      method: 'PATCH',
    },
    {
      name: 'superadmin:subscriptions:plans:delete',
      description: 'Archivar/eliminar planes SaaS',
      path: '/api/superadmin/subscriptions/plans/:id',
      method: 'DELETE',
    },
    {
      name: 'superadmin:subscriptions:partners:read',
      description: 'Ver partners y overrides',
      path: '/api/superadmin/subscriptions/partners',
      method: 'GET',
    },
    {
      name: 'superadmin:subscriptions:partners:update',
      description: 'Toggle partner, margin cap y overrides',
      path: '/api/superadmin/subscriptions/partners/*',
      method: 'PATCH',
    },
    {
      name: 'superadmin:subscriptions:promotional:read',
      description: 'Ver planes promocionales',
      path: '/api/superadmin/subscriptions/promotional',
      method: 'GET',
    },
    {
      name: 'superadmin:subscriptions:promotional:create',
      description: 'Crear planes promocionales',
      path: '/api/superadmin/subscriptions/promotional',
      method: 'POST',
    },
    {
      name: 'superadmin:subscriptions:promotional:update',
      description: 'Actualizar planes promocionales',
      path: '/api/superadmin/subscriptions/promotional/:id',
      method: 'PATCH',
    },
    {
      name: 'superadmin:subscriptions:promotional:delete',
      description: 'Eliminar planes promocionales',
      path: '/api/superadmin/subscriptions/promotional/:id',
      method: 'DELETE',
    },
    {
      name: 'superadmin:subscriptions:payouts:read',
      description: 'Ver batches de payouts a partners',
      path: '/api/superadmin/subscriptions/payouts',
      method: 'GET',
    },
    {
      name: 'superadmin:subscriptions:payouts:update',
      description: 'Aprobar/marcar como pagados los batches',
      path: '/api/superadmin/subscriptions/payouts/:id/*',
      method: 'PATCH',
    },
    {
      name: 'superadmin:subscriptions:events:read',
      description: 'Auditar eventos de suscripciones',
      path: '/api/superadmin/subscriptions/events',
      method: 'GET',
    },
    {
      name: 'superadmin:subscriptions:gateway:read',
      description: 'Ver configuración (enmascarada) de la pasarela SaaS',
      path: '/api/superadmin/subscriptions/gateway/:processor',
      method: 'GET',
    },
    {
      name: 'superadmin:subscriptions:gateway:write',
      description: 'Crear/actualizar credenciales de la pasarela SaaS',
      path: '/api/superadmin/subscriptions/gateway/:processor',
      method: 'PATCH',
    },
    {
      name: 'superadmin:subscriptions:gateway:test',
      description: 'Probar conexión con la pasarela SaaS',
      path: '/api/superadmin/subscriptions/gateway/:processor/test',
      method: 'POST',
    },
    {
      name: 'super_admin.settings.sync_all',
      description:
        'Sincronizar (migrar) settings de todas las tiendas desde super-admin',
      path: '/api/superadmin/settings/sync-all-stores',
      method: 'POST',
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

  const canonicalByPathMethod = new Map<string, string>();
  for (const p of permissions) {
    canonicalByPathMethod.set(`${p.path}::${p.method}`, p.name);
  }
  const existingRows = await client.permissions.findMany({
    select: { id: true, name: true, path: true, method: true },
  });
  const staleIds: number[] = [];
  for (const row of existingRows) {
    const canonical = canonicalByPathMethod.get(`${row.path}::${row.method}`);
    if (canonical && canonical !== row.name) staleIds.push(row.id);
  }
  if (staleIds.length) {
    const r = await client.permissions.deleteMany({
      where: { id: { in: staleIds } },
    });
    console.log(
      `   🧹 Removed ${r.count} stale permissions with conflicting (path, method)`,
    );
  }

  // Create permissions
  let permissionsCreated = 0;
  let permissionsSkipped = 0;
  for (const permission of permissions) {
    try {
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
    } catch (e: any) {
      // Skip unique constraint violations on (path, method)
      if (e?.code === 'P2002') {
        permissionsSkipped++;
      } else {
        throw e;
      }
    }
  }
  if (permissionsSkipped > 0) {
    console.log(
      `   ⚠️  Skipped ${permissionsSkipped} permissions (duplicate path+method)`,
    );
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

  const cashierRole = await client.roles.upsert({
    where: { name: 'cashier' },
    update: {},
    create: {
      name: 'cashier',
      description: 'Cajero de tienda',
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
  const superAdminSync = await syncRolePermissions(
    client,
    superAdminRole.id,
    allPermissions.map((p) => p.id),
    'super_admin',
  );
  assignmentsCreated += superAdminSync.added;

  // Assign permissions to owner (full control of their organization)
  const ownerPermissions = allPermissions.filter(
    (p) =>
      !p.name.includes('super_admin') &&
      !p.name.includes('system.test') &&
      !p.name.includes('users.impersonate'),
  );

  const ownerSync = await syncRolePermissions(
    client,
    ownerRole.id,
    ownerPermissions.map((p) => p.id),
    'owner',
  );
  assignmentsCreated += ownerSync.added;

  // Assign permissions to admin (operational management)
  const adminPermissions = allPermissions.filter(
    (p) =>
      (p.name.startsWith('organization:') ||
        p.name.startsWith('store:') ||
        p.name.startsWith('audit.') ||
        p.name.startsWith('email.') ||
        p.name.startsWith('domains.') ||
        p.name.startsWith('exogenous:') ||
        p.name.startsWith('payroll:') ||
        p.name.startsWith('taxes:') ||
        p.name.startsWith('withholding:') ||
        p.name === 'subscriptions:read' ||
        p.name === 'subscriptions:write' ||
        p.name.startsWith('reseller:')) &&
      !p.name.includes('super_admin') &&
      !p.name.startsWith('system.') &&
      !p.name.startsWith('security.') &&
      !p.name.startsWith('rate.limiting.') &&
      !p.name.includes('users.impersonate'),
  );

  const adminSync = await syncRolePermissions(
    client,
    adminRole.id,
    adminPermissions.map((p) => p.id),
    'admin (ORG_ADMIN)',
  );
  assignmentsCreated += adminSync.added;

  // Assign permissions to manager (full store management)
  //
  // STORE_ADMIN owns the per-store inventory write surface, but org-native
  // inventory writes (locations / suppliers / adjustments / transfers full
  // lifecycle / transactions ledger) belong exclusively to ORG_ADMIN — see
  // Plan P2 ROUND 2 §6.3.2. Suppliers in particular are migrating: STORE
  // keeps READ access and loses create/update/delete on the
  // `store:inventory:suppliers:*` surface (the canonical write API now
  // lives at /api/organization/inventory/suppliers).
  const managerPermissions = allPermissions.filter(
    (p) =>
      // Manager loses store-side supplier writes — those move to ORG_ADMIN.
      !(
        p.name === 'store:inventory:suppliers:create' ||
        p.name === 'store:inventory:suppliers:update' ||
        p.name === 'store:inventory:suppliers:delete'
      ) &&
      (p.name.startsWith('store:') ||
        p.name.startsWith('exogenous:') ||
        p.name.startsWith('payroll:') ||
        p.name.startsWith('taxes:') ||
        p.name.startsWith('withholding:') ||
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
          // org-native inventory writes belong to ORG_ADMIN only.
          !p.name.startsWith('organization:inventory:') &&
          !p.name.includes('security.') &&
          !p.name.includes('rate.limiting.'))),
  );

  // Sync STORE_ADMIN (manager) using the canonical helper. This both inserts
  // the missing assignments and revokes obsolete ones in a single idempotent
  // pass — for example, supplier writes that moved to ORG_ADMIN, or any new
  // `organization:inventory:*` rows we never want manager to inherit.
  const managerSync = await syncRolePermissions(
    client,
    managerRole.id,
    managerPermissions.map((p) => p.id),
    'STORE_ADMIN (manager)',
  );
  assignmentsCreated += managerSync.added;

  // Assign basic permissions to supervisor
  const supervisorPermissions = allPermissions.filter(
    (p) =>
      p.name.includes('store:orders:') ||
      p.name.includes('store:payments:read') ||
      (p.name.startsWith('store:inventory:') && p.name.includes(':read')) ||
      p.name.includes('store:coupons:read') ||
      p.name.includes('store:coupons:validate') ||
      p.name.includes('store:products:read') ||
      p.name.includes('store:categories:read') ||
      p.name.includes('store:brands:read') ||
      p.name.includes('store:suppliers:read') ||
      p.name.includes('organization:users:read') ||
      p.name.includes('organization:stores:read') ||
      p.name.includes('organization:addresses:read') ||
      p.name.includes('store:addresses:read') ||
      p.name.includes('store:taxes:read') ||
      p.name.includes('store:cash_registers:read') ||
      p.name.includes('store:cash_registers:reports') ||
      p.name.includes('store:reservations:create') ||
      p.name.includes('store:reservations:read') ||
      p.name.includes('store:reservations:read:one') ||
      p.name.includes('store:reservations:update') ||
      p.name.includes('store:dispatch_notes:create') ||
      p.name.includes('store:dispatch_notes:read') ||
      p.name.includes('store:dispatch_notes:read:one') ||
      p.name.includes('store:dispatch_notes:update') ||
      p.name.includes('store:dispatch_notes:delete') ||
      p.name.includes('store:dispatch_notes:confirm') ||
      p.name.includes('store:dispatch_notes:deliver') ||
      p.name.includes('store:dispatch_notes:void') ||
      p.name.includes('store:dispatch_notes:invoice') ||
      p.name.includes('store:reviews:read') ||
      p.name.includes('store:reviews:moderate') ||
      p.name === 'store:payroll:advances:read' ||
      // Permisos de lectura para nuevos dominios
      p.name === 'exogenous:read' ||
      p.name === 'payroll:read' ||
      p.name === 'taxes:ica:read' ||
      p.name === 'withholding:read' ||
      p.name === 'store:accounting:bank_reconciliation:read' ||
      p.name === 'store:accounting:budgets:read' ||
      p.name === 'store:accounting:consolidation:read' ||
      p.name === 'store:accounting:fixed_assets:read' ||
      p.name.includes('store:data_collection:') ||
      p.name.includes('store:metadata:read') ||
      p.name.includes('store:customers:history:read') ||
      p.name.includes('store:email_templates:read') ||
      p.name.includes('store:reservations:write') ||
      p.name.includes('store:settings:write'),
  );

  const supervisorSync = await syncRolePermissions(
    client,
    supervisorRole.id,
    supervisorPermissions.map((p) => p.id),
    'supervisor',
  );
  assignmentsCreated += supervisorSync.added;

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
      p.name.includes('store:coupons:read') ||
      p.name.includes('store:coupons:validate') ||
      p.name.includes('organization:addresses:read') ||
      p.name.includes('store:addresses:read') ||
      p.name.includes('store:taxes:read') ||
      p.name.includes('store:cash_registers:read') ||
      p.name.includes('store:cash_registers:open_session') ||
      p.name.includes('store:cash_registers:close_session') ||
      p.name.includes('store:cash_registers:movements') ||
      p.name.includes('store:reservations:read') ||
      p.name.includes('store:reservations:read:one') ||
      p.name.includes('store:dispatch_notes:create') ||
      p.name.includes('store:dispatch_notes:read') ||
      p.name.includes('store:dispatch_notes:read:one') ||
      p.name.includes('store:reviews:read') ||
      p.name.includes('store:data_collection:submissions:read') ||
      p.name.includes('store:customers:history:read') ||
      p.name.includes('store:reservations:write'),
  );

  const employeeSync = await syncRolePermissions(
    client,
    employeeRole.id,
    employeePermissions.map((p) => p.id),
    'employee',
  );
  assignmentsCreated += employeeSync.added;

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
      p.name.includes('organization:addresses:update') ||
      p.name.includes('organization:addresses:delete') ||
      p.name.includes('domains.resolve') ||
      p.name.includes('domains.check') ||
      p.name.includes('system.health'),
  );

  const customerSync = await syncRolePermissions(
    client,
    customerRole.id,
    customerPermissions.map((p) => p.id),
    'customer',
  );
  assignmentsCreated += customerSync.added;

  // Assign permissions to cashier (lectura amplia, escritura limitada)
  const cashierPermissions = allPermissions.filter(
    (p) =>
      // Autenticación básica
      p.name.includes('auth.login') ||
      p.name.includes('auth.logout') ||
      p.name.includes('auth.profile') ||
      p.name.includes('auth.me') ||
      p.name.includes('auth.sessions') ||
      p.name.includes('auth.change.password') ||
      // Productos - lectura
      p.name.includes('store:products:read') ||
      p.name.includes('store:products:read:one') ||
      p.name.includes('store:products:read:store') ||
      p.name.includes('store:products:read:slug') ||
      // Categorías - lectura
      p.name.includes('store:categories:read') ||
      p.name.includes('store:categories:read:one') ||
      // Marcas - lectura
      p.name.includes('store:brands:read') ||
      p.name.includes('store:brands:read:one') ||
      p.name.includes('store:brands:read:store') ||
      p.name.includes('store:brands:read:slug') ||
      // Órdenes - crear, leer, actualizar estado
      p.name.includes('store:orders:create') ||
      p.name.includes('store:orders:read') ||
      p.name.includes('store:orders:read:one') ||
      // Cupones - leer y validar
      p.name.includes('store:coupons:read') ||
      p.name.includes('store:coupons:read:one') ||
      p.name.includes('store:coupons:validate') ||
      // Clientes - leer y crear (no actualizar ni eliminar)
      p.name.includes('store:customers:read') ||
      p.name.includes('store:customers:create') ||
      // Direcciones - leer y crear
      p.name.includes('organization:addresses:read') ||
      p.name.includes('organization:addresses:create') ||
      p.name.includes('store:addresses:read') ||
      p.name.includes('store:addresses:create') ||
      // Impuestos - solo lectura
      p.name.includes('store:taxes:read') ||
      p.name.includes('store:taxes:read:one') ||
      // Caja - gestión completa de caja
      p.name.includes('store:cash_registers:read') ||
      p.name.includes('store:cash_registers:create') ||
      p.name.includes('store:cash_registers:update') ||
      p.name.includes('store:cash_registers:delete') ||
      p.name.includes('store:cash_registers:open_session') ||
      p.name.includes('store:cash_registers:close_session') ||
      p.name.includes('store:cash_registers:movements') ||
      p.name.includes('store:cash_registers:reports') ||
      // Reservas - leer y crear
      p.name.includes('store:reservations:read') ||
      p.name.includes('store:reservations:read:one') ||
      p.name.includes('store:reservations:create') ||
      // Remisiones - crear, leer, confirmar (no delete ni void)
      p.name.includes('store:dispatch_notes:create') ||
      p.name.includes('store:dispatch_notes:read') ||
      p.name.includes('store:dispatch_notes:read:one') ||
      p.name.includes('store:dispatch_notes:confirm') ||
      p.name.includes('store:dispatch_notes:deliver') ||
      // Reseñas - solo lectura
      p.name.includes('store:reviews:read') ||
      p.name.includes('store:reviews:read:one') ||
      p.name.includes('store:reviews:read:stats') ||
      // POS - acceso
      p.name.includes('store:pos:access') ||
      // Inventario - solo lectura de stock
      p.name.includes('store:inventory:stock_levels:read') ||
      p.name.includes('store:inventory:locations:read') ||
      // Ecommerce - solo lectura
      p.name.includes('store:ecommerce:read') ||
      // Configuración de tienda - solo lectura
      p.name.includes('store:settings:read') ||
      // Proveedores - solo lectura
      p.name.includes('store:suppliers:read') ||
      p.name.includes('store:inventory:suppliers:read') ||
      // Transferencias - solo lectura
      p.name.includes('store:stock-transfers:read') ||
      // Notificaciones - lectura
      p.name.includes('store:notifications:read') ||
      // Cola virtual - leer y gestionar
      p.name.includes('store:customer_queue:read') ||
      p.name.includes('store:customer_queue:manage') ||
      // Reservas - check-in y submissions
      p.name.includes('store:reservations:write') ||
      p.name.includes('store:data_collection:submissions:read') ||
      // Dominios públicos
      p.name.includes('domains.resolve') ||
      p.name.includes('domains.check') ||
      p.name.includes('system.health'),
  );

  const cashierSync = await syncRolePermissions(
    client,
    cashierRole.id,
    cashierPermissions.map((p) => p.id),
    'cashier',
  );
  assignmentsCreated += cashierSync.added;

  return {
    permissionsCreated,
    rolesCreated,
    assignmentsCreated,
  };
}
