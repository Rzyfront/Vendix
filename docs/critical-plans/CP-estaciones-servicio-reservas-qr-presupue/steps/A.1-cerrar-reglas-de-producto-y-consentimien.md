---
id: A.1
title: "Cerrar reglas de producto y consentimiento"
phase: A
status: done
owner: Andres Meza
updated: 2026-10-14
contracts: []
adrs: [ADR-01, ADR-02, ADR-03, ADR-04]
skills: [vendix-business-analysis, vendix-operating-scope, vendix-product-variants]
---
# A.1 — Cerrar reglas de producto y consentimiento

- **Skills:** vendix-business-analysis, vendix-operating-scope, vendix-product-variants
- **Resources:** evidence/business-analysis.md; entrevistas con líder y comercio
- **Business decision:** Una estación compartible con capacidad inicial uno; tope sobre importe cobrable, consentimiento explícito para excedente, persona/vehículo opcional según servicio. Ratificar o enmendar ADR antes de escribir código.
- **Why:** La regla equivocada produce cobros o reservas rechazadas.
- **Output:** Matriz firmada de estados, importes, roles, tiempos y canales para taller y barbería.
- **Contracts touched:** none — decisión funcional sin API
- **Data impact:** none — documento
- **Blast radius:** La regla equivocada produce cobros o reservas rechazadas.
- **Rollback:** Editar ADR y pasos antes de migración; no revertir datos.
- **Verification:**
  - `rg -n "Preguntas que bloquean" evidence/business-analysis.md`
- **Acceptance checklist:**
  - [x] Cada regla de tope define impuestos, descuento, anticipo y servicio inicial (ratificado: total cobrable con IVA/INC y descuentos; propina excluida; anticipos como abonos a la orden)
  - [x] Se define quién aprueba y prueba admisible (ratificado: enlace privado con token OTP y registro inmutable en service_proposal_decisions)
  - [x] Se define capacidad, horario, expiración, canal alterno y verificación de identidad (capacidad 1 compartible con compatibilidad explícita; canal correo y token revocable)
  - [x] Copy/campos por servicio y política de walk-in, pausa, no-show y demora están definidos (persona/vehículo opcional según producto)
  - [x] La decisión queda registrada en ADR-01 a ADR-04
- **Status:** done
