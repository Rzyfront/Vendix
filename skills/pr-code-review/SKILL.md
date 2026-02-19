---
name: pr-code-review
description: >
  Skill para revisar Pull Requests de cualquier repositorio GitHub usando MCP tools.
  Analiza seguridad, lógica, sintaxis, archivos core y calidad de código.
  Trigger: Cuando el usuario pide revisar PRs, analizar código de un PR, o hacer code review.
license: Apache-2.0
metadata:
  author: vendix
  version: "1.0"
  scope: [root]
  auto_invoke: ["revisar PR", "review PR", "analizar PR", "code review", "revisar pull request"]
---

## When to Use

Use this skill when:
- El usuario pide revisar PRs abiertos de uno o más repositorios
- Se necesita analizar código de un PR antes de aprobarlo
- Se quiere evaluar la calidad y seguridad de cambios propuestos
- El usuario pide hacer code review sistemático

---

## Requisitos: GitHub MCP Server

Esta skill **requiere** el MCP server de GitHub (`github`) para funcionar. Antes de iniciar cualquier revisión, verifica que esté disponible.

### Cómo detectar si está instalado

Intenta ejecutar `mcp__github__get_me`. Si funciona, el MCP está listo. Si falla o el tool no existe, el usuario necesita instalarlo.

### Si NO está instalado — Ofrecer ayuda

Dile al usuario:

> Para revisar PRs necesito el MCP server de GitHub. ¿Quieres que te ayude a instalarlo?

#### Instalación

El GitHub MCP server se configura en `~/.claude/settings.json` (global) o `.claude/settings.json` (proyecto):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<TOKEN>"
      }
    }
  }
}
```

#### Pasos para el usuario

1. **Crear un Personal Access Token (PAT)** en GitHub:
   - Ir a GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Crear token con permisos: `repo` (full), `read:org`, `read:user`
   - Para repos privados es indispensable el scope `repo`

2. **Agregar la config** al archivo de settings:
   ```bash
   # Global (funciona en todos los proyectos)
   ~/.claude/settings.json

   # O por proyecto (solo este repo)
   .claude/settings.json
   ```

3. **Reiniciar Claude Code** para que cargue el MCP server

4. **Verificar** ejecutando: `mcp__github__get_me` — debe devolver el usuario autenticado

#### Permisos mínimos del token por funcionalidad

| Funcionalidad | Permisos necesarios |
|---------------|-------------------|
| Listar PRs / ver diffs | `repo` (read) |
| Postear reviews / comentarios | `repo` (write) |
| Buscar repos de una org | `read:org` |
| Ver info del usuario | `read:user` |
| Repos privados | `repo` (full control) |

#### Troubleshooting

```
Error: "Resource not accessible by personal access token"
→ El token no tiene scope `repo` o no tiene acceso a ese repo/org

Error: "Bad credentials"
→ El token expiró o fue revocado, crear uno nuevo

Error: Tool `mcp__github__*` no existe
→ El MCP server no está configurado o Claude Code necesita reiniciarse
```

---

## Critical Patterns

### Pattern 1: Flujo Completo de Revisión (paso a paso)

```
PASO 1 → Identificar repos y listar PRs abiertos
PASO 2 → Tomar el primer PR y obtener metadata + archivos
PASO 3 → Obtener el diff completo y analizarlo
PASO 4 → Presentar hallazgos al usuario con calificación
PASO 5 → Esperar decisión: aprobar, request changes, o siguiente PR
PASO 6 → Si se postea review, usar MCP tools para dejar el comentario
PASO 7 → Repetir con el siguiente PR
```

### Pattern 2: Las 6 Categorías de Análisis (SIEMPRE revisar todas)

| # | Categoría | Qué buscar | Severidad |
|---|-----------|------------|-----------|
| 1 | **Seguridad** | XSS (innerHTML sin sanitizar), SQL injection, auth faltante, secrets expuestos, inputs sin validar | ALTA |
| 2 | **Lógica** | Race conditions, estados inconsistentes, valores falsy (`\|\| 0` vs `?? 0`), memory leaks, llamadas duplicadas a API | ALTA |
| 3 | **Sintaxis** | Typos, brackets faltantes, imports incorrectos, código que no compila | ALTA |
| 4 | **Archivos Core** | Cambios en router, store, package.json, configs — evaluar impacto en otros módulos | MEDIA |
| 5 | **Scope del PR** | Features mezcladas, cambios no relacionados con el título, cambios "sneaky" enterrados | MEDIA |
| 6 | **Calidad** | Hardcoded values, error handling faltante, console.logs de debug, código duplicado, patrones inconsistentes | BAJA |

### Pattern 3: Sistema de Calificación

```
90-100%  → APPROVE — Limpio, sin issues
70-89%   → APPROVE con comentarios menores — Issues de calidad baja
50-69%   → REQUEST CHANGES — Bugs de lógica o issues medias
30-49%   → REQUEST CHANGES — Issues de seguridad o bugs críticos
 0-29%   → REQUEST CHANGES — Múltiples issues críticas, PR necesita reescritura
