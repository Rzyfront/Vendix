# 🔧 Tareas Pendientes: Rate Limiting

**Fecha:** Septiembre 2025
**Versión:** 1.0
**Estado:** 📋 Pendiente

---

## 🎯 **OBJETIVO**

Completar la implementación de rate limiting para proteger todos los endpoints de autenticación contra ataques de fuerza bruta y abuso.

---

## 📋 **TAREAS PENDIENTES**

### **1. Agregar Rate Limiting a Register Staff**
**Archivo:** `apps/backend/src/modules/auth/auth.module.ts`
**Tiempo estimado:** 5 minutos
**Estado:** ✅ COMPLETADO

```typescript
// ✅ IMPLEMENTADO: Rate limiting agregado a register-staff
.forRoutes(
  { path: 'auth/register-owner', method: RequestMethod.POST },
  { path: 'auth/register-customer', method: RequestMethod.POST },
  { path: 'auth/register-staff', method: RequestMethod.POST }, // ✅ AGREGADO
  { path: 'auth/forgot-password', method: RequestMethod.POST },
  { path: 'auth/reset-password', method: RequestMethod.POST }
);
```

### **2. Verificar Cobertura Completa de Endpoints**
**Archivo:** `apps/backend/src/modules/auth/auth.controller.ts`
**Tiempo estimado:** 10 minutos

```bash
# Endpoints a verificar:
✅ POST /auth/login (ya protegido)
✅ POST /auth/refresh (ya protegido)
✅ POST /auth/register-owner (ya protegido)
✅ POST /auth/register-customer (ya protegido)
✅ POST /auth/register-staff (AGREGAR protección)
✅ POST /auth/forgot-password (ya protegido)
✅ POST /auth/reset-password (ya protegido)
❓ POST /auth/verify-email (¿protegido?)
❓ POST /auth/resend-verification (¿protegido?)
```

### **3. Implementar Headers de Rate Limiting**
**Archivo:** `apps/backend/src/common/utils/rate-limit.middleware.ts`
**Tiempo estimado:** 20 minutos

```typescript
// Agregar headers informativos
res.set({
  'X-RateLimit-Limit': maxAttempts.toString(),
  'X-RateLimit-Remaining': (maxAttempts - record.count).toString(),
  'X-RateLimit-Reset': record.resetTime.toString(),
  'Retry-After': Math.ceil((record.resetTime - now) / 1000).toString()
});
```

### **4. Implementar Rate Limiting con Redis (Opcional)**
**Tiempo estimado:** 1-2 horas

```bash
# Instalar dependencias
npm install @nestjs/throttler redis
npm install --save-dev @types/redis
```

```typescript
// En app.module.ts
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisService } from './redis.service';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60, // segundos
      limit: 10, // requests por ttl
      storage: new RedisStorage(RedisService.getClient()),
    }),
  ],
})
export class AppModule {}
```

### **5. Configuración Dinámica por Entorno**
**Archivo:** `apps/backend/src/common/utils/rate-limit.middleware.ts`
**Tiempo estimado:** 30 minutos

```typescript
// Hacer límites configurables
const loginMaxAttempts = this.configService.get('RATE_LIMIT_LOGIN_ATTEMPTS', 3);
const loginWindowMs = this.configService.get('RATE_LIMIT_LOGIN_WINDOW', 15 * 60 * 1000);
const generalMaxAttempts = this.configService.get('RATE_LIMIT_GENERAL_ATTEMPTS', 5);
const generalWindowMs = this.configService.get('RATE_LIMIT_GENERAL_WINDOW', 15 * 60 * 1000);
```

### **6. Rate Limiting por Usuario + IP**
**Archivo:** `apps/backend/src/common/utils/rate-limit.middleware.ts`
**Tiempo estimado:** 15 minutos

```typescript
// Combinar usuario y IP para mejor granularidad
const userId = req.user?.id || 'anonymous';
const key = `${userId}:${req.ip}`;
```

