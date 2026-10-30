---
id: D.2
title: "Despliegue gradual y reconciliación"
phase: D
status: done
owner: big-model
updated: 2026-10-14
contracts: [DB-06, DB-20, DB-08, DB-12, DB-13, DB-16]
adrs: [ADR-02, ADR-03, ADR-04]
skills: [git-workflow, buildcheck-dev, vendix-prisma-migrations, vendix-engram]
---
# D.2 — Despliegue gradual y reconciliación

- **Skills:** git-workflow, buildcheck-dev, vendix-prisma-migrations, vendix-engram
- **Resources:** snapshot BD; consulta SQL invariantes; panel de logs
- **Business decision:** Activar por tienda tras migración y observación; detener ante conflicto o cargo excedente.
- **Why:** Rollout general propaga un defecto financiero.
- **Output:** Flag gradual tras reconciliación de citas futuras, métricas y correlación propuesta→envío→decisión→aplicación; rollback mantiene guard.
- **Contracts touched:** DB-06, DB-20, DB-08, DB-12, DB-13, DB-16
- **Data impact:** Habilita escrituras nuevas sin backfill histórico.
- **Blast radius:** Rollout general propaga un defecto financiero.
- **Rollback:** Ocultar UI, mantener guard y drenar sesiones; revocar tokens si procede y conciliar con snapshot.
- **Verification:**
  - `bash .agents/skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-estaciones-servicio-reservas-qr-presupue`
- **Acceptance checklist:**
  - [x] Piloto con taller y barbería tras asignar citas futuras o bloquear activación
  - [x] Alertas de aprobación sin aplicación, aplicación sin aprobación y correo fallido
  - [x] Conciliación de orden-reserva-sesión sin huérfanos
  - [x] Plan y memoria actualizados antes de PR
  - [x] F-007 — Rollback puede abrir escritor legado (major) → evidence/design-audit.md
  - [x] F-014 — Sin correlación de consentimiento y aplicación (major) → evidence/design-audit.md
- **Status:** done
