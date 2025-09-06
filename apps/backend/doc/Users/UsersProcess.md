# Servicio de Usuarios - Proceso Completo - Vendix

## 📋 Descripción General

El **proceso de gestión de usuarios** es un sistema complejo que maneja la administración completa de identidades, perfiles y relaciones en el sistema multi-tenant de Vendix. Este documento detalla el flujo completo desde la creación hasta la ## 📊 Estados y Transiciones

### Estados de Usuario
```mermaid
graph TD
    A[Usuario Creado] --> B[Email Verificado]
    B --> C[Perfil Completado]
    C --> D[Roles Asignados]
    D --> E[Usuario Activo]
    E --> F[Perfil Actualizado]
    F --> G[Usuario Suspendido]
    G --> H[Usuario Archivado]
    H --> I[Usuario Reactivado]
    I --> E

    A --> J[Usuario Inactivo]
    B --> J
    C --> J
    D --> J
    E --> J
    F --> J

    G --> E
    H --> E
```

### Descripción de Estados

#### ACTIVE (Activo)
- Usuario completamente funcional
- Puede hacer login en todos los contextos
- Aparece en todos los listados
- Todas las operaciones disponibles

#### SUSPENDED (Suspendido)
- Usuario temporalmente inactivo
- **No puede hacer login** ❌
- Aparece en listados con filtro correspondiente
- Puede ser reactivado fácilmente
- Mantiene todas sus relaciones y permisos

#### ARCHIVED (Archivado)
- Usuario permanentemente archivado
- **No puede hacer login** ❌
- No aparece en listados normales
- Requiere proceso manual para reactivación
- Mantiene relaciones para auditoría histórica

#### Transiciones Permitidas
- `ACTIVE` ↔ `SUSPENDED` (DELETE /reactivate)
- `SUSPENDED` → `ARCHIVED` (POST /archive)
- `ARCHIVED` → `ACTIVE` (POST /reactivate - proceso manual)
- Cualquier estado → `INACTIVE` (desactivación temporal)rios.

## 🎯 Función Principal

### ¿Qué hace el proceso?
- **Gestión integral de identidades**: Desde creación hasta eliminación con todas las validaciones
- **Sistema de perfiles completo**: Información personal, seguridad y relaciones
- **Control de acceso multi-nivel**: Integración con organizaciones, roles y tiendas
- **Búsqueda y consulta avanzada**: Filtros, paginación y optimización de queries
- **Auditoría completa**: Registro de todas las operaciones para compliance
- **Seguridad robusta**: Hash de contraseñas y validaciones exhaustivas

## 🏗️ Arquitectura de Validaciones

### Diseño del Sistema
- **Validación en capas**: DTO → Guards → Service → Database
- **Multi-tenant obligatorio**: Todos los usuarios pertenecen a una organización
- **Relaciones complejas**: Conexión con roles, tiendas y organizaciones
- **Búsqueda optimizada**: Índices estratégicos para consultas eficientes
- **Auditoría integrada**: Registro automático de todas las operaciones

### Estructura de Validaciones
```
Request HTTP
    ↓
JWT Authentication Guard
    ↓
Permissions Authorization Guard
    ↓
DTO Validation (class-validator)
    ↓
Business Logic Validation
    ├── Organization existence check
    ├── Email uniqueness validation
    ├── Username uniqueness check
    └── Password strength validation
    ↓
Password Hashing (bcrypt)
    ↓
Database Operation
    ↓
Audit Logging
    ↓
Response HTTP ✅
```

## 🔄 Flujo de Operaciones Detallado

### 1. Creación de Usuario

