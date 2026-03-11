---
name: vendix-monorepo-workspaces
description: Monorepo architecture and npm workspaces patterns.
metadata:
  scope: [root]
  auto_invoke:
    - "Installing dependencies"
    - "Modifying package.json"
    - "Creating Dockerfiles"
    - "Configuring CI/CD"
    - "Adding/removing workspaces"
---
# Vendix Monorepo Workspaces

> **Trigger**: Whenever you work with dependencies, package installation, or monorepo configuration.

## Summary

Vendix is a **monorepo using npm workspaces** with multiple apps (`apps/*`) and shared libs (`libs/*`). Each workspace is self-contained for production, but they share development tools.

```
Vendix/
├── package.json              # Root: scripts only, NO production dependencies
├── apps/
│   ├── backend/              # NestJS API
│   │   └── package.json      # Backend dependencies
│   └── frontend/             # Angular SPA
│           └── package.json  # Frontend dependencies
└── libs/                     # Shared libraries (future)
```

## CRITICAL Rule: Dependency Location

### CORRECT

```yaml
# package.json (root)
dependencies: {}  # EMPTY - scripts only

# apps/frontend/package.json
dependencies:
  - marked           # Only frontend uses it
  - xlsx             # Frontend uses it
  - @types/xlsx

# apps/backend/package.json
dependencies:
  - xlsx             # Backend uses it
  - @types/xlsx
  - @nestjs/common   # Only backend uses it
```

### INCORRECT

```yaml
# package.json (root)
dependencies:
  - marked           # WRONG: Only frontend uses it
  - xlsx             # WRONG: Causes duplication

# apps/frontend/package.json
dependencies: {}     # WRONG: Uses marked but doesn't declare it
```

## Principles

### 1. Self-containment
**Each workspace must declare ALL dependencies it uses.**

If `apps/frontend/src` does `import { marked } from 'marked'`:
- `marked` MUST be in `apps/frontend/package.json`
- It must NOT depend on the root to obtain it

### 2. Single Source of Truth
**A dependency should live in ONE place only.**

- **Shared by frontend + backend**: Declare in BOTH `package.json`
- **Used by only one app**: Declare only in that app
- **Never in root**: Unless it's a shared development tool

### 3. Transparency
**When reading `apps/frontend/package.json`, I should see EVERYTHING it needs.**

There should be no "hidden" dependencies in the root that are required for production.

## Installing Dependencies

### Local Development

```bash
# From the root - installs ALL workspaces
npm install

# Install a dependency for a specific workspace
npm install <package> -w apps/frontend

# Install a shared dependency (both workspaces)
npm install <package> -w apps/frontend
npm install <package> -w apps/backend
```

### Practical Examples

```bash
# Case 1: Frontend needs a new package
npm install lucide-react -w apps/frontend

# Case 2: Both need the same package
npm install date-fns -w apps/frontend
npm install date-fns -w apps/backend

# Case 3: Shared development tool (eslint, prettier)
npm install -D -w apps/frontend eslint
npm install -D -w apps/backend eslint
```

## Docker and Containerization

### Correct Dockerfile.dev Pattern

```dockerfile
# CORRECT - Each workspace installs itself
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 4200
CMD ["npx", "ng", "serve", "--host", "0.0.0.0"]
```

```dockerfile
# INCORRECT - Depends on root
FROM node:20-alpine
WORKDIR /app
COPY ../../package.json ./package.json  # Don't do this
RUN npm install
```

### docker-compose.yml

```yaml
services:
  frontend:
    build:
      context: ./apps/frontend
      dockerfile: Dockerfile.dev
    volumes:
      - ./apps/frontend:/app
      - /app/node_modules
```

**Important**: The context must be the workspace, not the root.

## CI/CD Considerations

### GitHub Actions - Frontend

```yaml
- name: Install dependencies
  run: npm ci              # Installs from root (workspaces)

- name: Build frontend
  working-directory: apps/frontend
  run: npm run build:prod  # Builds only frontend
```

**Why it works**: `npm ci` installs all workspaces, but each build is independent.

### GitHub Actions - Backend

```yaml
- name: Build and push Docker image
  run: |
    cd apps/backend
    docker build -t app .
```

**Why it works**: The backend Dockerfile includes its own dependencies.

## Common Errors

### Error 1: "Cannot find module"

```
TS2307: Cannot find module 'marked' or its corresponding type declarations
```

**Cause**: `marked` is in the root but not in `apps/frontend/package.json`

**Solution**:
```bash
# Move the dependency to where it's used
npm install marked -w apps/frontend
# And remove it from root package.json
```

### Error 2: Duplicate Dependencies

```
node_modules/marked (v17.0.1)
node_modules/apps/frontend/node_modules/marked (v16.0.0)
```

**Cause**: The same dependency in root + workspace with different versions

**Solution**: Keep only in the workspace, remove from root

### Error 3: Docker Build Fails

```
Error: Cannot find module '@nestjs/common'
```

**Cause**: Dockerfile tries to install from root instead of the workspace

**Solution**: Use `COPY package*.json ./` from the workspace, not from the root

## Verification

### Diagnostic Commands

```bash
# See which apps use a package
grep -r "from ['\"]<package>['\"]" apps/*/src

# See if a package is duplicated
grep -r '"<package>"' package.json apps/*/package.json

# See workspace structure
npm workspaces list
```

### Pre-Commit Checklist

- [ ] Each dependency is in the package.json where it's used
- [ ] No production dependencies in the root
- [ ] Dockerfiles install from their own workspace
- [ ] `npm install` runs without errors
- [ ] Each app's build works individually

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm install` | Installs all workspaces from root |
| `npm install <pkg> -w <workspace>` | Installs in a specific workspace |
| `npm run build -w apps/frontend` | Runs script in a specific workspace |
| `npm workspaces list` | Lists all workspaces |

## Lessons Learned

1. **marked** was moved from root to frontend (only frontend uses it)
2. **xlsx** is in frontend and backend (both use it independently)
3. **@types/xlsx** is needed by both (TypeScript types per app)
4. The root should stay clean: orchestration scripts only

## Maintenance

### Adding a New App to the Monorepo

```bash
# 1. Create directory
mkdir apps/new-app

# 2. Initialize
cd apps/new-app
npm init -y

# 3. The root will detect it automatically (workspaces: ["apps/*"])
```

### Removing an App

```bash
# 1. Delete directory
rm -rf apps/old-app

# 2. Clean node_modules
npm install
```

---

**Remember**: The key is that each workspace should be **self-contained**. If a file does `import X from 'Y'`, then `Y` must be in the `package.json` of that workspace.
