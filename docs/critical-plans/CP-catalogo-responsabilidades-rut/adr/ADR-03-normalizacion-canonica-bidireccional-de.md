---
id: ADR-03
title: "Normalizacion Canonica Bidireccional de Codigos DIAN"
status: proposed
reversibility: trivial
updated: 2026-09-09
---
# ADR-03 — Normalizacion Canonica Bidireccional de Codigos DIAN

- **Context:** En el documento impreso o PDF del RUT, la casilla 53 presenta números de dos dígitos (ej. 05, 13, 14, 48, 52). Sin embargo, en el código y base de datos histórica de Vendix se utilizan identificadores con prefijo O- (ej. O-13, O-48, O-49) y R-99-PN. Si el escáner OCR extrae '48' pero los helpers de IVA buscan 'O-48', el sistema fallaría silenciosamente asumiendo al comercio como no responsable de IVA.
- **Decision:** Implementar un normalizador canónico puro en backend y frontend que unifique '48' <-> 'O-48', '05' <-> 'O-05', etc. El almacenamiento persistido mantendrá el formato canónico con prefijo (O-XX / R-99-PN) mientras los inputs, DTOs y salidas del escáner aceptarán transparentemente ambas formas.
- **Consequences:** Eliminación de fallos de comparación por diferencias de formato, robustez ante lecturas del OCR y compatibilidad total con datos preexistentes.
- **Reversibility:** trivial — función pura con batería de pruebas unitarias.
- **Revisit if:** La DIAN altere el sistema de codificación de la casilla 53 a caracteres alfanuméricos no numéricos.
