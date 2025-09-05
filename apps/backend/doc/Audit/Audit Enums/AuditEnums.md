# Audit Enums - Definiciones de Acciones y Recursos

## 📋 Descripción General

Los enums de auditoría definen las acciones y recursos estándar del sistema Vendix. Proporcionan una categorización consistente para todos los eventos de auditoría.

## 🏗️ Arquitectura

### Ubicación
```
src/modules/audit/audit.enums.ts
```

### Enums Definidos
- **AuditAction**: Tipos de acciones que se pueden auditar
- **AuditResource**: Tipos de recursos del sistema

## 🚀 AuditAction Enum

### Definición Completa
```typescript
export enum AuditAction {
  // Operaciones CRUD
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',

  // Autenticación y Autorización
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  EMAIL_VERIFY = 'EMAIL_VERIFY',
  PASSWORD_RESET = 'PASSWORD_RESET',

  // Sistema y Administración
  SYSTEM = 'SYSTEM',
  BACKUP = 'BACKUP',
  RESTORE = 'RESTORE',
  CONFIG_CHANGE = 'CONFIG_CHANGE',

  // Operaciones Especiales
  IMPORT = 'IMPORT',
  EXPORT = 'EXPORT',
  BULK_UPDATE = 'BULK_UPDATE',
  BULK_DELETE = 'BULK_DELETE',

  // Onboarding y Setup
  ONBOARDING_START = 'ONBOARDING_START',
  ONBOARDING_COMPLETE = 'ONBOARDING_COMPLETE',
  STORE_SETUP = 'STORE_SETUP',
  DOMAIN_CONFIG = 'DOMAIN_CONFIG',

  // Permisos y Roles
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
  ROLE_ASSIGN = 'ROLE_ASSIGN',
  ROLE_REVOKE = 'ROLE_REVOKE',

  // Errores y Eventos Especiales
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  SECURITY_ALERT = 'SECURITY_ALERT',
}
```

### Categorías de Acciones

#### 1. Operaciones CRUD Básicas
```typescript
CREATE     // Creación de nuevos recursos
UPDATE     // Actualización de recursos existentes
DELETE     // Eliminación de recursos
```

#### 2. Autenticación y Sesiones
```typescript
LOGIN              // Inicio de sesión exitoso
LOGOUT             // Cierre de sesión
PASSWORD_CHANGE    // Cambio de contraseña
EMAIL_VERIFY       // Verificación de email
PASSWORD_RESET     // Restablecimiento de contraseña
```

#### 3. Sistema y Mantenimiento
```typescript
SYSTEM         // Eventos del sistema
BACKUP         // Creación de respaldo
RESTORE        // Restauración de respaldo
CONFIG_CHANGE  // Cambio de configuración
```

#### 4. Operaciones Masivas
```typescript
IMPORT       // Importación de datos
EXPORT       // Exportación de datos
BULK_UPDATE  // Actualización masiva
BULK_DELETE  // Eliminación masiva
```

#### 5. Onboarding y Configuración
```typescript
ONBOARDING_START     // Inicio del proceso de onboarding
ONBOARDING_COMPLETE  // Completación del onboarding
STORE_SETUP         // Configuración de tienda
DOMAIN_CONFIG       // Configuración de dominio
```

#### 6. Gestión de Permisos
```typescript
PERMISSION_CHANGE  // Cambio de permisos
ROLE_ASSIGN        // Asignación de rol
ROLE_REVOKE        // Revocación de rol
```

#### 7. Eventos de Seguridad
```typescript
ERROR           // Errores del sistema
WARNING         // Advertencias
SECURITY_ALERT  // Alertas de seguridad
```

## 📊 AuditResource Enum

### Definición Completa
```typescript
export enum AuditResource {
  // Usuarios y Autenticación
  USERS = 'users',
  AUTH = 'auth',
  SESSIONS = 'sessions',

  // Organización y Empresa
  ORGANIZATIONS = 'organizations',
  STORES = 'stores',
  DOMAIN_SETTINGS = 'domain_settings',

  // Productos y Catálogo
  PRODUCTS = 'products',
  CATEGORIES = 'categories',
  BRANDS = 'brands',
  INVENTORY = 'inventory',

  // Órdenes y Ventas
  ORDERS = 'orders',
  ORDER_ITEMS = 'order_items',
  PAYMENTS = 'payments',
  REFUNDS = 'refunds',

  // Clientes y CRM
  CUSTOMERS = 'customers',
  ADDRESSES = 'addresses',

  // Sistema y Configuración
  SYSTEM = 'system',
  CONFIG = 'config',
  LOGS = 'logs',

  // Impuestos y Finanzas
  TAXES = 'taxes',
  TAX_CATEGORIES = 'tax_categories',
  INVOICES = 'invoices',

  // Recursos Adicionales
  FILES = 'files',
  IMAGES = 'images',
  REPORTS = 'reports',
}
```

