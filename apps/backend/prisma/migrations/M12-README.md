# M12 en retención — Vex Plus fase 1

Rama de retención, **sin PR**. Sale del commit `114315fd1` de `feat/vex-plus-f1` (PR #1309), de donde se retiraron estas piezas:

- `20261222090000_vex_title_generator_app/`: inserta la fila `vex_title_generator` en `ai_engine_applications` (0 o 1 fila, `ON CONFLICT DO NOTHING`).
- `20261223090000_vex_followup_prompt_rule/`: agrega la regla de seguimientos al `system_prompt` de `vex_assistant` (`UPDATE` acotado a 1 fila, idempotente).
- Entrada `vex_title_generator` de `prisma/seeds/ai-engine-apps.seed.ts`: el seed de producción corre en cada deploy e insertaría la misma fila.

Son mutaciones de datos M12 (`odd/tasks/vex-agente-avanzado.md` §3.9). No se integran hasta que Rafael dé su aprobación escrita, con snapshot de producción y dry-run sobre datos representativos.
