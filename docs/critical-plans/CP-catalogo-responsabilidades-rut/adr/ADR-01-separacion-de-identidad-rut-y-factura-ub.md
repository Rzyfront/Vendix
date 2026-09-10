---
id: ADR-01
title: "Separacion de Identidad RUT y Factura UBL"
status: proposed
reversibility: trivial
updated: 2026-09-09
---
# ADR-01 — Separacion de Identidad RUT y Factura UBL

- **Context:** En Colombia, la casilla 53 del RUT contiene más de 40 responsabilidades vigentes (01 al 61), como Régimen Ordinario (05), Exógena (14), Contabilidad (16) o Facturador (52). Sin embargo, el estándar XML UBL 2.1 de Facturación Electrónica DIAN (Anexo 1.9, reglas FAJ26/FAK26) restringe TaxLevelCode estrictamente a cinco códigos: O-13, O-15, O-23, O-47 y R-99-PN. Intentar enviar códigos del RUT como O-05 o O-52 en el XML causa rechazo inmediato por parte de la DIAN.
- **Decision:** Mantener una separación estricta entre la Identidad Tributaria del Contribuyente (almacenada en settings.fiscal_data.tax_responsibilities con el catálogo completo del RUT) y el adaptador de emisión XML UBL (gestionado exclusivamente por toDianTaxLevelCode, que filtra hacia la lista cerrada de 5 códigos).
- **Consequences:** El perfil fiscal del comerciante refleja con total fidelidad su RUT real, habilitando declaraciones, reportes y reglas contables correctas, sin generar jamás rechazos de validación en la DIAN.
- **Reversibility:** trivial — el desacoplamiento opera mediante funciones puras en backend.
- **Revisit if:** La DIAN publique un nuevo Anexo Técnico de Facturación Electrónica que admita códigos adicionales en TaxLevelCode.