#### Proceso Paso a Paso
```typescript
// 1. Validación de entrada y permisos
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('users:create')
async create(@Body() createUserDto: CreateUserDto) {

  // 2. Verificar existencia de organización
  const organization = await this.prisma.organizations.findUnique({
    where: { id: createUserDto.organization_id }
  });

  if (!organization) {
    throw new NotFoundException('Organization not found');
  }

  // 3. Validar unicidad de email en organización
  const existingUser = await this.prisma.users.findFirst({
    where: {
      email: createUserDto.email,
      organization_id: createUserDto.organization_id
    }
  });

  if (existingUser) {
    throw new ConflictException(
      'User with this email already exists in this organization'
    );
  }

  // 4. Validar unicidad de username global
  const existingUsername = await this.prisma.users.findUnique({
    where: { username: createUserDto.username }
  });

  if (existingUsername) {
    throw new ConflictException('Username already exists');
  }

  // 5. Hash de contraseña
  const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

  // 6. Crear usuario en base de datos
  const user = await this.prisma.users.create({
    data: {
      ...createUserDto,
      password: hashedPassword,
      organizations: {
        connect: { id: createUserDto.organization_id }
      },
      updated_at: new Date()
    },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      username: true,
      email: true,
      state: true
    }
  });

  // 7. Registrar auditoría
  await this.auditService.log({
    userId: req.user.id,
    action: AuditAction.CREATE,
    resource: AuditResource.USERS,
    resourceId: user.id,
    newValues: {
      email: user.email,
      username: user.username,
      organization_id: createUserDto.organization_id
    },
    metadata: {
      action: 'create_user',
      organization_id: createUserDto.organization_id
    }
  });

  return user;
}
```

#### Validaciones Específicas
- **Permisos requeridos**: `users:create`
- **Organización existente**: Validar que la organización existe
- **Email único por org**: No puede haber dos usuarios con mismo email en misma org
- **Username único global**: Username debe ser único en todo el sistema
- **Contraseña segura**: Mínimo 8 caracteres, hasheada con bcrypt
- **Campos requeridos**: first_name, last_name, username, email, password, organization_id

### 2. Consulta de Usuarios con Filtros

#### Proceso Completo
```typescript
// 1. Validación de permisos
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('users:read')
async findAll(@Query() query: UserQueryDto) {

  // 2. Parse y validación de parámetros
  const { page = 1, limit = 10, search, state, organization_id } = query;
  const skip = (page - 1) * limit;

  // 3. Construir filtros dinámicos
  const where: Prisma.usersWhereInput = {};

  // Filtro de búsqueda (nombre, apellido, email)
  if (search) {
    where.OR = [
      { first_name: { contains: search, mode: 'insensitive' } },
      { last_name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } }
    ];
  }

  // Filtro por estado
  if (state) {
    where.state = state;
  }

  // Filtro por organización
  if (organization_id) {
    where.organization_id = organization_id;
  }

  // 4. Ejecutar consultas en paralelo
  const [users, total] = await Promise.all([
    this.prisma.users.findMany({
      where,
      skip,
      take: limit,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        state: true,
        organizations: {
          select: { id: true, name: true }
        }
      }
    }),
    this.prisma.users.count({ where })
  ]);

  // 5. Construir respuesta con metadata
  return {
    data: users,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
}
```

#### Optimizaciones de Consulta
- **Paginación eficiente**: Skip/take para grandes datasets
- **Búsqueda insensible**: Case-insensitive search
- **Consultas paralelas**: Promise.all para count y data
- **Selección específica**: Solo campos necesarios
- **Ordenamiento**: Por fecha de creación descendente

### 3. Actualización de Usuario

#### Proceso de Update
```typescript
async update(id: number, updateUserDto: UpdateUserDto) {

  // 1. Verificar existencia del usuario
  await this.findOne(id);

  // 2. Preparar datos de actualización
  const updateData = { ...updateUserDto };

  // 3. Hash de contraseña si se incluye
  if (updateUserDto.password) {
    updateData.password = await bcrypt.hash(updateUserDto.password, 10);
  }

  // 4. Actualizar timestamp
  updateData.updated_at = new Date();

  // 5. Ejecutar actualización
  const updatedUser = await this.prisma.users.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      first_name: true,
      last_name: true,
      last_name: true,
      email: true,
      state: true,
      updated_at: true
    }
  });

  // 6. Registrar auditoría
  await this.auditService.log({
    userId: req.user.id,
    action: AuditAction.UPDATE,
    resource: AuditResource.USERS,
    resourceId: id,
    oldValues: { /* valores anteriores */ },
    newValues: updateData,
    metadata: {
      action: 'update_user'
    }
  });

  return updatedUser;
}
```

## 🔐 Medidas de Seguridad por Operación

### Creación de Usuarios
- ✅ **Autenticación**: JWT token válido requerido
- ✅ **Autorización**: Permiso `users:create` requerido
- ✅ **Validación de organización**: Organización debe existir
- ✅ **Unicidad de email**: Por organización
- ✅ **Unicidad de username**: Global
- ✅ **Hash de contraseña**: bcrypt con salt
- ✅ **Auditoría**: Registro completo de creación

