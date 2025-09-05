# Pruebas HTTP - Security Logs

Este archivo contiene pruebas exhaustivas para el sistema de security logs de Vendix.

## Requisitos previos

1. **Backend corriendo**: Asegúrate de que el backend esté ejecutándose en `http://localhost:3000/api`
2. **Base de datos preparada**: Ejecuta el seed si no lo has hecho:
   ```bash
   npx prisma db seed
   ```
3. **Migraciones aplicadas**: Asegúrate de que las migraciones estén aplicadas
4. **Extension REST Client**: En VS Code, instala la extensión "REST Client" de Huachao Mao
5. **Usuario con permisos**: Necesitas un usuario con permisos de admin para consultar logs

## Verificar que el servidor esté funcionando

Antes de ejecutar las pruebas, verifica que el servidor responda:

```
GET http://localhost:3000/api/health
```

Deberías recibir una respuesta 200 OK.

## Configuración de Variables

Para ejecutar las pruebas correctamente, necesitas configurar la variable `access_token`:

1. **Ejecuta primero** la prueba de registro (Test 1)
2. **Ejecuta el login** (Test 2) y copia el `access_token` de la respuesta
3. **Actualiza la variable** en la parte superior del archivo:
   ```
   @access_token = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

## Casos de prueba incluidos

### ✅ Casos de éxito
- **Consulta de logs**: Obtener todos los eventos de seguridad
- **Filtrado por acción**: Buscar eventos específicos
- **Filtrado por fecha**: Eventos en rango de tiempo
- **Filtrado por usuario**: Eventos de un usuario específico

### ⚠️ Casos de autorización
- **Sin permisos**: Usuario sin rol admin → 403 Forbidden
- **Token inválido**: Acceso no autorizado → 401
- **Usuario diferente organización**: No puede ver logs de otras orgs

### 🔒 Casos de seguridad
- **Auditoría de consultas**: Las consultas a logs también se registran
- **Datos sensibles protegidos**: Información sensible enmascarada
- **Rate limiting**: Consultas excesivas son limitadas

## Cómo ejecutar las pruebas

1. **Abre el archivo** `security-logs-tests.http` en VS Code
2. **Configura el token** después del login (Test 2)
3. **Ejecuta las requests** en orden secuencial haciendo clic en "Send Request"
4. **Verifica las respuestas** y códigos de estado
5. **Revisa los logs generados** en cada paso

## Preparación de datos de prueba

El test genera automáticamente eventos de seguridad:

```typescript
// Eventos generados durante las pruebas
const testEvents = [
  { action: 'USER_REGISTER', success: true },
  { action: 'USER_LOGIN', success: true },
  { action: 'USER_LOGIN', success: false }, // Intento fallido
  { action: 'USER_LOGIN', success: false }, // Otro intento fallido
  { action: 'USER_LOGOUT', success: true },
  { action: 'USER_REGISTER', success: true }, // Staff user
  { action: 'SECURITY_LOGS_ACCESS', success: false } // Intento sin permisos
];
```

## Resultados esperados

### Test 4: Consulta general de logs
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "evt_123",
        "action": "USER_LOGIN",
        "resource": "auth",
        "userId": 1,
        "organizationId": 1,
        "ipAddress": "192.168.1.100",
        "timestamp": "2024-01-15T10:30:00Z",
        "success": true,
        "metadata": {
          "userAgent": "REST Client",
          "method": "password"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 7
    }
  }
}
```

### Test 5: Filtrado por acción
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "action": "USER_LOGIN",
        "success": true,
        "timestamp": "2024-01-15T10:30:00Z"
      },
      {
        "action": "USER_LOGIN",
        "success": false,
        "timestamp": "2024-01-15T10:31:00Z"
      }
    ]
  }
}
```

### Test 8: Acceso sin permisos
```json
{
  "statusCode": 403,
  "message": "Forbidden resource",
  "error": "Forbidden"
}
```

## Parámetros de consulta disponibles

### Filtros básicos:
- `action`: Filtrar por tipo de acción (USER_LOGIN, USER_LOGOUT, etc.)
- `userId`: Filtrar por ID de usuario
- `dateFrom`: Fecha desde (formato ISO 8601)
- `dateTo`: Fecha hasta (formato ISO 8601)
- `success`: Filtrar por resultado (true/false)

### Paginación:
- `page`: Número de página (default: 1)
- `limit`: Elementos por página (default: 50, max: 100)

### Ejemplos de consultas:
```
GET /api/security-logs?action=USER_LOGIN&success=false
GET /api/security-logs?userId=123&dateFrom=2024-01-01
GET /api/security-logs?page=2&limit=20
```

## Verificación en base de datos

Después de ejecutar las pruebas, verifica en la base de datos:

```sql
-- Ver todos los eventos generados
SELECT action, success, created_at, ip_address
FROM security_logs
WHERE organization_id = 1
ORDER BY created_at DESC;

-- Contar eventos por tipo
SELECT action, COUNT(*) as count
FROM security_logs
WHERE organization_id = 1
GROUP BY action;

-- Ver eventos de login fallidos
SELECT * FROM security_logs
WHERE action = 'USER_LOGIN' AND success = false;
```

Deberías ver aproximadamente 7 eventos registrados.

## Verificación en logs de aplicación

Los eventos de security logs también generan entradas en los logs de la aplicación:

```bash
# Buscar eventos de security logging
grep "Security event logged" logs/app.log

# Ver accesos a security logs
grep "Security logs accessed" logs/app.log
```

## Limpieza para próximos tests

Para resetear el estado y poder ejecutar las pruebas nuevamente:

```sql
-- Eliminar eventos de prueba
DELETE FROM security_logs
WHERE organization_id = (
  SELECT id FROM organizations
  WHERE name = 'Test Organization'
);

-- Eliminar usuarios de prueba
DELETE FROM users
WHERE email LIKE 'testsecurity%' OR email LIKE 'staff%';
```

## Notas importantes

- **Permisos requeridos**: Solo usuarios con rol admin pueden consultar logs
- **Aislamiento por organización**: Los usuarios solo ven logs de su organización
- **Auditoría de consultas**: Las consultas a logs también se registran
- **Paginación**: Resultados paginados para performance
- **Filtros combinables**: Múltiples filtros pueden usarse juntos

## Troubleshooting

### Problema: No veo eventos en la consulta
**Solución**: Verifica que el usuario tenga permisos de admin

### Problema: 403 Forbidden
**Solución**: El usuario no tiene el rol adecuado o no pertenece a la organización

### Problema: Sin eventos generados
**Solución**: Verifica que las operaciones anteriores se ejecutaron correctamente

### Problema: Consulta lenta
**Solución**: Verifica índices en la tabla security_logs</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Security Logs/security-logs-tests.md
