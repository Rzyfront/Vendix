---
id: ADR-01
title: "Releases solo via main, sin dispatch manual de develop"
status: proposed
reversibility: costly
updated: 2026-09-08
---
# ADR-01 — Releases solo via main, sin dispatch manual de develop

- **Context:** prod muestra código de develop sin que exista release a `main` (F-001). Frontend nuevo + backend viejo es la combinación que produce exactamente el síntoma actual (mensaje nuevo, match viejo).
- **Decision:** todo cambio a prod via PR `develop→main` + deploys del release. Prohibido `workflow_dispatch` desde `develop` salvo incidente declarado con dueño y hora.
- **Consequences:** el skew actual se cierra mergeando #766; futuros diagnósticos pueden asumir `main` == prod.
- **Reversibility:** costly — un dispatch manual futuro reintroduce skew silencioso; se detecta comparando strings/hashes del bundle.
- **Revisit if:** se crea un canal de preview por tienda con versionado visible.