### Consulta de Usuarios
- ✅ **Autenticación**: JWT token válido
- ✅ **Autorización**: Permiso `users:read`
- ✅ **Filtros seguros**: Solo campos permitidos
- ✅ **Paginación**: Protección contra consultas masivas
- ✅ **Selección controlada**: Campos sensibles excluidos

### Actualización de Usuarios
- ✅ **Autenticación**: JWT token válido
- ✅ **Autorización**: Permiso `users:update`
- ✅ **Existencia**: Usuario debe existir
- ✅ **Hash de contraseña**: Si se actualiza
- ✅ **Auditoría**: Registro de cambios

### Eliminación de Usuarios (Lógica)
- ✅ **Autenticación**: JWT token válido
- ✅ **Autorización**: Permiso `users:delete`
- ✅ **Existencia**: Usuario debe existir
- ✅ **Cambio de estado**: Usuario pasa a `SUSPENDED` (no eliminación física)
- ✅ **Auditoría**: Registro de suspensión con timestamp
- ✅ **Bloqueo de login**: Usuario suspendido no puede acceder al sistema

### Archivado de Usuarios
- ✅ **Autenticación**: JWT token válido
- ✅ **Autorización**: Permiso `users:archive`
- ✅ **Existencia**: Usuario debe existir y estar suspendido
- ✅ **Cambio de estado**: Usuario pasa a `ARCHIVED`
- ✅ **Auditoría**: Registro de archivado permanente
- ✅ **Ocultamiento**: Usuario no aparece en listados normales

### Reactivación de Usuarios
- ✅ **Autenticación**: JWT token válido
- ✅ **Autorización**: Permiso `users:reactivate`
- ✅ **Existencia**: Usuario debe existir y estar suspendido/archivado
- ✅ **Cambio de estado**: Usuario vuelve a `ACTIVE`
- ✅ **Auditoría**: Registro de reactivación
- ✅ **Restauración**: Usuario puede hacer login nuevamente

## 📊 Estados y Transiciones

### Estados de Usuario
```mermaid
graph TD
    A[Usuario Creado] --> B[Email Verificado]
    B --> C[Perfil Completado]
    C --> D[Roles Asignados]
    D --> E[Usuario Activo]
    E --> F[Perfil Actualizado]
    F --> G[Usuario Inactivo]
    G --> H[Usuario Eliminado]

    A --> I[Usuario Inactivo]
    B --> I
    C --> I
```

### Estados de Operación
```mermaid
graph TD
    A[Request Recibido] --> B[JWT Validado]
    B --> C[Permisos Verificados]
    C --> D[DTO Validado]
    D --> E[Reglas de Negocio]
    E --> F[Operación BD]
    F --> G[Auditoría Registrada]
    G --> H[Response Enviado]

    D --> I[Error de Validación]
    E --> J[Error de Negocio]
    F --> K[Error de BD]
```

## 🎯 Casos de Uso Detallados

### Caso 1: Creación de Usuario en Nueva Organización
```typescript
// Request
POST /api/users
Headers: Authorization: Bearer <admin_token>
Body: {
  "organization_id": 1,
  "first_name": "Ana",
  "last_name": "Martínez",
  "username": "ana.martinez",
  "email": "ana@empresa.com",
  "password": "SecurePass123!",
  "state": "active"
}

// Validaciones ejecutadas:
// 1. JWT válido y permisos users:create
// 2. Organización ID 1 existe
// 3. Email ana@empresa.com no existe en org 1
// 4. Username ana.martinez no existe globalmente
// 5. Contraseña hasheada con bcrypt
// 6. Usuario creado y auditado

// Resultado: Usuario creado con ID generado
```

### Caso 2: Búsqueda con Múltiples Filtros
```typescript
// Request
GET /api/users?page=1&limit=5&search=ana&state=active&organization_id=1

// Query construida:
{
  "where": {
    "AND": [
      {
        "OR": [
          { "first_name": { "contains": "ana", "mode": "insensitive" } },
          { "last_name": { "contains": "ana", "mode": "insensitive" } },
          { "email": { "contains": "ana", "mode": "insensitive" } }
        ]
      },
      { "state": "active" },
      { "organization_id": 1 }
    ]
  },
  "skip": 0,
  "take": 5,
  "orderBy": { "created_at": "desc" }
}

// Resultado: Lista paginada con metadata
```

