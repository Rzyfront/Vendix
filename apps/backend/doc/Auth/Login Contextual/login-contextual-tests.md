# 🧪 Pruebas del Servicio Login Contextual - Vendix

## 📋 Descripción General

Este documento contiene los **casos de prueba exhaustivos** para el servicio de login contextual, incluyendo pruebas de funcionalidad, seguridad, edge cases y escenarios de error.

## 🎯 Objetivos de las Pruebas

- **Validar funcionalidad completa** del login flexible
- **Verificar medidas de seguridad** implementadas
- **Probar casos límite** y escenarios de error
- **Asegurar compatibilidad** con diferentes contextos
- **Validar auditoría** y logging completo

## 📊 Casos de Prueba por Categoría

---

## ✅ **PRUEBAS DE FUNCIONALIDAD BÁSICA**

### 1. Login con OrganizationSlug
**ID**: FUNC-001
**Descripción**: Verificar login exitoso con contexto organizacional
**Precondiciones**:
- Usuario registrado con email verificado
- Organización existente con slug válido
- Usuario pertenece a la organización

**Pasos**:
1. Enviar POST a `/api/auth/login`
2. Incluir `email`, `password`, `organizationSlug`
3. Verificar respuesta 200

**Resultado Esperado**:
```json
{
  "message": "Login exitoso",
  "data": {
    "user": { /* datos completos */ },
    "access_token": "jwt_token",
    "refresh_token": "jwt_refresh_token"
  }
}
```

### 2. Login con StoreSlug
**ID**: FUNC-002
**Descripción**: Verificar login exitoso con contexto de tienda
**Precondiciones**:
- Usuario registrado con acceso a tienda
- Tienda existente con slug válido
- Relación usuario-tienda en `store_users`

**Pasos**:
1. Enviar POST a `/api/auth/login`
2. Incluir `email`, `password`, `storeSlug`
3. Verificar respuesta 200

---

## ❌ **PRUEBAS DE VALIDACIÓN DE ERRORES**

### 3. Sin Contexto Obligatorio
**ID**: ERR-001
**Descripción**: Error cuando no se proporciona organizationSlug ni storeSlug

**Pasos**:
1. Enviar POST sin `organizationSlug` ni `storeSlug`
2. Verificar respuesta 400

