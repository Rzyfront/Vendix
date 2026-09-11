---
id: B.1
title: "Proyeccion de preparation_time en catalogo"
phase: B
status: done
owner: agent
updated: 2026-09-11
contracts: [FB-03, FB-04, FB-05, DB-02]
adrs: [ADR-02]
skills: [vendix-backend-api, vendix-multi-tenant-context, vendix-restaurant-ops]
---
# B.1 — Proyeccion de preparation_time en catalogo

- **Skills:** vendix-backend-api, vendix-multi-tenant-context, vendix-restaurant-ops
- **Resources:** `curl http://localhost:3000/ecommerce/catalog?limit=1` y `curl .../ecommerce/catalog/:slug` contra seed
- **Business decision:** La respuesta suma `preparation_time_minutes` (`number | null`) en listado y detalle; el flag solo gobierna display, nunca filtra ni ordena.
- **Why:** Va despues de A.1 porque lee el flag efectivo de settings; antes del frontend porque la vitrina consume este contrato.
- **Output:** `mapProductToResponse` y `mapProductDetailToResponse` proyectan el campo; `getPublicConfig` deja pasar el flag por el spread existente.
- **Contracts touched:** FB-03, FB-04, FB-05, DB-02
- **Data impact:** Solo lectura de `products` y `product_variants`; ninguna escritura en base de datos.
- **Blast radius:** Si el mapper renombra o quita una clave, la card y la ficha rompen precio, stock o promociones en produccion.
- **Rollback:** `git revert` del commit; la proyeccion es aditiva y su ausencia es la respuesta historica.
- **Verification:**
  - `curl listado, detalle y config/public; diff de claves contra contrato FB-03/FB-04/FB-05`
- **Acceptance checklist:**
  - [x] Listado trae `preparation_time_minutes` con todas las claves historicas
  - [x] Detalle lo trae a nivel producto y variante sin perder variantes
  - [x] `config/public` expone el flag efectivo del store
  - [x] Con flag apagado la respuesta solo suma la clave nueva
  - [x] `catalog.service.spec.ts` en verde por path exacto
- **Status:** done · agent · 2026-09-11 · evidence/d1-sweep.txt
