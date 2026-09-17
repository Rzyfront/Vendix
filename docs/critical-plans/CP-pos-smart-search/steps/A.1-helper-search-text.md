---
id: A.1
title: "Helper search-text.util.ts + specs"
phase: A
status: pending
owner: none
updated: 2026-09-17
contracts: [ERR-15]
adrs: [ADR-01, ADR-02]
skills: [vendix-backend, vendix-naming-conventions]
---
# A.1 — Helper search-text.util.ts + specs

- **Skills:** vendix-backend, vendix-naming-conventions
- **Resources:** none
- **Business decision:** Una sola normalización/tokenización/ensamblaje para las 4 superficies; tokenizer función total never-throw; predicado único decide wrap-vs-legacy. Cero IA/modelos.
- **Why:** Va tras A.0 porque B.1, B.2, D.1, D.2 y D.3 importan este helper; sin él no existe el motor.
- **Output:** `common/utils/search-text.util.ts`: normalizeSearchText(), STOPWORDS_ES_SEARCH, tokenizeSearch() + wrappers tokenizeInternal(6)/tokenizePublic(4) con maxTokens requerido, escapeLike(), isSmartSearchActive(query,flags), buildTokenAndFieldOr(tokens,fieldMap,nestPath) + spec.
- **Contracts touched:** ERR-15
- **Data impact:** none — código puro, sin lecturas ni escrituras
- **Blast radius:** Nulo hasta que alguien lo importe; tokenización divergente rompería recall/SQL-parity (F-081) — fijado por specs + fixture compartido.
- **Rollback:** `git revert` del commit; ningún consumidor existe aún.
- **Verification:**
  - `npm run buildcheck:test -- src/common/utils/search-text.util.spec.ts`
- **Acceptance checklist:**
  - [ ] normalizeSearchText('CAFÉ  Negro.') → 'cafe negro'
  - [ ] tokenizeSearch('café con chocolate') → ['cafe','chocolate'] (stopword fuera)
  - [ ] tokenizeSearch('de la') → [] (activa fallback legacy en B.1)
  - [ ] Spec cubre símbolos (-_/().), dedupe y tope 6 tokens
  - [ ] isSmartSearchActive decide wrap/legacy por caller (spec findAll≡findIds)
  - [ ] Probes surrogate/null/emoji/500chars: 200 definido, cero throws (ERR-15)
  - [ ] F-013 — Sin predicado único isSmartSearchActive (major)
  - [ ] F-015 — Ensamblaje AND×OR sin hogar compartido (major)
  - [ ] F-032 — Tokenizer puede lanzar con input adversarial (major)
- **Status:** pending
