# Servicio de Roles - Vendix

## 📋 Descripción General

El servicio de **Roles y Permisos** es el **sistema central de autorización** que gestiona el control de acceso basado en roles (RBAC) del sistema Vendix. Este servicio es fundamental para la seguridad y organización del sistema multi-tenant.

## 🎯 Funciones Principales

### ¿Qué hace el servicio?
- **Gestión completa de roles**: CRUD de roles con validaciones de seguridad
- **Sistema de permisos granular**: Control fino de acciones por recurso
- **Asignación dinámica**: Roles asignables a usuarios con auditoría completa
- **Regla de super admin único**: Garantiza que solo exista un super administrador
- **Filtrado por contexto**: Roles ocultos según nivel de permisos del usuario
- **Auditoría completa**: Registro de todas las operaciones de roles y permisos

## 🏗️ Arquitectura del Sistema RBAC

### Diseño del Sistema
- **Roles jerárquicos**: Super Admin → Admin → Manager → Employee → Customer
- **Permisos granulares**: Control por recurso, método HTTP y acción específica
- **Asignación flexible**: Múltiples roles por usuario con resolución de conflictos
- **Auditoría completa**: Tracking de cambios en roles y permisos
- **Validaciones de seguridad**: Reglas específicas para roles críticos

### Estructura de Roles
```
Super Admin (único)
├── Admin (múltiples)
│   ├── Manager (por tienda)
│   │   ├── Supervisor (por tienda)
│   │   └── Employee (por tienda)
│   └── Customer (global)
└── Owner (por organización)
```

## 🔄 Flujo de Operaciones Completo

### 1. Gestión de Roles
```typescript
// Crear rol con validaciones
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
async create(@Body() createRoleDto: CreateRoleDto, @Request() req) {
  // Validar nombre único
  // Verificar permisos del usuario
  // Crear rol con auditoría
  return await this.rolesService.create(createRoleDto, req.user.id);
}
```

### 2. Asignación de Roles
```typescript
// Asignar rol con validaciones de seguridad
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
async assignRoleToUser(@Body() dto: AssignRoleToUserDto, @Request() req) {
  // Validar existencia de usuario y rol
  // Verificar permisos para asignar super_admin
  // Aplicar regla de super admin único
  // Registrar auditoría
  return await this.rolesService.assignRoleToUser(dto, req.user.id);
}
```

## 🔐 Medidas de Seguridad Implementadas

### Validaciones Críticas
- **Super Admin único**: Solo puede existir un usuario con rol super_admin
- **Permisos de asignación**: Solo super_admins pueden asignar el rol super_admin
- **Filtrado de visibilidad**: Usuarios no super_admin no ven el rol super_admin
- **Auditoría obligatoria**: Todas las operaciones quedan registradas
- **Validación de roles del sistema**: Roles críticos no pueden ser eliminados

### Reglas de Negocio
```typescript
// Regla de Super Admin único
if (role.name === 'super_admin') {
  const existingSuperAdmin = await this.prismaService.user_roles.findFirst({
    where: { roles: { name: 'super_admin' } }
  });

  if (existingSuperAdmin) {
    throw new ConflictException('Solo puede existir un super administrador');
  }
}
```

## 📊 Endpoints Disponibles

### Gestión de Roles
- `POST /api/roles` - Crear rol
- `GET /api/roles` - Listar roles (filtrado por permisos)
- `GET /api/roles/:id` - Obtener rol específico
- `PATCH /api/roles/:id` - Actualizar rol
- `DELETE /api/roles/:id` - Eliminar rol

### Gestión de Permisos
- `POST /api/roles/:id/permissions` - Asignar permisos a rol
- `DELETE /api/roles/:id/permissions` - Remover permisos de rol

### Gestión de Usuarios
- `POST /api/roles/assign-to-user` - Asignar rol a usuario
- `POST /api/roles/remove-from-user` - Remover rol de usuario
- `GET /api/roles/user/:userId/roles` - Obtener roles de usuario
- `GET /api/roles/user/:userId/permissions` - Obtener permisos de usuario

## 🎯 Casos de Uso Principales

### 1. Creación de Rol Personalizado
```bash
POST /api/roles
{
  "name": "store_manager",
  "description": "Gerente de tienda específica",
  "is_system_role": false
}
```

### 2. Asignación de Rol con Validaciones
```bash
POST /api/roles/assign-to-user
{
  "userId": 123,
  "roleId": 5
}
```

### 3. Gestión de Permisos Granulares
```bash
POST /api/roles/5/permissions
{
  "permissionIds": [1, 2, 3, 4]
}
```

## 📈 Métricas y Monitoreo

### KPIs del Servicio
- **Tiempo de respuesta**: < 200ms para operaciones CRUD
- **Tasa de éxito**: > 99.5% en operaciones válidas
- **Auditoría completa**: 100% de operaciones registradas
- **Validaciones de seguridad**: 0% de bypass de reglas

### Alertas Críticas
- Intento de crear múltiples super_admins
- Fallos en validaciones de permisos
- Operaciones sin auditoría
- Roles del sistema modificados

## 🔧 Configuración y Dependencias

### Dependencias Principales
- **Prisma ORM**: Gestión de base de datos
- **JWT**: Autenticación y autorización
- **Class Validator**: Validaciones de DTOs
- **Audit Service**: Registro de operaciones

### Variables de Entorno
```env
# Base de datos
DATABASE_URL="postgresql://..."

# JWT
JWT_SECRET="your-secret-key"
JWT_EXPIRES_IN="1h"

# Auditoría
AUDIT_ENABLED=true
AUDIT_RETENTION_DAYS=365
```

## 🚀 Próximos Pasos

### Mejoras Planificadas
- [ ] **Cache de permisos**: Redis para mejorar performance
- [ ] **Roles temporales**: Expiración automática de roles
- [ ] **Aprobaciones**: Workflow para asignación de roles críticos
- [ ] **Reportes**: Dashboard de roles y permisos
- [ ] **Bulk operations**: Asignación masiva de roles

### Optimizaciones
- [ ] **Database indexing**: Optimización de consultas
- [ ] **Pagination**: Para listas grandes de roles
- [ ] **Soft delete**: Recuperación de roles eliminados
- [ ] **Versioning**: Historial de cambios en roles
