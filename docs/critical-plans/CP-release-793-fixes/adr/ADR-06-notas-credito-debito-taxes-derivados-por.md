---
id: ADR-06
title: "Notas credito-debito: taxes derivados por kernel (validacion DIAN)"
status: proposed
reversibility: one-way
updated: 2026-09-11
---
# ADR-06 — Notas credito-debito: taxes derivados por kernel (validacion DIAN)

- **Context:** F-010: el frontend omite `taxes` en notas parciales porque el backend deriva por kernel (`derivePartialNoteLinesViaKernel`). El header dice lo contrario. Tocar impuestos de NC/ND sin base normativa puede incumplir DIAN: la decision final se escribe aqui SOLO despues de R.2.
- **Decision:** (Pendiente de R.2.) Hipotesis de trabajo: el kernel es la fuente de verdad y el header se reescribe al contrato validado, sin cambiar ni un byte de runtime fiscal. Si R.2 refuta la hipotesis, este ADR registra el contrato correcto encontrado y el fix cambia.
- **Consequences:** Segun R.2: o solo-doc (reversible) o fix de motor (irreversible en datos emitidos).
- **Reversibility:** one-way — documentos fiscales emitidos no se reescriben; solo se corrige hacia adelante.
- **Revisit if:** La DIAN actualiza el anexo tecnico de NC/ND o cambia la validacion de impuestos por linea.
