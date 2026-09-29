---
name: sopus
description: >
  Modo de trabajo "big + small" (Sonnet + Opus = sopus): un modelo GRANDE planifica, orquesta,
  delega, audita y decide; un modelo SMALL rápido desarrolla con subagentes todo lo que el grande le
  delega. Agnóstico de proveedor (Opus/Sonnet, GPT Sol/GPT Luna, etc.).
  Trigger: NOT auto-invoked by context. Load ONLY when the user explicitly invokes `sopus` or asks
  that a big model orchestrate while a small/fast model writes the code.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "User explicitly invokes sopus (big model orchestrates, small model codes)"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent
---

# Sopus — el grande piensa, el pequeño construye

## Purpose

Divide cada tarea en dos roles con modelos distintos para sumar **juicio caro** donde importa y
**velocidad barata** donde basta:

| Rol | Modelo | Hace | NO hace |
| --- | --- | --- | --- |
| **Grande** (orquestador) | El más capaz disponible | Planifica, corta en tareas, delega, audita, decide, integra | Escribir código no trivial |
| **Pequeño** (ejecutor) | Rápido y barato | Implementa una tarea acotada contra una spec, reporta evidencia | Decidir arquitectura, ampliar alcance, auditarse a sí mismo |

No gobierna **cómo** se escribe el código (eso lo dicen las skills de dominio) ni cómo conviven
varios ejecutores en la misma rama (eso es `parallel`). Gobierna **quién decide y quién ejecuta**.

## Parejas de modelos (ejemplos)

La skill es agnóstica: sirve con cualquier par grande/pequeño.

| Familia | Grande (orquesta) | Pequeño (codea) |
| --- | --- | --- |
| Claude | Opus | Sonnet (o Haiku para tareas mecánicas) |
| GPT (ilustrativo) | GPT Sol | GPT Luna |
| Gemini (ilustrativo) | Gemini Pro | Gemini Flash |
| Genérico | "Titán" | "Colibrí" |

> Regla de elección: el grande es el que tiene **mejor juicio**; el pequeño, el que tiene **mejor
> costo/velocidad** y aún sigue una spec sin desviarse. Si el pequeño no puede seguir la spec, la
> tarea está mal cortada o necesita un pequeño más fuerte — no se sube al grande a codear.

### Cómo se fija el modelo

- **Claude Code**: el orquestador corre en el grande; cada `Agent` de ejecución lleva
  `model: "sonnet"` explícito. Una auditoría delegada lleva `model: "opus"`. `SendMessage` conserva
  el modelo del agente original.
- **Otros harnesses** (OpenCode, Codex, etc.): usar su selector de modelo por subagente con la
  misma asignación de roles.

## Core Rules

1. **El grande no codea.** Excepción: cambio trivial (1–3 líneas, typo, config). Todo lo demás se delega.
2. **El pequeño no decide.** Si la spec es ambigua o aparece algo fuera de alcance, **para y reporta**; no improvisa.
3. **Nunca se audita con el pequeño.** La auditoría la hace el grande (directo o vía subagente grande).
4. **El reporte no es evidencia; el árbol sí.** El grande verifica cada afirmación contra el código, el diff, el build o el test real.
5. **Una tarea = un entregable verificable.** Archivos en alcance, criterio de aceptación y comando de verificación explícitos.
6. **Paraleliza lo independiente, serializa lo dependiente.** Si varios pequeños tocan la misma rama, cargar `parallel`.
7. **Dos fallos → recortar, no escalar.** Si un pequeño falla la misma tarea dos veces, el grande reescribe la spec o la parte en piezas más pequeñas.
8. **Las skills viajan en el prompt.** Cada delegación nombra las skills que el pequeño debe invocar.

## Workflow

```
GRANDE                                   PEQUEÑO(S)
1. Entender + mapear skills
2. Plan (how-to-plan) → aprobación
3. Cortar en tareas con spec  ───────►  4. Implementar (en paralelo si son independientes)
                                        5. Verificar lo propio (build/test) y reportar evidencia
6. Auditar contra el árbol    ◄───────
7. Decidir: aceptar / rehacer / re-spec
8. Integrar, verificar global, cerrar
```

## Plantilla de delegación (grande → pequeño)

