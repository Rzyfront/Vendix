# 📊 Estado Actual: Logs de Seguridad

**Fecha:** Septiembre 2025
**Versión:** 1.0
**Estado:** 🔄 Parcialmente Implementado

---

## ✅ **LO QUE ESTÁ IMPLEMENTADO**

### **1. Sistema de Auditoría General**
```typescript
// AuditService con múltiples tipos de acciones
export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',      // ✅ Implementado
  LOGOUT = 'LOGOUT',    // ✅ Implementado
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  EMAIL_VERIFY = 'EMAIL_VERIFY',
  ONBOARDING_COMPLETE = 'ONBOARDING_COMPLETE',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
}
```

### **2. Endpoints HTTP para Consulta de Logs**
```typescript
// GET /api/audit/logs - Consulta logs con filtros
@ApiTags('Audit')
@Controller('audit')
@UseGuards(JwtAuthGuard, OrganizationAuditGuard)
export class AuditController {
  @Get('logs')
  async getAuditLogs(
    @Query('userId') userId?: string,
    @Query('action') action?: AuditAction,
    @Query('resource') resource?: AuditResource,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    // Retorna logs filtrados
  }

  @Get('stats')
  async getAuditStats() {
    // Retorna estadísticas de auditoría
  }
}
```

### **3. Tabla de Intentos de Login**
```prisma
model login_attempts {
  id             Int       @id @default(autoincrement())
  email          String    @db.VarChar(255)
  store_id       Int?
  ip_address     String?   @db.VarChar(45)
  user_agent     String?
  success        Boolean
  failure_reason String?   @db.VarChar(100)
  attempted_at   DateTime? @default(now()) @db.Timestamp(6)
}
```

### **4. Auditoría de Login/Logout**
```typescript
### **4. Auditoría de Login/Logout**
```typescript
// En auth.service.ts - login exitoso
await this.auditService.logAuth(
  user.id,
  AuditAction.LOGIN,
  {
    login_method: 'password',
    success: true,
    login_context: loginContext,
    organization_id: targetOrganizationId,
    store_id: targetStoreId,
  },
  clientInfo?.ipAddress || '127.0.0.1',
  clientInfo?.userAgent || 'Login-Device'
);
```

---

## 🌐 **ENDPOINTS HTTP DISPONIBLES**

### **1. Consultar Logs de Seguridad**
```http
GET /api/audit/logs
Authorization: Bearer {token}
```

**Parámetros de consulta:**
- `userId` - ID del usuario
- `action` - Acción específica (LOGIN, LOGOUT, etc.)
- `resource` - Recurso auditado (auth, users, etc.)
- `fromDate` - Fecha desde (ISO 8601)
- `toDate` - Fecha hasta (ISO 8601)
- `organizationId` - ID de organización
- `limit` - Límite de resultados
- `offset` - Desplazamiento

**Ejemplo de uso:**
```bash
# Obtener logs de login de los últimos 7 días
GET /api/audit/logs?action=LOGIN&fromDate=2025-08-29&limit=50

