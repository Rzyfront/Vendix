---
id: B.1
title: "buildProductWhere tokenizado AND×OR"
phase: B
status: pending
owner: none
updated: 2026-09-17
contracts: [FB-01, FB-02, FB-04, FB-05, FB-14, FB-15, DB-01, DB-17, ERR-01, ERR-02, ERR-03, ERR-04, ERR-15, ERR-16, ERR-20, ERR-23]
adrs: [ADR-02, ADR-09]
skills: [vendix-backend, vendix-backend-api, vendix-validation, vendix-prisma-scopes, vendix-multi-tenant-context]
---
# B.1 — buildProductWhere tokenizado AND×OR

- **Skills:** vendix-backend, vendix-backend-api, vendix-validation, vendix-prisma-scopes, vendix-multi-tenant-context
- **Resources:** `curl -H 'Authorization: Bearer $T' "$API/store/products?search=cafe%20chocolate&pos_optimized=true&state=active" | jq '.data[].name'`
- **Business decision:** AND por token vía `buildTokenAndFieldOr` (A.1) gateado por `isSmartSearchActive`; barcode conserva precedencia exacta; stopwords→frase legacy; DTO hardening ADR-09; rethrow VendixHttpException antes de lógica nueva. Scope: solo `GET /store/products` + `/ids`.
- **Why:** Cuarto porque es el cambio de recall; A.0/A.1/A.2 ya existen y B.2 ordenará lo que este paso recupera. Suite queda roja hasta B.3 (ventana explícita, F-052).
- **Output:** Rama search de buildProductWhere (:1417-1424) ENVUELTA (OR legacy conservado como fallback + path L1-off) con AND×OR tokenizado; DTO: @MaxLength(200)+trim search, @Min(1) page/limit, fix pos_optimized boolean, empty→undefined numéricos, pin ids[]+@ArrayMaxSize; rethrow en findAll; guard dead-code (4 superficies).
- **Contracts touched:** FB-01, FB-02, FB-04, FB-05, FB-14, FB-15, DB-01, DB-17, ERR-01, ERR-02, ERR-03, ERR-04, ERR-15, ERR-16, ERR-20, ERR-23
- **Data impact:** none — solo lectura; cambia el conjunto filtrado, no escribe filas
- **Blast radius:** Callers `GET /store/products`+`/ids` con search reciben distinto conjunto (POS web/móvil, admin, bulk, restaurante, facturación, Vexi); hermanos FB-10/11/12 intactos hasta Fase D; barcode intacto.
- **Rollback:** Flags obligatorios (A.0): L1 off restaura legacy en siguiente request (≤TTL); si no, `git revert`.
- **Verification:**
  - `curl -s -H "Authorization: Bearer $T" "$API/store/products?search=cafe%20chocolate&pos_optimized=true&state=active" | jq '.meta.total'`
- **Acceptance checklist:**
  - [ ] 'café chocolate' halla 'café negro granizado con hielo y chocolate'
  - [ ] barcode sigue anulando search (FB-02 regresión verde)
  - [ ] Sin search: where y orden idénticos a legacy (FB-08/FB-09)
  - [ ] Query 'de la' usa fallback frase legacy sin error
  - [ ] DTO: search 201chars→400, page=0→400, pos_optimized=false intacto, category_id= vacío
  - [ ] Throw tokenizer simulado → HTTP real con código (no 200+success:false)
  - [ ] F-003 — Try/catch findAll traga throws a 200+success:false (blocker)
  - [ ] F-016 — B.1 no nombra helper/stopwords; 5 variantes (major)
  - [ ] F-020 — Hermanos no usan buildProductWhere; blast falso (major)
  - [ ] F-033 — search sin cota: query larga = fallo sin código (major)
  - [ ] F-039 — page/limit sin @Min/@Max (major)
  - [ ] F-040 — pos_optimized=false coerciona a true (major)
  - [ ] F-041 — MaxLength+trim search sin dueño (major)
  - [ ] F-043 — Numéricos vacíos coercionan a 0 (major)
  - [ ] F-052 — Suite roja entre B.1 y B.3 sin gate por paso (major)
  - [ ] F-074 — Trampas dead-code en el path de implementación (minor)
  - [ ] F-075 — "Reemplazada" engaña: legacy debe sobrevivir (minor)
  - [ ] F-084 — Fallback stopwords es switch semántico silencioso (minor)
  - [ ] F-086 — ?ids= → [] con semántica sin pinar (minor)
  - [ ] F-091 — Rollback claims overprometen ("si no", in-flight) (minor)
- **Status:** pending
