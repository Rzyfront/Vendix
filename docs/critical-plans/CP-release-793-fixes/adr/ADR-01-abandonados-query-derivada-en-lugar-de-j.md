---
id: ADR-01
title: "Abandonados: query derivada en lugar de job de marcado"
status: accepted
reversibility: costly
updated: 2026-09-11
---
# ADR-01 — Abandonados: query derivada en lugar de job de marcado

- **Context:** F-002: ningun escritor pone `state = 'abandoned'`; la metrica lee ~0. Alternativas: (a) job que marque el estado sin borrar items, (b) derivar en SQL (`active` + `last_activity_at` antiguo + con items). QUI-628 existe y esta Devuelto.
- **Decision:** Derivar en SQL (b). Cero migracion de datos, cero job nuevo, solo cambia lectura. Definir ventana X de inactividad en el servicio (constante nombrada) y documentarla en QUI-628.
- **Consequences:** La metrica pasa a medir abandono real; el contrato `state` almacenado queda sin uso hasta que un job futuro lo pueble.
- **Reversibility:** costly — cambiar la definicion altera dashboards; requiere migrar la ventana y comunicar el cambio.
- **Revisit if:** Se necesita el estado materializado para performance o para campanas de recuperacion (ahi si job + backfill).
