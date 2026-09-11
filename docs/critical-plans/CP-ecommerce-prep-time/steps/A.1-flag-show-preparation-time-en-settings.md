---
id: A.1
title: "Flag show_preparation_time en settings"
phase: A
status: done
owner: agent
updated: 2026-09-11
contracts: [FB-01, FB-02, DB-01]
adrs: [ADR-01]
skills: [vendix-settings-system, vendix-backend-api, vendix-validation, vendix-prisma-scopes, vendix-multi-tenant-context]
---
# A.1 — Flag show_preparation_time en settings

- **Skills:** vendix-settings-system, vendix-backend-api, vendix-validation, vendix-prisma-scopes, vendix-multi-tenant-context
- **Resources:** none
- **Business decision:** El flag vive en `ecommerce.catalog.show_preparation_time`, opt-in con default `false` y lectura `=== true`; ausente equivale a apagado.
- **Why:** Va primero porque el catalogo, el admin y la vitrina dependen de que el campo exista, valide y persista antes de leerlo.
- **Output:** `EcommerceCatalogDto`, interface, defaults y espejo frontend aceptan y persisten el booleano sin tocar otras claves.
- **Contracts touched:** FB-01, FB-02, DB-01
- **Data impact:** Escribe solo la clave nueva dentro del JSON de `store_settings` del store editado; ninguna otra fila se toca.
- **Blast radius:** Si el DTO omite el campo, `whitelist: true` lo borra en silencio y el admin cree guardar sin guardar.
- **Rollback:** `git revert` del commit; sin migracion, el JSON viejo sigue valido.
- **Verification:**
  - `curl PATCH /store/settings con flag true/false y GET confirma persistencia y claves intactas`
- **Acceptance checklist:**
  - [x] DTO, interface, defaults y espejo declaran el flag con default false
  - [x] PATCH true persiste y GET lo devuelve sin perder claves vecinas
  - [x] PATCH con valor no booleano devuelve 400 y no guarda
  - [x] Store sin la clave se comporta como flag apagado
- **Status:** done · agent · 2026-09-11 · evidence/d1-sweep.txt
