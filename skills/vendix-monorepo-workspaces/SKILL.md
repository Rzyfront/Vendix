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

> **Trigger**: Siempre que trabajes con dependencias, instalación de paquetes, o configuración del monorepo.

## 📋 Resumen

Vendix es un **monorepo usando npm workspaces** con múltiples apps (`apps/*`) y libs compartidas (`libs/*`). Cada workspace es auto-contenido para producción, pero comparten herramientas de desarrollo.

```
Vendix/
├── package.json              # Raíz: solo scripts, NO dependencias de producción
├── apps/
│   ├── backend/              # NestJS API
│   │   └── package.json      # Dependencias del backend
│   └── frontend/             # Angular SPA
│           └── package.json  # Dependencias del frontend
└── libs/                     # Librerías compartidas (futuro)
```

## 🚨 Regla CRÍTICA: Ubicación de Dependencias

### ✅ CORRECTO

```yaml
# package.json (raíz)
dependencies: {}  # VACÍO - solo scripts

# apps/frontend/package.json
dependencies:
  - marked           # Solo frontend lo usa
  - xlsx             # Frontend lo usa
  - @types/xlsx

# apps/backend/package.json
dependencies:
  - xlsx             # Backend lo usa
  - @types/xlsx
  - @nestjs/common   # Solo backend lo usa
```

### ❌ INCORRECTO

```yaml
# package.json (raíz)
dependencies:
  - marked           # ❌ MAL: Solo frontend lo usa
  - xlsx             # ❌ MAL: Causa duplicación

# apps/frontend/package.json
dependencies: {}     # ❌ MAL: Usa marked pero no lo declara
```

## 🎯 Principios

### 1. Auto-contención
**Cada workspace debe declarar TODAS las dependencias que usa.**

Si `apps/frontend/src` hace `import { marked } from 'marked'`:
- ✅ `marked` DEBE estar en `apps/frontend/package.json`
- ❌ NO debe depender de la raíz para obtenerlo

### 2. Single Source of Truth
**Una dependencia debe vivir en UN solo lugar.**

- **Compartida por frontend + backend**: Declarar en AMBOS `package.json`
- **Usada solo por un app**: Declarar solo en ese app
- **Nunca en la raíz**: A menos que sea una herramienta de desarrollo shared

### 3. Transparencia
**Al leer `apps/frontend/package.json`, debo ver TODO lo que necesita.**

No debería haber dependencias "ocultas" en la raíz que sean necesarias para producción.

## 📦 Instalación de Dependencias

### Desarrollo Local

```bash
# Desde la raíz - instala TODOS los workspaces
npm install

# Instalar dependencia para un workspace específico
npm install <paquete> -w apps/frontend

# Instalar dependencia shared (ambos workspaces)
npm install <paquete> -w apps/frontend
npm install <paquete> -w apps/backend
```

### Ejemplos Prácticos

```bash
# Caso 1: Frontend necesita un nuevo paquete
npm install lucide-react -w apps/frontend

# Caso 2: Ambos necesitan el mismo paquete
npm install date-fns -w apps/frontend
npm install date-fns -w apps/backend

# Caso 3: Herramienta de desarrollo shared (eslint, prettier)
npm install -D -w apps/frontend eslint
npm install -D -w apps/backend eslint
```

## 🐳 Docker y Contenerización

### Dockerfile.dev Patrón Correcto

```dockerfile
# CORRECTO - Cada workspace se instala a sí mismo
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 4200
CMD ["npx", "ng", "serve", "--host", "0.0.0.0"]
```

```dockerfile
# ❌ INCORRECTO - Depende de la raíz
FROM node:20-alpine
WORKDIR /app
COPY ../../package.json ./package.json  # No hacer esto
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

**Importante**: El context debe ser el workspace, no la raíz.

## 🚀 CI/CD Considerations

### GitHub Actions - Frontend

```yaml
- name: Install dependencies
  run: npm ci              # Instala desde raíz (workspaces)

- name: Build frontend
  working-directory: apps/frontend
  run: npm run build:prod  # Construye solo frontend
```

**Por qué funciona**: `npm ci` instala todos los workspaces, pero cada build es independiente.

### GitHub Actions - Backend

```yaml
- name: Build and push Docker image
  run: |
    cd apps/backend
    docker build -t app .
```

**Por qué funciona**: El Dockerfile del backend incluye sus propias dependencias.

## ⚠️ Errores Comunes

### Error 1: "Cannot find module"

```
TS2307: Cannot find module 'marked' or its corresponding type declarations
```

**Causa**: `marked` está en la raíz pero no en `apps/frontend/package.json`

**Solución**:
```bash
# Mover la dependencia donde se usa
npm install marked -w apps/frontend
# Y eliminar de package.json raíz
```

### Error 2: Dependencias Duplicadas

```
node_modules/marked (v17.0.1)
node_modules/apps/frontend/node_modules/marked (v16.0.0)
```

**Causa**: La misma dependencia en raíz + workspace con versiones diferentes

**Solución**: Mantener solo en el workspace, eliminar de raíz

### Error 3: Docker Build Falla

```
Error: Cannot find module '@nestjs/common'
```

**Causa**: Dockerfile intenta instalar desde raíz en lugar del workspace

**Solución**: Usar `COPY package*.json ./` del workspace, no de la raíz

## 🔍 Verificación

### Comandos para Diagnóstico

```bash
# Ver qué apps usan un paquete
grep -r "from ['\"]<paquete>['\"]" apps/*/src

# Ver si un paquete está duplicado
grep -r '"<paquete>"' package.json apps/*/package.json

# Ver estructura de workspaces
npm workspaces list
```

### Checklist Antes de Commits

- [ ] Cada dependencia está en el package.json donde se usa
- [ ] No hay dependencias de producción en la raíz
- [ ] Dockerfiles instalan desde su propio workspace
- [ ] `npm install` funciona sin errores
- [ ] Build de cada app funciona individualmente

## 📚 Referencias Rápidas

| Comando | Descripción |
|---------|-------------|
| `npm install` | Instala todos los workspaces desde raíz |
| `npm install <pkg> -w <workspace>` | Instala en un workspace específico |
| `npm run build -w apps/frontend` | Ejecuta script en workspace específico |
| `npm workspaces list` | Lista todos los workspaces |

## 🎓 Lecciones Aprendidas

1. **marked** fue movido de raíz → frontend (solo frontend lo usa)
2. **xlsx** está en frontend y backend (ambos lo usan independientemente)
3. **@types/xlsx** lo necesitan ambos (TypeScript types por app)
4. La raíz debe mantenerse limpia: solo scripts de orchestration

## 🔄 Mantenimiento

### Agregando Nueva App al Monorepo

```bash
# 1. Crear directorio
mkdir apps/nueva-app

# 2. Inicializar
cd apps/nueva-app
npm init -y

# 3. La raíz lo detectará automáticamente (workspaces: ["apps/*"])
```

### Removiendo una App

```bash
# 1. Eliminar directorio
rm -rf apps/vieja-app

# 2. Limpiar node_modules
npm install
```

---

**Recuerda**: La clave es que cada workspace sea **auto-contenido**. Si un archivo hace `import X from 'Y'`, entonces `Y` debe estar en el `package.json` de ese workspace.
