---
id: T.1
title: "Tickets Linear: dedup, crear y actualizar"
phase: T
status: done
owner: none
updated: 2026-09-11
contracts: []
adrs: []
skills: [linear-issues, linear-connect]
---
# T.1 — Tickets Linear: dedup, crear y actualizar

- **Skills:** linear-issues, linear-connect
- **Resources:** `.linear/config.json`, skill linear-issues (dedup obligatorio antes de cada create), mapeo base: QUI-628↔F-002, QUI-792↔F-012, QUI-801↔F-004, QUI-702↔F-010
- **Business decision:** Directiva de usuario: lo sin ticket se crea y todo queda en el estado correspondiente. Nuevos en Todo; existentes se comentan/actualizan sin mover estado (el pipeline los mueve al abrir PR).
- **Why:** Sin ticket no hay trazabilidad del release; sin dedup se duplican QUI. QUI-628 esta Devuelto y QUI-702 Aprobado: ambos reciben comentario, no ticket nuevo.
- **Output:** 7 tickets nuevos en Todo + 4 comentarios de actualizacion, todos listados en `log/execution.md` con URL.
- **Contracts touched:** none — gestion en Linear, cero codigo.
- **Data impact:** none — API de Linear, fuera de la DB del producto.
- **Blast radius:** Solo tablero Quickss/Vendix.
- **Rollback:** Cerrar/cancelar el ticket creado por error (reversible en UI).
- **Verification:**
  - `searchIssues` por cada candidato antes de crear; si hay match >=70%% se actualiza/comenta en vez de crear
  - Releer cada issue tras escribir y confirmar estado + labels (un UUID muerto falla en silencio)
- **Acceptance checklist:**
  - [x] Dedup ejecutado para los 7 findings sin ticket y el CHORE de pulido (11, 13, 14, 15)
  - [x] Creados en Todo: 3 tickets nuevos maximo agrupados por modulo (PQR, checkout/shipping, UI/pulido)
  - [x] Comentados los 4 QUI existentes: 628 (abandonados), 801 (toggle), 792 (footer), 702 (notas)
  - [x] Ejecucion registrada en log con identifier + URL por ticket
- **Status:** done — oleada 1 cerrada 2026-09-11
