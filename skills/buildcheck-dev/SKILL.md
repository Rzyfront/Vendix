---
name: buildcheck-dev
description: Build verification steps for development.
metadata:
  scope: [root]
  auto_invoke: "Verifying Build"
---
# Buildcheck Dev

> **CRITICAL SKILL - ALWAYS ACTIVE** - La verificación del build es la RESPONSABILIDAD MÁS CRÍTICA. Una tarea NUNCA está completa si hay errores de compilación.

## 🚨 THE MOST IMPORTANT RULE OF ALL

**BEFORE marking ANY task as complete, you are ABSOLUTELY REQUIRED TO:**

1. ✅ **ALWAYS** use Docker logs with `--tail` to verify build watch in development
2. ✅ Verify that **ZERO errors** exist in any container
3. ✅ **ALWAYS** check container status (if running)
4. ✅ **DO NOT finalize** until ALL errors are completely resolved
5. ✅ Re-check logs **AFTER** applying fixes
6. ✅ Verify **recursively** - check dependencies and related components

---

## 📋 Verification Workflow

### Step 1: Make Code Changes
Apply your changes to the codebase.

### Step 2: Check Docker Logs (WATCH MODE - Development)

**⚠️ CRITICAL:** In development **ALWAYS** use watch mode with Docker logs. **DO NOT** run `npm run build` unless the human requests it EXPLICITLY for production.

Run the appropriate log commands based on what you modified:

```bash
# Backend changes - Check watch mode
docker logs --tail 40 vendix_backend

# Frontend changes - Check watch mode
docker logs --tail 40 vendix_frontend

# Database/Prisma changes - Check container
docker logs --tail 40 vendix_postgres

# Multiple components affected - Check all containers
docker logs --tail 40 vendix_backend
docker logs --tail 40 vendix_frontend
docker logs --tail 40 vendix_postgres
```

**Verify container status:**
```bash
# Always verify containers are running
docker ps
```

### Step 3: Analyze Results

**If NO errors:**
- ✅ Verify one more time
- ✅ Only then mark task complete

**If errors exist:**
- ❌ DO NOT mark task complete
- ⚠️ Fix the errors
- 🔄 Return to Step 2

### Step 4: Recursive Check
- Check not just the immediate component
- Check all dependencies
- Check all related components
- Verify the entire application builds successfully

---

## 🔍 Reading Docker Logs

### Backend Logs

```bash
docker logs --tail 40 vendix_backend
```

**Look for:**
- ❌ `ERROR` messages
- ❌ `TypeError` or `ReferenceError`
- ❌ Compilation errors
- ❌ Missing dependencies
- ❌ Type errors
- ✅ `Successfully compiled` (good)
- ✅ `Nest application successfully started` (good)

**Example of GOOD output:**
```
[Nest] INFO [NestFactory] Starting Nest application...
[Nest] INFO [InstanceLoader] modules dependencies initialized
[Nest] INFO [RouterExplorer] Mapping {/auth, POST} route
[Nest] INFO [NestApplication] Nest application successfully started
```

**Example of BAD output:**
```
[ERROR] TypeError: Cannot read property 'user_name' of undefined
[ERROR] src/domains/auth/auth.service.ts:45:20 - error TS2304
```

---

### Frontend Logs

```bash
docker logs --tail 40 vendix_frontend
```

**Look for:**
- ❌ `ERROR` messages
- ❌ `ERROR in` compilation errors
- ❌ Template parsing errors
- ❌ Module not found errors
- ❌ Type errors in `.ts` files
- ✅ `Compiled successfully` (good)
- ✅ `webpack: Compiled successfully` (good)

**Example of GOOD output:**
```
✓ Compiled successfully in 2345ms
webpack: Compiled successfully
```

**Example of BAD output:**
```
ERROR in src/app/shared/components/button/button.component.ts:12:5
TS2322: Type 'string' is not assignable to type 'ButtonVariant'
```

---

### Database Logs

```bash
docker logs --tail 40 vendix_postgres
```

**Look for:**
- ❌ `ERROR:` messages
- ❌ Connection refused
- ❌ Syntax errors in queries
- ✅ `database system is ready to accept connections` (good)

---

## 🎯 Common Build Errors and Fixes

### TypeScript Errors

**Error:**
```
TS2322: Type 'X' is not assignable to type 'Y'
```

**Fix:**
1. Check type definitions
2. Verify interface contracts
3. Ensure proper typing
4. Re-check logs after fix

---

### Module Not Found

**Error:**
```
Error: Cannot find module '@/shared/components/...'
```

**Fix:**
1. Verify import path
2. Check if file exists
3. Verify tsconfig paths
4. Re-check logs after fix

---

### Prisma Client Errors

**Error:**
```
Error: Prisma Client is not generated
```

**Fix:**
1. Run: `npx prisma generate`
2. Verify schema.prisma is valid
3. Re-check logs after fix

---

### Template Errors

**Error:**
```
NG2: Property 'user_name' does not exist on type 'Component'
```

**Fix:**
1. Check component TypeScript file
2. Verify property is defined
3. Check for proper decorators (@Input, signal)
4. Re-check logs after fix

---

## 📊 Verification Checklist

Before marking ANY task as complete:

- [ ] Code changes applied
- [ ] Docker logs checked for **ALL** affected components
- [ ] **ZERO errors** in logs
- [ ] Recursive verification complete
- [ ] Dependencies checked
- [ ] Related components checked
- [ ] Re-verified after any fixes
- [ ] Application builds successfully
- [ ] Application runs without errors

