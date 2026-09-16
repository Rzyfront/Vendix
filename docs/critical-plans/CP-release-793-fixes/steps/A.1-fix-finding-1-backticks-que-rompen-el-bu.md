---
id: A.1
title: "Fix finding 1: backticks que rompen el build"
phase: A
status: done
owner: none
updated: 2026-09-11
contracts: []
adrs: []
skills: [vendix-frontend, vendix-zoneless-signals, how-to-dev, buildcheck-dev]
---
# A.1 — Fix finding 1: backticks que rompen el build (F-001)

- **Skills:** vendix-frontend, vendix-zoneless-signals, how-to-dev, buildcheck-dev
- **Resources:** F-001, `evidence/r0-syntax.md` (Ronda 0: 11 errores TS1005), los 2 componentes con `template:` inline
- **Business decision:** Bloqueante de release: sin este fix `ng build` no compila y el PR a main no puede mergearse.
- **Why:** Tres comentarios HTML con backticks crudos dentro de template literals. Fix de 5 minutos con el chequeo de barrido incluido.
- **Output:** Backticks por comillas simples en los 3 comentarios + barrido del PR + transpile en 0 errores. Cierra F-001.
- **Contracts touched:** none — cambio de comentarios, cero runtime, cero contratos.
- **Data impact:** none — frontend compilado, sin datos.
- **Blast radius:** Solo los 2 componentes editados; el barrido es lectura.
- **Rollback:** Revert del commit (cambio cosmetico).
- **Verification:**
  - Transpile con el TS del repo sobre los 2 archivos: 0 errores (era 11)
  - `rg -n '`' --glob '*.ts' apps/frontend/src | xargs` identifica inline-templates: barrido sin mas casos
  - `buildcheck` frontend en verde o CI Frontend Build (prod) en pass
- **Acceptance checklist:**
  - [x] 3 comentarios sin backticks y barrido del PR limpio
  - [x] Transpile del repo en 0 errores con evidencia en evidence/
  - [x] Blocker de sintaxis cerrado con commit y evidencia (finding fileado en R.1)
- **Status:** done — verificado y consolidado 2026-09-11
