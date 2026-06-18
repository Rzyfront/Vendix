/**
 * POP feature flags (Fase 5 — modal unificado).
 *
 * Centralizes toggles that control the rollout of the unified product
 * modal. Set to `false` to roll back to the pre-Fase-5 behaviour
 * (separate `pop-prebulk-modal` + `pop-product-config-modal`).
 *
 * Rollback procedure (Fase 5 PR description):
 *   1. Set `POP_USE_UNIFIED_MODAL = false`.
 *   2. Restart the frontend (or wait for watch-mode rebuild).
 *   3. Smoke-test: "Agregar producto nuevo" opens `pop-prebulk-modal`;
 *      "Configurar" opens `pop-product-config-modal`.
 *   4. Merge a follow-up PR with the fix; keep the flag for at least one
 *      release cycle before removing the legacy code path.
 */
export const POP_USE_UNIFIED_MODAL = true;