### Categorías de Recursos

#### 1. Usuarios y Autenticación
```typescript
USERS     // Usuarios del sistema
AUTH      // Eventos de autenticación
SESSIONS  // Sesiones de usuario
```

#### 2. Organización y Empresa
```typescript
ORGANIZATIONS    // Organizaciones/empresas
STORES          // Tiendas
DOMAIN_SETTINGS // Configuración de dominios
```

#### 3. Productos y Catálogo
```typescript
PRODUCTS   // Productos
CATEGORIES // Categorías de productos
BRANDS     // Marcas
INVENTORY  // Inventario
```

#### 4. Órdenes y Ventas
```typescript
ORDERS      // Órdenes de compra
ORDER_ITEMS // Items de orden
PAYMENTS    // Pagos
REFUNDS     // Reembolsos
```

#### 5. Clientes y CRM
```typescript
CUSTOMERS // Clientes
ADDRESSES // Direcciones
```

#### 6. Sistema y Configuración
```typescript
SYSTEM // Eventos del sistema
CONFIG // Configuración
LOGS   // Logs del sistema
```

#### 7. Impuestos y Finanzas
```typescript
TAXES         // Impuestos
TAX_CATEGORIES // Categorías de impuestos
INVOICES      // Facturas
```

#### 8. Recursos Adicionales
```typescript
FILES  // Archivos
IMAGES // Imágenes
REPORTS // Reportes
```

## 🎯 Uso de los Enums

### Importación
```typescript
import { AuditAction, AuditResource } from '../audit/audit.enums';
```

### En AuditService
```typescript
async logCreate(userId: number, resource: AuditResource, resourceId: number, newValues: any) {
  await this.log({
    userId,
    action: AuditAction.CREATE, // ✅ Uso consistente
    resource,                    // ✅ Recurso tipado
    resourceId,
    newValues,
  });
}
```

### En Controllers
```typescript
@Post()
async create(@Body() data: CreateProductDto, @CurrentUser() user: any) {
  const product = await this.productsService.create(data, user.id);

  await this.auditService.logCreate(
    user.id,
    AuditResource.PRODUCTS, // ✅ Recurso específico
    product.id,
    product
  );

  return product;
}
```

### En Interceptors
```typescript
@AuditCreate(AuditResource.PRODUCTS)
@Post()
async create(@Body() data: CreateProductDto) {
  // Automáticamente usa AuditAction.CREATE y AuditResource.PRODUCTS
}
```

## 🔧 Extensión de Enums

### Agregar Nuevas Acciones
```typescript
export enum AuditAction {
  // ... acciones existentes
  ARCHIVE = 'ARCHIVE',        // Nueva acción
  UNARCHIVE = 'UNARCHIVE',    // Nueva acción
}
```

### Agregar Nuevos Recursos
```typescript
export enum AuditResource {
  // ... recursos existentes
  SHIPMENTS = 'shipments',      // Nuevo recurso
  RETURNS = 'returns',          // Nuevo recurso
}
```

### Validación de Enums
```typescript
// Función utilitaria para validar
export function isValidAuditAction(action: string): action is AuditAction {
  return Object.values(AuditAction).includes(action as AuditAction);
}

export function isValidAuditResource(resource: string): resource is AuditResource {
  return Object.values(AuditResource).includes(resource as AuditResource);
}
```

## 📊 Estadísticas y Reportes

### Agrupación por Acción
```typescript
const actionStats = await this.prisma.audit_logs.groupBy({
  by: ['action'],
  _count: { id: true },
  where: {
    action: {
      in: [
        AuditAction.CREATE,
        AuditAction.UPDATE,
        AuditAction.DELETE
      ]
    }
  }
});
```

### Agrupación por Recurso
```typescript
const resourceStats = await this.prisma.audit_logs.groupBy({
  by: ['resource'],
  _count: { id: true },
  where: {
    resource: {
      in: [
        AuditResource.PRODUCTS,
        AuditResource.ORDERS,
        AuditResource.USERS
      ]
    }
  }
});
```

