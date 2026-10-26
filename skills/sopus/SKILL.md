---
name: sopus
description: Grande orquesta, pequeño ejecuta. Úsala cuando una tarea GRANDE de ODD (con documento de feature) dispara delegación: define qué modelo hace cada rol y qué modelos pueden ser workers.
metadata:
  author: rzyfront
  version: "2.0"
---

# Sopus · modelo por rol dentro de ODD

ODD decide **si** y **cuándo** se delega. Sopus decide **con qué modelo**. No aplica a tareas pequeñas: esas van inline, en el modelo actual, sin subagentes.

## Cuándo aplica
Solo en tareas GRANDES de ODD (con `odd/tasks/<feature>.md`) y solo cuando se dispara un trigger de delegación: Mapping (explorador), Writer (escritores paralelos o backstop de contexto) o Verification (verificador de alto riesgo).

## Roles
| Rol | Modelo | Hace |
| --- | --- | --- |
| Orquestador | El grande de la sesión (Opus o equivalente) | Historia de usuario, documento de feature, corte en tareas, decisiones, integración, Risk line y reporte |
| Explorador | Worker permitido | Mapa read-only con evidencia `path:line` (≤ ~2k tokens) |
| Escritor | Worker permitido | Implementa UNA tarea contra su `S#`, con test-first y verificación indicada; reporta los comandos y su resultado |
| Verificador alto riesgo | El grande (nunca el mismo que escribió) | Verifica el `S#` completo, con probes aislados |

## Workers permitidos (lista cerrada)
- Claude Sonnet (`sonnet`)
- GPT Luna
- DeepSeek V4.1 Flash 1017
- Kimi K3
- Gemini 3.8 Flash
- Gemini 4 Argon

Ningún otro modelo puede ser worker (por ejemplo Haiku, Flash Lite, mini o nano).

**Fallback:** si el harness no tiene disponible ningún worker de la lista, los workers (explorador y escritor) usan el **modelo base del orquestador**. Nunca se sustituye por un modelo fuera de la lista.

## Cómo lanzar
- En Claude Code: `Agent` con `model: "sonnet"` para explorador y escritor; verificador sin `model` (hereda el grande). Si `sonnet` no está disponible en el harness, el `Agent` va sin `model` (hereda el orquestador).
- Otros proveedores: solo con su CLI instalada y en modo headless (por ejemplo `gemini -p` con un modelo de la lista). Si no está disponible, aplica el Fallback (modelo base del orquestador).
- El handoff es por referencia: `Spec: odd/tasks/<feature>.md, T#, S#`. Incluye los archivos en alcance, los skills, el runner de tests del cambio y la verificación. El worker lee hasta `## Log` y reporta qué `S#` cubrió.

## El grande audita
Antes de marcar una tarea: revisa el diff contra su superficie de edición, vuelve a ejecutar uno de los comandos reportados y confirma que se cumplen los criterios de la historia de usuario. Si falla, hace una corrección acotada y luego aplica la regla de ODD ("Needs your decision").
