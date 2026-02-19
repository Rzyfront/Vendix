---
name: git-workflow
description: >
  Reglas y patrones para commits, PRs, branching y resolución de conflictos.
  Trigger: Cuando se hacen commits, se crean PRs, se trabaja con ramas, o se resuelven conflictos en git.
license: Apache-2.0
metadata:
  author: vendix
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "git commit, git push, crear PR, crear rama"
    - "resolver conflictos de merge"
    - "cambios con migraciones de base de datos"
---

## When to Use

- Al hacer cualquier commit en el proyecto
- Al crear o actualizar Pull Requests
- Al crear o nombrar ramas
- Al resolver conflictos de merge con main/master
- Al hacer push de cambios

---

## Preferencia de Herramientas: GitHub MCP (PRIORITARIO)

**Si el servidor MCP de GitHub está disponible, SIEMPRE preferir usar las herramientas MCP sobre comandos bash de git.** Esto aplica especialmente para:

| Operación | MCP Tool preferido | Evitar |
|-----------|-------------------|--------|
| Crear PR | `mcp__github__create_pull_request` | `gh pr create` vía Bash |
| Crear rama | `mcp__github__create_branch` | `git checkout -b` + `git push` |
| Ver PRs | `mcp__github__list_pull_requests` | `gh pr list` vía Bash |
| Ver issues | `mcp__github__list_issues` / `mcp__github__search_issues` | `gh issue list` vía Bash |
| Leer archivos del repo | `mcp__github__get_file_contents` | `gh api` vía Bash |
| Ver diff de PR | `mcp__github__pull_request_read` (method: get_diff) | `gh pr diff` vía Bash |
| Comentar en PR/issue | `mcp__github__add_issue_comment` | `gh pr comment` vía Bash |
| Crear review | `mcp__github__pull_request_review_write` | `gh pr review` vía Bash |
| Push archivos | `mcp__github__push_files` | `git add` + `git commit` + `git push` |
| Merge PR | `mcp__github__merge_pull_request` | `gh pr merge` vía Bash |

**Razón:** Las herramientas MCP proveen acceso estructurado, tipado y con mejor manejo de errores que los comandos CLI. Solo usar `git` vía Bash para operaciones locales que no tengan equivalente MCP (ej: `git status`, `git diff` local, `git stash`).

---

## Critical Patterns

### REGLA 1: Protección de main/master (BLOQUEANTE)

**NUNCA** hacer push directo a `main` o `master`. Todo cambio debe ir por rama de desarrollo + PR.

```
PROHIBIDO:
  git push origin main
  git push origin master
  git checkout main && git commit

CORRECTO:
  git checkout -b feature/mi-cambio
  # ... hacer cambios y commits ...
  git push origin feature/mi-cambio
  # crear PR hacia main
```

### REGLA 2: Sin co-autores de IA (MANDATORIO)

**NUNCA** agregar líneas `Co-Authored-By` de IA o herramientas automatizadas en los mensajes de commit. Esta regla es **absoluta e innegociable**.

```
PROHIBIDO (nunca incluir):
  Co-Authored-By: Claude <noreply@anthropic.com>
  Co-Authored-By: GitHub Copilot <noreply@github.com>
  Co-Authored-By: [cualquier IA o bot]

CORRECTO:
  git commit -m "feat: agregar validación de formulario"
  (sin líneas de co-autoría automatizada)
```

Solo se permiten co-autores que sean **personas reales** del equipo.

### REGLA 3: Migraciones de BD requieren alerta en commit y PR

Cuando un cambio incluya migraciones de base de datos (ALTER TABLE, CREATE TABLE, DROP, etc.), el commit y el PR **deben** documentar los cambios en la descripción.

Formato para commits con migraciones:

```
feat: agregar campo status a tabla orders

⚠️ MIGRACIÓN DE BASE DE DATOS ⚠️
- ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'pending'
- CREATE INDEX idx_orders_status ON orders(status)
```

Formato para PRs con migraciones:

```markdown
## Summary
Agrega campo de status a órdenes

## ⚠️ MIGRACIÓN DE BASE DE DATOS
> **ATENCIÓN**: Este PR requiere ejecutar migraciones antes del deploy.

| Operación | Tabla | Detalle |
|-----------|-------|---------|
| ALTER TABLE | orders | ADD COLUMN status VARCHAR(50) DEFAULT 'pending' |
| CREATE INDEX | orders | idx_orders_status ON orders(status) |

### Comandos de migración
```bash
npx prisma migrate deploy
```
```

### REGLA 4: Resolución de conflictos

Los conflictos con main **siempre** se resuelven en la rama de desarrollo, nunca en main directamente.

```bash
# CORRECTO: traer main a tu rama y resolver ahí
git checkout feature/mi-rama
git merge main
# resolver conflictos en la rama de desarrollo
git add .
git commit -m "merge: resolver conflictos con main"

# PROHIBIDO: resolver conflictos en main
git checkout main
git merge feature/mi-rama  # NO hacer esto directamente
```

---

## Decision Tree

```
¿Dónde estoy haciendo el cambio?
  → En main/master         → DETENER. Crear rama primero.
  → En rama de desarrollo  → Continuar.

¿El cambio incluye migraciones de BD?
  → Sí → Agregar bloque ⚠️ MIGRACIÓN en commit y PR.
  → No → Commit normal.

¿Hay conflictos con main?
  → Sí, son claros     → Resolver en rama de desarrollo a favor de los cambios nuevos sin romper lo existente.
  → Sí, son ambiguos   → Preguntar al usuario qué opción de resolución prefiere.
  → No                  → Continuar normalmente.

¿El commit tiene co-autor de IA?
  → SIEMPRE eliminar. Sin excepciones.
```

---

## Conflictos: Reglas de Resolución

| Situación | Acción |
|-----------|--------|
| Conflicto claro (solo formato, imports) | Resolver a favor del cambio nuevo |
| Conflicto en lógica de negocio | Mantener ambos cambios si es posible, priorizar el nuevo |
| Conflicto ambiguo o riesgoso | Preguntar al usuario mostrando las opciones |
| Conflicto en archivos de config | Merge manual, preservar ambas configuraciones |
| Conflicto en migraciones | Preguntar siempre al usuario (alto riesgo) |

---

## Branching: Convenciones de Nombres

```
feature/descripcion-corta    # Nueva funcionalidad
fix/descripcion-del-bug      # Corrección de bug
hotfix/descripcion-urgente   # Fix urgente para producción
refactor/que-se-refactoriza  # Refactorización
chore/tarea-tecnica          # Tareas técnicas (deps, config)
migration/nombre-migracion   # Cambios que incluyen migraciones
```

---

## Commits: Formato

```
<tipo>: <descripción corta en imperativo>

[cuerpo opcional con más detalle]

[⚠️ MIGRACIÓN DE BASE DE DATOS si aplica]
```

Tipos válidos: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`, `hotfix`, `migration`

---

## Commands

```bash
git checkout -b feature/nombre    # Crear rama nueva
git push origin feature/nombre    # Push a rama (nunca a main)
git merge main                    # Traer main a tu rama para resolver conflictos
git log --oneline -10             # Ver últimos commits
```
