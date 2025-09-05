# Servicio Security Logs - Vendix

## 📋 Descripción General

El servicio `security-logs` es el **sistema de auditoría de seguridad** que registra todas las actividades sensibles en Vendix. Este servicio es crítico para compliance, investigación de incidentes y mantenimiento de la trazabilidad en el sistema multi-tenant.

## 🎯 Función Principal

### ¿Qué hace el servicio?
- **Auditoría completa**: Registra todas las operaciones sensibles
- **Trazabilidad**: Seguimiento de quién hizo qué y cuándo
- **Alertas de seguridad**: Detección de patrones sospechosos
- **Compliance**: Soporte para regulaciones de seguridad

## 🏗️ Arquitectura del Sistema

### Diseño del Sistema
- **Logging estructurado**: Eventos con metadata completa
- **Almacenamiento seguro**: Logs en base de datos separada
- **Filtrado por organización**: Logs aislados por tenant
- **API de consulta**: Búsqueda y filtrado de eventos

### Estructura de Eventos
```
Usuario → Acción → Recurso → Resultado
    ↓
Timestamp + Metadata
    ↓
Almacenamiento seguro
    ↓
Consulta y análisis
```

## 🔄 Flujo de Security Logging

### 1. Intercepción de Operaciones
```typescript
// Decorator para logging automático
@LogSecurity({
  action: 'USER_LOGIN',
  resource: 'auth',
  sensitive: true
})
async login(credentials: LoginDto) {
  // Operación se registra automáticamente
}
```

### 2. Captura de Eventos
```typescript
// Servicio de logging
@Injectable()
export class SecurityLogsService {
  async logEvent(event: SecurityEvent) {
    // Almacenar con metadata completa
  }
}
```

### 3. Almacenamiento Seguro
```typescript
// Modelo de evento de seguridad
interface SecurityEvent {
  id: string;
  organizationId: string;
  userId?: string;
  action: SecurityAction;
  resource: string;
  resourceId?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  success: boolean;
  metadata: Record<string, any>;
}
```

## 📝 Tipos de Eventos

### Eventos de Autenticación
- ✅ **USER_LOGIN**: Intentos de login exitosos/fallidos
- ✅ **USER_LOGOUT**: Cierre de sesión
- ✅ **PASSWORD_CHANGE**: Cambio de contraseña
- ✅ **PASSWORD_RESET**: Reset de contraseña solicitado

### Eventos de Autorización
- ✅ **PERMISSION_DENIED**: Acceso denegado a recurso
- ✅ **ROLE_CHANGE**: Cambio de rol de usuario
- ✅ **SESSION_EXPIRED**: Sesión expirada
- ✅ **TOKEN_REVOKED**: Token revocado

### Eventos de Datos Sensibles
- ✅ **USER_DATA_ACCESS**: Acceso a datos de usuario
- ✅ **ORGANIZATION_DATA_MODIFIED**: Modificación de datos de organización
- ✅ **BULK_DATA_EXPORT**: Exportación masiva de datos
- ✅ **SENSITIVE_DATA_VIEWED**: Visualización de datos sensibles

## 🔐 Seguridad y Compliance

### Características de Seguridad
- **No modificable**: Logs no pueden ser alterados
- **Encriptación**: Datos sensibles encriptados
- **Retención**: Políticas de retención configurables
- **Auditoría de logs**: Meta-auditoría de acceso a logs

### Compliance
- ✅ **GDPR**: Derecho al olvido y acceso a datos
- ✅ **SOX**: Controles internos y auditoría
- ✅ **PCI DSS**: Seguridad de datos de pago
- ✅ **ISO 27001**: Gestión de seguridad de información

## 📊 Casos de Uso y Escenarios

### Escenario de Investigación
```typescript
// Consulta de eventos de un usuario
GET /api/security-logs?userId=123&action=LOGIN&dateFrom=2024-01-01

Response: 200 OK
{
  "events": [
    {
      "id": "evt_123",
      "action": "USER_LOGIN",
      "timestamp": "2024-01-15T10:30:00Z",
      "ipAddress": "192.168.1.100",
      "success": true,
      "metadata": { "method": "password" }
    }
  ]
}
```

### Escenario de Alerta
```typescript
// Detección de patrón sospechoso
// Múltiples fallos de login desde misma IP
{
  "alert": "Multiple failed login attempts",
  "ipAddress": "192.168.1.100",
  "attempts": 5,
  "timeframe": "5 minutes"
}
```

## 🔄 Integración con Otros Servicios

### Servicios que Registra
- **Auth Service**: Todos los eventos de autenticación
- **User Management**: Cambios de roles y permisos
- **Organization Service**: Modificaciones de organización
- **API Gateway**: Todas las requests entrantes

### Servicios que Consulta
- **Security Dashboard**: Visualización de eventos
- **Alert System**: Detección de anomalías
- **Compliance Reports**: Generación de reportes
- **Incident Response**: Investigación de breaches

## 📈 Métricas y Monitoreo

### KPIs a Medir
- **Cobertura de logging**: Porcentaje de operaciones registradas
- **Tiempo de respuesta**: Impacto en performance
- **Volumen de logs**: Crecimiento diario/semanal
- **Alertas generadas**: Incidentes detectados

### Alertas Recomendadas
- 🔴 Fallos de login > 10 en 5 min desde misma IP
- 🟡 Accesos denegados > 50 en 1 hora por usuario
- 🟡 Logs no generados en operaciones críticas
- 🟡 Volumen de logs anormal (posible ataque)

## 🚨 Manejo de Errores y Edge Cases

### Errores Comunes
- **Base de datos llena**: Rotación automática de logs
- **Logging fallido**: Fallback a archivos locales
- **Consulta lenta**: Índices optimizados
- **Permisos insuficientes**: Control de acceso estricto

### Recuperación de Errores
- **Queue de logs**: Reintento automático de logging fallido
- **Compresión**: Logs antiguos comprimidos
- **Archivado**: Movimiento a storage de largo plazo
- **Backup**: Copias de seguridad regulares

## 🎯 Conclusión

El servicio `security-logs` es el **sistema nervioso de seguridad** de Vendix. Proporciona visibilidad completa de todas las actividades, permitiendo detectar, investigar y responder a incidentes de seguridad.

### Principios de Diseño
- **Completo pero no intrusivo**: Registra todo sin afectar performance
- **Seguro y compliant**: Protege datos sensibles y cumple regulaciones
- **Escalable**: Maneja altos volúmenes de eventos
- **Accesible**: API fácil de consultar para análisis</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Security Logs/SecurityLogs-Process.md
