# Sistema de Auditoría - Vendix

## 📋 Descripción General

El módulo de auditoría de Vendix proporciona un sistema completo para registrar y consultar todas las actividades importantes del sistema. Está diseñado para ser reutilizable en toda la aplicación.

## 🏗️ Arquitectura

### Componentes Principales
- **AuditService**: Servicio principal para registrar eventos
- **AuditController**: Endpoints para consultar logs
- **AuditInterceptor**: Interceptor automático para operaciones CRUD
- **AuditModule**: Módulo que agrupa todos los componentes

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
  ip_address  String?   @db.VarChar(45)
  user_agent  String?
  created_at  DateTime? @default(now())
  users       users?    @relation(fields: [user_id], references: [id])
}
```

## 🚀 Uso Básico

### 1. Inyección del Servicio
```typescript
import { AuditService, AuditAction, AuditResource } from '../audit';

@Injectable()
export class MyService {
  constructor(private readonly auditService: AuditService) {}

  async createItem(data: any, userId: number) {
    // Tu lógica de negocio
    const newItem = await this.prisma.items.create({ data });

    // Registrar auditoría
    await this.auditService.logCreate(
      userId,
      AuditResource.PRODUCTS, // o el recurso correspondiente
      newItem.id,
      newItem
    );

    return newItem;
  }
}
```

### 2. Tipos de Eventos Disponibles
```typescript
enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  EMAIL_VERIFY = 'EMAIL_VERIFY',
  ONBOARDING_COMPLETE = 'ONBOARDING_COMPLETE',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
}

enum AuditResource {
  USERS = 'users',
  ORGANIZATIONS = 'organizations',
  STORES = 'stores',
  DOMAIN_SETTINGS = 'domain_settings',
  PRODUCTS = 'products',
  ORDERS = 'orders',
  AUTH = 'auth',
  SYSTEM = 'system',
}
```

## 📊 Consultas de Auditoría

### Obtener Logs con Filtros
```typescript
// GET /api/audit/logs?userId=1&action=CREATE&resource=products
const logs = await auditService.getAuditLogs({
  userId: 1,
  action: AuditAction.CREATE,
  resource: AuditResource.PRODUCTS,
  limit: 50,
  offset: 0,
});
```

### Obtener Estadísticas
```typescript
// GET /api/audit/stats?fromDate=2025-01-01&toDate=2025-12-31
const stats = await auditService.getAuditStats(
  new Date('2025-01-01'),
  new Date('2025-12-31')
);

// Resultado:
// {
//   totalLogs: 1250,
//   logsByAction: [{ action: 'CREATE', _count: { id: 450 } }],
//   logsByResource: [{ resource: 'users', _count: { id: 200 } }]
// }
```

## 🔧 Integración en Módulos Existentes

### Agregar a un Módulo
```typescript
// En tu-module.module.ts
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  // ...
})
export class TuModule {}
```

### Usar en un Servicio
```typescript
// En tu-service.service.ts
import { AuditService, AuditAction, AuditResource } from '../audit';

@Injectable()
export class TuService {
  constructor(private readonly auditService: AuditService) {}

  async actualizarProducto(id: number, data: any, userId: number) {
    // Obtener valores anteriores
    const productoAnterior = await this.prisma.products.findUnique({
      where: { id }
    });

    // Actualizar
    const productoActualizado = await this.prisma.products.update({
      where: { id },
      data
    });

    // Registrar auditoría
    await this.auditService.logUpdate(
      userId,
      AuditResource.PRODUCTS,
      id,
      productoAnterior,
      productoActualizado,
      { updated_fields: Object.keys(data) }
    );

    return productoActualizado;
  }
}
```

## 🎯 Casos de Uso Comunes

### 1. Registro de Usuarios
```typescript
await auditService.logCreate(
  userId,
  AuditResource.USERS,
  newUser.id,
  {
    email: newUser.email,
    first_name: newUser.first_name,
    last_name: newUser.last_name,
  }
);
```

### 2. Cambios de Contraseña
```typescript
await auditService.logAuth(
  userId,
  AuditAction.PASSWORD_CHANGE,
  { method: 'reset_password' }
);
```

### 3. Operaciones de Sistema
```typescript
await auditService.logSystem(
  AuditAction.DELETE,
  AuditResource.USERS,
  { reason: 'account_cleanup', deleted_count: 5 }
);
```

## 🔍 Consultas Avanzadas

### Logs de un Usuario Específico
```typescript
const userLogs = await auditService.getAuditLogs({
  userId: 123,
  fromDate: new Date('2025-01-01'),
  toDate: new Date('2025-12-31'),
});
```

### Logs de un Recurso Específico
```typescript
const productLogs = await auditService.getAuditLogs({
  resource: AuditResource.PRODUCTS,
  resourceId: 456,
});
```

### Logs por Tipo de Acción
```typescript
const createLogs = await auditService.getAuditLogs({
  action: AuditAction.CREATE,
  limit: 100,
});
```

## 📈 Dashboard y Reportes

### Estadísticas Diarias
```typescript
const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);

const dailyStats = await auditService.getAuditStats(yesterday, today);
```

### Actividad por Usuario
```typescript
const userActivity = await auditService.getAuditLogs({
  userId: userId,
  limit: 10,
  orderBy: { created_at: 'desc' }
});
```

## 🔐 Seguridad y Privacidad

### Control de Acceso
- Solo usuarios autenticados pueden consultar logs
- Los administradores pueden ver todos los logs
- Los usuarios regulares solo pueden ver sus propios logs

### Datos Sensibles
- Las contraseñas nunca se registran en los logs
- Los tokens JWT no se almacenan completos
- La información sensible se filtra automáticamente

## 🚀 Próximos Pasos

### Mejoras Sugeridas
1. **Interceptor Automático**: Registrar automáticamente operaciones CRUD
2. **Filtros Avanzados**: Búsqueda por texto, rangos de fecha complejos
3. **Exportación**: Exportar logs a CSV/JSON
4. **Alertas**: Notificaciones para eventos críticos
5. **Dashboard**: Interfaz visual para consultar logs

### Extensión del Sistema
```typescript
// Agregar nuevos recursos
enum AuditResource {
  // ... existentes
  INVOICES = 'invoices',
  PAYMENTS = 'payments',
  SHIPMENTS = 'shipments',
}

// Agregar nuevas acciones
enum AuditAction {
  // ... existentes
  EXPORT = 'EXPORT',
  IMPORT = 'IMPORT',
  BULK_UPDATE = 'BULK_UPDATE',
}
```

## 📝 Ejemplos de Implementación

### En un Controller
```typescript
@Post()
async create(@Body() data: CreateDto, @CurrentUser() user: any) {
  const result = await this.service.create(data, user.id);

  // El interceptor puede hacerlo automáticamente
  // await this.auditService.logCreate(user.id, AuditResource.YOUR_RESOURCE, result.id, result);

  return result;
}
```

### En un Servicio
```typescript
async update(id: number, data: UpdateDto, userId: number) {
  const oldData = await this.prisma.resource.findUnique({ where: { id } });
  const newData = await this.prisma.resource.update({ where: { id }, data });

  await this.auditService.logUpdate(
    userId,
    AuditResource.YOUR_RESOURCE,
    id,
    oldData,
    newData
  );

  return newData;
}
```

Este sistema de auditoría es completamente reutilizable y se puede integrar en cualquier parte de la aplicación Vendix para mantener un registro completo de todas las actividades importantes.</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/src/modules/audit/README.md
