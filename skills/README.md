# Vendix Skills

`skills/<name>/SKILL.md` es la **única fuente** de los skills de agentes del repo.

## Cómo se cargan

- Claude Code y Gemini CLI anuncian el `name` + `description` de cada skill en **cada sesión**; el cuerpo solo se lee al invocarlo. Por eso la descripción va corta (≤250 caracteres: qué es + `Trigger: …`) y el detalle va al cuerpo.
- `disable-model-invocation: true` oculta el skill al modelo: solo se usa con `/nombre` (flujos operativos o de planificación explícita).
- No hay tabla de auto-invocación: las descripciones enrutan.

## Proveedores (symlinks, nunca copias)

| Agente | Instrucciones | Skills |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` → `AGENTS.md` | `.claude/skills/<name>` → `skills/<name>` (local, gitignored) |
| Gemini CLI | `GEMINI.md` → `AGENTS.md` | `.agents/skills/<name>` → `skills/<name>` (versionado) |

```bash
./skills/setup.sh            # Claude + Gemini (idempotente; poda symlinks rotos)
./skills/setup.sh --claude
./skills/setup.sh --gemini
```

Córrelo tras clonar y cada vez que crees, renombres o borres un skill. Edita siempre `skills/`, nunca las rutas enlazadas.

## Crear o editar un skill

Usa el skill global `skill-creator` y el flujo de `skill-sync` (`/skill-sync`). Frontmatter mínimo:

```yaml
---
name: my-skill            # igual que la carpeta
description: >
  Qué cubre. Trigger: cuándo cargarlo.
metadata:
  author: rzyfront
  version: "1.0"
---
```
