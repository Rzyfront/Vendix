# OrganizationAuditGuard - Control de Acceso Multi-Tenant

## 📋 Descripción General

El `OrganizationAuditGuard` es un guard de NestJS que implementa control de acceso multi-tenant para el sistema de auditoría. Asegura que los usuarios solo puedan acceder a logs de auditoría de su propia organización, manteniendo el aislamiento de datos en un entorno multi-tenant.

## 🏗️ Arquitectura

### Ubicación
```
src/modules/audit/guards/organization-audit.guard.ts
```

### Dependencias
- **Reflector**: Para acceder a metadatos de rutas
- **ExecutionContext**: Para acceder al contexto de ejecución
- **User**: Entidad de usuario con organizationId

## 🔐 Funcionamiento

### Lógica de Filtrado
```typescript
export class OrganizationAuditGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // 1. Super Admin: Acceso completo sin filtros
    if (user.role === 'super_admin') {
      return true;
    }

    // 2. Admin de Organización: Filtrar por su organización
    if (user.role === 'admin' && user.organizationId) {
      request.query.organizationId = user.organizationId;
      return true;
    }

    // 3. Admin de Store: Filtrar por su store
    if (user.role === 'store_admin' && user.storeId) {
      request.query.storeId = user.storeId;
      return true;
    }

    // 4. Usuario regular: Filtrar por su organización
    if (user.organizationId) {
      request.query.organizationId = user.organizationId;
      return true;
    }

    // 5. Sin organización/store: Denegar acceso
    return false;
  }
}
```

### Niveles de Acceso

#### 1. Super Admin
```typescript
// ✅ Acceso completo a todos los logs del sistema
// ✅ Sin filtros de organización ni store aplicados
// ✅ Puede ver logs de todas las organizaciones y stores
```

#### 2. Admin de Organización
```typescript
// ✅ Acceso a logs de su organización
// ✅ Filtro automático: organizationId = user.organizationId
// ❌ No puede ver logs de otras organizaciones
```

#### 3. Admin de Store (Nuevo)
```typescript
// ✅ Acceso solo a logs de su store
// ✅ Filtro automático: storeId = user.storeId
// ❌ No puede ver logs de otras stores ni organización completa
```

#### 4. Usuario Regular
```typescript
// ✅ Solo puede ver sus propios logs
// ✅ Filtro automático: organizationId = user.organizationId
// ❌ No puede ver logs de otros usuarios
```

### Niveles de Acceso

#### 1. Super Admin
```typescript
// ✅ Acceso completo a todos los logs del sistema
// ✅ Sin filtros de organización aplicados
// ✅ Puede ver logs de todas las organizaciones
```

#### 2. Admin de Organización
```typescript
// ✅ Acceso a logs de su organización
// ✅ Filtro automático: organizationId = user.organizationId
// ❌ No puede ver logs de otras organizaciones
```

#### 3. Usuario Regular
```typescript
// ✅ Solo puede ver sus propios logs
// ✅ Filtro automático: organizationId = user.organizationId
// ❌ No puede ver logs de otros usuarios
```

## 🚀 Uso en Controladores

### Aplicación del Guard
```typescript
@Controller('audit')
@UseGuards(JwtAuthGuard, OrganizationAuditGuard)
export class AuditController {
  @Get('logs')
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    // El guard ya aplicó el filtro organizationId automáticamente
    return this.auditService.getAuditLogs(query, query.organizationId);
  }
}
```

### Query Parameters Automáticos
```typescript
// Antes del guard:
// GET /audit/logs?userId=123&action=CREATE

// Después del guard (usuario de org 456):
// GET /audit/logs?userId=123&action=CREATE&organizationId=456
```

## 🔧 Integración con AuditService

### Método getAuditLogs Actualizado
```typescript
async getAuditLogs(query: AuditLogQueryDto, organizationId?: string): Promise<AuditLog[]> {
  const where: Prisma.AuditLogWhereInput = {
    // ... otros filtros
    user: organizationId ? {
      organizationId: organizationId // ✅ Filtrado por organización
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
          organizationId: true
        }
      }
    }
  });
}
```

## 🧪 Casos de Prueba

### Caso 1: Super Admin
```typescript
// Usuario: { id: 1, role: 'super_admin', organizationId: null }
// Request: GET /audit/logs
// Resultado: ✅ Acceso a todos los logs del sistema
```

### Caso 2: Admin de Organización
```typescript
// Usuario: { id: 2, role: 'admin', organizationId: 456 }
// Request: GET /audit/logs
// Resultado: ✅ Solo logs de organizationId: 456
```

### Caso 3: Admin de Store (Nuevo)
```typescript
// Usuario: { id: 3, role: 'store_admin', storeId: 789 }
// Request: GET /audit/logs
// Resultado: ✅ Solo logs de storeId: 789
```

### Caso 4: Usuario sin Organización
```typescript
// Usuario: { id: 4, role: 'user', organizationId: null }
// Request: GET /audit/logs
// Resultado: ❌ Acceso denegado
```

## ⚠️ Consideraciones de Seguridad

### Validación de Datos
- ✅ Verificación de existencia de organizationId
- ✅ Validación de roles de usuario
- ✅ Protección contra manipulación de queries

### Manejo de Errores
```typescript
// Usuario sin organización
if (!user.organizationId && user.role !== 'super_admin') {
  throw new ForbiddenException('Usuario sin organización asignada');
}
```

### Auditoría de Accesos
```typescript
// Los accesos al sistema de auditoría también se auditán
await this.auditService.logAuth(
  user.id,
  AuditAction.AUDIT_ACCESS,
  { resource: 'audit_logs', organizationId: user.organizationId }
);
```

## 📊 Beneficios

### Seguridad Multi-Tenant
- ✅ **Aislamiento completo**: Cada organización solo ve sus logs
- ✅ **Filtrado automático**: No requiere lógica adicional en controladores
- ✅ **Escalable**: Funciona con cualquier número de organizaciones

### Mantenibilidad
- ✅ **Reutilizable**: Un solo guard para todo el módulo de auditoría
- ✅ **Centralizado**: Lógica de seguridad en un solo lugar
- ✅ **Testable**: Fácil de probar con diferentes escenarios

### Compliance
- ✅ **GDPR**: Datos aislados por organización
- ✅ **SOX**: Auditoría de accesos a logs
- ✅ **ISO 27001**: Control de acceso basado en roles
