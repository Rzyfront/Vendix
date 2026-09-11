---
id: ADR-05
title: "Tracking publico solo para PQRs publicas de plataforma"
status: accepted
reversibility: costly
updated: 2026-09-11
---
# ADR-05 — Tracking publico solo para PQRs publicas de plataforma

- **Context:** F-009: el tracking publico sirve PQRs de tiendas con tickets secuenciales enumerables. Directiva de usuario: lo publico solo trackea lo publico.
- **Decision:** Re-aplicar gate de plataforma (o filtro `is_public`) en el endpoint publico de tracking. Las tiendas siguen consultando sus PQRs en su admin autenticado.
- **Consequences:** Desaparece la enumeracion cross-tienda; si alguna tienda usaba el link publico, pierde acceso (comunicar + alternativa en admin).
- **Reversibility:** costly — revertir re-expone enumeracion; requiere decision de seguridad firmada.
- **Revisit if:** Producto define tracking de tienda con segundo factor (email del solicitante) — entonces nuevo diseno, no revert.
