---
id: A.3
title: "API de estaciones y compatibilidades"
phase: A
status: done
owner: Andres Meza
updated: 2026-10-14
contracts: [FB-01, FB-02, FB-03, FB-04, FB-23, DB-01, DB-02, DB-03, DB-19, ERR-01, ERR-04]
adrs: [ADR-01, ADR-03]
skills: [vendix-backend, vendix-backend-api, vendix-permissions, vendix-validation, vendix-multi-tenant-context]
---
# A.3 — API de estaciones y compatibilidades

- **Skills:** vendix-backend, vendix-backend-api, vendix-permissions, vendix-validation, vendix-multi-tenant-context
- **Resources:** curl -i con JWT de dos tiendas; npx jest --runInBand
- **Business decision:** Administrador configura nombre, estado, servicios y proveedores compatibles; no se permite asignación cruzada.
- **Why:** Permisos insuficientes permitirían ver otra tienda.
- **Output:** CRUD y relaciones M:N validadas; QR físico sin datos de sesión.
- **Contracts touched:** FB-01, FB-02, FB-03, FB-04, FB-23, DB-01, DB-02, DB-03, DB-19, ERR-01, ERR-04
- **Data impact:** Lee y escribe estaciones/capacidades por tienda.
- **Blast radius:** Permisos insuficientes permitirían ver otra tienda.
- **Rollback:** Flag off y revertir API; conservar filas para reintento.
- **Verification:**
  - `curl -i http://vendix.com/api/store/service-stations`
- **Acceptance checklist:**
  - [x] CRUD routes derive tenant scope from request context and use reservation permissions → evidence/a3-permission-matrix.md
  - [x] Services must be same-store products with `product_type=service`; providers must be active and same-store → evidence/a3-permission-matrix.md
  - [x] Provider/service compatibility is checked before replacing assignments → evidence/a3-permission-matrix.md
  - [x] Physical QR identifier does not return active session or token data → evidence/a3-permission-matrix.md
  - [x] Station weekly schedules and local-time exceptions can be managed within the store scope → evidence/d1-calendar-spec-20261014.md
  - [x] Matriz read/create/update/delete revisada; creación/aplicación de propuestas y contacto documentados → evidence/a3-permission-matrix.md
  - [x] Proveedor y producto pertenecen a tienda → evidence/a3-permission-matrix.md
  - [x] Servicio debe ser product_type service; `requires_station` se habilita explícitamente → evidence/a3-permission-matrix.md
  - [x] QR físico sólo identifica la estación y no revela atención activa → evidence/a3-permission-matrix.md
- **Status:** done · 2026-10-14
