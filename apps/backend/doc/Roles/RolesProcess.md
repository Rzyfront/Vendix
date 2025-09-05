# Servicio de Roles - Proceso Completo - Vendix

## 📋 Descripción General

El **proceso de gestión de roles** es un sistema complejo que maneja la autorización basada en roles (RBAC) con múltiples capas de validación y seguridad. Este documento detalla el flujo completo desde la creación hasta la asignación de roles.

## 🎯 Función Principal

### ¿Qué hace el proceso?
- **Gestión integral de roles**: Desde creación hasta eliminación con todas las validaciones
- **Control de permisos granulares**: Asignación y remoción de permisos específicos
- **Asignación segura a usuarios**: Con validaciones de jerarquía y unicidad
- **Auditoría completa**: Registro de todas las operaciones para compliance
- **Filtrado contextual**: Información mostrada según permisos del usuario

## 🏗️ Arquitectura de Validaciones

### Diseño del Sistema
- **Validación en capas**: DTO → Guards → Service → Database
- **Jerarquía de permisos**: Super Admin → Admin → Manager → Employee
- **Regla de unicidad**: Solo un Super Admin en el sistema
- **Auditoría obligatoria**: Todas las operaciones quedan registradas

### Estructura de Validaciones
```
Request HTTP
    ↓
JWT Authentication Guard
    ↓
Roles Authorization Guard
    ↓
DTO Validation (class-validator)
    ↓
Business Logic Validation
    ├── Role existence check
    ├── Permission validation
    ├── Uniqueness rules
    └── System role protection
    ↓
Database Operation
    ↓
Audit Logging
    ↓
Response HTTP ✅
```

## 🔄 Flujo de Operaciones Detallado

### 1. Creación de Rol

#### Proceso Paso a Paso
```typescript
// 1. Validación de entrada
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
async create(@Body() createRoleDto: CreateRoleDto, @Request() req) {

  // 2. Verificar permisos del usuario
  const userRoles = await this.prismaService.user_roles.findMany({
    where: { user_id: req.user.id },
    include: { roles: true }
  });

  // 3. Validar nombre único
  const existingRole = await this.prismaService.roles.findUnique({
    where: { name: createRoleDto.name }
  });

  if (existingRole) {
    throw new ConflictException('Ya existe un rol con este nombre');
  }

  // 4. Crear rol en base de datos
  const role = await this.prismaService.roles.create({
    data: {
      name: createRoleDto.name,
      description: createRoleDto.description,
      is_system_role: createRoleDto.is_system_role || false
    }
  });

  // 5. Registrar auditoría
  await this.auditService.log({
    userId: req.user.id,
    action: AuditAction.CREATE,
    resource: AuditResource.ROLES,
    resourceId: role.id,
    newValues: { name: role.name, description: role.description },
    metadata: {
      action: 'create_role',
      role_name: role.name
    }
  });

  return role;
}
```

#### Validaciones Específicas
- **Permisos requeridos**: SUPER_ADMIN o ADMIN
- **Nombre único**: No puede existir otro rol con el mismo nombre
- **Campos obligatorios**: name (requerido), description (opcional)
- **Auditoría**: Registro completo de la creación

### 2. Asignación de Rol a Usuario

#### Proceso Completo
```typescript
// 1. Validación inicial
async assignRoleToUser(assignRoleToUserDto: AssignRoleToUserDto, adminUserId: number) {
  const { userId, roleId } = assignRoleToUserDto;

  // 2. Verificar existencia del usuario
  const user = await this.prismaService.users.findUnique({
    where: { id: userId },
    select: { id: true, email: true, first_name: true, last_name: true }
  });

  if (!user) {
    throw new NotFoundException('Usuario no encontrado');
  }

  // 3. Verificar existencia del rol
  const role = await this.prismaService.roles.findUnique({
    where: { id: roleId },
    select: { id: true, name: true }
  });

  if (!role) {
    throw new NotFoundException('Rol no encontrado');
  }

  // 4. Validación especial para Super Admin
  if (role.name === 'super_admin') {
    // Verificar permisos del admin
    const adminUserRoles = await this.prismaService.user_roles.findMany({
      where: { user_id: adminUserId },
      include: { roles: true }
    });

    const isSuperAdmin = adminUserRoles.some(ur => ur.roles?.name === 'super_admin');

    if (!isSuperAdmin) {
      throw new ForbiddenException('Solo los super administradores pueden asignar el rol super_admin');
    }

    // Verificar unicidad de Super Admin
    const existingSuperAdmin = await this.prismaService.user_roles.findFirst({
      where: {
        roles: {
          name: 'super_admin'
        }
      },
      include: {
        users: {
          select: { id: true, email: true, first_name: true, last_name: true }
        }
      }
    });

    if (existingSuperAdmin) {
      throw new ConflictException(`Ya existe un super administrador: ${existingSuperAdmin.users?.email}. Solo puede existir un super administrador en el sistema.`);
    }
  }

  // 5. Verificar que el usuario no tenga ya este rol
  const existingUserRole = await this.prismaService.user_roles.findUnique({
    where: {
      user_id_role_id: {
        user_id: userId,
        role_id: roleId
      }
    }
  });

  if (existingUserRole) {
    throw new ConflictException('El usuario ya tiene este rol asignado');
  }

  // 6. Asignar el rol
  const userRole = await this.prismaService.user_roles.create({
    data: {
      user_id: userId,
      role_id: roleId
    },
    include: {
      users: {
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true
        }
      },
      roles: true
    }
  });

  // 7. Registrar auditoría
  await this.auditService.log({
    userId: adminUserId,
    action: AuditAction.PERMISSION_CHANGE,
    resource: AuditResource.USERS,
    resourceId: userId,
    newValues: { assigned_role: role.name },
    metadata: {
      action: 'assign_role_to_user',
      target_user: user.email,
      role_name: role.name
    }
  });

  return userRole;
}
```