```

### Pattern 4: Formato de Presentación al Usuario

Siempre presentar cada PR en este formato:

```markdown
# PR #NNN — `repo` — "título del PR"

**Autor:** username | **Archivos:** N | **+adds / -dels** | **Branch:** head → base

## Archivos modificados
(tabla con archivo, cambios, qué hace)

## Hallazgos
(organizados por severidad: CRITICO > ALTO > MEDIO > BAJO)
(cada hallazgo con: archivo, línea aproximada, código relevante, explicación, fix sugerido)

## Archivos Core tocados
(tabla con archivo, nivel de riesgo, nota)

## Calificación: XX/100
(lo bueno, lo malo, recomendación: APPROVE o REQUEST CHANGES)
```

### Pattern 5: Formato del Review Message para GitHub

Cuando el usuario aprueba postear el review, usar lenguaje natural y directo:

```markdown
Hola [autor], [comentario positivo breve sobre el PR].
Hay [N] cosas que revisar antes de merge:

**1. [Título del issue] ([severidad])**
`archivo.ext` ~L[línea] — [explicación clara y concisa]. [Fix sugerido con código si aplica]:
\`\`\`typescript
// código sugerido
\`\`\`

**2. [Título del issue] ([severidad])**
`archivo.ext` ~L[línea] — [explicación].

[Resumen final: qué es lo más importante de arreglar]
```

Reglas del mensaje:
- Lenguaje natural, no robótico
- Empezar con algo positivo del PR
- Issues ordenados por severidad (crítico primero)
- Referencias a archivos abreviadas: `archivo.ext ~LNNN`
- Incluir código de fix solo cuando es corto y claro
- Cerrar con resumen de qué es lo más urgente

---

## Decision Tree

```
¿El usuario pidió revisar PRs?
│
├─ ¿Especificó repos? → Usar esos repos
│  └─ NO → Preguntar o buscar repos del usuario/org
│
├─ ¿Especificó PR number? → Ir directo a ese PR
│  └─ NO → Listar PRs abiertos y revisar uno por uno
│
├─ ¿El diff es muy grande (>3000 líneas)?
│  └─ SÍ → Usar subagent (Task tool) para analizar el diff completo
│  └─ NO → Analizar inline
│
├─ Después de presentar hallazgos:
│  ├─ Usuario dice "aprueba" / "approve" → Postear APPROVE review
│  ├─ Usuario dice "postea" / "deja review" → Postear REQUEST_CHANGES review
│  ├─ Usuario dice "siguiente" / "next" → Ir al siguiente PR
│  └─ Usuario pide plan de fixes → Crear plan detallado de correcciones
│
└─ ¿Hay PR del mismo autor en frontend Y backend?
   └─ SÍ → Mencionar posible relación entre PRs (feature completa front+back)
```

---

## MCP Tools Reference

### Descubrir repos y PRs

```
# Obtener usuario actual
mcp__github__get_me

# Buscar repos de una org
mcp__github__search_repositories  query="org:ORGNAME"

# Listar PRs abiertos
mcp__github__list_pull_requests  owner, repo, state="open"
```

### Analizar un PR específico

```
# Metadata del PR (título, autor, branch, mergeable)
mcp__github__pull_request_read  method="get", owner, repo, pullNumber

# Lista de archivos cambiados (+adds, -dels, status)
mcp__github__pull_request_read  method="get_files", owner, repo, pullNumber

# Diff completo (CLAVE para el análisis de código)
mcp__github__pull_request_read  method="get_diff", owner, repo, pullNumber

# Reviews existentes (para no duplicar)
mcp__github__pull_request_read  method="get_reviews", owner, repo, pullNumber
```

### Postear review

