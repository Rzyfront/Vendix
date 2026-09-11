---
id: C.1
title: "Toggle admin ecommerce"
phase: C
status: done
owner: agent
updated: 2026-09-11
contracts: [FB-01, FB-02]
adrs: [ADR-01]
skills: [vendix-frontend, vendix-zoneless-signals, vendix-angular-forms]
---
# C.1 — Toggle admin ecommerce

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-angular-forms
- **Resources:** none
- **Business decision:** Switch en la seccion Catalogo del admin ecommerce con guardado explicito, igual que los demas flags; sin autosave.
- **Why:** Va despues del backend porque bindea el campo de A.1; corre en paralelo con C.2 porque no comparten archivos.
- **Output:** Toggle que carga el valor, persiste con el form de ecommerce y recarga el estado al entrar.
- **Contracts touched:** FB-01, FB-02
- **Data impact:** Ninguna escritura directa; todo pasa por el PATCH de settings ya existente.
- **Blast radius:** Si el binding escribe otra clave, el admin puede borrar configuracion vecina del catalogo al guardar.
- **Rollback:** `git revert` del commit frontend; el backend queda compatible con el admin viejo.
- **Verification:**
  - `abrir admin ecommerce, alternar, guardar, recargar y confirmar persistencia; docker logs sin errores`
- **Acceptance checklist:**
  - [x] El toggle refleja el valor guardado al entrar al admin
  - [x] Guardar persiste y recargar mantiene el estado
  - [x] Guardar no altera otras claves del bloque catalog
  - [x] Componente usa signals sin BehaviorSubject nuevo
- **Status:** done · agent · 2026-09-11 · evidence/d1-sweep.txt
