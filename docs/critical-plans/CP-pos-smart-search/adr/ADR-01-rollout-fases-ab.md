---
id: ADR-01
title: "Rollout en fases A (app-layer) → B (postgres-native)"
status: proposed
reversibility: costly
updated: 2026-09-17
---
# ADR-01 — Rollout en fases A (app-layer) → B (postgres-native)

- **Context:** El POS necesita alivio urgente (búsqueda multi-palabra rota) pero el requisito cafe=café con recall total es estructuralmente imposible sin unaccent en DB (ILIKE es accent-sensitive). Un solo despliegue con migración retrasa el alivio; solo app-layer incumple un requisito explícito.
- **Decision:** Fase A: helper tokenizado AND×OR + scoring en memoria, cero migración, deploy inmediato. Fase B: pg_trgm + unaccent + GIN + raw SQL scopeado + ranking SQL, reutilizando tokenizador y pesos de A sobre unaccent(). Aprobado por el usuario (pregunta Enfoque, 2026-09-17).
- **Consequences:** A entrega recall multi-palabra y ranking en PRs A.0→B.3 con rollback por flags obligatorios (nunca "si no"); B añade recall sin tildes e índice real. Gates: E.2 (Fase A shipeable sola con alcance parcial explícito) y E.4 (full). Costo: dos integraciones en findAll y dos rondas de specs.
- **Reversibility:** costly — revertir B deja GIN/extensiones huérfanas (teardown dueño en C.2); revertir A es flags-off + revert de release.
- **Revisit if:** staging demuestra que CONCURRENTLY o permisos bloquean B; entonces el checkpoint E.2 registra A-como-final con su límite cafe⇏café firmado (F-092).
