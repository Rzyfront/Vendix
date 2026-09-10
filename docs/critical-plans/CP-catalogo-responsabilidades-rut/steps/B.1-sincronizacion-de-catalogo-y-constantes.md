---
id: B.1
title: "Sincronizacion de Catalogo y Constantes Frontend"
phase: B
status: done
owner: none
updated: 2026-09-09
contracts: [FB-01, FB-02, FB-06]
adrs: [ADR-03]
skills: [vendix-frontend, vendix-naming-conventions]
---
# B.1 — Sincronizacion de Catalogo y Constantes Frontend

- **Skills:** vendix-frontend, vendix-naming-conventions
- **Resources:** `docker logs vendix_frontend --tail 50`
- **Business decision:** Espejo 1:1 del canónico de A.1 en `fiscal-responsibilities.constants.ts` con tipos estrictos, labels 01-61 y normalizador; el `Record` exhaustivo de labels es la guarda que impide códigos sin traducir.
- **Why:** Va primero en B porque B.2/C.1/C.2 importan estas constantes; sin el espejo la UI compila contra 7 códigos y pinta el resto como texto crudo.
- **Output:** `fiscal-responsibilities.constants.ts` actualizado con catálogo, labels y normalizador.
- **Contracts touched:** FB-01, FB-02, FB-06
- **Data impact:** none — archivos de constantes en frontend.
- **Blast radius:** Componentes que consumen `FISCAL_RESPONSIBILITY_LABELS` y el tipo `FiscalResponsibility`.
- **Rollback:** `git checkout HEAD~1 -- apps/frontend/src/app/shared/constants/fiscal-responsibilities.constants.ts`
- **Verification:**
  - `docker logs vendix_frontend | grep "Compiled successfully"`
- **Acceptance checklist:**
  - [x] Añadir constantes vigentes a `FISCAL_RESPONSIBILITIES` en paridad con A.1.
  - [x] Añadir labels legibles en `FISCAL_RESPONSIBILITY_LABELS` sin claves huérfanas.
  - [x] Implementar `normalizeFiscalResponsibilityCode` en frontend.
  - [x] Validar que `getFiscalResponsibilityLabel` traduce '05' y 'O-05'.
- **Status:** done
