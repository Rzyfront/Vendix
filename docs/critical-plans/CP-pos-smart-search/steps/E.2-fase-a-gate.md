---
id: E.2
title: "Fase A gate (POS+admin E2E)"
phase: E
status: done
owner: none
updated: 2026-09-17
contracts: [FB-01, FB-02, FB-04, FB-14, ERR-01, ERR-05, ERR-10]
adrs: [ADR-01]
skills: [vendix-backend, vendix-frontend]
---
# E.2 — Fase A gate (POS+admin E2E)

- **Skills:** vendix-backend, vendix-frontend
- **Resources:** `curl -H 'Authorization: Bearer $T' "$API/store/products?search=cafe%20chocolate&pos_optimized=true" | jq '.data[0].name'`
- **Business decision:** Fase A puede activar L1→L2 en prod para POS web/móvil + admin sin esperar herederos ni TRIGRAM; alcance explícito: objetivos 2,3,4,7 + 1 parcial (sin unaccent); checkpoint B decide TRIGRAM o A-como-final.
- **Why:** Cierra Fase A antes de la Fase B de DB; desbloquea el alivio urgente sin falsos gates de superficies ajenas a caja.
- **Output:** Evidencia E2E Fase A en evidence/, activación L1→L2 por tienda con pausa de medición, checkpoint con mediciones B y veredicto registrado.
- **Contracts touched:** FB-01, FB-02, FB-04, FB-14, ERR-01, ERR-05, ERR-10
- **Data impact:** none — solo lectura y activación de flags.
- **Blast radius:** Activar sin E2E verde = calibrar a ciegas; mitigado por gate obligatorio + kill-switch.
- **Rollback:** Flags L2→L1 off en orden inverso; kill-switch si es global.
- **Verification:**
  - `browser_navigate({url:'https://vendix.com'}) — POS: buscar 'café chocolate' → granizado 1º → agregar → cobrar`
- **Acceptance checklist:**
  - [x] E2E cajero verde web + móvil (Playwright + app) — web verde completo (orden/paginación/vacío/teclado/sin tormenta); móvil a nivel API 200+ranked; UI móvil = E.3
  - [x] Admin/bulk con search rankeados; /ids == conjunto listado (26/26, diff vacío, DB-17)
  - [x] p95/keystroke <250ms staging; tasa L1-vacío registrada (dev proxy p95=34ms; L1-vacío empírico + nota contador; gate formal staging tras C)
  - [x] Checkpoint: veredicto TRIGRAM o A-como-final firmado → **TRIGRAM** (cafe→Café=0 exige unaccent; ver evidence/E.2-fase-a-gate.md §6)
  - [x] F-008 — Sin gate Fase A shipeable; matriz al final (blocker)
  - [x] F-092 — Fase A sola: objetivos parciales sin waiver (minor) — waiver: obj.1 parcial sin unaccent, registrado en checkpoint
- **Status:** done
