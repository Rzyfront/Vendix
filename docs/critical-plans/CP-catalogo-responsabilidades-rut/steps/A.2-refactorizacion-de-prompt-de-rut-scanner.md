---
id: A.2
title: "Refactorizacion de Prompt de rut scanner en AI Engine"
phase: A
status: done
owner: Rafael Eduardo Martinez Frontado
updated: 2026-09-09
contracts: [FB-03, DB-04, ERR-03]
adrs: [ADR-01, ADR-03, ADR-04]
skills: [vendix-ai-engine, vendix-prisma-seed, vendix-prisma-migrations]
---
# A.2 — Refactorizacion de Prompt de rut scanner en AI Engine

- **Skills:** vendix-ai-engine, vendix-prisma-seed, vendix-prisma-migrations
- **Resources:** `npx prisma migrate dev --name rut-scanner-prompt-v3`
- **Business decision:** Prompt extrae dígitos literales de casilla 53 sin lista restrictiva y sin `R-99-PJ`; el contrato `RutScanResult` documenta el catálogo 01-61. La propagación a filas existentes va por migración, no por seed.
- **Why:** El prompt descarta IVA (48/49), Ordinario (05) y Facturador (52), por eso la extracción falla en la mayoría de RUTs; y el seed nunca reconcilia prompts existentes, así que sin migración prod conserva el prompt viejo.
- **Output:** Prompt de `rut_scanner` en `ai-engine-apps.seed.ts`, contrato actualizado y migración UPDATE del prompt.
- **Contracts touched:** FB-03, DB-04, ERR-03
- **Data impact:** Escribe 1 fila en `ai_engine_applications` vía migración con header DATA IMPACT; seed solo afecta instalaciones nuevas.
- **Blast radius:** Extracción OCR en el Wizard de Activación Fiscal y en el botón "Re-escanear RUT" del panel de Identidad.
- **Rollback:** Migración down restaura el prompt anterior desde el respaldo del propio SQL.
- **Verification:**
  - `curl -s -X POST -F "file=@apps/backend/src/fixtures/rut-sample.pdf" http://localhost:3000/organization/ai-engine/applications/rut_scanner/execute | grep "tax_responsibilities"`
- **Acceptance checklist:**
  - [x] Remover la lista restrictiva del system prompt y pedir dígitos literales de casilla 53.
  - [x] Eliminar toda referencia a `R-99-PJ` del prompt y del contrato `RutScanResult`.
  - [x] Actualizar el comentario de `tax_responsibilities` al catálogo 01-61.
  - [x] Crear migración UPDATE del prompt con guarda (solo si contiene la lista vieja).
  - [x] Verificar que el seed crea la fila correcta en instalación nueva.
- **Status:** done · Rafael Eduardo Martinez Frontado · 2026-09-09
