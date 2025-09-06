# Login Contextual - VENDIX

## 📋 Descripción General

El **Login Contextual** es el sistema de autenticación avanzado que permite a los usuarios acceder al sistema VENDIX a través de diferentes contextos organizacionales y de tienda. Este sistema soporta autenticación multi-tenant con validaciones de contexto específicas.

## 🎯 Funcionalidades Principales

### ¿Qué hace el Login Contextual?
- **Autenticación Multi-contexto**: Soporte para login por organización o tienda específica
- **Validación de Pertenencia**: Verificación automática de que el usuario pertenece al contexto solicitado
- **Bloqueo de Usuarios Suspendidos**: ✅ **NUEVO** - Usuarios suspended/archived no pueden hacer login
- **Auditoría Completa**: Registro de todos los intentos de login con contexto
- **Rate Limiting**: Protección contra ataques de fuerza bruta por contexto

## 🏗️ Arquitectura del Sistema

### Contextos de Login Soportados

#### 1. Login por Organización
```typescript
POST /api/auth/login
{
  "email": "user@company.com",
  "password": "password123",
  "organizationSlug": "company-corp"
}
```

**Validaciones:**
- ✅ Usuario existe y contraseña correcta
- ✅ Usuario pertenece a la organización especificada
- ✅ **Usuario NO está suspended o archived**
- ✅ Organización está activa

#### 2. Login por Tienda
```typescript
POST /api/auth/login
{
  "email": "user@company.com",
  "password": "password123",
  "storeSlug": "store-main"
}
```

**Validaciones:**
- ✅ Usuario existe y contraseña correcta
- ✅ Usuario tiene acceso a la tienda especificada
- ✅ **Usuario NO está suspended o archived**
- ✅ Tienda está activa

## 🚫 Bloqueo de Usuarios Suspendidos/Archivados

### ✅ Nueva Funcionalidad Implementada

El sistema ahora **bloquea automáticamente** el login de usuarios con estado `suspended` o `archived`:

```typescript
// Validación implementada en AuthService.login()
if (user.state === 'suspended' || user.state === 'archived') {
  await this.logLoginAttempt(user.id, false);
  throw new UnauthorizedException('Cuenta suspendida o archivada');
}
```

### Estados de Usuario y Comportamiento

| Estado | Puede hacer Login | Aparece en Listados | Puede ser Reactivado |
|--------|-------------------|---------------------|---------------------|
| `active` | ✅ Sí | ✅ Sí | N/A |
| `inactive` | ✅ Sí | ✅ Sí | N/A |
| `pending_verification` | ❌ No | ✅ Sí | N/A |
| `suspended` | ❌ **No** | ❌ No | ✅ Sí |
| `archived` | ❌ **No** | ❌ No | ✅ Sí |

### Mensajes de Error

- **Cuenta suspendida o archivada**: Cuando un usuario suspended/archived intenta login
- **Credenciales inválidas**: Cuando usuario no existe o contraseña incorrecta
- **Usuario no pertenece a la organización especificada**: Contexto organizacional inválido
- **Usuario no tiene acceso a la tienda especificada**: Contexto de tienda inválido

## 🔄 Flujo de Login Contextual

### Diagrama de Flujo
```
1. Usuario envía credenciales + contexto
   ↓
2. Validar existencia de usuario
   ↓
3. ✅ Verificar estado del usuario (NO suspended/archived)
   ↓
4. Validar pertenencia al contexto (org/tienda)
   ↓
5. Validar contraseña
   ↓
6. Generar tokens JWT
   ↓
7. Registrar auditoría
   ↓
8. Retornar tokens y datos de usuario
```

### Código de Implementación

```typescript
async login(loginDto: LoginDto, clientInfo?: { ipAddress?: string; userAgent?: string }) {
  const { email, password, organizationSlug, storeSlug } = loginDto;

  // 1. Buscar usuario
  const user = await this.prismaService.users.findFirst({
    where: { email },
    include: { /* relations */ }
  });

  if (!user) {
    throw new UnauthorizedException('Credenciales inválidas');
  }

  // 2. ✅ NUEVO: Validar estado del usuario
  if (user.state === 'suspended' || user.state === 'archived') {
    await this.logLoginAttempt(user.id, false);
    throw new UnauthorizedException('Cuenta suspendida o archivada');
  }

  // 3. Validar contexto (organización o tienda)
  // ... validaciones de contexto

  // 4. Validar contraseña
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new UnauthorizedException('Credenciales inválidas');
  }

  // 5. Generar y retornar tokens
  return this.generateTokens(user);
}
```

## 📊 Endpoints Disponibles

### Login Contextual
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@company.com",
  "password": "password123",
  "organizationSlug": "company-corp"  // Opcional: para login por organización
  "storeSlug": "store-main"           // Opcional: para login por tienda
}
```

### Respuesta Exitosa
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "user@company.com",
    "first_name": "Juan",
    "last_name": "Pérez",
    "organization": {
      "id": 1,
      "name": "Company Corp",
      "slug": "company-corp"
    },
    "roles": ["admin"],
    "permissions": ["users:read", "users:create"]
  },
  "expires_in": 3600
}
```

### Respuestas de Error

#### Usuario Suspendido/Archivado
```json
{
  "statusCode": 401,
  "message": "Cuenta suspendida o archivada",
  "error": "Unauthorized"
}
```

