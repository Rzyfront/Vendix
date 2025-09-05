# Pruebas HTTP - Rate Limiting

Este archivo contiene pruebas exhaustivas para el sistema de rate limiting de Vendix.

## Requisitos previos

1. **Backend corriendo**: Asegúrate de que el backend esté ejecutándose en `http://localhost:3000/api`
2. **Redis corriendo**: El rate limiting requiere Redis para funcionar correctamente
3. **Base de datos preparada**: Ejecuta el seed si no lo has hecho:
   ```bash
   npx prisma db seed
   ```
4. **Migraciones aplicadas**: Asegúrate de que las migraciones estén aplicadas
5. **Extension REST Client**: En VS Code, instala la extensión "REST Client" de Huachao Mao

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
- **Requests normales**: Dentro de límites permitidos
- **Headers informativos**: X-RateLimit-* headers presentes
- **Diferentes endpoints**: Límites específicos por ruta

### ⚠️ Casos de límite excedido
- **Usuario autenticado**: Límite por usuario
- **IP sin autenticar**: Límite por dirección IP
- **Endpoint específico**: Login con límites más restrictivos

### 🔒 Casos de seguridad
- **Bloqueo temporal**: 429 Too Many Requests
- **Headers de retry**: Información para reintento
- **Logging de incidentes**: Eventos registrados

## Cómo ejecutar las pruebas

1. **Abre el archivo** `rate-limiting-tests.http` en VS Code
2. **Configura el token** después del login (Test 2)
3. **Ejecuta las requests** en orden secuencial haciendo clic en "Send Request"
4. **Verifica las respuestas** y códigos de estado
5. **Observa los headers** de rate limiting en las respuestas

## Configuración esperada de límites

Para estas pruebas se asume la siguiente configuración:

```typescript
// Límites por defecto
const RATE_LIMITS = {
  // Auth endpoints - más restrictivos
  '/auth/login': { windowMs: 60000, max: 5 }, // 5 por minuto
  '/auth/register-*': { windowMs: 60000, max: 3 }, // 3 por minuto

  // API general
  '/api/*': { windowMs: 60000, max: 100 }, // 100 por minuto

  // Por IP (sin auth)
  'ip-limit': { windowMs: 60000, max: 10 } // 10 por minuto
};
```

## Resultados esperados

### Test 3: Requests normales
```json
// Response 200 OK con headers
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1634567890
```

### Test 4: Límite por IP excedido
```json
// Después de 10 requests sin auth
{
  "statusCode": 429,
  "message": "Too Many Requests",
  "error": "Rate limit exceeded"
}
```

### Test 6: Límite de login excedido
```json
// Después de 5 intentos de login
{
  "statusCode": 429,
  "message": "Rate limit exceeded. Try again in 60 seconds",
  "retryAfter": 60
}
```

## Headers de Rate Limiting

### Headers incluidos en cada respuesta:
- `X-RateLimit-Limit`: Número máximo de requests permitidos
- `X-RateLimit-Remaining`: Requests restantes en la ventana actual
- `X-RateLimit-Reset`: Timestamp cuando se resetea el contador
- `X-RateLimit-Retry-After`: Segundos para esperar (solo cuando se excede)

### Ejemplo de headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1634567890
```

## Verificación en logs

Después de ejecutar las pruebas, verifica los logs del backend:

```bash
# Buscar eventos de rate limiting
grep "Rate limit exceeded" logs/app.log

# Ver todos los eventos de rate limiting
grep "rate.limit" logs/app.log
```

Deberías ver entradas como:
```
[2024-01-15 10:30:00] INFO: Rate limit exceeded for IP 192.168.1.100 on /auth/login
[2024-01-15 10:30:00] INFO: Rate limit exceeded for user 123 on /api/users
```

## Limpieza para próximos tests

Para resetear los contadores de rate limiting:

```bash
# Reset Redis keys (si tienes acceso)
redis-cli FLUSHDB

# O esperar a que expire la ventana de tiempo
# Los contadores se resetean automáticamente
```

## Notas importantes

- **Redis requerido**: El rate limiting no funciona sin Redis
- **Tiempo de ventana**: Los límites se resetean cada minuto
- **Contadores persistentes**: Los contadores se mantienen entre reinicios
- **IP vs Usuario**: Límite por IP para requests no autenticados, por usuario para autenticados
- **Headers opcionales**: No todos los servidores incluyen los headers X-RateLimit-*

## Troubleshooting

### Problema: No veo headers de rate limiting
**Solución**: Verifica que el middleware esté aplicado globalmente

### Problema: Límite no se resetea
**Solución**: Verifica la configuración de Redis y tiempo de ventana

### Problema: 429 pero contador no disminuye
**Solución**: Verifica que Redis esté corriendo y accesible

### Problema: Rate limiting no funciona
**Solución**: Verifica configuración del middleware y dependencias</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Rate Limiting/rate-limiting-tests.md
