# Audit Service - Servicio Principal de Auditoría

## 📋 Descripción General

El `AuditService` es el corazón del sistema de auditoría de Vendix. Proporciona métodos para registrar todas las operaciones importantes del sistema, manteniendo un historial completo de cambios y actividades.

## 🏗️ Arquitectura

### Ubicación
```
src/modules/audit/audit.service.ts
```

### Dependencias
- **PrismaService**: Para persistir los logs en la base de datos
- **Enums**: AuditAction y AuditResource para categorización

### Base de Datos
```sql
model audit_logs {
  id          Int       @id @default(autoincrement())
  user_id     Int?
  action      String    @db.VarChar(100)
  resource    String    @db.VarChar(100)
  resource_id Int?
  old_values  Json?
  new_values  Json?
  metadata    Json?
  ip_address  String?   @db.VarChar(45)
  user_agent  String?
  created_at  DateTime? @default(now())

  users       users?    @relation(fields: [user_id], references: [id])
}
```

## 🚀 Métodos Disponibles

### 1. `logCreate(userId, resource, resourceId, newValues, metadata?)`
Registra la creación de un nuevo recurso.

**Parámetros:**
- `userId`: ID del usuario que realiza la acción
- `resource`: Tipo de recurso (AuditResource)
- `resourceId`: ID del recurso creado
- `newValues`: Valores del nuevo recurso
- `metadata`: Información adicional opcional

**Ejemplo:**
```typescript
await auditService.logCreate(
  userId,
  AuditResource.PRODUCTS,
  product.id,
  {
    name: product.name,
    sku: product.sku,
    base_price: product.base_price,
  },
  { store_id: product.store_id }
);
```

### 2. `logUpdate(userId, resource, resourceId, oldValues, newValues, metadata?)`
Registra la actualización de un recurso existente.

**Parámetros:**
- `userId`: ID del usuario que realiza la acción
- `resource`: Tipo de recurso (AuditResource)
- `resourceId`: ID del recurso actualizado
- `oldValues`: Valores anteriores del recurso
- `newValues`: Valores nuevos del recurso
- `metadata`: Información adicional opcional

**Ejemplo:**
```typescript
await auditService.logUpdate(
  userId,
  AuditResource.PRODUCTS,
  productId,
  {
    name: oldProduct.name,
    base_price: oldProduct.base_price,
  },
  {
    name: updatedProduct.name,
    base_price: updatedProduct.base_price,
  },
  { updated_fields: ['name', 'base_price'] }
);
```

### 3. `logDelete(userId, resource, resourceId, oldValues, metadata?)`
Registra la eliminación de un recurso.

**Parámetros:**
- `userId`: ID del usuario que realiza la acción
- `resource`: Tipo de recurso (AuditResource)
- `resourceId`: ID del recurso eliminado
- `oldValues`: Valores del recurso antes de eliminar
- `metadata`: Información adicional opcional

**Ejemplo:**
```typescript
await auditService.logDelete(
  userId,
  AuditResource.PRODUCTS,
  productId,
  {
    name: product.name,
    sku: product.sku,
  },
  { reason: 'archived_by_user' }
);
```

### 4. `logAuth(userId, action, metadata?, ipAddress?, userAgent?)`
Registra eventos de autenticación y autorización.

**Parámetros:**
- `userId`: ID del usuario (puede ser undefined para eventos anónimos)
- `action`: Tipo de acción de autenticación (AuditAction)
- `metadata`: Información adicional del evento
- `ipAddress`: Dirección IP del cliente
- `userAgent`: User-Agent del cliente

**Ejemplo:**
```typescript
await auditService.logAuth(
  user.id,
  AuditAction.LOGIN,
  {
    login_method: 'password',
    success: true,
  },
  '192.168.1.100',
  'Mozilla/5.0...'
);
```

### 5. `logSystem(action, resource, metadata?)`
Registra eventos del sistema (sin usuario específico).

**Parámetros:**
- `action`: Tipo de acción del sistema
- `resource`: Recurso afectado
- `metadata`: Información del evento

**Ejemplo:**
```typescript
await auditService.logSystem(
  AuditAction.DELETE,
  AuditResource.USERS,
  {
    reason: 'bulk_cleanup',
    deleted_count: 150,
    admin_user_id: 1
  }
);
```

## 📊 Métodos de Consulta

### 1. `getAuditLogs(filters)`
Obtiene logs de auditoría con filtros.

**Parámetros:**
```typescript
interface AuditLogFilters {
  userId?: number;
  action?: AuditAction;
  resource?: AuditResource;
  resourceId?: number;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}
```

**Ejemplo:**
```typescript
const userActivity = await auditService.getAuditLogs({
  userId: 123,
  action: AuditAction.UPDATE,
  resource: AuditResource.PRODUCTS,
  limit: 50,
});
```