```markdown
## Tarea: <nombre corto>
**Rol:** ejecutor. No decides arquitectura ni amplías alcance.
**Skills a invocar:** <vendix-backend, vendix-prisma-scopes, ...>
**Contexto:** <por qué existe la tarea, 2–4 líneas>
**Archivos en alcance:** <rutas exactas>. Cualquier otro archivo: NO tocar.
**Spec:** <qué debe hacer, contratos, nombres, firmas>
**Criterio de aceptación:** <condiciones comprobables>
**Verificación:** <comando exacto: tsc, jest, buildcheck, curl>
**Prohibido:** commits, push, borrar archivos, migraciones destructivas, cambiar de rama.
**Si algo no cuadra:** para y reporta la duda; no la resuelvas por tu cuenta.
**Reporte:** archivos cambiados, resumen del diff, salida literal de la verificación, dudas abiertas.
```

## Checklist de auditoría (grande)

- [ ] El diff real coincide con lo reportado (leer el árbol, no el resumen).
- [ ] Solo se tocaron archivos en alcance.
- [ ] La verificación se corrió de verdad y cubre lo cambiado (ver `vendix-known-errors`: verdes que mienten).
- [ ] Se respetaron las skills citadas (naming, scopes, zoneless, errores, etc.).
- [ ] Sin decisiones de diseño tomadas por el pequeño sin avisar.
- [ ] Veredicto explícito por tarea: **aceptada**, **rehacer** (con corrección concreta) o **re-spec**.

## Ejemplos

### Claude: Opus + Sonnet — "agregar filtro por fecha a Compras"

1. **Opus** mapea skills (`vendix-backend-api`, `vendix-date-timezone`, `vendix-frontend-standard-module`), arma plan y lo aprueba el usuario.
2. **Opus** corta dos tareas independientes y lanza en paralelo:
   - `Agent(model: "sonnet")` → DTO + query backend con rango en TZ de tienda.
   - `Agent(model: "sonnet")` → selector de fechas en el módulo frontend.
3. **Sonnet** implementa, corre `tsc`/buildcheck, reporta.
4. **Opus** lee ambos diffs, detecta que el frontend manda `Date` y no `YYYY-MM-DD` → veredicto *rehacer* con corrección precisa vía `SendMessage`.
5. **Opus** verifica de punta a punta y cierra.

### GPT Sol + GPT Luna — "migrar 12 componentes a signals"

1. **GPT Sol** audita el alcance, define el patrón canónico con un componente de muestra y la checklist.
2. **GPT Sol** reparte 12 componentes en 4 lotes de 3 → 4 instancias de **GPT Luna** en paralelo.
3. **GPT Luna** aplica el patrón a su lote, corre el audit de zoneless, reporta.
4. **GPT Sol** revisa cada lote contra la checklist; un lote falla dos veces → lo parte en tareas de 1 componente con spec más estricta.

### Titán + Colibrí — "investigar un bug de totales"

1. **Titán** formula hipótesis y reparte la investigación: 3 **Colibríes** leen (sin escribir) backend, frontend y datos.
2. **Titán** cruza hallazgos, decide la causa raíz y el fix.
3. Un **Colibrí** implementa el fix + test de regresión; **Titán** audita y cierra.

## Anti-patterns

| Anti-patrón | Por qué falla |
| --- | --- |
| El grande "termina rápido" escribiendo el código | Se pierde el ahorro y nadie audita lo escrito |
| Spec vaga ("mejora el módulo X") | El pequeño improvisa decisiones que no le tocan |
| Aceptar el PASS del reporte sin leer el diff | Verdes falsos, archivos fuera de alcance, commits no pedidos |
| Auditar con el modelo pequeño | El mismo sesgo que produjo el error lo aprueba |
| Un pequeño con 10 archivos y 3 dominios | Tarea demasiado grande: cortar |
| Subir al grande a codear tras un fallo | Rompe el rol; se corrige la spec o el tamaño de la tarea |

## Related Skills

- `agent-teams` - mecánica general de orquestación de subagentes; sopus fija la asignación de modelos por rol.
- `parallel` - obligatorio cuando varios ejecutores trabajan en la misma rama y árbol.
- `how-to-plan` / `how-to-critical-plan` - el plan que el grande produce antes de delegar.
- `how-to-dev` - flujo de desarrollo que el pequeño sigue dentro de su tarea.
- `vendix-known-errors` - base para auditar verdes y reportes de subagentes.
- `git-workflow` - commits y push los decide el grande, nunca el ejecutor.
