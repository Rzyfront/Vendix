# VENDIX - Users Module Permissions

## 🔐 Sistema de Permisos - Módulo de Usuarios

### Descripción General

El módulo de usuarios implementa un sistema granular de permisos basado en RBAC (Role-Based Access Control) que permite controlar el acceso a cada operación CRUD de manera independiente. Los permisos están integrados con el sistema de roles y organizaciones para proporcionar control multi-tenant.

## 📋 Permisos Disponibles

### Permisos CRUD Básicos

| Permiso | Descripción | Operación |
|---------|-------------|-----------|
| `USERS_READ` | Permite listar y ver detalles de usuarios | `GET /api/users` |
| `USERS_CREATE` | Permite crear nuevos usuarios | `POST /api/users` |
| `USERS_UPDATE` | Permite actualizar usuarios existentes | `PATCH /api/users/:id` |
| `USERS_DELETE` | Permite eliminar usuarios | `DELETE /api/users/:id` |

### Permisos Avanzados

| Permiso | Descripción | Uso |
|---------|-------------|-----|
| `USERS_MANAGE_ALL` | Permite todas las operaciones en cualquier organización | Super admin |
| `USERS_VIEW_AUDIT` | Permite ver logs de auditoría de usuarios | `GET /api/audit?resource=USERS` |
| `USERS_BULK_OPERATIONS` | Permite operaciones masivas (futuro) | Bulk create/update/delete |

## 👥 Roles y Permisos Predefinidos

### 1. Super Admin
```json
{
  "name": "Super Admin",
  "permissions": [
    "USERS_MANAGE_ALL",
    "USERS_READ",
    "USERS_CREATE",
    "USERS_UPDATE",
    "USERS_DELETE",
    "USERS_VIEW_AUDIT"
  ],
  "scope": "GLOBAL"
}
```

**Características:**
- ✅ Acceso a todas las organizaciones
- ✅ Bypass de validaciones de negocio
- ✅ No puede ser eliminado por otros usuarios
- ✅ Acceso completo a auditoría

### 2. Admin de Organización
```json
{
  "name": "Organization Admin",
  "permissions": [
    "USERS_READ",
    "USERS_CREATE",
    "USERS_UPDATE",
    "USERS_DELETE"
  ],
  "scope": "ORGANIZATION"
}
```

**Características:**
- ✅ Gestión completa de usuarios en su organización
- ✅ No puede gestionar usuarios de otras organizaciones
- ✅ Respeta validaciones de negocio
- ✅ Acceso limitado a auditoría

### 3. Manager
```json
{
  "name": "Manager",
  "permissions": [
    "USERS_READ",
    "USERS_UPDATE"
  ],
  "scope": "ORGANIZATION"
}
```

**Características:**
- ✅ Puede ver y editar usuarios
- ❌ No puede crear nuevos usuarios
- ❌ No puede eliminar usuarios
- ✅ Solo usuarios de su organización

### 4. Viewer (Solo Lectura)
```json
{
  "name": "Viewer",
  "permissions": [
    "USERS_READ"
  ],
  "scope": "ORGANIZATION"
}
```

**Características:**
- ✅ Solo puede ver usuarios
- ❌ No puede modificar datos
- ✅ Solo usuarios de su organización

## 🔒 Lógica de Autorización

### Verificación de Permisos

```typescript
// Ejemplo de guard de permisos
@Injectable()
export class UsersPermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const permission = this.getRequiredPermission(context);

    return this.permissionsService.hasPermission(user, permission);
  }
}
```

### Alcance Multi-Tenant

```typescript
// Verificación de organización
private async validateOrganizationAccess(
  user: User,
  targetUser: User,
  permission: string
): Promise<boolean> {
  // Super admin tiene acceso global
  if (user.roles.some(role => role.name === 'Super Admin')) {
    return true;
  }

  // Otros roles solo acceden a su organización
  return user.organization_id === targetUser.organization_id;
}
```

## 🚫 Restricciones Especiales

