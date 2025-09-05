# Servicio Login Contextual - Vendix

## 📋 Descripción General

El servicio `login-contextual` es el **punto de entrada principal** del sistema de autenticación que permite a los usuarios iniciar sesión de manera flexible, soportando tanto contextos organizacionales como de tienda. Este servicio es crítico porque valida la pertenencia del usuario al contexto especificado antes de permitir el acceso.

## 🎯 Función Principal

### ¿Qué hace el servicio?
- **Autenticación flexible**: Soporta login por `organizationSlug` O `storeSlug`
- **Validación de contexto**: Verifica que el usuario pertenezca al contexto especificado
- **Gestión de sesiones**: Crea y mantiene sesiones activas con información del dispositivo
- **Seguridad avanzada**: Rate limiting, bloqueo por intentos fallidos, auditoría completa
- **Multi-tenant**: Soporte completo para organizaciones y tiendas

## 🏗️ Arquitectura de Validaciones

### Diseño del Sistema
- **Validación condicional**: `organizationSlug` XOR `storeSlug` (uno obligatorio)
- **Verificación de pertenencia**: Usuario debe existir en el contexto especificado
- **Sesiones seguras**: Device fingerprinting y tracking de IP
- **Auditoría completa**: Registro de todos los intentos y actividades

### Estructura de Validaciones
```
Credenciales Básicas (Email + Password)
    ↓
Contexto Obligatorio (OrganizationSlug XOR StoreSlug)
    ↓
Verificación de Pertenencia
    ├── Organization: Usuario.organization_id == Organization.id
    └── Store: Usuario ∈ Store.store_users
    ↓
Estado de Cuenta (No bloqueada)
    ↓
Contraseña Válida
    ↓
Tokens Generados + Sesión Creada ✅
```

## 🔄 Flujo de Autenticación Completo

### 1. Recepción y Validación Inicial
```typescript
// Validar estructura del DTO
@UseGuards(RateLimitGuard)
async login(@Body() loginDto: LoginDto, @Req() request: Request) {
  const { email, password, organizationSlug, storeSlug } = loginDto;

  // Validar contexto obligatorio
  if (!organizationSlug && !storeSlug) {
    throw new BadRequestException('Debe proporcionar organizationSlug o storeSlug');
  }
}
```

### 2. Búsqueda y Verificación de Usuario
```typescript
// Buscar usuario con roles y permisos
const user = await this.prismaService.users.findFirst({
  where: { email },
  include: {
    user_roles: {
      include: {
        roles: {
          include: {
            role_permissions: {
              include: { permissions: true }
            }
          }
        }
      }
    },
    organizations: true
  }
});
```

### 3. Validación de Contexto Específico

#### Opción A: Login por Organización
```typescript
if (organizationSlug) {
  // Verificar pertenencia a organización
  if (user.organization_id) {
    const userOrganization = await this.prismaService.organizations.findUnique({
      where: { id: user.organization_id }
    });

    if (!userOrganization || userOrganization.slug !== organizationSlug) {
      throw new UnauthorizedException('Usuario no pertenece a la organización especificada');
    }

    targetOrganizationId = userOrganization.id;
    loginContext = `organization:${organizationSlug}`;
  }
}
```

#### Opción B: Login por Tienda
```typescript
else if (storeSlug) {
  // Verificar acceso a tienda específica
  const storeUser = await this.prismaService.store_users.findFirst({
    where: {
      user_id: user.id,
      store: { slug: storeSlug }
    },
    include: {
      store: {
        include: { organizations: true }
      }
    }
  });

  if (!storeUser) {
    throw new UnauthorizedException('Usuario no tiene acceso a la tienda especificada');
  }

  targetOrganizationId = storeUser.store.organizations.id;
  targetStoreId = storeUser.store.id;
  loginContext = `store:${storeSlug}`;
}
```

### 4. Validaciones de Seguridad
```typescript
// Verificar bloqueo por intentos fallidos
if (user.locked_until && new Date() < user.locked_until) {
  throw new UnauthorizedException('Cuenta temporalmente bloqueada');
}

// Verificar contraseña
const isPasswordValid = await bcrypt.compare(password, user.password);
if (!isPasswordValid) {
  await this.handleFailedLogin(user.id);
  throw new UnauthorizedException('Credenciales inválidas');
}
```

### 5. Generación de Tokens y Sesión
```typescript
// Reset intentos fallidos
if (user.failed_login_attempts > 0) {
  await this.prismaService.users.update({
    where: { id: user.id },
    data: {
      failed_login_attempts: 0,
      locked_until: null,
    },
  });
}

// Generar tokens JWT
const tokens = await this.generateTokens(user);

// Crear sesión con device fingerprinting
await this.createUserSession(user.id, tokens.refresh_token, {
  ipAddress: clientInfo?.ipAddress || '127.0.0.1',
  userAgent: clientInfo?.userAgent || 'Unknown',
  deviceFingerprint: this.generateDeviceFingerprint(clientInfo)
});
```