### Consultas Combinadas
```typescript
const combinedStats = await this.prisma.audit_logs.groupBy({
  by: ['action', 'resource'],
  _count: { id: true },
  where: {
    action: AuditAction.CREATE,
    resource: AuditResource.PRODUCTS,
  }
});
```

## 🚨 Validación y Type Safety

### Type Guards
```typescript
function isAuditAction(value: string): value is AuditAction {
  return Object.values(AuditAction).includes(value as AuditAction);
}

function isAuditResource(value: string): value is AuditResource {
  return Object.values(AuditResource).includes(value as AuditResource);
}
```

### Validación en DTOs
```typescript
import { IsEnum } from 'class-validator';

export class AuditLogQueryDto {
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsEnum(AuditResource)
  resource?: AuditResource;
}
```

### TypeScript Integration
```typescript
// Tipos derivados
type AuditActionType = keyof typeof AuditAction;
type AuditResourceType = keyof typeof AuditResource;

// Funciones con tipos seguros
function getAuditActionLabel(action: AuditAction): string {
  const labels = {
    [AuditAction.CREATE]: 'Creación',
    [AuditAction.UPDATE]: 'Actualización',
    [AuditAction.DELETE]: 'Eliminación',
    // ... otros
  };
  return labels[action] || 'Desconocido';
}
```

## 📈 Métricas de Uso

### Acciones Más Comunes
```typescript
const topActions = await this.prisma.audit_logs.groupBy({
  by: ['action'],
  _count: { id: true },
  orderBy: { _count: { id: 'desc' } },
  take: 10,
});
```

### Recursos Más Auditados
```typescript
const topResources = await this.prisma.audit_logs.groupBy({
  by: ['resource'],
  _count: { id: 'desc' },
  orderBy: { _count: { id: 'desc' } },
  take: 10,
});
```

### Distribución por Usuario
```typescript
const userActivity = await this.prisma.audit_logs.groupBy({
  by: ['user_id', 'action'],
  _count: { id: true },
  where: { user_id: { not: null } },
});
```

## 🔄 Migración y Versionado

### Versionado de Enums
```typescript
// Versión 1.0
export enum AuditActionV1 {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

// Versión 2.0 - Agregando nuevas acciones
export enum AuditActionV2 {
  ...AuditActionV1,
  ARCHIVE = 'ARCHIVE',
  RESTORE = 'RESTORE',
}

// Mantener compatibilidad
export const AuditAction = AuditActionV2;
```

### Migración de Datos
```typescript
// Script de migración para actualizar logs existentes
async function migrateAuditActions() {
  await this.prisma.audit_logs.updateMany({
    where: { action: 'ARCHIVE' },
    data: { action: AuditAction.ARCHIVE },
  });
}
```

## 🧪 Pruebas

### Pruebas Unitarias
```typescript
describe('AuditAction Enum', () => {
  it('should contain CREATE action', () => {
    expect(AuditAction.CREATE).toBe('CREATE');
  });

  it('should validate action', () => {
    expect(isValidAuditAction('CREATE')).toBe(true);
    expect(isValidAuditAction('INVALID')).toBe(false);
  });
});

describe('AuditResource Enum', () => {
  it('should contain PRODUCTS resource', () => {
    expect(AuditResource.PRODUCTS).toBe('products');
  });

  it('should validate resource', () => {
    expect(isValidAuditResource('products')).toBe(true);
    expect(isValidAuditResource('invalid')).toBe(false);
  });
});
```

### Pruebas de Integración
```typescript
describe('Audit Enums Integration', () => {
  it('should use enums in audit logging', async () => {
    await auditService.logCreate(1, AuditResource.PRODUCTS, 123, { name: 'Test' });

    const log = await prisma.audit_logs.findFirst({
      where: { resource: AuditResource.PRODUCTS }
    });

    expect(log.action).toBe(AuditAction.CREATE);
    expect(log.resource).toBe(AuditResource.PRODUCTS);
  });
});
```

## 📚 Documentación Adicional

### Guías de Uso
- [Audit Service](./AuditService.md) - Servicio principal
- [Audit Controller](./AuditController.md) - API REST
- [Integration Guide](../Integration%20Guide/) - Guía de integración

### Referencias
- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeScript Enums](https://www.typescriptlang.org/docs/handbook/enums.html)
- [Prisma Documentation](https://www.prisma.io/docs/)

Estos enums proporcionan una base sólida y extensible para categorizar consistentemente todas las actividades del sistema Vendix, facilitando consultas, reportes y análisis de auditoría.</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Audit/Audit Enums/AuditEnums.md