### **7. Implementar Auditoría de Rate Limiting**
**Archivo:** `apps/backend/src/common/utils/rate-limit.middleware.ts`
**Tiempo estimado:** 20 minutos

```typescript
// Registrar cuando se excede el límite
if (record.count >= maxAttempts) {
  await this.auditService.logSecurityEvent({
    event_type: 'rate_limit_exceeded',
    severity: 'medium',
    ip_address: req.ip,
    user_agent: req.get('User-Agent'),
    endpoint: req.path,
    method: req.method,
  });
}
```

### **8. Crear Tests de Rate Limiting**
**Archivo:** `apps/backend/src/common/utils/rate-limit.middleware.spec.ts`
**Tiempo estimado:** 45 minutos

```typescript
describe('RateLimitMiddleware', () => {
  it('should allow requests within limit', () => {
    // Test implementation
  });

  it('should block requests over limit', () => {
    // Test implementation
  });

  it('should reset limit after window', () => {
    // Test implementation
  });
});
```

---

## 🧪 **TESTING**

### **Pruebas Manuales**
```bash
# Test register-staff rate limiting
for i in {1..6}; do
  curl -X POST http://localhost:3000/auth/register-staff \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <token>" \
    -d '{"first_name":"Test","last_name":"User","email":"test'$i'@test.com","password":"password123","role":"employee"}'
done

# Verificar respuesta 429 en el 6to intento
```

### **Pruebas Automáticas**
```typescript
// rate-limit.middleware.spec.ts
describe('Rate Limiting', () => {
  it('should protect register-staff endpoint', async () => {
    // Test que verifica que register-staff tiene rate limiting
  });
});
```

---

## 📊 **VALIDACIÓN**

### **Checklist de Verificación**
- [x] Register-staff tiene rate limiting aplicado ✅ COMPLETADO
- [ ] Todos los endpoints de auth están protegidos
- [ ] Headers de rate limiting se incluyen
- [ ] Configuración es dinámica por entorno
- [ ] Tests pasan exitosamente
- [ ] Auditoría registra bloqueos

### **Comandos de Verificación**
```bash
# Verificar configuración
curl -I http://localhost:3000/auth/register-staff

# Debería incluir headers:
# X-RateLimit-Limit: 5
# X-RateLimit-Remaining: 4
# X-RateLimit-Reset: 1634567890

# Test de rate limiting
npm run test -- --testPathPattern=rate-limit
```

---

## 🎯 **CRITERIOS DE ACEPTACIÓN**

### **Funcionalidad**
- ✅ Todos los endpoints de autenticación tienen rate limiting
- ✅ Límites apropiados por tipo de endpoint
- ✅ Headers informativos incluidos
- ✅ Mensajes de error claros

### **Seguridad**
- ✅ Prevención efectiva de ataques de fuerza bruta
- ✅ Rate limiting por IP y usuario
- ✅ Auditoría de intentos de abuso
- ✅ Configuración segura por defecto

### **Rendimiento**
- ✅ Bajo impacto en requests legítimos
- ✅ Almacenamiento eficiente
- ✅ Escalabilidad con Redis (opcional)

---

## 💡 **CONCLUSIÓN**

Implementar estas mejoras completará el sistema de rate limiting, proporcionando:

- ✅ **Protección completa** contra ataques de fuerza bruta
- ✅ **Visibilidad** a través de headers informativos
- ✅ **Flexibilidad** con configuración dinámica
- ✅ **Monitoreo** a través de auditoría
- ✅ **Escalabilidad** con Redis backend

**Tiempo Total Estimado:** ~3-4 horas (Fase 1 esencial completada) + 2-3 horas (mejoras avanzadas)
**Prioridad:** Alta (Seguridad)
**Progreso:** ✅ Tarea crítica completada - Rate limiting aplicado a register-staff</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Rate Limiting/TODO.md
