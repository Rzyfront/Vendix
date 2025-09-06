# Servicio de Usuarios - Vendix

## 📋 Descripción General

El servicio de **Gestión de Usuarios** es el **sistema central de administración de usuarios** del sistema Vendix. Este servicio es fundamental para la gestión de identidades, perfiles de usuario y relaciones organizacionales en el sistema multi-tenant.

## 🎯 Funciones Principales

### ¿Qué hace el servicio?
- **Gestión completa de usuarios**: CRUD con validaciones exhaustivas
- **Sistema de perfiles**: Información detallada de usuarios y sus relaciones
- **Control de acceso**: Integración con sistema de roles y permisos
- **Organización multi-tenant**: Soporte completo para múltiples organizaciones
- **Búsqueda y filtrado avanzado**: Consultas eficientes con paginación
- **Seguridad de contraseñas**: Hash seguro y validaciones robustas

## 🏗️ Arquitectura del Sistema de Usuarios

### Diseño del Sistema
- **Multi-tenant por defecto**: Cada usuario pertenece a una organización
- **Relaciones complejas**: Conexión con roles, tiendas y organizaciones
- **Validaciones estrictas**: Unicidad de email por organización
- **Búsqueda optimizada**: Índices y consultas eficientes
- **Auditoría integrada**: Registro de todas las operaciones

### Estructura de Usuarios
```
Usuario
├── Información Personal
│   ├── first_name, last_name
│   ├── username (único global)
│   └── email (único por organización)
├── Seguridad
│   ├── password (hash bcrypt)
│   └── state (active/inactive)
├── Relaciones
│   ├── organization (obligatoria)
│   ├── roles (múltiples)
│   └── stores (tiendas asignadas)
└── Metadata
    ├── created_at, updated_at
    └── onboarding_completed
```

## 🔄 Flujo de Operaciones Completo

### 1. Creación de Usuario
```typescript
// Validación y creación con hash de contraseña
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('users:create')
async create(@Body() createUserDto: CreateUserDto) {
  // Validar unicidad email por organización
  // Hash de contraseña con bcrypt
  // Crear usuario con relaciones
  return await this.usersService.create(createUserDto);
}
```

### 2. Consulta de Usuarios
```typescript
// Búsqueda avanzada con filtros y paginación
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('users:read')
async findAll(@Query() query: UserQueryDto) {
  // Aplicar filtros de búsqueda
  // Paginación automática
  // Incluir relaciones necesarias
  return await this.usersService.findAll(query);
}
```

## 🔐 Medidas de Seguridad Implementadas

### Validaciones Críticas
- **Unicidad de email**: Por organización para evitar conflictos
- **Hash de contraseñas**: bcrypt con salt rounds configurables
- **Validaciones de entrada**: DTOs con class-validator
- **Control de permisos**: Sistema granular por operación
- **Protección de datos**: Campos sensibles filtrados en respuestas

### Reglas de Negocio
```typescript
// Validación de unicidad por organización
const existingUser = await this.prisma.users.findFirst({
  where: {
    email,
    organization_id
  }
});

if (existingUser) {
  throw new ConflictException(
    'User with this email already exists in this organization'
  );
}
```

## 📊 Endpoints Disponibles

### Gestión de Usuarios
- `POST /api/users` - Crear usuario
- `GET /api/users` - Listar usuarios con filtros y paginación
- `GET /api/users/:id` - Obtener usuario específico con relaciones
- `PATCH /api/users/:id` - Actualizar usuario
- `DELETE /api/users/:id` - **Suspender usuario (eliminación lógica)**
- `POST /api/users/:id/archive` - **Archivar usuario permanentemente**
- `POST /api/users/:id/reactivate` - **Reactivar usuario suspendido**

### Parámetros de Consulta
```typescript
{
  "page": 1,           // Página actual
  "limit": 10,         // Registros por página
  "search": "john",    // Búsqueda por nombre/email
  "state": "active",   // Filtro por estado
  "organization_id": 1 // Filtro por organización
}
```

## 🎯 Casos de Uso Principales

