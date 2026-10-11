---
id: B.2
title: "alinear por enviar con filtros"
phase: B
status: in-progress
owner: ejecutor-pequeno
updated: 2026-10-06
contracts: [FB-03]
adrs: [ADR-02]
skills: [sopus, vendix-frontend, vendix-zoneless-signals, vendix-frontend-component, vendix-ui-ux]
---
# B.2 — alinear por enviar con filtros

- **Skills:** sopus, vendix-frontend, vendix-zoneless-signals, vendix-frontend-component, vendix-ui-ux
- **Resources:** `apps/frontend/src/app/shared/components/button/README.md`; `apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.component.scss`; `bash scripts/buildcheck.sh --watch`
- **Business decision:** Igualar únicamente «Por enviar» a 40 × 40 px bajo 640 px y 44 × 44 px hasta 767 px; preservar botón con texto desde 768 px.
- **Why:** B.1 resuelve la tarjeta; esta acción independiente corrige el segundo síntoma sin alterar tamaños globales.
- **Output:** Clases locales vía `customClasses` con precedencia explícita sobre `size="md"`, restauración `md:`, sin sombra de primary, nombre accesible y `aria-pressed` en el `<button>` interno mediante entrada opcional.
- **Contracts touched:** FB-03
- **Data impact:** none — solo CSS/clases y atributos; la query `dispatchable` no cambia.
- **Blast radius:** Un override global puede desalinear otros botones; `aria-pressed` en el host no anuncia el estado del botón real.
- **Rollback:** Revertir clases locales y la entrada opcional de botón; el filtro mantiene su lógica anterior.
- **Verification:**
  - `bash scripts/buildcheck.sh --watch` tras el último cambio.
  - Playwright MCP: medir `getBoundingClientRect()` a 375, 700 y 1024 px; inspeccionar nombre y `aria-pressed` del botón real.
- **Acceptance checklist:**
  - [ ] El botón coincide en alto/ancho con triggers adyacentes a 375 y 700 px; no hay scroll horizontal — falta medición Playwright
  - [x] Desde 768 px se conserva texto y tamaño anterior — clases locales restauran 44 px y `iconOnlyMobile` muestra texto desde md; falta E2E
  - [ ] Las utilidades `!`/breakpoint ganan a `h-8 sm:h-11` en DOM real a 320, 639/640 y 767/768 px.
  - [x] Icono tiene nombre accesible y `aria-pressed` cambia en el botón interno — input nuevo aplicado directamente al `<button>`
  - [ ] Dos toques alternan URL y filtro como antes; otros `app-button` no cambian — falta E2E
  - [x] Cambio integrado y revisado por el orquestador — diff local
  - [ ] F-003 — Overrides de tamaño deben ganar por breakpoint (minor)
- **Status:** in-progress · orquestador · 2026-10-06 · falta medición de DOM con navegador
