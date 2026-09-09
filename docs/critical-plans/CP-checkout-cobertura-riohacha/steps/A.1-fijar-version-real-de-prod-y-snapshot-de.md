---
id: A.1
title: "Fijar versión real de prod y snapshot de zonas"
phase: A
status: in-progress
owner: orchestrator
updated: 2026-09-08
contracts: [FB-01, DB-01, DB-02, DB-03, DB-04]
adrs: [ADR-01]
skills: [vendix-ecommerce-checkout, vendix-backend-api, buildcheck-dev]
---
# A.1 — Fijar versión real de prod y snapshot de zonas

- **Skills:** vendix-ecommerce-checkout, vendix-backend-api, buildcheck-dev
- **Resources:** `git merge-base --is-ancestor 93365bc55 origin/main` (ya corrió: NO-EN-MAIN) + `gh pr view 766 --json state` + SELECTs de DB-01…DB-04 sobre prod (solo lectura) + `gh run list --workflow deploy-s3.yml --limit 5`
- **Business decision:** ningún diagnóstico cierra sin saber qué código corre prod ni con qué criterios de zona; adivinar el dato quema el fix correcto.
- **Why:** va primero porque A.2 (deploy) y A.3 (verificación) dependen de si prod ya tiene el frontend nuevo con backend viejo (skew) o si la zona realmente no matchea ni con el fix.
- **Output:** `evidence/prod-version.md` (runs de deploy + ramas) y `evidence/zonas-tienda-10.md` (snapshot anonimizado de criterios + tarifas).
- **Contracts touched:** FB-01 (request anotado como baseline), DB-01, DB-02, DB-03, DB-04 (solo lectura).
- **Data impact:** none — solo SELECTs y lectura de runs; sin migración ni escritura.
- **Blast radius:** nulo en ejecución (lectura); el riesgo que acota es desplegar a ciegas.
- **Rollback:** n/a (paso de lectura).
- **Verification:**
  - `gh run list --workflow deploy-s3.yml --limit 5` y `deploy-backend-ec2.yml` muestran qué rama/commit desplegó prod
  - SELECTs de zonas/tarifas de la tienda 10 guardados en `evidence/` y cada criterio comparado contra el payload anotado
- **Acceptance checklist:**
  - [ ] Versión prod frontend/backend fijada con evidencia en `evidence/prod-version.md`
  - [ ] Snapshot de zonas y tarifas de la tienda 10 en `evidence/zonas-tienda-10.md`
  - [ ] F-001 — prod muestra string de develop sin release a main (blocker)
  - [ ] F-002 — zona domicilio no matchea pese a existir tarifas (major)
  - [ ] F-003 — tarifas free con rangos que excluyen el carrito (minor)
  - [ ] F-004 — descarte de zona solo deja huella en warn-log (minor)
- **Status:** in-progress
