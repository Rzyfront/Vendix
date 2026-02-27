# Vendix Skills System

> **Sistema modular de conocimientos para IA** - Arquitectura de patrones, convenciones y mejores prácticas.

Este directorio contiene las habilidades especializadas que los asistentes de IA utilizan para trabajar con **Vendix** de manera consistente y correcta.

## 📁 Estructura del Sistema

```
skills/
├── CORE/                    # Patrones fundamentales (SIEMPRE ACTIVOS)
├── BACKEND_ARCHITECTURE/    # Arquitectura y patrones del backend
├── FRONTEND_ARCHITECTURE/   # Arquitectura y patrones del frontend
├── SHARED_PATTERNS/         # Patrones compartidos entre frontend y backend
└── DATABASE/                # Patrones de base de datos
```

## 🎯 Categorías de Skills

### CORE - Siempre Activos
Estos skills contienen las reglas más críticas que **SIEMPRE** deben respetarse:

| Skill | Descripción | Trigger |
|-------|-------------|---------|
| `how-to-dev` | Flujo de desarrollo mandatorio y ultra-obligatorio | **SIEMPRE ACTIVO** |
| `vendix-development-rules` | Reglas críticas de desarrollo, uso de Task tools | **SIEMPRE ACTIVO** |
| `vendix-naming-conventions` | Convenciones de nombres (snake_case, CamelCase, PascalCase) | **SIEMPRE ACTIVO** |
| `buildcheck-dev` | Verificación con Docker logs antes de completar tareas | **SIEMPRE ACTIVO** |

### BACKEND_ARCHITECTURE - NestJS + Prisma
Patrones específicos del backend con NestJS:

| Skill | Descripción | Trigger |
|-------|-------------|---------|
| `vendix-backend-domain` | Arquitectura de dominios hexagonal, estructura de carpetas | Editando en `apps/backend/src/domains/` |
| `vendix-prisma-scopes` | Sistema de scoping multi-tenant, registro de modelos, withoutScope() | Trabajando con servicios Prisma scoped o agregando modelos a scopes |
| `vendix-backend-auth` | JWT, decoradores @Public, @Roles, @Permissions | Trabajando con autenticación/autorización |
| `vendix-backend-middleware` | Domain resolver, contexto de solicitud, middlewares | Creando/editando middlewares |
| `vendix-backend-api` | Patrones de respuesta, DTOs, controladores, ResponseService | Creando endpoints o controladores |

### FRONTEND_ARCHITECTURE - Angular 20
Patrones específicos del frontend con Angular:

| Skill | Descripción | Trigger |
|-------|-------------|---------|
| `vendix-frontend-module` | Creación de módulos con estructura estándar | Creando módulos en `app/private/modules/` |
| `vendix-frontend-component` | Componentes SIEMPRE en carpetas, standalone o módulares | Creando cualquier componente |
| `vendix-frontend-routing` | Routing público vs privado, guards, lazy loading | Editando archivos de rutas |
| `vendix-frontend-domain` | Detección de dominios, configuración, branding | Trabajando con domain config |
| `vendix-frontend-state` | Servicios, ToastService, notificaciones, estado reactiva | Creando servicios o estado |

### SHARED_PATTERNS - Patrones Transversales
Patrones aplicables tanto en frontend como backend:

| Skill | Descripción | Trigger |
|-------|-------------|---------|
| `vendix-validation` | Validación con early return, manejo de errores temprano | Escribiendo lógica de validación |
| `vendix-error-handling` | Try-catch, respuestas de error, logging | Manejando errores en cualquier capa |
| `vendix-reusable-abstractions` | Creación de componentes/servicios reutilizables | Creando abstracciones compartidas |

### DATABASE - Prisma ORM
Patrones de base de datos y migraciones:

| Skill | Descripción | Trigger |
|-------|-------------|---------|
| `vendix-prisma-schema` | Edición de schema.prisma, relaciones, convenciones | Editando `schema.prisma` |
| `vendix-prisma-seed` | Seeds estructurados, orden de eliminación | Creando/editando seeds |

## 🔄 Cómo Funciona el Sistema

### 1. Auto-detección de Contexto
Claude Code detecta automáticamente qué skill cargar basándose en:
- **Ruta del archivo** que se está editando
- **Tipo de operación** que se está realizando
- **Tecnología** detectada en el archivo

### 2. Composición de Skills
Múltiples skills pueden estar activos simultáneamente:

```typescript
// Ejemplo: Crear componente que llama API
// Skills activos:
// 1. vendix-frontend-component (estructura del componente)
// 2. vendix-frontend-state (servicio y notificaciones)
// 3. vendix-naming-conventions (NOMBRES CRÍTICOS)
// 4. buildcheck-dev (verificar al final)
```

### 3. Prioridad de Skills
Los skills CORE tienen prioridad absoluta y **SIEMPRE** deben respetarse:

```
1. vendix-naming-conventions (CRITICAL)
2. buildcheck-dev (CRITICAL)
3. vendix-development-rules (CRITICAL)
4. Skills específicos del dominio
5. Skills generales
```

## 📖 Uso del Sistema

### Para Desarrolladores

Los skills son **automáticos** - no necesitas hacer nada. Claude Code los cargará según el contexto.

### Para Mantenedores

Para agregar o modificar un skill:

1. **Crear/Editar el SKILL.md** correspondiente
2. **Actualizar AGENTS.md** con la nueva información en la tabla de skills
3. **Ejecutar** `./skills/setup.sh --sync` para sincronizar

## 🔧 Mantenimiento

### Sincronizar con Claude Code
```bash
./skills/setup.sh --sync
```

### Regenerar archivos de configuración
```bash
./skills/setup.sh --all        # Todos los formatos
./skills/setup.sh --claude     # Solo Claude Code
./skills/setup.sh --copilot    # Solo GitHub Copilot
```

## 📚 Recursos Adicionales

- **Contexto completo**: Ver [`Context.md`](../Context.md) en la raíz del repositorio
- **Documentación del backend**: `apps/backend/doc/`
- **Documentación del frontend**: `apps/frontend/README.md`
- **Schema de Prisma**: `apps/backend/prisma/schema.prisma`

---

**Principio de Diseño**: Cada skill es una unidad autónoma de conocimiento con una responsabilidad clara. Los triggers en AGENTS.md actúan como un router inteligente que compone los skills apropiados según el contexto.
