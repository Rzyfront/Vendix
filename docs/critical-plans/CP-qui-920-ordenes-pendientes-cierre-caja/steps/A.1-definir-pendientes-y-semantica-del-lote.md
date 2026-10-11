---
id: A.1
title: "Definir pendientes y semantica del lote"
phase: A
status: done
owner: none
updated: 2026-10-06
contracts: []
adrs: [ADR-01, ADR-02, ADR-03]
skills: [vendix-business-analysis, vendix-analytics-metrics, vendix-operating-scope]
---
# A.1 — Definir pendientes y semantica del lote

- **Skills:** vendix-business-analysis, vendix-analytics-metrics, vendix-operating-scope
- **Resources:** evidence/business-analysis.md; URL QUI-920; rg -n order_state_enum apps/backend/prisma/schema.prisma
- **Business decision:** Contar por sesión de origen. Diferenciar estado operativo, saldo pendiente y cobros de otra caja. Decidir si el lote es todo-o-nada y a quién se permite override.
- **Why:** Clasificar mal una orden puede ocultar dinero o finalizar una entrega pendiente.
- **Output:** Matriz firmada de estados, saldos, COD, rol, excepción, legacy y copy web/móvil.
- **Contracts touched:** none — decisión previa a contratos
- **Data impact:** none — solo documento
- **Blast radius:** Clasificar mal una orden puede ocultar dinero o finalizar una entrega pendiente.
- **Rollback:** Corregir ADR y pasos antes de tocar datos.
- **Verification:**
  - `rg -n "Preguntas críticas" docs/critical-plans/CP-qui-920-ordenes-pendientes-cierre-caja/evidence/business-analysis.md`
- **Acceptance checklist:**
  - [x] Definición usa finished y saldo, no completed ni paid como estado
  - [x] COD y shipped/delivered tienen regla explícita
  - [x] Se decide todo-o-nada versus parcial y efecto económico permitido
  - [x] Override define permiso, motivo y auditoría
  - [x] Legacy sin sesión tiene tratamiento visible
- **Status:** done