### Reglas de Negocio

1. **Auto-Eliminación**
   ```typescript
   // Usuario no puede eliminarse a sí mismo
   if (userId === currentUser.id) {
     throw new ForbiddenException('Cannot delete yourself');
   }
   ```

2. **Super Admin Protection**
   ```typescript
   // Super admin no puede ser eliminado por no-super-admins
   if (targetUser.roles.some(role => role.name === 'Super Admin')) {
     throw new ForbiddenException('Cannot delete Super Admin');
   }
   ```

3. **Organización Isolation**
   ```typescript
   // Usuarios solo pueden gestionar usuarios de su organización
   if (currentUser.organization_id !== targetUser.organization_id) {
     throw new ForbiddenException('Access denied to other organizations');
   }
   ```

## 📊 Matriz de Permisos

| Operación | Super Admin | Org Admin | Manager | Viewer |
|-----------|-------------|-----------|---------|--------|
| Listar usuarios | ✅ | ✅ (propia org) | ✅ (propia org) | ✅ (propia org) |
| Ver usuario específico | ✅ | ✅ (propia org) | ✅ (propia org) | ✅ (propia org) |
| Crear usuario | ✅ | ✅ (propia org) | ❌ | ❌ |
| Actualizar usuario | ✅ | ✅ (propia org) | ✅ (propia org) | ❌ |
| Eliminar usuario | ✅ | ✅ (propia org) | ❌ | ❌ |
| Ver auditoría | ✅ | ❌ | ❌ | ❌ |
| Gestionar otras orgs | ✅ | ❌ | ❌ | ❌ |

## 🔧 Configuración de Guards

### Uso de Decoradores

```typescript
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {

  @Get()
  @Permissions('USERS_READ')
  async findAll(@Query() query: UsersQueryDto) {
    // Implementation
  }

  @Post()
  @Permissions('USERS_CREATE')
  async create(@Body() createUserDto: CreateUserDto) {
    // Implementation
  }

  @Patch(':id')
  @Permissions('USERS_UPDATE')
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    // Implementation
  }

  @Delete(':id')
  @Permissions('USERS_DELETE')
  async remove(@Param('id') id: string) {
    // Implementation
  }
}
```

### Guards Personalizados

```typescript
@Injectable()
export class OrganizationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const targetOrgId = request.params.organizationId || request.body.organization_id;

    // Super admin bypass
    if (this.isSuperAdmin(user)) {
      return true;
    }

    // Check organization access
    return user.organization_id === targetOrgId;
  }
}
```

## 🔍 Validación de Permisos en Servicio

### Patrón de Validación

```typescript
@Injectable()
export class UsersService {
  async create(createUserDto: CreateUserDto, currentUser: User) {
    // Verificar permisos
    await this.permissionsService.validatePermission(
      currentUser,
      'USERS_CREATE'
    );

    // Verificar acceso a organización
    await this.validateOrganizationAccess(
      currentUser,
      createUserDto.organization_id
    );

    // Crear usuario
    return this.prisma.user.create({
      data: {
        ...createUserDto,
        password: await bcrypt.hash(createUserDto.password, 12),
        created_by: currentUser.id
      }
    });
  }
}
```

## 📋 Casos de Uso Comunes

### 1. Creación de Usuario por Admin
```typescript
// Admin de organización crea un nuevo usuario
POST /api/users
Authorization: Bearer <admin_token>
{
  "organization_id": 1,
  "first_name": "Juan",
  "last_name": "Pérez",
  "username": "juan.perez",
  "email": "juan.perez@company.com",
  "password": "SecurePass123!",
  "state": "active"
}
```

**Validaciones realizadas:**
- ✅ Token JWT válido
- ✅ Usuario tiene `USERS_CREATE`
- ✅ `organization_id` pertenece a la organización del usuario
- ✅ Email único en la organización
- ✅ Username único global

### 2. Actualización por Manager
```typescript
// Manager actualiza datos de un usuario
PATCH /api/users/123
Authorization: Bearer <manager_token>
{
  "first_name": "Juan Carlos",
  "state": "active"
}
```

