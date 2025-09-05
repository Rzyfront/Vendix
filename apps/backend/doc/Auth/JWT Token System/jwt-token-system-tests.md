# 🧪 Pruebas del Sistema JWT Token - Vendix

## 📋 Descripción General

Este documento contiene los **casos de prueba exhaustivos** para el sistema JWT Token de Vendix, incluyendo pruebas de funcionalidad, seguridad, renovación automática, gestión de sesiones y casos límite.

## 🎯 Objetivos de las Pruebas

- **Validar sistema JWT **Variables Requeridas**:
```env
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
JWT_EXPIRES_IN=10h      # ✅ ACCESS TOKEN: 10 HORAS
JWT_REFRESH_EXPIRES_IN=7d
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=5
```*: Access + Refresh tokens
- **Verificar renovación automática**: Flujo transparente de expiración
- **Probar gestión de sesiones**: Device fingerprinting y tracking
- **Validar medidas de seguridad**: Rate limiting, revocación, validaciones
- **Asegurar multi-dispositivo**: Soporte para múltiples sesiones
- **Probar casos de error**: Manejo robusto de excepciones

## 📊 Casos de Prueba por Categoría

---

## ✅ **PRUEBAS DE FUNCIONALIDAD JWT BÁSICA**

### 1. Login y Generación de Tokens
**ID**: JWT-001
**Descripción**: Verificar generación correcta de access y refresh tokens
**Precondiciones**:
- Usuario registrado con credenciales válidas
- Servidor JWT configurado correctamente

**Pasos**:
1. Enviar POST a `/api/auth/login` con credenciales válidas
2. Verificar respuesta 200 con tokens
3. Validar estructura de tokens JWT

**Resultado Esperado**:
```json
{
  "message": "Login exitoso",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": 1,
      "email": "superadmin@vendix.com",
      "roles": ["super_admin"],
      "permissions": ["users.read", "users.create", ...]
    }
  }
}
```

### 2. Validación de Access Token
**ID**: JWT-002
**Descripción**: Verificar que access token funcione en endpoints protegidos

**Pasos**:
1. Obtener access token del login
2. Enviar GET a `/api/auth/sessions` con Authorization header
3. Verificar respuesta 200 con datos de sesiones

---

## 🔄 **PRUEBAS DE RENOVACIÓN DE TOKENS**

### 3. Expiración de Access Token
**ID**: REF-001
**Descripción**: Verificar detección de token expirado

**Precondiciones**:
- JWT_EXPIRES_IN configurado (ej: 10h)
- Esperar tiempo de expiración o modificar configuración

