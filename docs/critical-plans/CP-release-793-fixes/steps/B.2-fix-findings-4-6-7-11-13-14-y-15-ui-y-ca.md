---
id: B.2
title: "Fix findings 4, 6, 7, 11, 13, 14 y 15: UI y calidad"
phase: B
status: pending
owner: none
updated: 2026-09-11
contracts: [DB-04]
adrs: [ADR-02]
skills: [vendix-frontend, vendix-backend, vendix-zoneless-signals, how-to-dev]
---
# B.2 — Fix findings 4, 6, 7, 11, 13, 14 y 15: UI y calidad

- **Skills:** vendix-frontend, vendix-backend, vendix-zoneless-signals, how-to-dev
- **Resources:** F-004, F-006, F-007, F-011, F-013, F-014, F-015, ADR-02, `toggle.component.ts`, listener PQR, mapper fiscal, helpers de vitrina
- **Business decision:** F-004 mantiene codigo y corrige comentario (ADR-02 + QUI-801); F-006 constante compartida de roles; F-007 helper de formato compartido + spec; resto pulido local. Comentar en QUI-801.
- **Why:** Lote de severidad menor agrupado por ser cambios acotados e independientes entre si. Ninguno cambia contratos.
- **Output:** 7 fixes + specs donde aplique (paridad de decimales, helper prep-min). Cierra los 7 findings.
- **Contracts touched:** DB-04 — solo lectura de roles, misma forma (ver registry). Resto sin contratos.
- **Data impact:** none — UI y codigo, sin datos.
- **Blast radius:** Toggle global (solo comentario + verificacion visual), notificaciones PQR, tirilla POS, 3 vitrinas, 2 formularios.
- **Rollback:** Revert por commit (cambios pequenos y aislados).
- **Verification:**
  - Visual por modulo: toggles OFF en danger segun comentario corregido
  - Listener: test con rol `super_admin` y owner/admin/manager reciben aviso de respuesta
  - Tirilla con snapshot fiscal pinta `'$5.000,00'` igual que el mapper (spec paridad)
  - `Number.isInteger` guards y `parseNullableNumber` en los 2 formularios
- **Acceptance checklist:**
  - [ ] Comentario toggle corregido + verificacion visual registrada
  - [ ] Roles, decimales, helper prep-min, parses y docblock con specs en verde
  - [ ] Findings de este step cerrados en sus records con evidencia
- **Status:** pending
