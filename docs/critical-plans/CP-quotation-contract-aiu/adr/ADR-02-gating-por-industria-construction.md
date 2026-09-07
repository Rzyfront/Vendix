---
id: ADR-02
title: "Gating por industria construction existente"
status: accepted
reversibility: costly
updated: 2026-09-06
---
# ADR-02 — Gating por industria construction existente

- **Context:** El dueno pidio activar contratos solo para industrias de obra. La industria `construction` ya existe ("Obras, contratos y AIU") con patron de ocultos por industria y semantica OR.
- **Decision:** No crear industria nueva. Cotizaciones con destino contrato, fichas de contrato y botones AIU solo visibles si el store incluye `construction`. Backend niega con 403 aunque la UI se manipule.
- **Consequences:** Stores sin `construction` no ven ni tocan el flujo. Multi-industria (`construction`+otra) lo conserva por la interseccion OR.
- **Reversibility:** costly — retirar el gating expone el flujo a industrias sin regimen AIU y exige revisar permisos.
- **Revisit if:** Otra industria (vigilancia, aseo) entra al regimen y pide el mismo flujo.
