---
id: C.1
title: "verificar responsive y contratos"
phase: C
status: in-progress
owner: orquestador
updated: 2026-10-06
contracts: [FB-01, FB-02, FB-03, DB-01, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07]
adrs: [ADR-01, ADR-02, ADR-03]
skills: [how-to-test, buildcheck-dev, vendix-ui-ux, vendix-permissions, vendix-error-handling, sopus]
---
# C.1 — verificar responsive y contratos

- **Skills:** how-to-test, buildcheck-dev, vendix-ui-ux, vendix-permissions, vendix-error-handling, sopus
- **Resources:** `bash scripts/buildcheck.sh --watch`; `curl -fsS http://localhost:3000/api/health`; Playwright MCP en `https://vendix.com/admin/orders/sales`; `bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-qui-914-cancelar-filtro-movil`
- **Business decision:** No se aprueba con una captura estática: debe pasar happy, sad y brute-force en dev, más desktop y accesibilidad.
- **Why:** Tras B.1/B.2, solo un navegador con datos de prueba demuestra un toque, confirmación, medidas y permisos sin regresiones.
- **Output:** `evidence/c1-runtime.md` con flujos a 375/700/1024 px, medidas a 320/639/640/767/768 px, red, capturas y accesibilidad; resultado del spec de controller.
- **Contracts touched:** FB-01, FB-02, FB-03, DB-01, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, ERR-07
- **Data impact:** only dev test fixture — una orden de prueba puede pasar a cancelled tras confirmación; no usar producción.
- **Blast radius:** Un falso positivo puede publicar una acción que cancela sin control o una barra inaccesible.
- **Rollback:** Bloquear merge; revertir el paso responsable B.1/B.2/B.3 si no se puede resolver la regresión dentro del alcance.
- **Verification:**
  - `bash scripts/buildcheck.sh --watch` y `curl -fsS http://localhost:3000/api/health` antes de E2E.
  - `cd apps/backend && NODE_OPTIONS=--max-old-space-size=4096 npx jest src/domains/store/orders/orders.controller.spec.ts --runInBand`
  - Playwright MCP en vhost local: happy (confirmar), sad (cerrar/bloqueo 409), brute (sin permiso/orden ajena) y cajas 320/375/639/640/700/767/768/1024.
  - `bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-qui-914-cancelar-filtro-movil`
- **Acceptance checklist:**
  - [ ] Happy: un toque abre diálogo y una confirmación envía exactamente un PATCH; toast y recarga correctos.
  - [ ] Sad: cerrar diálogo envía cero PATCH; stock o mesa bloqueados dan error, sin éxito falso ni mutación.
  - [ ] Error inesperado al cancelar sale 500 `SYS_INTERNAL_001`; error tipado conserva código/HTTP; PATCH no cancelatorio conserva contrato.
  - [ ] Brute: usuario sin `store:orders:update` y orden de otra tienda no se cancelan; estado persiste intacto.
  - [ ] Filtro mantiene URL, respuesta y accesibilidad; tamaños 40/44 y desktop sin cambio.
  - [ ] No hay desborde a 320 px ni cambio inesperado en 639/640/767/768 px.
  - [ ] 13 perspectivas y dos rondas limpias de convergencia documentadas antes de cerrar el plan.
  - [ ] F-005 — Cubrir cortes de breakpoint y 320 px (minor)
- **Status:** in-progress · orquestador · 2026-10-06 · pruebas ejecutables registradas; Playwright y compilación backend bloqueados