#### Contexto Inválido
```json
{
  "statusCode": 401,
  "message": "Usuario no pertenece a la organización especificada",
  "error": "Unauthorized"
}
```

## 🔐 Medidas de Seguridad

### Rate Limiting por Contexto
- **Login attempts**: 5 por minuto por IP
- **Contexto específico**: Rate limiting por organización/tienda
- **Bloqueo temporal**: Después de múltiples intentos fallidos

### Auditoría de Login
```typescript
// Registro automático de cada intento de login
await this.auditService.logAuth(
  user.id,
  loginSuccessful ? AuditAction.LOGIN_SUCCESS : AuditAction.LOGIN_FAILED,
  {
    email: user.email,
    context: loginContext,  // "organization:company-corp" o "store:store-main"
    ip_address: clientInfo?.ipAddress,
    user_agent: clientInfo?.userAgent
  }
);
```

### Validaciones de Seguridad
- ✅ **Bloqueo de usuarios suspended/archived**
- ✅ **Verificación de pertenencia a contexto**
- ✅ **Rate limiting por IP y usuario**
- ✅ **Auditoría completa de intentos**
- ✅ **Validación de contraseñas hasheadas**

## 🎭 Gestión de Estados de Usuario

### Estados Disponibles
```typescript
enum UserState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING_VERIFICATION = 'pending_verification',
  SUSPENDED = 'suspended',  // ✅ No puede hacer login
  ARCHIVED = 'archived'     // ✅ No puede hacer login
}
```

### Transiciones de Estado
```
ACTIVE ↔ INACTIVE (manual)
PENDING_VERIFICATION → ACTIVE (verificación de email)
ACTIVE → SUSPENDED (eliminación lógica)
SUSPENDED → ACTIVE (reactivación)
SUSPENDED → ARCHIVED (archivado permanente)
```

### Operaciones por Estado

| Operación | Active | Inactive | Pending | Suspended | Archived |
|-----------|--------|----------|---------|-----------|----------|
| Login | ✅ | ✅ | ❌ | ❌ | ❌ |
| Listar | ✅ | ✅ | ✅ | ❌ | ❌ |
| Actualizar | ✅ | ✅ | ✅ | ✅ | ✅ |
| Eliminar | ✅ | ✅ | ✅ | ✅ | ❌ |
| Reactivar | N/A | N/A | N/A | ✅ | ✅ |

## 📋 Checklist de Validación

### ✅ Pre-Login
- [x] Usuario existe en base de datos
- [x] **Usuario NO está suspended o archived**
- [x] Usuario pertenece al contexto especificado
- [x] Contraseña es correcta
- [x] Cuenta no está bloqueada temporalmente

### ✅ Post-Login
- [x] Tokens JWT generados correctamente
- [x] Información de usuario incluida
- [x] Contexto de login registrado
- [x] Auditoría de login exitoso
- [x] Rate limiting reseteado

### ✅ Error Handling
- [x] Mensajes de error apropiados
- [x] Auditoría de intentos fallidos
- [x] Rate limiting incrementado
- [x] No información sensible expuesta

## 🔧 Configuración

### Variables de Entorno
```bash
# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Rate Limiting
LOGIN_RATE_LIMIT_WINDOW=15min
LOGIN_RATE_LIMIT_MAX=5

# Security
BCRYPT_ROUNDS=12
ACCOUNT_LOCKOUT_ATTEMPTS=5
ACCOUNT_LOCKOUT_DURATION=30min
```

### Configuración de Base de Datos
```sql
-- Estados de usuario ya definidos en enum
-- No se requieren cambios adicionales en BD
```

## 📈 Monitoreo y Métricas

### Métricas a Monitorear
- **Login attempts por hora**
- **Login success/failure ratio**
- **Usuarios suspendidos/archivados**
- **Rate limiting hits**
- **Tiempo promedio de login**

### Alertas de Seguridad
- 🚨 Más de 10 logins fallidos en 5 minutos
- 🚨 Usuario suspended intentando login
- 🚨 Rate limiting activado frecuentemente
- 🚨 Cambios en estados de usuario

## 🚀 Casos de Uso

### 1. Login de Administrador
```typescript
// Admin login por organización
const response = await authService.login({
  email: 'admin@company.com',
  password: 'password123',
  organizationSlug: 'company-corp'
});
```

### 2. Login de Empleado de Tienda
```typescript
// Employee login por tienda específica
const response = await authService.login({
  email: 'employee@company.com',
  password: 'password123',
  storeSlug: 'store-main'
});
```

### 3. Intento de Login de Usuario Suspendido
```typescript
// Resultado esperado: Error 401
try {
  await authService.login({
    email: 'suspended@company.com',
    password: 'password123',
    organizationSlug: 'company-corp'
  });
} catch (error) {
  console.log(error.message); // "Cuenta suspendida o archivada"
}
```

## 📚 Referencias

- [Documentación de Usuarios](../Users/Users.md)
- [Sistema de Roles](../Roles/Roles.md)
- [Auditoría](../Audit/README.md)
- [Rate Limiting](../Auth/Rate Limiting/README.md)

---

**Nota**: El Login Contextual ahora incluye **bloqueo automático** de usuarios suspended/archived, garantizando que solo usuarios activos puedan acceder al sistema.</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Login Contextual/LoginContextual.md