#### Validaciones por Tipo de Rol
- **Super Admin**: Requiere ser Super Admin + Unicidad
- **Roles normales**: Solo permisos básicos de admin
- **Roles del sistema**: Protegidos contra eliminación
- **Duplicados**: No se puede asignar el mismo rol dos veces

### 3. Gestión de Permisos

#### Asignación de Permisos
```typescript
async assignPermissions(roleId: number, assignPermissionsDto: AssignPermissionsDto, userId: number) {
  // 1. Verificar existencia del rol
  const role = await this.findOne(roleId);

  // 2. Validar existencia de permisos
  const permissions = await this.prismaService.permissions.findMany({
    where: {
      id: { in: assignPermissionsDto.permissionIds },
      status: 'active'
    }
  });

  if (permissions.length !== assignPermissionsDto.permissionIds.length) {
    throw new BadRequestException('Uno o más permisos no existen o están inactivos');
  }

  // 3. Crear relaciones role_permissions
  const rolePermissions = assignPermissionsDto.permissionIds.map(permissionId => ({
    role_id: roleId,
    permission_id: permissionId,
    granted: true
  }));

  await this.prismaService.role_permissions.createMany({
    data: rolePermissions,
    skipDuplicates: true
  });

  // 4. Registrar auditoría
  await this.auditService.log({
    userId,
    action: AuditAction.PERMISSION_CHANGE,
    resource: AuditResource.ROLES,
    resourceId: roleId,
    newValues: { assigned_permissions: assignPermissionsDto.permissionIds },
    metadata: {
      action: 'assign_permissions_to_role',
      role_name: role.name,
      permissions_count: assignPermissionsDto.permissionIds.length
    }
  });

  return await this.findOne(roleId);
}
```

## 🔐 Medidas de Seguridad por Operación

### Creación de Roles
- ✅ **Autenticación**: JWT token válido requerido
- ✅ **Autorización**: Rol SUPER_ADMIN o ADMIN
- ✅ **Validación**: Nombre único, campos requeridos
- ✅ **Auditoría**: Registro completo de creación

### Asignación de Roles
- ✅ **Autenticación**: JWT token válido
- ✅ **Autorización**: SUPER_ADMIN o ADMIN
- ✅ **Validación de existencia**: Usuario y rol deben existir
- ✅ **Regla de unicidad**: Solo un Super Admin
- ✅ **Permisos especiales**: Super Admin puede asignar Super Admin
- ✅ **Prevención de duplicados**: No asignar rol ya existente
- ✅ **Auditoría**: Registro de asignación

### Gestión de Permisos
- ✅ **Autenticación**: JWT token válido
- ✅ **Autorización**: SUPER_ADMIN o ADMIN
- ✅ **Validación**: Permisos deben existir y estar activos
- ✅ **Duplicados**: Skip de permisos ya asignados
- ✅ **Auditoría**: Registro de cambios en permisos

## 📊 Estados y Transiciones

### Estados de un Rol
```mermaid
graph TD
    A[Rol Creado] --> B[Permisos Asignados]
    B --> C[Usuario Asignado]
    C --> D[Rol Activo]
    D --> E[Permisos Modificados]
    E --> F[Usuario Removido]
    F --> G[Rol Inactivo]
    G --> H[Rol Eliminado]

    A --> I[Rol Eliminado]
    B --> I
    C --> I
```

### Estados de Asignación
```mermaid
graph TD
    A[Usuario Identificado] --> B[Rol Identificado]
    B --> C[Validar Permisos]
    C --> D{¿Es Super Admin?}
    D -->|Sí| E[Validar Unicidad]
    D -->|No| F[Asignar Rol]
    E --> G{¿Ya existe Super Admin?}
    G -->|Sí| H[Error: Conflicto]
    G -->|No| F
    F --> I[Crear Relación]
    I --> J[Auditoría]
    J --> K[Éxito]
```

## 🎯 Casos de Uso Detallados

### Caso 1: Creación de Rol Personalizado
```typescript
// Request
POST /api/roles
Headers: Authorization: Bearer <token>
Body: {
  "name": "store_auditor",
  "description": "Auditor especializado para tienda",
  "is_system_role": false
}

// Validaciones ejecutadas:
// 1. JWT válido
// 2. Usuario tiene rol SUPER_ADMIN o ADMIN
// 3. Nombre 'store_auditor' no existe
// 4. Campos válidos

// Resultado: Rol creado con ID generado
```