## 🛡️ Medidas de Seguridad Implementadas

### Rate Limiting
- **Límite**: 5 intentos por IP en ventana de tiempo
- **Bloqueo**: Automático después de intentos fallidos
- **Reset**: En login exitoso o expiración de ventana

### Bloqueo de Cuenta
- **Intentos fallidos**: Máximo 5 antes de bloqueo
- **Duración**: 30 minutos de bloqueo
- **Reset**: Automático en login exitoso

### Device Fingerprinting
- **Componentes**: IP, User-Agent, Browser, OS
- **Validación**: En refresh tokens
- **Tracking**: Sesiones activas por dispositivo

### Auditoría Completa
- **Login attempts**: Todos los intentos registrados
- **Login context**: Organización o tienda utilizada
- **Session tracking**: Creación y revocación de sesiones
- **Security events**: Bloqueos y rate limiting

## 📊 Endpoints Relacionados

### POST /api/auth/login
**Función**: Autenticación principal con contexto flexible
**Parámetros**:
- `email`: Email del usuario
- `password`: Contraseña
- `organizationSlug`: Slug de organización (opcional)
- `storeSlug`: Slug de tienda (opcional)

**Respuesta Exitosa**:
```json
{
  "message": "Login exitoso",
  "data": {
    "user": { /* datos del usuario */ },
    "access_token": "jwt_access_token",
    "refresh_token": "jwt_refresh_token"
  }
}
```

### GET /api/auth/sessions
**Función**: Lista sesiones activas del usuario
**Respuesta**:
```json
{
  "message": "Sesiones obtenidas exitosamente",
  "data": [
    {
      "id": 1,
      "device": {
        "browser": "Chrome",
        "os": "Linux",
        "type": "Desktop"
      },
      "ipAddress": "192.168.1.100",
      "lastUsed": "2025-09-05T15:30:00Z",
      "isCurrentSession": true
    }
  ]
}
```

### POST /api/auth/logout
**Función**: Cerrar sesión(es)
**Parámetros**:
- `refresh_token`: Token específico (opcional)
- `all_sessions`: true para cerrar todas (opcional)

## 🔧 Configuración y Variables de Entorno

### Rate Limiting
```env
RATE_LIMIT_WINDOW_MS=900000  # 15 minutos
RATE_LIMIT_MAX_REQUESTS=5    # Máximo 5 requests por ventana
```

### JWT Tokens
```env
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

### Seguridad
```env
BCRYPT_SALT_ROUNDS=12
MAX_FAILED_LOGIN_ATTEMPTS=5
ACCOUNT_LOCK_DURATION_MINUTES=30
```

## 🧪 Casos de Prueba

### ✅ Casos de Éxito
1. **Login con organizationSlug válido**
2. **Login con storeSlug válido**
3. **Login con usuario que tiene acceso a múltiples contextos**
4. **Reset de intentos fallidos en login exitoso**

### ❌ Casos de Error
1. **Sin organizationSlug ni storeSlug**
2. **Usuario no pertenece a organización especificada**
3. **Usuario no tiene acceso a tienda especificada**
4. **Cuenta bloqueada por intentos fallidos**
5. **Credenciales inválidas**

### 🛡️ Casos de Seguridad
1. **Rate limiting activado después de 5 intentos**
2. **Bloqueo de cuenta por intentos fallidos**
3. **Validación de device fingerprint en refresh**
4. **Auditoría completa de actividades**

## 📈 Métricas y Monitoreo

### KPIs de Seguridad
- **Tasa de login exitoso**: >95%
- **Intentos de fuerza bruta bloqueados**: Rate limiting
- **Cuentas comprometidas**: Monitoreo de sesiones sospechosas
- **Tiempo de respuesta**: <500ms promedio

### Logs de Auditoría
- **Login attempts**: Todos los intentos registrados
- **Session events**: Creación, uso y revocación
- **Security events**: Bloqueos y alertas
- **Context usage**: Organización vs tienda

## 🚀 Próximas Mejoras

### Funcionalidades Planificadas
- [ ] **Login con código QR** para dispositivos móviles
- [ ] **Autenticación biométrica** integrada
- [ ] **Login social** (Google, Microsoft)
- [ ] **MFA avanzado** con TOTP
- [ ] **Geolocalización** de sesiones
- [ ] **Detección de anomalías** con IA

### Mejoras de Seguridad
- [ ] **Zero-trust architecture** completa
- [ ] **Encryption at rest** para tokens
- [ ] **Session isolation** por contexto
- [ ] **Advanced threat detection**
- [ ] **Compliance logging** (GDPR, SOX)

---

**📅 Última actualización**: Septiembre 5, 2025
**👨‍💻 Desarrollado por**: Vendix Development Team
**📊 Estado**: ✅ **PRODUCCIÓN LISTO**</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Login Contextual/LoginContextualProcess.md