**Resultado Esperado**:
```json
{
  "message": "Debe proporcionar organizationSlug o storeSlug",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 4. Usuario No Pertenece a Organización
**ID**: ERR-002
**Descripción**: Error cuando usuario no pertenece a la organización especificada

**Resultado Esperado**:
```json
{
  "message": "Usuario no pertenece a la organización especificada",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### 5. Usuario Sin Acceso a Tienda
**ID**: ERR-003
**Descripción**: Error cuando usuario no tiene acceso a la tienda especificada

**Resultado Esperado**:
```json
{
  "message": "Usuario no tiene acceso a la tienda especificada",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### 6. Credenciales Inválidas
**ID**: ERR-004
**Descripción**: Error con contraseña incorrecta

**Resultado Esperado**:
```json
{
  "message": "Credenciales inválidas",
  "error": "Unauthorized",
  "statusCode": 401
}
```

---

## 🛡️ **PRUEBAS DE SEGURIDAD**

### 7. Rate Limiting Básico
**ID**: SEC-001
**Descripción**: Verificar activación de rate limiting después de múltiples intentos fallidos

**Pasos**:
1. Realizar 5 intentos de login fallidos
2. Verificar respuesta 429 en el sexto intento

**Resultado Esperado**:
```json
{
  "message": "Too many login attempts from this IP, please try again later.",
  "error": "Too Many Requests",
  "statusCode": 429
}
```

### 8. Bloqueo de Cuenta
**ID**: SEC-002
**Descripción**: Verificar bloqueo de cuenta después de intentos fallidos

**Precondiciones**:
- Usuario con `failed_login_attempts >= 5`

**Resultado Esperado**:
```json
{
  "message": "Cuenta temporalmente bloqueada",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### 9. Reset de Intentos Fallidos
**ID**: SEC-003
**Descripción**: Verificar que los intentos fallidos se resetean en login exitoso

**Pasos**:
1. Provocar intentos fallidos
2. Realizar login exitoso
3. Verificar `failed_login_attempts = 0` en base de datos

---

## 📱 **PRUEBAS DE SESIONES**

### 10. Obtener Sesiones Activas
**ID**: SES-001
**Descripción**: Verificar listado de sesiones activas del usuario

**Resultado Esperado**:
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

### 11. Logout de Sesión Específica
**ID**: SES-002
**Descripción**: Cerrar una sesión específica con refresh_token

**Resultado Esperado**:
```json
{
  "message": "Sesión cerrada exitosamente",
  "data": {
    "session_revoked": 1
  }
}
```

### 12. Logout Completo
**ID**: SES-003
**Descripción**: Cerrar todas las sesiones del usuario

**Resultado Esperado**:
```json
{
  "message": "Se cerraron 3 sesiones activas.",
  "data": {
    "sessions_revoked": 3
  }
}
```

---

## 🔍 **PRUEBAS DE AUDITORÍA**

### 13. Auditoría de Login Exitoso
**ID**: AUD-001
**Descripción**: Verificar registro en audit_logs para login exitoso

**Verificar en BD**:
```sql
SELECT * FROM audit_logs
WHERE action = 'LOGIN'
AND resource = 'USER'
AND details LIKE '%login_context%'
ORDER BY created_at DESC LIMIT 1;
```

### 14. Auditoría de Intentos Fallidos
**ID**: AUD-002
**Descripción**: Verificar registro de intentos fallidos

**Verificar en BD**:
```sql
SELECT * FROM login_attempts
WHERE email = 'test@example.com'
AND success = false
ORDER BY created_at DESC;
```

---

## 🌐 **PRUEBAS DE MULTI-TENANT**

### 15. Login con Múltiples Organizaciones
**ID**: MT-001
**Descripción**: Usuario con acceso a múltiples organizaciones

**Pasos**:
1. Crear usuario con múltiples organizaciones
2. Probar login con diferentes `organizationSlug`
3. Verificar acceso correcto a cada contexto

### 16. Login con Múltiples Tiendas
**ID**: MT-002
**Descripción**: Usuario con acceso a múltiples tiendas

**Pasos**:
1. Crear usuario con acceso a múltiples tiendas
2. Probar login con diferentes `storeSlug`
3. Verificar acceso correcto a cada tienda

---

## ⚡ **PRUEBAS DE PERFORMANCE**

### 17. Tiempo de Respuesta
**ID**: PERF-001
**Descripción**: Verificar tiempo de respuesta del endpoint

**Criterios**:
- Login exitoso: < 500ms
- Login con validaciones: < 800ms
- Rate limiting: < 100ms

### 18. Conexiones Concurrentes
**ID**: PERF-002
**Descripción**: Probar múltiples logins simultáneos

**Pasos**:
1. Realizar 10 logins simultáneos
2. Verificar que todos respondan correctamente
3. Verificar integridad de datos en BD

---

## 🔧 **PRUEBAS DE CONFIGURACIÓN**

### 19. Variables de Entorno
**ID**: CONF-001
**Descripción**: Verificar configuración correcta de variables

**Variables Requeridas**:
```env
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=5
BCRYPT_SALT_ROUNDS=12
```

### 20. Conexión a Base de Datos
**ID**: CONF-002
**Descripción**: Verificar conectividad y permisos en BD

**Verificar**:
- Conexión activa a PostgreSQL
- Permisos de lectura/escritura en tablas
- Triggers y constraints funcionando

---

## 📊 **MÉTRICAS DE COBERTURA**

### Cobertura por Categoría
- **Funcionalidad Básica**: 2/2 ✅ (100%)
- **Validación de Errores**: 4/4 ✅ (100%)
- **Seguridad**: 3/3 ✅ (100%)
- **Sesiones**: 3/3 ✅ (100%)
- **Auditoría**: 2/2 ✅ (100%)
- **Multi-tenant**: 2/2 ✅ (100%)
- **Performance**: 2/2 ✅ (100%)
- **Configuración**: 2/2 ✅ (100%)

**Total**: 20/20 casos de prueba ✅ (100% cobertura)

---

## 🚀 **EJECUCIÓN DE PRUEBAS**

### Pre-requisitos
1. **Base de datos**: PostgreSQL con seed ejecutado
2. **Servidor**: NestJS corriendo en puerto 3000
3. **Usuario de prueba**: `superadmin@vendix.com` / `password123`
4. **Organización**: `vendix-corp`
5. **Tienda**: `tienda-principal` (pre-creada)

### Comando de Ejecución
```bash
# Ejecutar pruebas HTTP con REST Client
# Archivo: login-contextual-tests.http

# O ejecutar individualmente
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "superadmin@vendix.com",
    "password": "password123",
    "organizationSlug": "vendix-corp"
  }'
```

### Resultados Esperados
- ✅ **20/20 pruebas pasan**
- ✅ **Tiempo de ejecución**: < 30 segundos
- ✅ **Sin errores en logs**
- ✅ **Base de datos consistente**

---

**📅 Última actualización**: Septiembre 5, 2025
**👨‍💻 Desarrollado por**: Vendix QA Team
**📊 Estado**: ✅ **LISTO PARA EJECUCIÓN**</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Login Contextual/login-contextual-tests.md