**Resultado Esperado**:
```json
{
  "message": "Token expirado",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### 4. Renovación Exitosa de Tokens
**ID**: REF-002
**Descripción**: Verificar renovación automática con refresh token válido

**Pasos**:
1. Access token expirado (401)
2. Enviar POST a `/api/auth/refresh` con refresh token
3. Verificar respuesta 200 con nuevos tokens
4. Usar nuevo access token en endpoint protegido

**Resultado Esperado**:
```json
{
  "message": "Tokens renovados exitosamente",
  "data": {
    "access_token": "NEW_JWT_TOKEN...",
    "refresh_token": "NEW_REFRESH_TOKEN...",
    "user": { /* datos actualizados */ }
  }
}
```

### 5. Refresh Token Inválido
**ID**: REF-003
**Descripción**: Verificar rechazo de refresh token malformado

**Resultado Esperado**:
```json
{
  "message": "Refresh token inválido o expirado",
  "error": "Unauthorized",
  "statusCode": 401
}
```

---

## 🛡️ **PRUEBAS DE SEGURIDAD**

### 6. Rate Limiting Básico
**ID**: SEC-001
**Descripción**: Verificar activación de rate limiting

**Pasos**:
1. Realizar 5 requests de login fallidos
2. Verificar sexto request retorna 429

**Resultado Esperado**:
```json
{
  "message": "Too many requests from this IP, please try again later.",
  "error": "Too Many Requests",
  "statusCode": 429
}
```

### 7. Logout de Sesión Específica
**ID**: SEC-002
**Descripción**: Verificar revocación de sesión específica

**Pasos**:
1. Login para obtener tokens
2. Logout con refresh_token específico
3. Intentar usar tokens revocados

**Resultado Esperado**:
```json
{
  "message": "Sesión cerrada exitosamente",
  "data": {
    "session_revoked": 1
  }
}
```

### 8. Logout Completo
**ID**: SEC-003
**Descripción**: Verificar revocación de todas las sesiones

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

## 📱 **PRUEBAS DE GESTIÓN DE SESIONES**

### 9. Múltiples Dispositivos
**ID**: SES-001
**Descripción**: Verificar soporte para múltiples sesiones simultáneas

**Pasos**:
1. Login desde diferentes User-Agents
2. Verificar creación de sesiones separadas
3. Validar device fingerprinting diferente

**Resultado Esperado**:
```json
{
  "message": "Sesiones obtenidas exitosamente",
  "data": [
    {
      "device": { "browser": "Chrome", "os": "Linux" },
      "ipAddress": "192.168.1.100",
      "isCurrentSession": true
    },
    {
      "device": { "browser": "Firefox", "os": "Linux" },
      "ipAddress": "192.168.1.100",
      "isCurrentSession": false
    }
  ]
}
```

### 10. Device Fingerprinting
**ID**: SES-002
**Descripción**: Verificar validación de dispositivo en refresh

**Pasos**:
1. Login desde un dispositivo
2. Intentar refresh desde User-Agent diferente
3. Verificar rechazo por fingerprint mismatch

**Resultado Esperado**:
```json
{
  "message": "Sesión inválida - dispositivo no coincide",
  "error": "Unauthorized",
  "statusCode": 401
}
```

---

## ❌ **PRUEBAS DE VALIDACIÓN DE ERRORES**

### 11. Token Malformado
**ID**: ERR-001
**Descripción**: Verificar manejo de JWT malformado

**Resultado Esperado**:
```json
{
  "message": "Token inválido",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### 12. Sin Token de Autorización
**ID**: ERR-002
**Descripción**: Verificar manejo de requests sin token

**Resultado Esperado**:
```json
{
  "message": "Token no proporcionado",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### 13. Refresh Token Expirado
**ID**: ERR-003
**Descripción**: Verificar expiración de refresh token

**Precondiciones**:
- JWT_REFRESH_EXPIRES_IN configurado (ej: 7d)
- Esperar expiración o modificar configuración

**Resultado Esperado**:
```json
{
  "message": "Refresh token expirado",
  "error": "Unauthorized",
  "statusCode": 401
}
```

---

## 🔄 **PRUEBAS DE FLUJOS COMPLETOS**

### 14. Flujo Completo de Login
**ID**: FLOW-001
**Descripción**: Login → Uso → Expiración → Refresh → Continuación

**Pasos**:
1. Login inicial
2. Usar access token
3. Esperar expiración
4. Refresh automático
5. Continuar usando nuevos tokens

### 15. Flujo de Logout Forzado
**ID**: FLOW-002
**Descripción**: Login → Logout → Rechazo de tokens antiguos

**Pasos**:
1. Login y obtener tokens
2. Logout completo
3. Intentar usar tokens revocados
4. Verificar todos los requests fallan

### 16. Flujo Multi-Sesión
**ID**: FLOW-003
**Descripción**: Múltiples logins → Gestión selectiva → Logout específico

**Pasos**:
1. Login desde 3 dispositivos diferentes
2. Verificar 3 sesiones activas
3. Logout de sesión específica
4. Verificar 2 sesiones restantes

---

## ⚡ **PRUEBAS DE PERFORMANCE**

### 17. Tiempo de Respuesta JWT
**ID**: PERF-001
**Descripción**: Verificar performance de validación JWT

**Criterios**:
- **Validación JWT**: < 10ms
- **Refresh token**: < 100ms
- **Generación de tokens**: < 50ms
- **Consulta de sesiones**: < 200ms
- **Duración access token**: 10 horas

### 18. Conexiones Concurrentes
**ID**: PERF-002
**Descripción**: Probar múltiples operaciones JWT simultáneas

**Pasos**:
1. 10 logins simultáneos
2. 10 refresh simultáneos
3. 10 validaciones simultáneas
4. Verificar integridad de datos

---

## 🔧 **PRUEBAS DE CONFIGURACIÓN**

### 19. Variables de Entorno
**ID**: CONF-001
**Descripción**: Verificar configuración correcta de JWT

**Variables Requeridas**:
```env
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=5
```

### 20. Base de Datos
**ID**: CONF-002
**Descripción**: Verificar esquema de refresh_tokens

**Verificar en BD**:
```sql
SELECT COUNT(*) FROM refresh_tokens
WHERE user_id = 1 AND revoked = false;

-- Debe retornar el número correcto de sesiones activas
```

---

## 📊 **MÉTRICAS DE COBERTURA**

### Cobertura por Categoría
- **Funcionalidad JWT Básica**: 2/2 ✅ (100%)
- **Renovación de Tokens**: 3/3 ✅ (100%)
- **Seguridad**: 3/3 ✅ (100%)
- **Gestión de Sesiones**: 2/2 ✅ (100%)
- **Validación de Errores**: 3/3 ✅ (100%)
- **Flujos Completos**: 3/3 ✅ (100%)
- **Performance**: 2/2 ✅ (100%)
- **Configuración**: 2/2 ✅ (100%)

**Total**: 20/20 casos de prueba ✅ (100% cobertura)

---

## 🚀 **EJECUCIÓN DE PRUEBAS**

### Pre-requisitos
1. **Base de datos**: PostgreSQL con seed ejecutado
2. **Servidor**: NestJS corriendo en puerto 3000
3. **Usuario de prueba**: `superadmin@vendix.com` / `password123`
4. **Configuración JWT**: Variables de entorno configuradas

### Comando de Ejecución
```bash
# Ejecutar pruebas HTTP con REST Client
# Archivo: jwt-token-system-tests.http

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
- ✅ **Tiempo de ejecución**: < 60 segundos
- ✅ **Sin errores en logs del servidor**
- ✅ **Base de datos consistente**

### Configuración para Testing
```env
# Para testing rápido de expiración
JWT_EXPIRES_IN=30s    # 30 segundos para testing
JWT_REFRESH_EXPIRES_IN=5m    # 5 minutos para testing

# Rate limiting agresivo para testing
RATE_LIMIT_WINDOW_MS=60000   # 1 minuto
RATE_LIMIT_MAX_REQUESTS=3    # 3 requests por minuto
```

---

## 🔍 **DEBUGGING Y TROUBLESHOOTING**

### Problemas Comunes
1. **Token expirado inmediatamente**: Verificar configuración de tiempo
2. **Refresh falla**: Verificar device fingerprint
3. **Rate limiting**: Verificar IP y configuración
4. **Sesiones no aparecen**: Verificar BD refresh_tokens

### Logs Útiles
```bash
# Ver logs de JWT
tail -f logs/auth.log | grep -E "(TOKEN|SESSION|JWT)"

# Ver sesiones en BD
docker-compose exec db psql -U username -d vendix_db \
  -c "SELECT * FROM refresh_tokens WHERE revoked = false;"
```

### Herramientas de Debug
- **JWT Debugger**: https://jwt.io/
- **Postman**: Para testing de flujos completos
- **Database Viewer**: Para inspeccionar refresh_tokens

---

**📅 Última actualización**: Septiembre 5, 2025
**👨‍💻 Desarrollado por**: Vendix QA Team
**📊 Estado**: ✅ **LISTO PARA EJECUCIÓN**</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/JWT Token System/jwt-token-system-tests.md
