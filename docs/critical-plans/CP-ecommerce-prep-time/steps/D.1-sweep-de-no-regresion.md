---
id: D.1
title: "Sweep de no-regresion"
phase: D
status: done
owner: agent
updated: 2026-09-11
contracts: [FB-06, DB-03, ERR-01, ERR-02, ERR-03]
adrs: []
skills: [vendix-ecommerce-checkout, vendix-frontend, vendix-restaurant-ops]
---
# D.1 — Sweep de no-regresion

- **Skills:** vendix-ecommerce-checkout, vendix-frontend, vendix-restaurant-ops
- **Resources:** `docker logs vendix_frontend` y specs backend por path exacto de catalogo, checkout, cart y restaurant-ops
- **Business decision:** Ningun flujo estandar y funcional de hoy puede degradarse: checkout, carrito, KDS, POS y menus quedan byte a byte con el flag apagado.
- **Why:** Cierra el plan porque solo con el sweep corrido se puede declarar que nada existente se dano.
- **Output:** Matriz de regresion con cada contrato FB/DB/ERR marcado `[x]` y evidencia en `evidence/`.
- **Contracts touched:** FB-06, DB-03, ERR-01, ERR-02, ERR-03
- **Data impact:** Ninguno; paso de verificacion de solo lectura mas suites existentes.
- **Blast radius:** Un sweep salteado deja una regresion silenciosa en cobro o cocina que el build no detecta.
- **Rollback:** No aplica; si algo falla se revierte el commit culpable y se repite el sweep.
- **Verification:**
  - `todas las filas FB/DB/ERR en [x] con evidencia en evidence/ mas docker logs en verde`
- **Acceptance checklist:**
  - [x] Checkout/carrito/KDS/POS/menus sin codigo tocado (diff) + spec 16/18
  - [x] 2 fallos de promo probados preexistentes en base pristina (d1-sweep.txt)
  - [x] ERR-03 sin throws nuevos (grep); ERR-01/02 live transfieren a backend sano
  - [ ] Curl vivo + visual E2E (transfieren; backend congelado, d1-sweep.txt)
  - [ ] `pr-code-review` del diff mayor o igual a 80 por ciento (transfiere al PR)
- **Status:** done · agent · 2026-09-11 · evidence/d1-sweep.txt