### 1. Creación de Nuevo Empleado
```bash
POST /api/users
{
  "organization_id": 1,
  "first_name": "María",
  "last_name": "González",
  "username": "maria.gonzalez",
  "email": "maria@empresa.com",
  "password": "SecurePass123!",
  "state": "active"
}
```

### 2. Búsqueda de Usuarios
```bash
GET /api/users?page=1&limit=10&search=maria&state=active
```

### 3. Actualización de Perfil
```bash
PATCH /api/users/123
{
  "first_name": "María José",
  "state": "active"
}
```

### 4. Consulta Detallada con Relaciones
```bash
GET /api/users/123
# Retorna usuario con organización, roles y tiendas
```

## �️ **Eliminación Lógica de Usuarios**

### ¿Por qué eliminación lógica?
- **Preservación de datos**: Los usuarios nunca se eliminan físicamente de la base de datos
- **Auditoría completa**: Se mantiene el historial de todas las operaciones
- **Integridad referencial**: No se pierden relaciones con otras entidades
- **Recuperación posible**: Los usuarios pueden ser reactivados si es necesario

### Estados de Usuario
```typescript
enum UserStatus {
  ACTIVE = 'active',       // Usuario activo y funcional
  SUSPENDED = 'suspended', // Usuario suspendido temporalmente
  ARCHIVED = 'archived'    // Usuario archivado permanentemente
}
```

### Operaciones de Eliminación Lógica

#### 1. Suspensión Temporal (DELETE)
```bash
DELETE /api/users/123
# Cambia estado a 'suspended'
# Usuario no puede hacer login
# Aparece en listados con filtro correspondiente
```

#### 2. Archivado Permanente (POST)
```bash
POST /api/users/123/archive
# Cambia estado a 'archived'
# Usuario no puede hacer login
# No aparece en listados normales
```

#### 3. Reactivación (POST)
```bash
POST /api/users/123/reactivate
# Cambia estado a 'active'
# Usuario puede hacer login nuevamente
# Aparece en todos los listados
```

### Comportamiento del Sistema

#### Usuarios SUSPENDED:
- ❌ **No pueden hacer login** en ningún contexto
- ✅ **Aparecen en listados** con filtro `state=suspended`
- ✅ **Pueden ser reactivados** con endpoint `/reactivate`
- ✅ **Mantienen todas sus relaciones** (roles, tiendas, organización)

#### Usuarios ARCHIVED:
- ❌ **No pueden hacer login** en ningún contexto
- ❌ **No aparecen en listados** normales (solo con filtro específico)
- ❌ **No pueden ser reactivados** fácilmente (requiere proceso manual)
- ✅ **Mantienen todas sus relaciones** para auditoría

### Filtros de Consulta
```bash
# Solo usuarios activos
GET /api/users?state=active

# Solo usuarios suspendidos
GET /api/users?state=suspended

# Todos los usuarios (incluyendo archived)
GET /api/users?include_archived=true

# Búsqueda en usuarios suspendidos
GET /api/users?state=suspended&search=john
```

## �📈 Métricas y Monitoreo

### KPIs del Servicio
- **Tiempo de respuesta**: < 200ms para operaciones CRUD
- **Tasa de éxito**: > 99% en operaciones válidas
- **Búsquedas eficientes**: < 100ms en consultas con filtros
- **Validaciones**: 100% de requests validados correctamente

### Alertas Críticas
- Intentos de crear usuarios duplicados
- Operaciones sin permisos adecuados
- Consultas que exceden límites de tiempo
- Errores en hash de contraseñas

## 🔧 Configuración y Dependencias

### Dependencias Principales
- **Prisma ORM**: Gestión de base de datos y relaciones
- **bcryptjs**: Hash seguro de contraseñas
- **class-validator**: Validaciones de entrada
- **JWT**: Autenticación de usuarios

### Variables de Entorno
```env
# Base de datos
DATABASE_URL="postgresql://user:pass@localhost:5432/vendix"

# Seguridad
BCRYPT_ROUNDS=10
JWT_SECRET="your-secret-key"

# Paginación
DEFAULT_PAGE_SIZE=10
MAX_PAGE_SIZE=100
```

## 🚀 Próximos Pasos

