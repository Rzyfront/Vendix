---
name: buildcheck-dev
description: Build verification steps for development.
metadata:
  scope: [root]
  auto_invoke: "Verifying Build"
---

# Buildcheck Dev

> **Tip**: Si al verificar el build ves errores en shared components, consulta el README del componente en `apps/frontend/src/app/shared/components/{componente}/README.md` para verificar el uso correcto de inputs y outputs.

> **CRITICAL SKILL - ALWAYS ACTIVE** - Build verification is the MOST CRITICAL RESPONSIBILITY. A task is NEVER complete if there are compilation errors.

## THE MOST IMPORTANT RULE OF ALL

**BEFORE marking ANY task as complete, you are ABSOLUTELY REQUIRED TO:**

1. **ALWAYS** use Docker logs with `--tail` to verify build watch in development
2. Verify that **ZERO errors** exist in any container
3. **ALWAYS** check container status (if running)
4. **DO NOT finalize** until ALL errors are completely resolved
5. Re-check logs **AFTER** applying fixes
6. Verify **recursively** - check dependencies and related components

---

## Verification Workflow

### Step 1: Make Code Changes

Apply your changes to the codebase.

### Step 2: Check Docker Logs (WATCH MODE - Development)

**CRITICAL:** In development **ALWAYS** use watch mode with Docker logs. **DO NOT** run `npm run build` unless the human requests it EXPLICITLY for production.

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

- Verify one more time
- Only then mark task complete

**If errors exist:**

- DO NOT mark task complete
- Fix the errors
- Return to Step 2

### Step 4: Recursive Check

- Check not just the immediate component
- Check all dependencies
- Check all related components
- Verify the entire application builds successfully

---

## Reading Docker Logs

### Backend Logs

```bash
docker logs --tail 40 vendix_backend
```

**Look for:**

- `ERROR` messages
- `TypeError` or `ReferenceError`
- Compilation errors
- Missing dependencies
- Type errors
- `Successfully compiled` (good)
- `Nest application successfully started` (good)

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

- `ERROR` messages
- `ERROR in` compilation errors
- Template parsing errors
- Module not found errors
- Type errors in `.ts` files
- `Compiled successfully` (good)
- `webpack: Compiled successfully` (good)

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

- `ERROR:` messages
- Connection refused
- Syntax errors in queries
- `database system is ready to accept connections` (good)

---

## Common Build Errors and Fixes

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

## Verification Checklist

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

## CRITICAL UNDERSTANDING

**A task is NEVER complete if there are:**

- Build errors
- Compilation errors
- Runtime errors
- Type errors
- Missing dependencies
- Template parsing errors

**You must:**

- ALWAYS verify build status recursively
- ALWAYS fix ALL issues before considering work done
- NEVER accept "it should work" - verify with logs
- ALWAYS re-check after applying fixes

**Partial completion is NOT ACCEPTABLE**

---

## Example Workflow

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

## Development vs Production

### DEVELOPMENT MODE (DEFAULT)

**THIS IS THE DEFAULT MODE - ALWAYS ASSUME DEVELOPMENT**

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

- Watch mode enabled (hot-reload)
- Changes reflect automatically
- Compilation errors appear in logs
- Check logs AFTER each change

---

### PRODUCTION MODE (Only if human requests EXPLICITLY)

**ONLY run production build when:**

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

### DEFAULT WORKFLOW

**ALWAYS follow this order:**

1. **Make code changes**
2. **Check Docker logs (`--tail`) to see watch mode**
3. **Verify container is running (`docker ps`)**
4. **If errors, fix them**
5. **Go back to step 2**
6. **ONLY when NO errors, mark task complete**

---

## Container Recreation (Cache Issues)

### When to Recreate

**Container recreation is NECESSARY when:**

- Errors persist after multiple fix attempts
- Changes in `package.json` (new dependencies)
- Changes in `docker-compose.yml` (volumes, networks, environment)
- Image has corrupt or outdated cache
- Strange errors from modules that "should" be installed
- Permission issues with mapped files
- Container does not respond after `docker restart`
- Changes in Dockerfile

### How to Recreate

**Option 1: Restart + Rebuild (Recommended for minor changes)**

```bash
# Restart and rebuild a specific container
docker-compose restart <service>
# Example:
docker-compose restart backend
```

**Option 2: Rebuild (Without stopping)**

```bash
# Rebuild without stopping other services
docker-compose build --no-cache <service>
docker-compose up -d <service>
```

**Option 3: Full Recreate (For critical changes)**

```bash
# Stop, remove, and recreate container
docker-compose down
docker-compose up -d

# Or for a specific service:
docker-compose down <service>
docker-compose up -d <service>
```

**Option 4: Force Recreate (Clears cache)**

```bash
# Force recreate - removes containers and recreates them
docker-compose up -d --force-recreate

# For a specific service:
docker-compose up -d --force-recreate <service>
```

### Verification After Recreate

**ALWAYS verify after recreating:**

```bash
# 1. Verify the container is running
docker ps

# 2. Verify logs of the recreated container
docker logs --tail 40 vendix_<service>

# 3. Verify no errors exist
docker logs --tail 40 vendix_backend
docker logs --tail 40 vendix_frontend
```

### Common Scenarios

| Problem                           | Solution                                      |
| --------------------------------- | --------------------------------------------- |
| New dependencies in package.json  | `docker-compose build --no-cache backend`     |
| Changes in volumes/docker-compose | `docker-compose down && docker-compose up -d` |
| Corrupt node_modules cache        | `docker-compose build --no-cache frontend`    |
| Persistent nonsensical errors     | `docker-compose up -d --force-recreate`       |
| Changes in Dockerfile             | `docker-compose up -d --build`                |

---

### GOLDEN RULE

**Development → Docker logs (watch mode)**
**Production → npm run build (ONLY if human requests)**

---

## Quick Reference

| Component | Command                                 |
| --------- | --------------------------------------- |
| Backend   | `docker logs --tail 40 vendix_backend`  |
| Frontend  | `docker logs --tail 40 vendix_frontend` |
| Database  | `docker logs --tail 40 vendix_postgres` |
| All       | Run all three commands                  |

---

## YOUR FINAL CHECKPOINT

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
