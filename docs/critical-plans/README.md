# Critical plans

Planes producidos con la skill `how-to-critical-plan` (`skills/how-to-critical-plan/SKILL.md`).

## Formato v2 — bundle (desde 2026-09-05)

Cada plan es un directorio `CP-<slug>/`. Lo único que se carga por defecto es el hub `PLAN.md`.

| Ruta | Contenido |
|------|-----------|
| `PLAN.md` | Identidad, **ledger** e **índice** (generados), contexto, criticidad, objetivos, fases, enfoque, blast radius, rollback, approval |
| `steps/A.1-<slug>.md` | Un step por archivo: 12 campos + checklist |
| `adr/ADR-nn-<slug>.md` | Una decisión de arquitectura por archivo |
| `registry/fb.md` · `db.md` · `err.md` | Contratos frontend↔backend, base de datos y códigos de error, una fila por punto |
| `findings/F-nnn.md` | Un hallazgo de la flota por archivo |
| `log/execution.md` · `convergence.md` | Historial de ejecución y rondas de convergencia |
| `inventory/files.md` · `assets.md` | Archivos críticos y activos reutilizables |
| `evidence/` | Salidas de las verificaciones (nunca `/tmp`) |

### Retomar un plan en frío

```bash
S=skills/how-to-critical-plan/assets; B=docs/critical-plans/CP-<slug>
$S/cp-context.sh $B hub          # 1. leer solo el hub: posición, bloqueos, hallazgos abiertos
$S/cp-context.sh $B step A.3     # 2. paquete mínimo del step a ejecutar
$S/cp-ledger.sh  $B              # 3. regenerar ledger tras cambiar el estado de un step
$S/cp-lint.sh    $B              # 4. validar antes de cerrar una fase o pedir aprobación
```

Crear un plan: `$S/cp-new.sh <slug>`; fragmentos: `cp-new.sh step|adr|finding …`. Formato completo: `skills/how-to-critical-plan/references/format.md`.

> `docs/` está en `.gitignore`: para compartir un bundle con el equipo hay que añadirlo a mano, `git add -f docs/critical-plans/CP-<slug>` (mismo criterio que `docs/evidence/`).

## Formato v1 — archivo único (histórico)

Los `CP-*.md` sueltos aquí y en `docs/plans/` son planes v1. Se conservan y no se migran.