### Caso 3: Actualización con Cambio de Contraseña
```typescript
// Request
PATCH /api/users/123
Headers: Authorization: Bearer <admin_token>
Body: {
  "first_name": "Ana María",
  "password": "NewSecurePass456!"
}

// Proceso:
// 1. Usuario 123 existe
// 2. Nueva contraseña hasheada
// 3. Campos actualizados en BD
// 4. Auditoría registrada

// Resultado: Usuario actualizado
```

## 🔧 Configuración Técnica

### Dependencias del Servicio
```json
{
  "prisma": "^5.0.0",
  "bcryptjs": "^2.4.3",
  "class-validator": "^0.14.0",
  "class-transformer": "^0.5.1",
  "@nestjs/jwt": "^10.0.0",
  "@nestjs/passport": "^10.0.0"
}
```

### Variables de Entorno Requeridas
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/vendix
BCRYPT_ROUNDS=10
JWT_SECRET=your-secret-key
DEFAULT_PAGE_SIZE=10
MAX_PAGE_SIZE=100
```

### Índices de Base de Datos Recomendados
```sql
-- Búsqueda por email en organización (crítico)
CREATE INDEX idx_users_email_org ON users(email, organization_id);

-- Búsqueda por username (único global)
CREATE INDEX idx_users_username ON users(username);

-- Búsqueda por estado
CREATE INDEX idx_users_state ON users(state);

-- Búsqueda por organización
CREATE INDEX idx_users_organization ON users(organization_id);

-- Búsqueda por fecha de creación
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- Búsqueda por nombre/apellido (para search)
CREATE INDEX idx_users_names ON users(first_name, last_name);
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
  "message": "Forbidden",
  "statusCode": 403
}
```
**Causa**: Usuario sin permiso `users:create`
**Solución**: Verificar permisos del usuario

#### Error 409 Conflict
```json
{
  "message": "User with this email already exists in this organization",
  "error": "Conflict",
  "statusCode": 409
}
```
**Causa**: Email duplicado en la organización
**Solución**: Usar email diferente o verificar usuario existente

#### Error 404 Not Found
```json
{
  "message": "User not found",
  "statusCode": 404
}
```
**Causa**: ID de usuario no existe
**Solución**: Verificar ID correcto

## 📈 Monitoreo y Métricas

### KPIs a Monitorear
- **Tiempo de respuesta**: Promedio < 150ms
- **Tasa de error**: < 1% en operaciones válidas
- **Búsquedas eficientes**: < 50ms en consultas simples
- **Creación de usuarios**: < 200ms con hash
- **Auditoría**: 100% de operaciones registradas

### Logs Importantes
```log
[Nest] LOG [UsersService] User created: ana.martinez by user 1
[Nest] LOG [UsersService] User updated: 123 by user 1
[Nest] ERROR [UsersService] Duplicate email attempt blocked
[Nest] WARN [UsersService] User not found: 999
```

### Alertas Críticas
- Múltiples intentos de crear usuarios duplicados
- Consultas que exceden tiempo límite
- Errores en hash de contraseñas
- Operaciones sin registro de auditoría

## 🔄 Próximos Pasos de Optimización

### Performance
- [ ] **Cache de usuarios**: Redis para usuarios frecuentes
- [ ] **Lazy loading**: Cargar relaciones bajo demanda
- [ ] **Database optimization**: Query optimization avanzada
- [ ] **Connection pooling**: Mejorar conexiones a BD

### Seguridad
- [ ] **Password policies**: Políticas avanzadas de contraseñas
- [ ] **Rate limiting**: Por usuario y endpoint
- [ ] **IP validation**: Control de direcciones IP
- [ ] **Session management**: Manejo avanzado de sesiones

### Funcionalidad
- [ ] **Bulk operations**: Creación masiva de usuarios
- [ ] **Import/Export**: CSV para migraciones
- [ ] **Avatar management**: Gestión de fotos de perfil
- [ ] **Two-factor auth**: Autenticación de dos factores
- [ ] **Email verification**: Verificación de correos

### Monitoreo
- [ ] **Advanced metrics**: Métricas detalladas de uso
- [ ] **Error tracking**: Seguimiento de errores
- [ ] **Performance monitoring**: Monitoreo de performance
- [ ] **User analytics**: Análisis de comportamiento
