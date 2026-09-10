---
id: ADR-04
title: "Propagacion de prompt via migracion y retiro de R-99-PJ"
status: proposed
reversibility: costly
updated: 2026-09-09
---
# ADR-04 — Propagacion de prompt via migracion y retiro de R-99-PJ

- **Context:** El seed `ai-engine-apps.seed.ts` nunca reconcilia `system_prompt` en filas existentes: los cambios del seed solo aplican a instalaciones nuevas. Además el prompt y `RutScanResult` emiten `R-99-PJ`, un código ficticio fuera del RUT, mientras excluyen IVA (48/49).
- **Decision:** Propagar el prompt nuevo con migración SQL `UPDATE ai_engine_applications WHERE key='rut_scanner'` (ver A.3), retirar `R-99-PJ` del prompt, del contrato y de `KNOWN_TAX_RESPONSIBILITIES`, y reparar filas existentes mapeándolo a `R-99-PN` (fallback UBL ya usado por `toDianTaxLevelCode`).
- **Consequences:** Instalaciones existentes reciben el prompt sin perder personalizaciones de otros campos; ningún dato histórico conserva un código inexistente ante la DIAN.
- **Reversibility:** costly — reescribir prompts y datos exige migración inversa con respaldo previo.
- **Revisit if:** La DIAN publique un código real para personas jurídicas sin responsabilidad UBL.
