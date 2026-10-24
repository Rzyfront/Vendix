---
id: ADR-03
title: "QR físico separado del acceso privado"
status: proposed
reversibility: costly
updated: 2026-10-06
---
# ADR-03 — QR físico separado del acceso privado

- **Context:** El token permanente de mesas persiste y habilita escrituras públicas.
- **Decision:** QR físico identifica la estación sin exponer sesión; el correo contiene token opaco aleatorio de sesión, hash en BD, vencimiento y revocación. Consentimiento usa desafío de un solo uso y propuesta concreta.
- **Consequences:** Dos URLs y controles de privacidad/SSE; cierre revoca acceso o cambia a vista histórica según regla de retención.
- **Reversibility:** costly — exige migración y actualización de contratos.
- **Revisit if:** Se exige acceso autenticado de cuenta de cliente.
