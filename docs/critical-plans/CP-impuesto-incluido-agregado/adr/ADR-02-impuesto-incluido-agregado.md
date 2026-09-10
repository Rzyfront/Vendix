---
id: ADR-02
title: "Semantica de incluido: el precio publicado ya contiene el impuesto"
status: proposed
reversibility: costly
updated: 2026-09-10
---
# ADR-02 — Semántica de incluido: el precio publicado ya contiene el impuesto

- **Context:** "Incluido" es ambiguo: puede leerse como descuento del impuesto o como precio final con impuesto dentro. La práctica retail colombiana (precio con IVA incluido en etiqueta) y el estimado del modal (`p/(1+r)`) fijan la lectura correcta.
- **Decision:** Inclusivo = el cliente paga exactamente el precio publicado; el total NO crece. El desglose despeja: `base = p/(1+r_total_inclusivo)`, `impuesto = p − base`, por tasa a prorrata de su peso. Agregado = `total = p + p*r`. Mixto = primero se despeja lo inclusivo y sobre la base neta se suma lo agregado (igual que el estimado del modal).
- **Consequences:** Todos los canales (vitrina, checkout, WhatsApp, POS, factura) aplican la misma fórmula; el estimado del modal deja de ser decorativo y pasa a ser especificación. Redondeo a centavos con residuo a la mayor tasa (mismo criterio que factura).
- **Reversibility:** costly — cambiar la semántica reescribe totales históricos en reportes comparativos.
- **Revisit if:** DIAN exige desglose por tasa con redondeo distinto al de factura vigente.
