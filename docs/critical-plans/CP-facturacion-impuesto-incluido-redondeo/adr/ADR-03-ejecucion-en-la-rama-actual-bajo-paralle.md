---
id: ADR-03
title: "Ejecucion en la rama actual bajo parallel"
status: proposed
reversibility: trivial
updated: 2026-09-11
---
# ADR-03 — Ejecucion en la rama actual bajo parallel

- **Context:** El usuario prohibió cambiar de rama y exigió el skill `parallel`; el run vive en `develop`, que además es la rama del run por defecto del skill.
- **Decision:** Sin `checkout`/`switch` en ningún agente; checkpoint = `git rev-parse HEAD` + tag liviano; scopes disjuntos por agente (motor / espejo / preview); commit temprano de archivos propios; protocolo de archivo compartido si dos agentes tocan el mismo archivo.
- **Consequences:** Cero riesgo de trabajar sobre la rama equivocada; la protección contra pérdida es disciplina de scope + commit temprano.
- **Reversibility:** trivial — es regla de proceso, no de código.
- **Revisit if:** El usuario pidiera aislamiento (worktree/rama por agente), fuera del alcance de este plan.
