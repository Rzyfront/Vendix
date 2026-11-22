/** Contratos de `superadmin/ai-engine/agent-runtime` (ficha única del agente). */

export type RuntimeAgentKey = 'vex' | 'vexi';

export interface AgentVoiceValues {
  voice?: string;
  speed?: number;
  vol?: number;
}

export interface AgentRuntimeConfigOption {
  id: number;
  label: string;
  provider: string;
  model_id: string;
  model_type: string;
}

export interface AgentVoiceProfileSummary {
  id: number;
  name: string;
  voice_id: string;
  language: string;
  provider: string;
  config_label: string;
}

export interface AgentRuntimeSheet {
  agent: {
    key: string;
    name: string;
    description: string | null;
    is_active: boolean;
    system_prompt: string | null;
    allowed_tools: string[];
    denied_tools: string[];
    max_iterations: number | null;
    timeout_seconds: number | null;
  };
  application: {
    key: string;
    name: string;
    config_id: number | null;
    model_type: string;
    is_active: boolean;
  } | null;
  config: {
    id: number;
    label: string;
    provider: string;
    model_id: string;
    model_type: string;
    is_active: boolean;
  } | null;
  unused_by_agents: {
    temperature: { value: number | null; unused_by_agents: true };
    max_tokens: { value: number | null; unused_by_agents: true };
  };
  available_configs: AgentRuntimeConfigOption[];
  voice: {
    app_key: string;
    effective: AgentVoiceValues;
    base: AgentVoiceValues;
    has_override: boolean;
    /** Voz del catálogo asignada al agente; manda sobre base/override. */
    profile: (AgentVoiceProfileSummary & { is_active: boolean }) | null;
  };
  available_voice_profiles: AgentVoiceProfileSummary[];
}

export interface UpdateAgentRuntimeDto {
  config_id?: number;
  system_prompt?: string | null;
  allowed_tools?: string[];
  denied_tools?: string[];
  max_iterations?: number | null;
  timeout_seconds?: number | null;
  /** `null` quita el ajuste propio del agente y vuelve a la voz base. */
  voice?: AgentVoiceValues | null;
  /** Voz del catálogo para este agente; `null` la quita. */
  voice_profile_id?: number | null;
}

export interface AgentVoicePreview {
  audioBase64: string;
  contentType: string;
}
