// --- AI Voice Profiles (Vex Plus F8 T49): catálogo de voces de lectura ---

export interface AiVoiceSpeechConfig {
  id: number;
  label: string;
  provider: string;
  sdk_type: string;
  model_id: string;
}

export interface AiVoiceProfile {
  id: number;
  name: string;
  voice_id: string;
  language: string;
  speed: number | null;
  vol: number | null;
  sample_text: string | null;
  is_active: boolean;
  config: AiVoiceSpeechConfig & { is_active: boolean };
  /** Agent keys using this voice, e.g. ['vex']. */
  assigned_agents: string[];
  created_at: string;
  updated_at: string;
}

export interface AiVoiceProfileWriteDto {
  config_id?: number;
  voice_id?: string;
  name?: string;
  language?: string;
  speed?: number | null;
  vol?: number | null;
  sample_text?: string | null;
  is_active?: boolean;
}

export interface AiVoicePreviewAudio {
  audioBase64: string;
  contentType: string;
}

export const AI_VOICE_SAMPLE_MAX_LENGTH = 120;
