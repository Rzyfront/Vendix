---
id: D.1
title: "Regresion de venta y facturacion estandar"
phase: D
status: blocked
owner: rzy
updated: 2026-09-11
contracts: [FB-02, FB-03, FB-04, FB-07, FB-08, DB-01, DB-02, ERR-01, ERR-02]
adrs: []
skills: [vendix-frontend, vendix-backend-api, vendix-error-handling, vendix-fiscal-scope, parallel]
---
# D.1 — Regresion de venta y facturacion estandar

- **Skills:** vendix-frontend, vendix-backend-api, vendix-error-handling, vendix-fiscal-scope, parallel
- **Resources:** `curl POST /store/payments/pos` + Playwright MCP en vhost dev `https://vendix.com` con `--ignore-https-errors`
- **Business decision:** Ningún flujo estándar se degrada: anónima, existente, nuevo, edición, cotización, separé, factura y reimpresión.
- **Why:** Va tras C porque solo con el fix puesto se puede probar que lo estándar sigue intacto.
- **Output:** `evidence/regression-matrix.md` con las 8 casillas en verde y contratos FB/DB/ERR tickados.
- **Contracts touched:** FB-02, FB-03, FB-04, FB-07, FB-08, DB-01, DB-02, ERR-01, ERR-02
- **Data impact:** none — ventas de prueba en dev, sin tocar prod.
- **Blast radius:** Si se salta, una regresión fiscal llega a prod como factura mal titulada.
- **Rollback:** `git revert <sha del fix>` y repetir matriz; ventas de prueba no requieren undo.
- **Verification:**
  - `curl -H 'Authorization: [redacted]' http://localhost:3000/store/payments/pos -d '{"customer_id":<B>}' | jq .data.order.customer_id`
- **Acceptance checklist:**
  - [ ] Anónima respeta el gate según política
  - [ ] Existente sigue vendiendo a A
  - [ ] Nuevo vende y factura a B
  - [ ] Edición conserva cliente salvo cambio explícito
  - [ ] Cotización y separé conservan customer_id
  - [ ] Factura from-order hereda B y reimprime B
  - [ ] F-007 — alias con carro A se descarta en silencio y factura A (minor)
- **Status:** blocked — Blocker: backend boot-loop (health 000) + ng serve caído; matriz viva en evidence/coverage-matrix.md