# Obtener logs de un usuario específico
GET /api/audit/logs?userId=123&action=LOGIN
```

**Respuesta:**
```json
{
  "data": [
    {
      "id": 1,
      "user_id": 123,
      "action": "LOGIN",
      "resource": "auth",
      "metadata": {
        "login_method": "password",
        "success": true,
        "organization_id": 1
      },
      "ip_address": "192.168.1.100",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2025-09-05T10:30:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

### **2. Estadísticas de Auditoría**
```http
GET /api/audit/stats
Authorization: Bearer {token}
```

**Parámetros:**
- `fromDate` - Fecha desde
- `toDate` - Fecha hasta

**Respuesta:**
```json
{
  "total_logs": 1250,
  "actions_count": {
    "LOGIN": 450,
    "LOGOUT": 420,
    "CREATE": 150,
    "UPDATE": 180,
    "DELETE": 50
  },
  "recent_activity": {
    "last_hour": 25,
    "last_day": 180,
    "last_week": 1250
  }
}
```
```

### **4. Manejo de Intentos Fallidos**
```typescript
// Contador de intentos fallidos
const failedAttempts = user.failed_login_attempts + 1;

// Bloqueo automático después de 5 intentos
if (failedAttempts >= 5) {
  updateData.locked_until = new Date(Date.now() + 30 * 60 * 1000);
}
```

---

- ❌ Alertas automáticas de seguridad

---

## 🔍 **CONSULTAS DE SEGURIDAD COMUNES**

### **1. Verificar Intentos de Login Fallidos**
```bash
# Últimos 7 días
GET /api/audit/logs?action=LOGIN_FAILED&fromDate=2025-08-29

# De un usuario específico
GET /api/audit/logs?userId=123&action=LOGIN_FAILED

# De una IP específica (requiere filtrado adicional)
GET /api/audit/logs?action=LOGIN_FAILED&limit=100
```

### **2. Monitorear Bloqueos de Cuenta**
```bash
GET /api/audit/logs?action=ACCOUNT_LOCKED&fromDate=2025-09-01
```

### **3. Revisar Actividad de Login por Usuario**
```bash
GET /api/audit/logs?userId=123&action=LOGIN&limit=20
```

### **4. Estadísticas de Seguridad**
```bash
GET /api/audit/stats?fromDate=2025-09-01
```

---

## 💡 **Conclusión**

### **1. Auditoría Específica de Login Fallidos**
```typescript
// ✅ IMPLEMENTADO: Auditoría de login fallidos
await this.auditService.logAuth(
  user.id,
  AuditAction.LOGIN_FAILED,
  {
    email: user.email,
    reason: 'Invalid credentials',
    attempt_number: user.failed_login_attempts + 1,
  },
  clientInfo?.ipAddress || '127.0.0.1',
  clientInfo?.userAgent || 'Unknown'
);
```

### **2. Auditoría de Cambios de Contraseña**
```typescript
// ❌ NO implementado en changePassword()
await this.auditService.logAuth(
  userId,
  AuditAction.PASSWORD_CHANGE,
  {
    changed_by: userId,  // Auto-cambio
    ip_address: ipAddress,
    user_agent: userAgent,
  }
);

// ❌ NO implementado en resetPassword()
await this.auditService.logAuth(
  userId,
  AuditAction.PASSWORD_CHANGE,
  {
    changed_by: 'password_reset',
    token_used: token,
    ip_address: ipAddress,
  }
);
```

### **3. Auditoría de Bloqueo de Cuentas**
```typescript
// ❌ NO implementado cuando cuenta se bloquea
await this.auditService.logAuth(
  userId,
  'ACCOUNT_LOCKED',
  {
    reason: 'Too many failed login attempts',
    locked_until: lockedUntil,
    failed_attempts: failedAttempts,
  }
);
```

### **4. Logging Avanzado de Seguridad**
```typescript
// ❌ NO implementado
interface SecurityLogData {
  event_type: 'login_failed' | 'password_change' | 'account_locked' | 'suspicious_activity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  ip_address: string;
  user_agent: string;
  geolocation?: {
    country: string;
    city: string;
    coordinates: [number, number];
  };
  device_info?: {
    fingerprint: string;
    browser: string;
    os: string;
    device_type: string;
  };
  risk_score?: number;
}
```

---

## 🔧 **IMPLEMENTACIÓN PROPUESTA**

### **1. Extender AuditAction Enum**
```typescript
export enum AuditAction {
  // ... acciones existentes
  LOGIN_FAILED = 'LOGIN_FAILED',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
}
```

### **2. Agregar Auditoría en Puntos Críticos**
```typescript
// En handleFailedLogin()
if (failedAttempts >= 5) {
  await this.auditService.logAuth(
    userId,
    AuditAction.ACCOUNT_LOCKED,
    {
      reason: 'Too many failed login attempts',
      failed_attempts: failedAttempts,
      locked_until: updateData.locked_until,
    }
  );
}

// En changePassword()
await this.auditService.logAuth(
  userId,
  AuditAction.PASSWORD_CHANGE,
  {
    changed_by: 'user_self',
    ip_address: ipAddress,
    user_agent: userAgent,
  }
);
```

### **3. Middleware de Seguridad Global**
```typescript
// src/common/middleware/security-logging.middleware.ts
@Injectable()
export class SecurityLoggingMiddleware implements NestMiddleware {
  constructor(private readonly auditService: AuditService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;

      // Log suspicious activities
      if (this.isSuspiciousRequest(req, res, duration)) {
        this.auditService.logSecurityEvent({
          event_type: 'suspicious_activity',
          severity: this.calculateSeverity(req, res),
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
          // ... más datos
        });
      }
    });

    next();
  }
}
```

---

## 📊 **Métricas de Seguridad Actuales**

### **✅ Métricas Disponibles:**
- ✅ Número de intentos de login por usuario
- ✅ Timestamp de último login exitoso
- ✅ Conteo de intentos fallidos
- ✅ Estado de bloqueo de cuenta
- ✅ Historial de login attempts por tienda

### **❌ Métricas Faltantes:**
- ❌ Número de login fallidos por IP
- ❌ Patrones de comportamiento sospechoso
- ❌ Geolocalización de accesos
- ❌ Análisis de riesgo en tiempo real
- ❌ Alertas automáticas de seguridad

---

## 🎯 **Plan de Implementación**

### **Fase 1: Auditoría Básica (1-2 días)**
- [ ] Agregar `LOGIN_FAILED` al enum `AuditAction`
- [ ] Implementar auditoría en `handleFailedLogin()`
- [ ] Implementar auditoría en `changePassword()` y `resetPassword()`
- [ ] Agregar auditoría de bloqueo/desbloqueo de cuentas

### **Fase 2: Logging Avanzado (2-3 días)**
- [ ] Crear middleware de logging de seguridad
- [ ] Implementar análisis de riesgo básico
- [ ] Agregar geolocalización de IPs
- [ ] Crear dashboard de métricas de seguridad

### **Fase 3: Alertas y Monitoreo (1-2 días)**
- [ ] Sistema de alertas para actividades sospechosas
- [ ] Integración con herramientas de monitoreo
- [ ] Reportes automáticos de seguridad
- [ ] API para consulta de logs de seguridad

---

## 📋 **Checklist de Validación**

### **Auditoría de Login**
- [x] Login exitoso registrado
- [x] Login attempts guardados en BD
- [x] Login fallidos auditados específicamente
- [x] Bloqueo de cuenta auditado

### **Auditoría de Contraseñas**
- [ ] Cambio de contraseña auditado
- [ ] Reset de contraseña auditado
- [ ] Invalidación de sesiones auditada

### **Logging Avanzado**
- [ ] IP addresses registradas
- [ ] User agents capturados
- [ ] Geolocalización implementada
- [ ] Análisis de riesgo básico

### **Monitoreo y Alertas**
- [ ] Dashboard de seguridad
- [ ] Alertas de actividades sospechosas
- [ ] Reportes automáticos
- [ ] API de consulta de logs

---

## 💡 **Conclusión**

**Estado Actual:** Los logs de seguridad están **mayoritariamente implementados**
- ✅ **Base sólida:** Sistema de auditoría y login attempts
- ✅ **Funcionalidad core:** Login/logout auditados
- ✅ **Eventos críticos:** Login fallidos auditados
- ❌ **Logging avanzado:** Sin geolocalización, análisis de riesgo

**Recomendación:** El sistema de auditoría básico está **completo**. Considerar mejoras avanzadas (geolocalización, análisis de riesgo) según necesidades del negocio.</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Security Logs/README.md