**Validaciones realizadas:**
- ✅ Token JWT válido
- ✅ Usuario tiene `USERS_UPDATE`
- ✅ Usuario objetivo pertenece a la misma organización
- ✅ Usuario objetivo existe

### 3. Intento de Acceso No Autorizado
```typescript
// Usuario sin permisos intenta crear usuario
POST /api/users
Authorization: Bearer <viewer_token>
{
  "organization_id": 1,
  "first_name": "Nuevo",
  "last_name": "Usuario",
  "username": "nuevo.usuario",
  "email": "nuevo@company.com",
  "password": "SecurePass123!"
}
```

**Respuesta esperada:**
```json
{
  "statusCode": 403,
  "message": "Forbidden resource",
  "error": "Forbidden"
}
```

## 🚨 Manejo de Errores de Permisos

### Códigos de Error

| Código | Descripción | Causa |
|--------|-------------|-------|
| 401 | Unauthorized | Token inválido o expirado |
| 403 | Forbidden | Usuario no tiene permisos requeridos |
| 403 | Organization Access Denied | Intento de acceder a otra organización |
| 403 | Cannot Delete Yourself | Usuario intenta auto-eliminarse |
| 403 | Cannot Delete Super Admin | Intento de eliminar super admin |

### Logging de Accesos Denegados

```typescript
// Registro de intentos de acceso no autorizado
this.logger.warn(`Access denied: User ${user.id} attempted ${operation} on user ${targetUserId}`);
```

## 🔧 Configuración de Roles Iniciales

### Seed de Roles y Permisos

```typescript
// Seed para roles iniciales
const roles = [
  {
    name: 'Super Admin',
    permissions: ['USERS_MANAGE_ALL', 'USERS_READ', 'USERS_CREATE', 'USERS_UPDATE', 'USERS_DELETE', 'USERS_VIEW_AUDIT'],
    is_system: true
  },
  {
    name: 'Organization Admin',
    permissions: ['USERS_READ', 'USERS_CREATE', 'USERS_UPDATE', 'USERS_DELETE'],
    is_system: false
  },
  {
    name: 'Manager',
    permissions: ['USERS_READ', 'USERS_UPDATE'],
    is_system: false
  },
  {
    name: 'Viewer',
    permissions: ['USERS_READ'],
    is_system: false
  }
];
```

## 📊 Monitoreo de Permisos

### Métricas a Monitorear

- **Accesos denegados por hora**
- **Uso de permisos por rol**
- **Intentos de acceso a organizaciones no autorizadas**
- **Cambios en asignación de roles**

### Alertas de Seguridad

- ✅ Más de 10 accesos denegados en 5 minutos
- ✅ Intento de acceso a super admin
- ✅ Cambios masivos en permisos
- ✅ Acceso desde IP sospechosa

## 🔄 Actualización de Permisos

### Proceso de Actualización

1. **Revisar impacto**: Analizar qué usuarios se verán afectados
2. **Actualizar roles**: Modificar permisos en base de datos
3. **Notificar usuarios**: Informar sobre cambios de acceso
4. **Auditar cambios**: Registrar modificaciones en logs
5. **Validar funcionamiento**: Probar operaciones afectadas

### Migración de Permisos

```sql
-- Ejemplo de migración de permisos
UPDATE roles
SET permissions = array_append(permissions, 'USERS_VIEW_AUDIT')
WHERE name = 'Organization Admin';
```

## 📚 Referencias

- [Documentación de Roles](../Roles/Roles.md)
- [Guía de Autenticación](../Auth/README.md)
- [Sistema de Auditoría](../Audit/README.md)
- [Arquitectura Multi-Tenant](../../frontend/doc/MULTI_TENANT_ARCHITECTURE.md)

---

**Nota**: Este sistema de permisos garantiza seguridad granular mientras mantiene la flexibilidad necesaria para diferentes tipos de usuarios y organizaciones.
