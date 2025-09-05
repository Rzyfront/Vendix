# 🔧 Tareas Pendientes: Logs de Seguridad

**Fecha:** Septiembre 2025
**Versión:** 1.0
**Estado:** 📋 Pendiente

---

## 🎯 **OBJETIVO**

Completar la implementación de logs de seguridad para tener un sistema de auditoría completo que registre todos los eventos críticos de seguridad.

---

## 📋 **TAREAS PENDIENTES**

### **1. Extender AuditAction Enum**
**Archivo:** `apps/backend/src/modules/audit/audit.service.ts`
**Tiempo estimado:** 30 minutos

```typescript
// Agregar nuevas acciones de auditoría
export enum AuditAction {
  // ... acciones existentes
  LOGIN_FAILED = 'LOGIN_FAILED',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
}
```

### **2. Implementar Auditoría de Login Fallidos**
**Archivo:** `apps/backend/src/modules/auth/auth.service.ts`
**Tiempo estimado:** 45 minutos

```typescript
// En handleFailedLogin()
private async handleFailedLogin(userId: number) {
  // ... código existente

  // Agregar auditoría específica
  await this.auditService.logAuth(
    userId,
    AuditAction.LOGIN_FAILED,
    {
      email: user.email,
      failed_attempts: failedAttempts,
      reason: 'Invalid credentials',
      will_be_locked: failedAttempts >= 5,
    },
    // ipAddress y userAgent se pueden obtener del contexto
  );

  // ... resto del código
}
```

### **3. Implementar Auditoría de Cambios de Contraseña**
**Archivo:** `apps/backend/src/modules/auth/auth.service.ts`
**Tiempo estimado:** 30 minutos

```typescript
// En changePassword()
async changePassword(userId: number, currentPassword: string, newPassword: string) {
  // ... código existente

  // Agregar auditoría
  await this.auditService.logAuth(
    userId,
    AuditAction.PASSWORD_CHANGE,
    {
      changed_by: 'user_self',
      method: 'current_password_verification',
    },
    // ipAddress y userAgent del request
  );

  return { message: 'Contraseña cambiada exitosamente' };
}
```

### **4. Implementar Auditoría de Reset de Contraseña**
**Archivo:** `apps/backend/src/modules/auth/auth.service.ts`
**Tiempo estimado:** 30 minutos

```typescript
// En resetPassword()
async resetPassword(token: string, newPassword: string) {
  // ... código existente

  // Agregar auditoría
  await this.auditService.logAuth(
    resetToken.user_id,
    AuditAction.PASSWORD_RESET,
    {
      changed_by: 'password_reset_token',
      token_id: resetToken.id,
      method: 'email_token',
    },
    // ipAddress y userAgent del request
  );

  return { message: 'Contraseña restablecida exitosamente' };
}
```

### **5. Implementar Auditoría de Bloqueo de Cuentas**
**Archivo:** `apps/backend/src/modules/auth/auth.service.ts`
**Tiempo estimado:** 20 minutos

```typescript
// En handleFailedLogin() - después del bloqueo
if (failedAttempts >= 5) {
  await this.auditService.logAuth(
    userId,
    AuditAction.ACCOUNT_LOCKED,
    {
      reason: 'Too many failed login attempts',
      failed_attempts: failedAttempts,
      locked_until: updateData.locked_until,
      auto_unlock: true,
    }
  );
}
```

### **6. Mejorar Captura de IP y User Agent**
**Archivo:** `apps/backend/src/modules/auth/auth.controller.ts`
**Tiempo estimado:** 45 minutos

```typescript
// En todos los endpoints de auth
@Post('login')
async login(@Body() loginDto: LoginDto, @Request() req: any) {
  const clientInfo = {
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
  };

  return this.authService.login(loginDto, clientInfo);
}
```

### **7. Crear Endpoint para Consulta de Logs de Seguridad**
**Archivo:** `apps/backend/src/modules/audit/audit.controller.ts` (nuevo)
**Tiempo estimado:** 1 hora