### Caso 2: Asignación de Super Admin
```typescript
// Request
POST /api/roles/assign-to-user
Headers: Authorization: Bearer <super_admin_token>
Body: {
  "userId": 123,
  "roleId": 1  // Super Admin role
}

// Validaciones ejecutadas:
// 1. JWT válido
// 2. Usuario actual es SUPER_ADMIN
// 3. Usuario destino existe
// 4. Rol Super Admin existe
// 5. NO existe otro Super Admin
// 6. Usuario no tiene ya el rol

// Resultado: Super Admin asignado
```

### Caso 3: Error de Unicidad
```typescript
// Request
POST /api/roles/assign-to-user
Body: {
  "userId": 456,
  "roleId": 1
}

// Resultado esperado:
// HTTP 409 Conflict
// {
//   "message": "Ya existe un super administrador: admin@vendix.com. Solo puede existir un super administrador en el sistema.",
//   "error": "Conflict",
//   "statusCode": 409
// }
```

## 🔧 Configuración Técnica

### Dependencias del Servicio
```json
{
  "prisma": "^5.0.0",
  "class-validator": "^0.14.0",
  "class-transformer": "^0.5.1",
  "@nestjs/jwt": "^10.0.0",
  "@nestjs/passport": "^10.0.0"
}
```

### Variables de Entorno Requeridas
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/vendix
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=1h
AUDIT_SERVICE_ENABLED=true
```

### Índices de Base de Datos Recomendados
```sql
-- Para búsquedas rápidas de roles
CREATE INDEX idx_roles_name ON roles(name);

-- Para validaciones de unicidad de Super Admin
CREATE INDEX idx_user_roles_super_admin ON user_roles(role_id) WHERE role_id = 1;

-- Para auditoría eficiente
CREATE INDEX idx_audit_roles ON audit_logs(resource, resource_id) WHERE resource = 'ROLES';
```

## 🚨 Manejo de Errores

### Errores Comunes y Soluciones

#### Error 401 Unauthorized
```json
{
  "message": "Unauthorized",
  "statusCode": 401
}
```
**Causa**: Token JWT inválido o expirado
**Solución**: Refrescar token o hacer login nuevamente

#### Error 403 Forbidden
```json
{
  "message": "Solo los super administradores pueden asignar el rol super_admin",
  "statusCode": 403
}
```
**Causa**: Usuario sin permisos para asignar Super Admin
**Solución**: Usar cuenta con rol SUPER_ADMIN

#### Error 409 Conflict
```json
{
  "message": "Ya existe un super administrador: admin@email.com. Solo puede existir un super administrador en el sistema.",
  "statusCode": 409
}
```
**Causa**: Intento de crear múltiples Super Admins
**Solución**: Remover Super Admin existente antes de asignar nuevo

#### Error 404 Not Found
```json
{
  "message": "Rol no encontrado",
  "statusCode": 404
}
```
**Causa**: ID de rol no existe
**Solución**: Verificar ID correcto en base de datos

## 📈 Monitoreo y Métricas

### KPIs a Monitorear
- **Tiempo de respuesta**: Promedio < 150ms
- **Tasa de error**: < 1% en operaciones válidas
- **Auditoría**: 100% de operaciones registradas
- **Validaciones**: 0% de bypass de seguridad

### Logs Importantes
```log
[Nest] LOG [RolesService] Role created: store_manager by user 1
[Nest] LOG [RolesService] Super admin assigned to user 123 by user 1
[Nest] ERROR [RolesService] Attempt to create duplicate super admin blocked
[Nest] WARN [RolesService] Permission validation failed for user 456
```

### Alertas Críticas
- Múltiples intentos de crear Super Admin
- Fallos en validaciones de permisos
- Operaciones sin registro de auditoría
- Roles del sistema modificados incorrectamente

## 🔄 Próximos Pasos de Optimización

### Performance
- [ ] **Cache de roles**: Redis para roles frecuentemente accedidos
- [ ] **Lazy loading**: Cargar permisos bajo demanda
- [ ] **Database indexing**: Optimización de consultas complejas
- [ ] **Connection pooling**: Mejorar conexiones a BD

### Seguridad
- [ ] **Rate limiting**: Por usuario y endpoint
- [ ] **IP whitelist**: Para operaciones críticas
- [ ] **2FA**: Para asignación de roles críticos
- [ ] **Session validation**: Verificación de sesiones activas

### Funcionalidad
- [ ] **Bulk operations**: Asignación masiva de roles
- [ ] **Role templates**: Plantillas predefinidas de roles
- [ ] **Temporary roles**: Roles con expiración automática
- [ ] **Role approval workflow**: Aprobaciones para roles críticos

### Monitoreo
- [ ] **Dashboard**: Visualización de roles y permisos
- [ ] **Reports**: Reportes de actividad de roles
- [ ] **Alerts**: Notificaciones de actividades sospechosas
- [ ] **Audit trails**: Historial completo de cambios
