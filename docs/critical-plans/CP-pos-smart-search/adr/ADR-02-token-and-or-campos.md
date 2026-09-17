---
id: ADR-02
title: "Token-AND × OR-campos con fallback legacy"
status: proposed
reversibility: trivial
updated: 2026-09-17
---
# ADR-02 — Token-AND × OR-campos con fallback legacy

- **Context:** La frase completa como substring contiguo es la causa raíz del 0-resultados. Alternativas: AND por token (preciso, puede vaciar con typos), OR-union (recall máximo, rompe total honesto y paginación).
- **Decision:** AND por token a través de campos (cada token en ≥1 campo de name/description/sku/variants.name/variants.sku); si el tokenizador devuelve vacío (query solo stopwords), fallback a la frase legacy contains(search). Sin fallback OR-union.
- **Consequences:** "café chocolate" halla "café negro granizado con hielo y chocolate" porque cada token puede estar en distinto campo. Queries con typos devuelven vacío igual que hoy (con copy typo-empty F-064). Description entra en Fase A y en Fase B vía rama OR acotada (F-027, sin regresión). Divergencias NFD-JS vs unaccent() documentadas en fixture (F-019/F-081).
- **Reversibility:** trivial — cambio confinado a la rama search de buildProductWhere (wrap, no replace); revert restaura el OR de frase.
- **Revisit if:** métricas de L1-vacío superan 15% de búsquedas; entonces evaluar pasada relajada OR + fuzzy antes que L3.
