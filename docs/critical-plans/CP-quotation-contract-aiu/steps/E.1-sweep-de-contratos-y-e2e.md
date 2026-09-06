---
id: E.1
title: "Sweep de contratos y E2E"
phase: E
status: pending
owner: none
updated: 2026-09-06
contracts: [FB-10, FB-11]
adrs: []
skills: [vendix-frontend, vendix-backend-api, pr-code-review]
---
# E.1 — Sweep de contratos y E2E

- **Skills:** vendix-frontend, vendix-backend-api, pr-code-review
- **Resources:** registry/fb.md, registry/db.md, registry/err.md, evidence/
- **Business decision:** Nada se declara listo sin barrer cada contrato contra servidor vivo y flujo E2E.
- **Why:** Los quiebres de contrato pasan builds y tests y aparecen en produccion como pantalla en blanco o numero mal.
- **Output:** Cada fila FB/DB/ERR en `[x]` con evidencia en `evidence/`, E2E cotizar-perfil-contrato-factura y revision >= 80%.
- **Contracts touched:** FB-10, FB-11
- **Data impact:** Solo datos de prueba en entorno de desarrollo; las verificaciones DB corren en dataset representativo.
- **Blast radius:** Tiempo de verificacion, no producto. Encontrar un mismatch aqui evita un documento fiscal malo.
- **Rollback:** No aplica; si el sweep encuentra quiebre se abre finding y su paso de arreglo.
- **Verification:**
  - `cp-lint.sh` exit 0 sobre el bundle
  - E2E completo con recibos curl y capturas en `evidence/`
- **Acceptance checklist:**
  - [ ] Todas las filas de registries en `[x]` con evidencia
  - [ ] E2E perfil-contrato-AIU en verde sobre servidor vivo
  - [ ] Revision de codigo >= 80% y lint en 0
  - [ ] F-001 — convertToOrder sin rechazo explicito en destino contract (major)
- **Status:** pending
