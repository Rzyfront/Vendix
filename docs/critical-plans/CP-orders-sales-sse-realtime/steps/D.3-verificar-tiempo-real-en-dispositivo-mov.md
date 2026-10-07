---
id: D.3
title: "verificar tiempo real en dispositivo movil"
phase: D
status: pending
owner: mobile-qa
updated: 2026-10-05
contracts: [FB-06, FB-07, FB-08, ERR-01, ERR-02]
adrs: [ADR-03]
skills: [mobile-dev, how-to-test, vendix-permissions, vendix-multi-tenant-context]
---
# D.3 — verificar tiempo real en dispositivo movil

- **Skills:** mobile-dev, how-to-test, vendix-permissions, vendix-multi-tenant-context
- **Resources:** `npm run start --prefix apps/mobile`; `curl -N -G --data-urlencode "token=$JWT" "$API/store/orders/stream"`; Expo Android/iOS con dos usuarios de prueba y dos tiendas; `bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-orders-sales-sse-realtime`
- **Business decision:** El criterio es la lista móvil actualizada sin pull-to-refresh; el sonido/push por sí solo no aprueba el caso.
- **Why:** La verificación de D.2 estática no prueba red, foco, reconexión ni aislamiento entre tiendas en un celular real.
- **Output:** `evidence/d3-mobile-device.md` con matriz, tiempos y capturas; FB-06/07/08 marcados solo con evidencia; convergencia actualizada.
- **Contracts touched:** FB-06, FB-07, FB-08, ERR-01, ERR-02
- **Data impact:** none — órdenes de prueba en entorno de desarrollo, sin producción.
- **Blast radius:** Una prueba solo de sesión feliz deja sin detectar caché ajena o eventos perdidos al reconectar.
- **Rollback:** Si falla aislamiento, bloquear merge y revertir D.2 antes de liberar móvil.
- **Verification:**
  - `npm run start --prefix apps/mobile` y matriz manual Expo en `evidence/d3-mobile-device.md` con orden de otra sesión, filtro, estado, modo avión, foreground, switch y logout.
  - `bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-orders-sales-sse-realtime`
- **Acceptance checklist:**
  - [ ] Nueva orden aparece en móvil sin gesto manual; KPIs se actualizan y filtro activo se respeta.
  - [ ] Cambio de estado se ve sin gesto; un evento repetido no duplica filas ni causa ráfaga REST.
  - [ ] Modo avión y retorno del background recuperan eventos perdidos por reconsulta REST.
  - [ ] Switch entre dos tiendas y logout cierran stream y eliminan datos de la tienda anterior.
  - [ ] Usuario sin `store:orders:read` no recibe ventas; evidencia móvil y curl en dev.
  - [ ] `cp-lint.sh` pasa y las dos rondas de convergencia pendientes quedan registradas.
- **Status:** pending · mobile-qa · 2026-10-05 · requiere dispositivo Expo; sin emulator/Playwright disponible en esta sesión
