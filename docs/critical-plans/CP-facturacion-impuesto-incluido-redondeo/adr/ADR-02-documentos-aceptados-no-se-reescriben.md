---
id: ADR-02
title: "Documentos aceptados no se reescriben"
status: proposed
reversibility: one-way
updated: 2026-09-11
---
# ADR-02 — Documentos aceptados no se reescriben

- **Context:** Hay facturas ya aceptadas con el total corto impreso (consecutivo quemado, CUFE firmado, letras de $2.999,99).
- **Decision:** El fix solo rige emisiones nuevas; ningún script reescribe `invoices`/`invoice_items`/`invoice_taxes`/`cude` de documentos aceptados. La corrección de un documento histórico, si aplica, es nota crédito, no UPDATE.
- **Consequences:** Cero riesgo sobre documentos legales vigentes; el bug visible en histórico se explica pero no se muta.
- **Reversibility:** one-way door — reescribir un documento aceptado es irreversible frente a la DIAN.
- **Revisit if:** La DIAN o el contador exigieran corrección formal de un documento puntual (vía nota, nunca UPDATE).
