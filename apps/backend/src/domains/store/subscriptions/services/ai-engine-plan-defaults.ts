/**
 * Engine configuration every NEW plan is born with (plan section 3.11,
 * "configuracion del motor"). These legacy `ai_feature_flags` keys are not
 * commercial levers and have no capability in the catalog, so the plan screen
 * has no editor for them; without this default a new plan would lack
 * `async_queue`, which still protects received-document scanning
 * (received-documents/store-received-documents.controller.ts). Lives in the
 * store domain because the enforce gate (T20) reads it too. Existing plans keep their stored
 * value: updates never touch these keys.
 */
export const AI_ENGINE_PLAN_DEFAULTS: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
> = {
  async_queue: { enabled: true, degradation: 'warn' },
};

/**
 * `flags` with the engine defaults added for the keys it does not carry.
 * A key the caller sent wins; never mutates `flags`.
 */
export function withAIEngineDefaults(
  flags: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const base = flags ?? {};
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(AI_ENGINE_PLAN_DEFAULTS)) {
    if (out[key] === undefined) out[key] = { ...value };
  }
  return out;
}