---

## 🔴 CRITICAL UNDERSTANDING

**A task is NEVER complete if there are:**
- ❌ Build errors
- ❌ Compilation errors
- ❌ Runtime errors
- ❌ Type errors
- ❌ Missing dependencies
- ❌ Template parsing errors

**You must:**
- ✅ ALWAYS verify build status recursively
- ✅ ALWAYS fix ALL issues before considering work done
- ✅ NEVER accept "it should work" - verify with logs
- ✅ ALWAYS re-check after applying fixes

**Partial completion is NOT ACCEPTABLE**

---

## 💻 Example Workflow

### Scenario: Creating a new Angular component

```bash
# 1. Create the component
ng generate component modules/user-management/user-list

# 2. Check logs IMMEDIATELY
docker logs --tail 40 vendix_frontend

# 3. If errors found:
#    - Fix them
#    - Re-check logs
#    - Repeat until ZERO errors

# 4. Only then mark task complete
```

---

## 🔧 Development vs Production

### 🚨 DEVELOPMENT MODE (DEFAULT)

**⚠️ THIS IS THE DEFAULT MODE - ALWAYS ASSUME DEVELOPMENT**

In development, **ALWAYS** use:

```bash
# Verify watch mode with Docker logs
docker logs --tail 40 <container>

# Verify container is running
docker ps

# If container is not running, restart it
docker restart <container>
```

**Development mode characteristics:**
- ✅ Watch mode enabled (hot-reload)
- ✅ Changes reflect automatically
- ✅ Compilation errors appear in logs
- ✅ Check logs AFTER each change

---

### 🏭 PRODUCTION MODE (Only if human requests EXPLICITLY)

**⚠️ ONLY run production build when:**
- Human says it explicitly ("run production build")
- Human asks if code compiles for production
- Preparing for a deployment

```bash
# Backend - Production build
cd apps/backend && npm run build

# Frontend - Production build
cd apps/frontend && npm run build
```

---

### 📋 DEFAULT WORKFLOW

**ALWAYS follow this order:**

1. **Make code changes**
2. **Check Docker logs (`--tail`) to see watch mode**
3. **Verify container is running (`docker ps`)**
4. **If errors, fix them**
5. **Go back to step 2**
6. **ONLY when NO errors, mark task complete**

---

## 🐳 Container Recreation (Cache Issues)

### When to Recreate

**Recrear el contenedor es NECESARIO cuando:**

- ❌ Errores persisten después de múltiples intentos de fix
- ❌ Cambios en `package.json` (nuevas dependencias)
- ❌ Cambios en `docker-compose.yml` (volúmenes, redes, environment)
- ❌ La imagen tiene caché corrupto o desactualizado
- ❌ Errores extraños de módulos que "deberían" estar instalados
- ❌ Problemas de permisos en archivos mapeados
- ❌ El contenedor no responde después de `docker restart`
- ❌ Cambios en el Dockerfile

### How to Recreate

**Opción 1: Restart + Rebuild (Recomendado para cambios menores)**
```bash
# Restart y rebuild de un contenedor específico
docker-compose restart <service>
# Ejemplo:
docker-compose restart backend
```

**Opción 2: Rebuild (Sin stop)**
```bash
# Rebuild sin detener otros servicios
docker-compose build --no-cache <service>
docker-compose up -d <service>
```

**Opción 3: Full Recreate (Para cambios críticos)**
```bash
# Detener, eliminar y recrear contenedor
docker-compose down
docker-compose up -d

# O para un servicio específico:
docker-compose down <service>
docker-compose up -d <service>
```

**Opción 4: Force Recreate (Limpia cache)**
```bash
# Forzar recreate - elimina contenedores y recreatea
docker-compose up -d --force-recreate

# Para un servicio específico:
docker-compose up -d --force-recreate <service>
```

### Verification After Recreate

**SIEMPRE verificar después de recrear:**

```bash
# 1. Verificar que el contenedor esté corriendo
docker ps

# 2. Verificar logs del contenedor recreado
docker logs --tail 40 vendix_<service>

# 3. Verificar que no haya errores
docker logs --tail 40 vendix_backend
docker logs --tail 40 vendix_frontend
```

### Common Scenarios

| Problema | Solución |
|----------|----------|
| Nuevas dependencias en package.json | `docker-compose build --no-cache backend` |
| Cambios en volumenes/docker-compose | `docker-compose down && docker-compose up -d` |
| Caché corrupta de node_modules | `docker-compose build --no-cache frontend` |
| Errores persistentes sin sentido | `docker-compose up -d --force-recreate` |
| Cambios en Dockerfile | `docker-compose up -d --build` |

---

### 🎯 GOLDEN RULE

**Development → Docker logs (watch mode)**
**Production → npm run build (ONLY if human requests)**

---

## 🎯 Quick Reference

| Component | Command |
|-----------|---------|
| Backend | `docker logs --tail 40 vendix_backend` |
| Frontend | `docker logs --tail 40 vendix_frontend` |
| Database | `docker logs --tail 40 vendix_postgres` |
| All | Run all three commands |

---

## 🔴 YOUR FINAL CHECKPOINT

**Remember: Code quality and consistency directly impact:**
- Project success
- Team productivity
- Long-term maintainability

**Build verification is your final checkpoint before delivery.**

---

## Related Skills

- `vendix-development-rules` - General development rules
- `vendix-naming-conventions` - Naming conventions (CRITICAL)
- `vendix-backend-domain` - Backend verification patterns
- `vendix-frontend-component` - Frontend verification patterns
