---
id: B.3
title: "Fix finding 10: header de notas al contrato validado"
phase: B
status: done
owner: none
updated: 2026-09-11
contracts: [DB-05, ERR-01]
adrs: [ADR-06]
skills: [vendix-frontend, vendix-tax-typing, how-to-dev]
---
# B.3 — Fix finding 10: header de notas al contrato validado (F-010)

- **Skills:** vendix-frontend, vendix-tax-typing, how-to-dev
- **Resources:** F-010, ADR-06 (accepted tras R.2), `evidence/r2-dian-ncnd.md`, `invoice-note-payload.util.ts:8-37`, QUI-702 (comentar, no duplicar)
- **Business decision:** Solo se ejecuta con ADR-06 en accepted. Si R.2 refuta la hipotesis del kernel, este step se reescribe al contrato correcto antes de tocar nada.
- **Why:** Documentacion fiscal que orienta futuras emisiones de NC/ND: debe describir exactamente el contrato validado (quien deriva `taxes`, donde, con que redondeo), ni una palabra mas.
- **Output:** Header reescrito al contrato validado + comentario en QUI-702. Cierra F-010. Cero runtime fiscal.
- **Contracts touched:** DB-05, ERR-01 — validados en R.2, no modificados (ver registry).
- **Data impact:** none — cambio de comentario, cero runtime, cero documentos emitidos.
- **Blast radius:** Solo el archivo del util y sus futuros lectores.
- **Rollback:** Revert del commit (comentario).
- **Verification:**
  - El header cita rutas exactas (kernel, controller, spec) y cada cita existe (`rg` en evidence/)
  - `git diff --stat` del step muestra 1 archivo y 0 lineas de logica
  - ADR-06 en accepted enlazado desde el header
- **Acceptance checklist:**
  - [x] ADR-06 en accepted antes de editar (gate duro de este step)
  - [x] Header reescrito con citas verificables y diff de 1 archivo sin logica
  - [x] QUI-702 comentado y finding cerrado en su record
- **Status:** done — verificado y consolidado 2026-09-11