### Mejoras Planificadas
- [ ] **Cache de usuarios**: Redis para consultas frecuentes
- [ ] **Bulk operations**: Creación masiva de usuarios
- [ ] **Import/Export**: CSV para migraciones
- [ ] **Avatar upload**: Gestión de fotos de perfil
- [ ] **Two-factor auth**: Autenticación de dos factores
- [ ] **Password policies**: Políticas avanzadas de contraseñas

### Optimizaciones
- [ ] **Database indexing**: Optimización de búsquedas
- [ ] **Query optimization**: Eager loading inteligente
- [ ] **Response caching**: Cache de respuestas
- [ ] **Rate limiting**: Protección contra abuso
- [ ] **Audit logging**: Logs detallados de cambios

## 🔗 Integración con Otros Módulos

### Sistema de Roles
- ✅ **Asignación automática**: Roles por defecto al crear usuario
- ✅ **Validación de permisos**: Control de acceso integrado
- ✅ **Relaciones many-to-many**: Usuario puede tener múltiples roles

### Sistema de Organizaciones
- ✅ **Multi-tenant**: Usuarios aislados por organización
- ✅ **Validación de pertenencia**: Control de acceso organizacional
- ✅ **Jerarquía organizacional**: Soporte para estructuras complejas

### Sistema de Tiendas
- ✅ **Asignación de tiendas**: Usuarios pueden trabajar en múltiples tiendas
- ✅ **Control de acceso**: Permisos específicos por tienda
- ✅ **Gestión de inventario**: Control por ubicación

## 🎯 Estados y Transiciones

### Estados de Usuario
```mermaid
graph TD
    A[Usuario Creado] --> B[Perfil Completado]
    B --> C[Roles Asignados]
    C --> D[Tiendas Asignadas]
    D --> E[Usuario Activo]
    E --> F[Perfil Actualizado]
    F --> G[Usuario Inactivo]
    G --> H[Usuario Eliminado]

    A --> I[Usuario Inactivo]
    B --> I
    C --> I
```

### Estados de Consulta
```mermaid
graph TD
    A[Request Recibido] --> B[Autenticación JWT]
    B --> C[Validación de Permisos]
    C --> D[Parse Query Params]
    D --> E[Construir Filtros]
    E --> F[Ejecutar Consulta BD]
    F --> G[Procesar Resultados]
    G --> H[Construir Metadata]
    H --> I[Response Enviado]
```

## 📊 Estructura de Base de Datos

### Tabla Principal: users
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  state user_state_enum DEFAULT 'active',
  email_verified BOOLEAN DEFAULT false,
  two_factor_enabled BOOLEAN DEFAULT false,
  two_factor_secret VARCHAR(255),
  last_login TIMESTAMP,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  onboarding_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(email, organization_id)
);
```

### Índices Recomendados
```sql
-- Búsqueda por email en organización
CREATE INDEX idx_users_email_org ON users(email, organization_id);

-- Búsqueda por nombre de usuario
CREATE INDEX idx_users_username ON users(username);

-- Búsqueda por estado
CREATE INDEX idx_users_state ON users(state);

-- Búsqueda por organización
CREATE INDEX idx_users_organization ON users(organization_id);

-- Búsqueda por fecha de creación
CREATE INDEX idx_users_created_at ON users(created_at DESC);
```

## 🔐 Consideraciones de Seguridad

### Protección de Datos
- **Contraseñas hasheadas**: bcrypt con 10 rounds mínimo
- **Datos sensibles filtrados**: Contraseñas nunca en responses
- **Validación de entrada**: Todos los campos validados
- **SQL Injection prevention**: Uso de Prisma ORM

### Controles de Acceso
- **JWT obligatorio**: Todas las operaciones requieren autenticación
- **Permisos granulares**: Control por operación específica
- **Validación de pertenencia**: Usuarios solo acceden a su organización
- **Rate limiting**: Protección contra abuso de API

### Auditoría
- **Logs de operaciones**: Todas las operaciones registradas
- **Tracking de cambios**: Historial de modificaciones
- **Alertas de seguridad**: Detección de actividades sospechosas
- **Compliance**: Soporte para requerimientos regulatorios