```typescript
@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('security-events')
  @Permissions('audit:read')
  async getSecurityEvents(@Query() query: SecurityEventsQueryDto) {
    return this.auditService.getSecurityEvents(query);
  }
}
```

### **8. Agregar Índices de Rendimiento**
**Archivo:** `apps/backend/prisma/schema.prisma`
**Tiempo estimado:** 15 minutos

```prisma
model audit_logs {
  // ... campos existentes
  @@index([action])
  @@index([user_id, created_at])
  @@index([resource, action])
  @@index([ip_address])
}
```

---

## 🧪 **TESTING**

### **Pruebas Unitarias**
```typescript
// audit.service.spec.ts
describe('AuditService', () => {
  it('should log login failed events', async () => {
    // Test implementation
  });

  it('should log password changes', async () => {
    // Test implementation
  });
});
```

### **Pruebas de Integración**
```typescript
// auth.controller.spec.ts
describe('AuthController (Security Logs)', () => {
  it('should audit failed login attempts', async () => {
    // Test implementation
  });
});
```

---

## 📊 **VALIDACIÓN**

### **Checklist de Verificación**
- [ ] `LOGIN_FAILED` se registra en intentos fallidos
- [ ] `PASSWORD_CHANGE` se registra en cambios de contraseña
- [ ] `ACCOUNT_LOCKED` se registra cuando cuenta se bloquea
- [ ] IP address y User Agent se capturan correctamente
- [ ] Endpoint de consulta de logs funciona
- [ ] Índices de BD mejoran rendimiento
- [ ] Tests pasan exitosamente

### **Comandos de Verificación**
```bash
# Verificar logs de auditoría
npx prisma studio

# Ejecutar tests
npm run test:unit -- --testPathPattern=audit
npm run test:e2e -- --testPathPattern=auth

# Verificar endpoint
curl -X GET "http://localhost:3000/api/audit/security-events" \
  -H "Authorization: Bearer <token>"
```

---

## 🎯 **CRITERIOS DE ACEPTACIÓN**

### **Funcionalidad**
- ✅ Todos los eventos de seguridad se registran en `audit_logs`
- ✅ Login fallidos generan entrada específica en auditoría
- ✅ Cambios de contraseña se auditán con contexto completo
- ✅ Bloqueo de cuentas se registra automáticamente

### **Datos Capturados**
- ✅ IP address del cliente
- ✅ User Agent del navegador/dispositivo
- ✅ Timestamp preciso
- ✅ Contexto del evento (razón, método, etc.)

### **Rendimiento**
- ✅ Consultas de logs son eficientes (< 100ms)
- ✅ No impacta performance de autenticación
- ✅ Almacenamiento optimizado

### **Seguridad**
- ✅ Solo usuarios autorizados pueden ver logs
- ✅ Datos sensibles no se exponen
- ✅ Logs no se pueden modificar

---

## 📈 **MÉTRICAS ESPERADAS**

### **Después de Implementación**
- **Eventos de Seguridad Auditados:** 100%
- **Tiempo de Respuesta:** Sin impacto (< 5ms adicional)
- **Cobertura de Tests:** > 90%
- **Consultas por Segundo:** > 1000

---

## 🚀 **DEPLOYMENT**

### **Migraciones de Base de Datos**
```bash
# Crear migración para índices
npx prisma migrate dev --name add_audit_indexes

# Aplicar cambios
npx prisma db push
```

### **Variables de Entorno**
```bash
# Agregar si es necesario
AUDIT_RETENTION_DAYS=365
AUDIT_MAX_QUERY_LIMIT=1000
```

---

## 💡 **CONCLUSIÓN**

Implementar estos logs de seguridad completará el sistema de auditoría, proporcionando:

- ✅ **Visibilidad completa** de eventos de seguridad
- ✅ **Cumplimiento** con estándares de seguridad
- ✅ **Investigación de incidentes** facilitada
- ✅ **Monitoreo proactivo** de amenazas

**Tiempo Total Estimado:** ~4-5 horas
**Prioridad:** Alta (Seguridad)
**Dependencias:** AuditService existente</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Security Logs/TODO.md