```
# Review simple (un comentario general)
mcp__github__pull_request_review_write
  method="create"
  owner, repo, pullNumber
  event="APPROVE" | "REQUEST_CHANGES" | "COMMENT"
  body="mensaje del review"

# Review con comentarios en líneas específicas (avanzado)
# Paso 1: Crear review pendiente (sin event)
mcp__github__pull_request_review_write  method="create", owner, repo, pullNumber

# Paso 2: Agregar comentarios a líneas específicas
mcp__github__add_comment_to_pending_review  owner, repo, pullNumber, path, line, body, subjectType="LINE", side="RIGHT"

# Paso 3: Enviar el review
mcp__github__pull_request_review_write  method="submit_pending", owner, repo, pullNumber, event="REQUEST_CHANGES", body="resumen"
```

---

## Checklist de Análisis por Archivo

### Frontend (Angular/TypeScript)

```
[ ] innerHTML / [innerHTML] → ¿Sanitizado con DomSanitizer?
[ ] HTTP calls directos → ¿Debería usar el servicio/interceptor del proyecto?
[ ] Subscriptions → ¿Se limpian en ngOnDestroy o usan takeUntilDestroyed?
[ ] Async operations → ¿Tienen manejo de errores?
[ ] @Output sin tipo explícito
[ ] console.log de debug que quedó
[ ] Hardcoded URLs, IDs, o strings mágicos
[ ] Cambios en routing/store/package.json → ¿Impacto en otros módulos?
[ ] Dependencias nuevas en package.json → ¿Son confiables? ¿Bundle size?
[ ] Signals vs Observables → ¿Se usa el patrón correcto del proyecto?
```

### Backend (NestJS/TypeScript)

```
[ ] Raw SQL queries sin Prisma → Posible SQL injection
[ ] Input del usuario sin validar (falta DTO con class-validator)
[ ] Rutas/endpoints sin guards de auth (@Public faltante o @UseGuards faltante)
[ ] Secrets/credenciales hardcodeadas
[ ] try/catch faltante en operaciones de DB/filesystem
[ ] Cambios en migraciones Prisma → ¿Son reversibles?
[ ] Cambios en config/rutas → ¿Rompen otros endpoints?
[ ] N+1 queries en loops (usar include/select de Prisma)
[ ] File uploads sin validación de tipo/tamaño
[ ] Error responses que exponen info interna (stack traces, paths)
[ ] Prisma scoped service → ¿Se usa el servicio correcto para el dominio?
[ ] withoutScope() → ¿Es realmente necesario? (ver vendix-prisma-scopes)
```

### General

```
[ ] El título del PR describe lo que realmente cambia
[ ] No hay features mezcladas no relacionadas
[ ] No hay cambios "sneaky" de configuración enterrados
[ ] || vs ?? para valores falsy (0, '', false)
[ ] error.message vs error.msg (objetos Error nativos usan .message)
[ ] Métodos llamados múltiples veces en template (debería ser computed/signal)
```

---

## Common Issues (Patrones que se repiten)

### Issue 1: `|| 0` vs `?? 0`

**Problema**: `value || 0` falla cuando value es legítimamente `0`, `''`, o `false`
**Fix**: Usar `value ?? 0` (nullish coalescing — solo reemplaza `null`/`undefined`)

### Issue 2: Lógica repetida sin helper

**Problema**: La misma comparación/cálculo copiado en 3+ lugares
**Fix**: Extraer a una función helper/utility reutilizable

### Issue 3: HTTP call directo sin interceptor

**Problema**: Usar `fetch()` nativo o `HttpClient` sin el interceptor del proyecto que incluye auth tokens
**Fix**: Usar el servicio HTTP del proyecto que ya maneja headers y auth

### Issue 4: Subscriptions sin cleanup

**Problema**: `.subscribe()` en componentes sin `takeUntilDestroyed()` o `ngOnDestroy`
**Fix**: Agregar cleanup con `DestroyRef` + `takeUntilDestroyed()` o usar `async` pipe

### Issue 5: Cambios sneaky no documentados

**Problema**: Cambiar un default, desactivar una feature, o modificar un config sin mención en el PR
**Fix**: Separar en su propio commit/PR o documentar explícitamente en la descripción

### Issue 6: Prisma scope incorrecto

**Problema**: Usar `GlobalPrismaService` en un dominio de store, o `withoutScope()` innecesariamente
**Fix**: Usar el scoped service correcto para el dominio (ver `vendix-prisma-scopes`)

---

## Resources

- **GitHub MCP Tools**: Disponibles via `mcp__github__*`
- **OWASP Top 10**: Referencia para análisis de seguridad web
- **Angular Style Guide**: Para convenciones de Angular (signals, standalone components)
