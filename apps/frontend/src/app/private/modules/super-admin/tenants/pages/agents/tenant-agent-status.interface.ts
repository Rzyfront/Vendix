/** Respuesta de `GET superadmin/ai-engine/agent-runtime/stores/:id/status`. */
export interface TenantAgentStatus {
  readonly agent_key: 'vex' | 'vexi';
  readonly label: 'Vex' | 'Vexi';
  readonly state:
    | 'on'
    | 'off_by_plan'
    | 'off_by_store'
    | 'no_subscription'
    | 'subscription_blocked';
  readonly plan_includes: boolean;
  readonly store_enabled: boolean;
  /** `null` cuando el agente está encendido. */
  readonly reason: string | null;
}
