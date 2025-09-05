# Servicio de Registro de Propietarios - Vendix

## 📋 Descripción General

El servicio `register-owner` es el **punto de entrada principal** para nuevos propietarios en la plataforma Vendix. Este servicio permite crear organizaciones completas con sus respectivos propietarios, manejando de forma inteligente usuarios existentes y garantizando la integridad de los datos.

## 🎯 Función Principal

### ¿Qué hace el servicio?
- **Crear organizaciones**: Establece la entidad empresarial del usuario
- **Registrar propietarios**: Crea usuarios con rol de administrador
- **Configurar permisos**: Asigna roles y permisos automáticamente
- **Generar autenticación**: Proporciona tokens de acceso inmediatos
- **Manejar estados**: Gestiona el proceso de onboarding

## 🏗️ Arquitectura Multi-Tenant

### Diseño del Sistema
- **Organizaciones independientes**: Cada registro crea una organización separada
- **Usuarios compartidos**: El mismo email puede existir en múltiples organizaciones
- **Scopes de seguridad**: Todas las búsquedas están limitadas por organización
- **Jerarquía de roles**: Sistema granular de permisos por organización

### Estructura de Datos
```
Organización (1) ←→ Usuario (1:N) ←→ Roles (N:N) ←→ Permisos
     ↓
   Tiendas (1:N) ←→ Productos, Órdenes, etc.
```

## 🔄 Flujo de Registro Inteligente

### 1. Detección de Usuarios Existentes
```typescript
// Busca usuarios con onboarding incompleto
const existingUser = await prisma.users.findFirst({
  where: {
    email,
    onboarding_completed: false
  }
});
```

### 2. Decisión: Actualizar vs Crear
- **Si existe usuario pendiente**: Actualiza con nueva organización
- **Si no existe**: Crea usuario completamente nuevo
- **Siempre**: Asigna rol "owner" y crea organización

### 3. Transacción Atómica
```typescript
await prisma.$transaction(async (tx) => {
  // 1. Crear organización
  // 2. Crear/actualizar usuario
  // 3. Asignar rol owner
  // 4. Crear sesión con tokens
});
```

## 📝 Validaciones y Reglas de Negocio

### Validaciones de Entrada
- **Email**: Formato válido, único por organización
- **Contraseña**: Mínimo 8 caracteres, al menos 1 carácter especial
- **Nombre de organización**: Requerido, no vacío
- **Nombres de usuario**: Requeridos, strings válidos

### Reglas de Unicidad
- **Email**: Puede repetirse entre organizaciones (multi-tenant)
- **Username**: Debe ser único globalmente (generación automática)
- **Nombre de organización**: Puede repetirse (no es clave única)

### Validaciones de Seguridad
- **Prevención de enumeración**: Mensajes genéricos
- **Hash de contraseñas**: bcrypt con 12 rounds
- **Hash de refresh tokens**: Almacenamiento seguro
- **Logging de intentos**: Registro de todas las operaciones

## 🔐 Manejo de Estados y Onboarding

### Estados del Usuario
```typescript
enum UserState {
  PENDING_VERIFICATION = 'pending_verification',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  LOCKED = 'locked'
}
```

### Proceso de Onboarding
1. **Registro inicial**: `onboarding_completed: false`
2. **Verificación de email**: Opcional
3. **Configuración de tienda**: Pendiente
4. **Activación completa**: `onboarding_completed: true`

### Detección Inteligente
```typescript
// Detecta usuarios con proceso incompleto
if (existingUser && !existingUser.onboarding_completed) {
  // Actualizar usuario existente
  return { wasExistingUser: true };
}
```

## 🛡️ Características de Seguridad

### Autenticación y Autorización
- **JWT Tokens**: Access y refresh tokens
- **Hash seguro**: Contraseñas y refresh tokens
- **Fingerprinting**: IP y User-Agent tracking
- **Rate limiting**: Prevención de ataques de fuerza bruta

