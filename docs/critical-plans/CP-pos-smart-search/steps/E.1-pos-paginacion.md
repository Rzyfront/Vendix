---
id: E.1
title: "POS frontend: paginación y orden visible"
phase: E
status: done
owner: none
updated: 2026-09-17
contracts: [FB-01, ERR-01, ERR-02, ERR-06, ERR-12, ERR-13, ERR-17]
adrs: [ADR-03, ADR-08]
skills: [vendix-frontend, vendix-frontend-state, vendix-zoneless-signals, vendix-ui-ux]
---
# E.1 — POS frontend: paginación y orden visible

- **Skills:** vendix-frontend, vendix-frontend-state, vendix-zoneless-signals
- **Resources:** none
- **Business decision:** Sticky-bottom "cargar más (x restantes)" + copy exacto; total real de meta; orden backend sin re-sort; loading no-destructivo + stream ordenado; teclado+foco+live-regions completos; toasts por causa; degraded visible.
- **Why:** Tras B.2/C.3 porque pagina el ranking backend; antes de E.2 (gate Fase A) y E.4 (full) que verifican sus contratos UX/a11y.
- **Output:** selection.component: barra sticky, contador header, fix total meta, loading dim+aria-busy, switchMap/secuencia, tap-stability, scroll-reset, Enter-rank1, highlight/clamp, cards botón+roving, foco cargar-más, FAB names, live-region, labels, agotados, contraste, chip degraded, copys typo/toast/teaching/hint/limpiar, clamp page; service pagina; muerto NO tocado.
- **Contracts touched:** FB-01, ERR-01, ERR-02, ERR-06, ERR-12, ERR-13, ERR-17
- **Data impact:** none — solo lectura paginada.
- **Blast radius:** Grilla POS: regresión UX/a11y frena caja; mitigado por matriz E.2/E.4 (28 findings). Zoneless: signals puros, sin NgZone.
- **Rollback:** `git revert`; backend intacto, grilla vuelve a top-20 legacy.
- **Verification:**
  - `browser_navigate({url:'https://vendix.com'}) then browser_snapshot() — buscar, teclado, cargar más, focos, live-regions, chip`
- **Acceptance checklist:**
  - [ ] 'cafe' muestra total y "cargar más" trae página 2 sin duplicar ids — PARCIAL: paginación/append/total-meta verificados en vivo (20/90→40, 20/26, 20/29, sin dup por ids); 'cafe'→'Café' devuelve 0 en L2 POR DISEÑO (unaccent es C.1/C.3; legacy idéntico ⇒ paridad, no regresión). Se cierra tras C.3.
  - [x] Orden backend se respeta: cero .sort()/.filter() por texto en vivo (grep: solo filter token-min-len/dedupe-ids; orden verificado E2E con tokens invertidos 'slim playstation'→rank-1 correcto)
  - [x] Vacío de ERR-01 conserva botón "Limpiar búsqueda" (E2E 'zzzqqqxxx' → 'No se encontraron productos' + botón + live-region)
  - [x] `npm run zoneless:audit` sin violaciones en archivos tocados (0 EventEmitter, 0 *ngIf, 10/10 subscribes con takeUntilDestroyed; FAIL global es pre-existente en otros 19 archivos)
  - [x] Keyboard-only E2E: type→Enter→carrito ('e1pag' → Enter → rank-1 'Café Molido Tostado 23 E1PAG' en carrito, Subtotal $10.000)
  - [ ] Stale-order + tap-mid-respuesta + Vexi-interleave (E.4) pineados — difiere a E.4 por plan
  - [x] F-009 — Cards mouse-only; teclado no selecciona (blocker)
  - [ ] F-010 — Cargar-más sin focus management (blocker)
  - [x] F-011 — Orden degradado silencioso: wrong-first sin señal (blocker)
  - [x] F-023 — SearchResult.total siempre = page length (major)
  - [ ] F-036 — Paginación hereda trampa success:false (major)
  - [ ] F-037 — Aritmética load-more puede disparar ERR-06 (major)
  - [x] F-053 — Rank-1 sin fast path teclado/Enter (major)
  - [ ] F-054 — Cards truncadas ocultan el match (major)
  - [ ] F-055 — Re-rank mueve card bajo el dedo (mis-tap) (major)
  - [ ] F-056 — Spinner full-grid por keystroke (flicker) (major)
  - [ ] F-057 — Cargar-más/scroll ambiguo; costo indefinido (major)
  - [ ] F-058 — Respuesta stale pisa rank nuevo sin orden (major)
  - [x] F-060 — FABs con nombre idéntico sin producto (major)
  - [x] F-061 — Sin live-regions en loading/count/empty/total (major)
  - [x] F-062 — Input search sin label programático (major)
  - [x] F-063 — Botones header solo-icono sin nombres (major)
  - [ ] F-064 — Typo-empty indistinguible de cero real (major)
  - [ ] F-065 — Toast genérico colapsa 5+ causas; contradice grilla (major)
  - [x] F-066 — Copy contador/cargar-más sin fijar (major)
  - [ ] F-067 — Sin copy de loading para doble-scan (major)
  - [ ] F-078 — E.1 lista FB-06 sin path compartido (minor)
  - [ ] F-093 — Search-while-scrolled deja rank-1 fuera de viewport (minor)
  - [ ] F-095 — Agotados sin path teclado; estado solo-opacidad (minor)
  - [ ] F-096 — Texto 10px sobre fotos; contador nuevo sin contraste (minor)
  - [ ] F-097 — Grid sin semántica lista; volumen tab-stops sin roving (minor)
  - [ ] F-098 — Ranking nuevo sin explicar; capability sin descubrir (minor)
  - [ ] F-099 — Fallback stopwords busca literal sin hint (minor)
  - [x] F-100 — Limpiar promete recovery que no entrega (categoría sobrevive) (minor)
- **Status:** in-progress
