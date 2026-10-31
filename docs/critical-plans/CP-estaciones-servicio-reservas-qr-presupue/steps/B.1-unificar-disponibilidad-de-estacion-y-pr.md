---
id: B.1
title: "Unificar disponibilidad de estación y proveedor"
phase: B
status: done
owner: Andres Meza
updated: 2026-10-14
contracts: [FB-05, FB-06, FB-22, DB-04, DB-05, DB-06, DB-17, DB-19, DB-20, ERR-01, ERR-02, ERR-03]
adrs: [ADR-02]
skills: [vendix-backend, vendix-date-timezone, vendix-product-variants]
---
# B.1 — Unificar disponibilidad de estación y proveedor

- **Skills:** vendix-backend, vendix-date-timezone, vendix-product-variants
- **Resources:** npx jest availability --runInBand; curl slots
- **Business decision:** Un slot sólo está disponible si coinciden horarios tienda/proveedor/estación, variante, excepciones y capacidad.
- **Why:** Slot falso promete una cita imposible.
- **Output:** Consulta de slots y calendario por par estación-proveedor con zona horaria de tienda.
- **Contracts touched:** FB-05, FB-06, FB-22, DB-04, DB-05, DB-06, DB-17, DB-19, DB-20, ERR-01, ERR-02, ERR-03
- **Data impact:** Lecturas de horarios, excepciones y asignaciones.
- **Blast radius:** Slot falso promete una cita imposible.
- **Rollback:** Flag off y restaurar cálculo anterior para servicios sin estación.
- **Verification:**
  - `npx jest availability --runInBand`
- **Acceptance checklist:**
  - [x] Existing admin/ecommerce slot routes accept station filters for station-required services → evidence/b1-static-availability-review.md
  - [x] FB-05 station availability endpoint intersects station, provider, store calendars, exceptions and active allocations → evidence/b1-static-availability-review.md
  - [x] Station schedule and exception administration endpoints were added under A.3 → evidence/d1-calendar-spec-20261014.md
  - [x] Variante cambia duración y buffer según sus valores o el fallback del producto → evidence/b1-static-availability-review.md
  - [x] Asignaciones activas y reservas heredadas bloquean al mismo proveedor en cualquier estación → evidence/b1-static-availability-review.md
  - [x] Estación cerrada o sin horario activo no ofrece huecos → evidence/b1-static-availability-review.md
  - [x] Rangos de disponibilidad se limitan a 62 días e índices cubren estación/proveedor → evidence/b1-static-availability-review.md
  - [x] Conversión usa zona IANA de tienda para instantes UTC → evidence/d1-calendar-spec-20261014.md
- **Status:** done · 2026-10-14
