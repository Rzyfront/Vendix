# Servicio Rate Limiting - Vendix

## 📋 Descripción General

El servicio `rate-limiting` es el **sistema de protección contra abuso** que controla la frecuencia de requests por usuario/IP en Vendix. Este servicio es crítico para prevenir ataques DDoS, abuso de recursos y mantener la estabilidad del sistema multi-tenant.

## 🎯 Función Principal

### ¿Qué hace el servicio?
- **Limitar requests**: Controla frecuencia por endpoint y usuario
- **Detección de abuso**: Identifica patrones de uso excesivo
- **Bloqueo temporal**: Aplica penalizaciones por violaciones
- **Logging de incidentes**: Registra intentos de abuso para análisis

## 🏗️ Arquitectura del Sistema

### Diseño del Sistema
- **Rate limiting distribuido**: Funciona en múltiples instancias
- **Configuración por endpoint**: Límites personalizables por ruta
- **Excepciones por rol**: Usuarios premium pueden tener límites más altos
- **Redis backend**: Almacenamiento eficiente de contadores

### Estructura de Límites
```
Usuario/IP → Endpoint
    ↓
Verificar límite actual
    ↓
Si excede → Bloquear temporalmente
    ↓
Si no → Permitir + incrementar contador
    ↓
Reset automático por ventana de tiempo
```

## 🔄 Flujo de Rate Limiting

### 1. Intercepción de Requests
```typescript
// Middleware aplicado globalmente
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: Function) {
    // Verificar límites antes de procesar
  }
}
```

### 2. Verificación de Límites
```typescript
// Verificar límite por usuario/IP
const isAllowed = await this.rateLimitService.checkLimit(
  userId || ip,
  endpoint,
  windowMs
);
```

### 3. Aplicación de Penalizaciones
```typescript
if (!isAllowed) {
  // Bloquear request
  throw new HttpException('Rate limit exceeded', 429);
}
```

## 📝 Configuración de Límites

### Límites por Endpoint
- ✅ **Auth endpoints**: 5 requests/minuto por IP
- ✅ **API general**: 100 requests/minuto por usuario
- ✅ **File uploads**: 10 requests/minuto por usuario
- ✅ **Search endpoints**: 30 requests/minuto por usuario

### Límites por Rol
- ✅ **Free tier**: Límites estándar
- ✅ **Premium**: Límites 2x más altos
- ✅ **Enterprise**: Límites 5x más altos
- ✅ **Staff/Admin**: Límites ilimitados para operaciones críticas

## 🔐 Seguridad y Monitoreo

### Características de Seguridad
- **Headers informativos**: X-RateLimit-* headers en responses
- **Bloqueo progresivo**: Penalizaciones incrementales
- **Whitelist/Blacklist**: IPs/usuarios especiales
- **Logging detallado**: Todos los eventos de rate limiting

### Headers de Rate Limiting
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1634567890
X-RateLimit-Retry-After: 60
```

## 📊 Casos de Uso y Escenarios

### Escenario Normal
```typescript
GET /api/users/profile
Authorization: Bearer {valid_jwt}

Response: 200 OK
X-RateLimit-Remaining: 99
```

### Escenario de Límite Excedido
```typescript
GET /api/users/profile
Authorization: Bearer {valid_jwt}

Response: 429 Too Many Requests
{
  "message": "Rate limit exceeded. Try again in 60 seconds",
  "retryAfter": 60
}
```

## 🔄 Integración con Otros Servicios

### Servicios que Protege
- **Auth endpoints**: Login, registro, verificación
- **API REST**: Todas las operaciones CRUD
- **File operations**: Uploads y downloads
- **Search**: Consultas de búsqueda

### Servicios que Dependen
- **Security monitoring**: Análisis de patrones de abuso
- **Analytics**: Métricas de uso por endpoint
- **Load balancer**: Distribución de carga

## 📈 Métricas y Monitoreo

### KPIs a Medir
- **Tasa de bloqueo**: Porcentaje de requests bloqueados
- **Patrones de abuso**: IPs/usuarios más activos
- **Tiempo de respuesta**: Impacto en performance
- **False positives**: Usuarios legítimos bloqueados

### Alertas Recomendadas
- 🔴 Tasa de bloqueo > 10% (posible ataque)
- 🟡 Tasa de bloqueo > 5% (monitoreo)
- 🟡 False positives > 1% (ajuste de límites)

## 🚨 Manejo de Errores y Edge Cases

### Errores Comunes
- **Redis unavailable**: Fallback a límites locales
- **Configuración inválida**: Límites por defecto
- **Usuario no identificado**: Límite por IP
- **Race conditions**: Contadores precisos

### Recuperación de Errores
- **Circuit breaker**: Protección contra fallos de Redis
- **Graceful degradation**: Funcionamiento sin Redis
- **Auto-recovery**: Reset de contadores tras mantenimiento

## 🎯 Conclusión

El servicio `rate-limiting` es el **primera línea de defensa** contra abuso en Vendix. Protege la infraestructura mientras mantiene una experiencia de usuario fluida para usuarios legítimos.

### Principios de Diseño
- **Protección sin fricción**: Usuario no nota los límites normales
- **Escalabilidad**: Funciona en entornos distribuidos
- **Configurabilidad**: Límites adaptables por necesidad
- **Transparencia**: Headers informativos para clientes</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Rate Limiting/RateLimiting-Process.md