### Prevención de Ataques
- **Enumeración**: No revela existencia de emails
- **SQL Injection**: Uso de Prisma ORM
- **XSS**: Validación de inputs
- **CSRF**: Tokens de estado

### Logging y Auditoría
- **Intentos de registro**: Todos los intentos se registran
- **Cambios de estado**: Tracking completo
- **Errores de validación**: Logging detallado
- **Métricas de seguridad**: Dashboard de intentos

## 📊 Respuestas del Servicio

### Registro Exitoso (201)
```json
{
  "message": "Bienvenido a Vendix! Tu organización ha sido creada.",
  "data": {
    "user": {
      "id": 2,
      "username": "owner",
      "email": "owner@test.com",
      "organization_id": 2,
      "onboarding_completed": false,
      "user_roles": [{ "role": "owner" }]
    },
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "wasExistingUser": false
  }
}
```

### Usuario Existente con Onboarding Pendiente (409)
```json
{
  "message": "Ya tienes un registro pendiente. Completa tu onboarding.",
  "nextStep": "complete_onboarding",
  "organizationId": 2,
  "data": { /* datos del usuario */ }
}
```

### Errores de Validación (400)
```json
{
  "message": "La contraseña debe contener al menos un carácter especial",
  "error": "Bad Request",
  "statusCode": 400
}
```

## 🔧 Generación Automática de Username

### Algoritmo de Generación
```typescript
private async generateUniqueUsername(email: string): Promise<string> {
  const baseUsername = email.split('@')[0];
  let username = baseUsername;
  let counter = 1;

  while (await this.prisma.users.findFirst({ where: { username } })) {
    username = `${baseUsername}${counter}`;
    counter++;
  }

  return username;
}
```

### Ejemplos
- `usuario@email.com` → `usuario`
- `usuario@email.com` (ocupado) → `usuario1`
- `usuario@email.com` (usuario1 ocupado) → `usuario2`

## 📈 Métricas y Monitoreo

### KPIs del Servicio
- **Tasa de conversión**: Registros → Onboarding completado
- **Tasa de éxito**: Registros exitosos vs fallidos
- **Tiempo de respuesta**: Latencia del endpoint
- **Errores por tipo**: Validación, seguridad, sistema

### Alertas y Monitoreo
- **Errores de base de datos**: Conexión, constraints
- **Picos de uso**: Rate limiting activado
- **Intentos de ataque**: Enumeración, fuerza bruta
- **Usuarios duplicados**: Colisiones de email/username

## 🚀 Próximos Pasos de Implementación

### Servicio de Completar Onboarding
```typescript
POST /auth/complete-onboarding
Authorization: Bearer {access_token}
```

**Funcionalidad requerida:**
- ✅ Verificar usuario autenticado
- ✅ Validar estado actual (`onboarding_completed: false`)
- ✅ Actualizar estado a `true`
- ✅ Cambiar `state` a `active`
- ✅ Logging de finalización

### Beneficios
- **UX completa**: Flujo de registro terminado
- **Analytics**: Métricas de conversión
- **Integración**: Conectar con otros servicios
- **Seguridad**: Usuario completamente validado

## 📚 Referencias Técnicas

### Endpoints Relacionados
- `POST /auth/register-owner` - Registro de propietarios
- `POST /auth/login` - Autenticación
- `POST /auth/refresh` - Refresh de tokens
- `GET /auth/profile` - Perfil de usuario

### DTOs Principales
- `RegisterOwnerDto` - Datos de registro
- `LoginDto` - Credenciales de login
- `RefreshTokenDto` - Token de refresh

### Modelos de Base de Datos
- `organizations` - Entidades empresariales
- `users` - Usuarios del sistema
- `user_roles` - Relación usuario-rol
- `roles` - Definición de roles
- `permissions` - Permisos del sistema

---

**Estado**: ✅ **Servicio completamente implementado y funcional**
**Última actualización**: Septiembre 2025
**Versión**: 1.0.0