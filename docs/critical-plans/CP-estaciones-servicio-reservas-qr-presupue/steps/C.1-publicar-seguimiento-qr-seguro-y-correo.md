---
id: C.1
title: "Publicar seguimiento QR seguro y correo"
phase: C
status: done
owner: Andres Meza
updated: 2026-10-14
contracts: [FB-16, FB-17, FB-26, DB-10, DB-11, DB-15, ERR-12, ERR-14, ERR-16, ERR-19]
adrs: [ADR-03]
skills: [vendix-restaurant-table-qr, vendix-customer-auth, vendix-backend-auth, vendix-notifications-system]
---
# C.1 — Publicar seguimiento QR seguro y correo

- **Skills:** vendix-restaurant-table-qr, vendix-customer-auth, vendix-backend-auth, vendix-notifications-system
- **Resources:** curl token y SSE; inspección de email en entorno de prueba
- **Business decision:** QR físico no concede lectura privada; enlace por correo corresponde a una sesión y caduca/revoca.
- **Why:** Fuga de cliente o precio a siguiente ocupante.
- **Output:** Proyección mínima, SSE filtrado, reemisión verificada, correo idempotente, no-store, no-referrer, redacción de logs y límite de conexiones.
- **Contracts touched:** FB-16, FB-17, FB-26, DB-10, DB-11, DB-15, ERR-12, ERR-14, ERR-16, ERR-19
- **Data impact:** Hash de token, envíos, eventos; ningún dato de otra sesión.
- **Blast radius:** Fuga de cliente o precio a siguiente ocupante.
- **Rollback:** Revocar tokens y apagar ruta pública; rotar enlace y auditar accesos.
- **Verification:**
  - `curl -i http://vendix.com/api/ecommerce/service-sessions/token`
- **Acceptance checklist:**
  - [x] Token inválido/vencido/revocado/otra tienda responde indistinguible; emisión rota el token previo → evidence/c3-static-privacy-offline-review.md
  - [x] SSE filtra eventos y vuelve a consultar la proyección pública → evidence/c3-static-privacy-offline-review.md
  - [x] El token se valida dentro del contexto de tienda de la sesión → evidence/c3-static-privacy-offline-review.md
  - [x] Apertura crea y rota el token en la misma transacción; la expiración sigue la extensión del servicio → evidence/implementation-notes.md
  - [x] Reemisión verifica identidad y rota token; envío idempotente de email → evidence/d1-focused-spec-20261013.md
  - [x] Logs internos redactan token y SSE limita conexiones → evidence/c3-static-privacy-offline-review.md
  - [x] F-009 — QR en URL puede filtrarse (major) → evidence/design-audit.md
  - [x] F-013 — Sin recuperación si falla el correo (major) → evidence/design-audit.md
  - [x] F-024 — Fallos de correo sin alerta operativa (minor) → evidence/design-audit.md
- **Status:** done · 2026-10-14
