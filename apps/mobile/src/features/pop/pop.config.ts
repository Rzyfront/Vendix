/**
 * POP feature flags (Fase 5 — modal unificado).
 *
 * Centraliza los toggles que controlan el rollout del modal unificado de
 * producto. Set to `false` para volver al comportamiento pre-Fase-5
 * (pop-prebulk-modal + pop-product-config-modal separados).
 *
 * Procedimiento de rollback:
 *   1. Set `POP_USE_UNIFIED_MODAL = false`.
 *   2. Reiniciar la app o esperar el rebuild.
 *   3. Verificar: "Agregar producto nuevo" abre pop-prebulk-modal;
 *      "Configurar" abre pop-product-config-modal.
 */
export const POP_USE_UNIFIED_MODAL = true;