### 2. `getAuditStats(fromDate, toDate)`
Obtiene estadísticas de auditoría por período.

**Retorno:**
```typescript
{
  totalLogs: number;
  logsByAction: Array<{ action: string; _count: { id: number } }>;
  logsByResource: Array<{ resource: string; _count: { id: number } }>;
}
```

**Ejemplo:**
```typescript
const stats = await auditService.getAuditStats(
  new Date('2025-01-01'),
  new Date('2025-12-31')
);
```

## 🔧 Método Interno: `log(data)`
Método privado que persiste el log en la base de datos.

**Parámetros:**
```typescript
interface AuditLogData {
  userId?: number;
  action: AuditAction;
  resource: AuditResource;
  resourceId?: number;
  oldValues?: any;
  newValues?: any;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}
```

## 🎯 Casos de Uso

### 1. Registro de Usuario
```typescript
await auditService.logCreate(
  adminId,
  AuditResource.USERS,
  newUser.id,
  {
    email: newUser.email,
    first_name: newUser.first_name,
    last_name: newUser.last_name,
  }
);
```

### 2. Cambio de Contraseña
```typescript
await auditService.logAuth(
  userId,
  AuditAction.PASSWORD_CHANGE,
  { method: 'reset_password' }
);
```

### 3. Actualización de Producto
```typescript
await auditService.logUpdate(
  userId,
  AuditResource.PRODUCTS,
  productId,
  oldProduct,
  newProduct,
  { updated_fields: Object.keys(changes) }
);
```

### 4. Eliminación de Tienda
```typescript
await auditService.logDelete(
  userId,
  AuditResource.STORES,
  storeId,
  oldStore,
  { reason: 'user_requested_deletion' }
);
```

## 🔒 Seguridad y Privacidad

### Control de Acceso
- Los logs contienen información sensible
- Solo usuarios autorizados pueden consultar logs
- Los administradores tienen acceso completo
- Los usuarios regulares solo ven sus propios logs

### Datos Sensibles
- Las contraseñas nunca se registran
- Los tokens JWT no se almacenan completos
- Información sensible se filtra automáticamente

## 📈 Rendimiento

### Optimizaciones
- **Índices en BD**: Los campos más consultados están indexados
- **Paginación**: Todas las consultas soportan paginación
- **Filtros eficientes**: Los filtros se aplican a nivel de base de datos
- **Compresión**: Los valores JSON grandes se comprimen

### Recomendaciones
- Usar paginación para consultas grandes
- Aplicar filtros específicos para mejorar rendimiento
- Programar limpieza periódica de logs antiguos
- Monitorear el crecimiento de la tabla audit_logs

## 🚨 Manejo de Errores

### Errores Comunes
1. **Usuario no encontrado**: Cuando userId no existe
2. **Recurso inválido**: Cuando se pasa un AuditResource no válido
3. **Error de BD**: Problemas de conexión o constraints

### Logging de Errores
Los errores del AuditService se registran pero no detienen el flujo principal de la aplicación.

```typescript
try {
  await auditService.logCreate(userId, resource, id, data);
} catch (error) {
  console.error('Audit logging failed:', error);
  // No throw - audit failures shouldn't break business logic
}
```

## 🔄 Integración con Otros Módulos

### Inyección de Dependencia
```typescript
@Injectable()
export class MyService {
  constructor(private readonly auditService: AuditService) {}

  async createItem(data: any, userId: number) {
    const item = await this.prisma.items.create({ data });

    await this.auditService.logCreate(
      userId,
      AuditResource.ITEMS,
      item.id,
      item
    );

    return item;
  }
}
```

### Importación del Módulo
```typescript
@Module({
  imports: [AuditModule],
  // ...
})
export class MyModule {}
```

Este servicio proporciona una base sólida para el sistema de auditoría, permitiendo un seguimiento completo de todas las actividades importantes del sistema Vendix.

## 🔐 Multi-Tenant Security

### Filtrado por Organización
```typescript
async getAuditLogs(query: AuditLogQueryDto, organizationId?: string): Promise<AuditLog[]> {
  const where: Prisma.AuditLogWhereInput = {
    // ... otros filtros
    user: organizationId ? {
      organizationId: organizationId // ✅ Filtrado automático por organización
    } : undefined
  };

  return this.prisma.auditLog.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          organizationId: true // ✅ Incluye organizationId para validación
        }
      }
    }
  });
}
```

### Validación de Acceso
- **Super Admin**: `organizationId = undefined` → Acceso global
- **Admin de Org**: `organizationId = user.organizationId` → Acceso limitado
- **Usuario Regular**: `organizationId = user.organizationId` → Solo sus logs

### Integración con Guards
```typescript
// El OrganizationAuditGuard llama automáticamente:
// auditService.getAuditLogs(query, user.organizationId)
```
