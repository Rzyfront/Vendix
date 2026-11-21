import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import { VendixHttpException, ErrorCodes } from '../common/errors';
import { AIEngineService } from './ai-engine.service';
import { AgentQuotaService } from '../domains/store/subscriptions/services/agent-quota.service';

/** App TTS that holds the base voice (`metadata.speech`). */
export const VOICE_TTS_APP_KEY = 'vexi_voice_tts';

export const RUNTIME_AGENT_KEYS = ['vex', 'vexi'] as const;
export type RuntimeAgentKey = (typeof RUNTIME_AGENT_KEYS)[number];

export const VOICE_PREVIEW_MAX_CHARS = 120;
export const VOICE_PREVIEW_DEFAULT_TEXT =
  'Hola, soy tu asistente. Así suena mi voz en tus respuestas.';

export interface AgentVoice {
  voice?: string;
  speed?: number;
  vol?: number;
}

export interface AgentStatusView {
  agent_key: RuntimeAgentKey;
  label: 'Vex' | 'Vexi';
  state: 'on' | 'off_by_plan' | 'off_by_store' | 'no_subscription';
  plan_includes: boolean;
  store_enabled: boolean;
  /** `null` when `state = 'on'`. Same text for store and super admin. */
  reason: string | null;
}

export interface AgentSheetUpdate {
  config_id?: number;
  system_prompt?: string | null;
  allowed_tools?: string[];
  denied_tools?: string[];
  max_iterations?: number | null;
  timeout_seconds?: number | null;
  /** `null` removes the agent's voice override (falls back to the base). */
  voice?: { voice?: string; speed?: number; vol?: number } | null;
}

const AGENT_LABELS: Record<RuntimeAgentKey, 'Vex' | 'Vexi'> = {
  vex: 'Vex',
  vexi: 'Vexi',
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const textOf = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const numberOf = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Effective voice of one agent from the `metadata.speech` of the TTS app:
 * base keys (`voice`, `speed`, `vol`) overridden by
 * `speech.agent_voices[agentKey]` when valid. Invalid values are ignored.
 */
export function agentVoiceFromSpeechMetadata(
  speech: unknown,
  agentKey: string,
): AgentVoice {
  if (!isRecord(speech)) return {};
  const result: AgentVoice = {};

  const voice = textOf(speech.voice);
  const speed = numberOf(speech.speed);
  const vol = numberOf(speech.vol);
  if (voice !== undefined) result.voice = voice;
  if (speed !== undefined) result.speed = speed;
  if (vol !== undefined) result.vol = vol;

  const voices = speech.agent_voices;
  const own = isRecord(voices) ? voices[agentKey] : undefined;
  if (isRecord(own)) {
    const oVoice = textOf(own.voice);
    const oSpeed = numberOf(own.speed);
    const oVol = numberOf(own.vol);
    if (oVoice !== undefined) result.voice = oVoice;
    if (oSpeed !== undefined) result.speed = oSpeed;
    if (oVol !== undefined) result.vol = oVol;
  }
  return result;
}

export function agentStatusReason(
  state: AgentStatusView['state'],
  label: string,
): string | null {
  switch (state) {
    case 'no_subscription':
      return 'La tienda no tiene una suscripción activa.';
    case 'off_by_plan':
      return `El plan de la tienda no incluye ${label}.`;
    case 'off_by_store':
      return `La tienda apagó ${label} en Ajustes → Agentes IA.`;
    default:
      return null;
  }
}

/**
 * Single read/write point for the super admin agent sheet (one screen per
 * agent) and for the "why is it off" status shown to store and super admin.
 * It reads and writes the SAME tables the rest of the engine uses.
 */
@Injectable()
export class AgentRuntimeConfigService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly audit: AuditService,
    private readonly aiEngine: AIEngineService,
    // T19 — the same effective rows the gate decides with (shadow: legacy
    // JSON; enforce: the table), so the reason shown never contradicts it.
    private readonly entitlements: AgentQuotaService,
  ) {}

  assertAgentKey(agentKey: string): asserts agentKey is RuntimeAgentKey {
    if (!(RUNTIME_AGENT_KEYS as readonly string[]).includes(agentKey)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'agentKey debe ser "vex" o "vexi".',
      );
    }
  }

  private async loadAgent(agentKey: string) {
    this.assertAgentKey(agentKey);
    const agent = await this.prisma.ai_agents.findUnique({
      where: { key: agentKey },
    });
    if (!agent) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        `Agente ${agentKey} no encontrado.`,
      );
    }
    return agent;
  }

  private async loadVoiceApp() {
    return this.prisma.ai_engine_applications.findUnique({
      where: { key: VOICE_TTS_APP_KEY },
      select: { id: true, key: true, metadata: true },
    });
  }

  async getEffectiveVoice(agentKey: RuntimeAgentKey): Promise<AgentVoice> {
    const app = await this.loadVoiceApp();
    const meta = isRecord(app?.metadata) ? app?.metadata : null;
    return agentVoiceFromSpeechMetadata(meta?.speech, agentKey);
  }

  async getAgentSheet(agentKey: string) {
    const agent = await this.loadAgent(agentKey);
    const key = agentKey as RuntimeAgentKey;

    const app = agent.app_key
      ? await this.prisma.ai_engine_applications.findUnique({
          where: { key: agent.app_key },
        })
      : null;
    const config = app?.config_id
      ? await this.prisma.ai_engine_configs.findUnique({
          where: { id: app.config_id },
        })
      : null;
    const available = await this.prisma.ai_engine_configs.findMany({
      where: { is_active: true, model_type: app?.model_type ?? 'text' },
      select: {
        id: true,
        label: true,
        provider: true,
        model_id: true,
        model_type: true,
      },
      orderBy: [{ provider: 'asc' }, { label: 'asc' }],
    });

    const voiceApp = await this.loadVoiceApp();
    const meta = isRecord(voiceApp?.metadata) ? voiceApp?.metadata : null;
    const speech = meta?.speech;
    const own = isRecord(speech) && isRecord(speech.agent_voices)
      ? speech.agent_voices[key]
      : undefined;

    return {
      agent: {
        key: agent.key,
        name: agent.name,
        description: agent.description,
        is_active: agent.is_active,
        system_prompt: agent.system_prompt,
        allowed_tools: agent.allowed_tools,
        denied_tools: agent.denied_tools,
        max_iterations: agent.max_iterations,
        timeout_seconds: agent.timeout_seconds,
      },
      application: app
        ? {
            key: app.key,
            name: app.name,
            config_id: app.config_id,
            model_type: app.model_type,
            is_active: app.is_active,
          }
        : null,
      config: config
        ? {
            id: config.id,
            label: config.label,
            provider: config.provider,
            model_id: config.model_id,
            model_type: config.model_type,
            is_active: config.is_active,
          }
        : null,
      // Duplicated knobs: shown but never read by agents.
      unused_by_agents: {
        temperature: {
          value: app?.temperature != null ? Number(app.temperature) : null,
          unused_by_agents: true as const,
        },
        max_tokens: {
          value: app?.max_tokens ?? null,
          unused_by_agents: true as const,
        },
      },
      available_configs: available,
      voice: {
        app_key: VOICE_TTS_APP_KEY,
        effective: agentVoiceFromSpeechMetadata(speech, key),
        base: agentVoiceFromSpeechMetadata(speech, '__base__'),
        has_override: isRecord(own),
      },
    };
  }

  async updateAgentSheet(
    agentKey: string,
    dto: AgentSheetUpdate,
    userId: number,
  ) {
    const agent = await this.loadAgent(agentKey);
    const key = agentKey as RuntimeAgentKey;
    const before = await this.getAgentSheet(key);

    if (dto.config_id !== undefined) {
      if (!agent.app_key) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'El agente no tiene una aplicación de IA asociada.',
        );
      }
      const config = await this.prisma.ai_engine_configs.findUnique({
        where: { id: dto.config_id },
        select: { id: true, is_active: true },
      });
      if (!config || !config.is_active) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'La configuración de modelo no existe o está inactiva.',
        );
      }
      await this.prisma.ai_engine_applications.update({
        where: { key: agent.app_key },
        data: { config_id: dto.config_id, updated_at: new Date() },
      });
    }

    const agentData: Prisma.ai_agentsUpdateInput = {};
    if (dto.system_prompt !== undefined)
      agentData.system_prompt = dto.system_prompt;
    if (dto.allowed_tools !== undefined)
      agentData.allowed_tools = dto.allowed_tools;
    if (dto.denied_tools !== undefined)
      agentData.denied_tools = dto.denied_tools;
    if (dto.max_iterations !== undefined)
      agentData.max_iterations = dto.max_iterations;
    if (dto.timeout_seconds !== undefined)
      agentData.timeout_seconds = dto.timeout_seconds;
    if (Object.keys(agentData).length > 0) {
      await this.prisma.ai_agents.update({
        where: { id: agent.id },
        data: { ...agentData, updated_at: new Date() },
      });
    }

    if (dto.voice !== undefined) {
      await this.writeVoice(key, dto.voice);
    }

    const after = await this.getAgentSheet(key);
    await this.audit.log({
      userId,
      action: AuditAction.UPDATE,
      resource: 'ai_agents',
      resourceId: agent.id,
      oldValues: before,
      newValues: after,
      metadata: { agent_key: key, source: 'agent_runtime_sheet' },
    });
    return after;
  }

  /** Merge into `metadata.speech.agent_voices[agentKey]` losing nothing else. */
  private async writeVoice(
    agentKey: RuntimeAgentKey,
    voice: NonNullable<AgentSheetUpdate['voice']> | null,
  ) {
    const app = await this.loadVoiceApp();
    if (!app) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        `La aplicación ${VOICE_TTS_APP_KEY} no existe.`,
      );
    }
    const metadata: Record<string, unknown> = isRecord(app.metadata)
      ? { ...app.metadata }
      : {};
    const speech: Record<string, unknown> = isRecord(metadata.speech)
      ? { ...metadata.speech }
      : {};
    const voices: Record<string, unknown> = isRecord(speech.agent_voices)
      ? { ...speech.agent_voices }
      : {};

    if (voice === null) {
      delete voices[agentKey];
    } else {
      const next: Record<string, unknown> = {};
      const prev = isRecord(voices[agentKey]) ? voices[agentKey] : {};
      Object.assign(next, prev);
      if (voice.voice !== undefined) next.voice = voice.voice;
      if (voice.speed !== undefined) next.speed = voice.speed;
      if (voice.vol !== undefined) next.vol = voice.vol;
      voices[agentKey] = next;
    }
    speech.agent_voices = voices;
    metadata.speech = speech;

    await this.prisma.ai_engine_applications.update({
      where: { key: VOICE_TTS_APP_KEY },
      data: {
        metadata: metadata as Prisma.InputJsonValue,
        updated_at: new Date(),
      },
    });
  }

  async previewVoice(
    agentKey: string,
    text?: string,
  ): Promise<{ audioBase64: string; contentType: string }> {
    await this.loadAgent(agentKey);
    const key = agentKey as RuntimeAgentKey;
    const sample = (text ?? '').trim() || VOICE_PREVIEW_DEFAULT_TEXT;
    if (sample.length > VOICE_PREVIEW_MAX_CHARS) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `El texto de muestra admite máximo ${VOICE_PREVIEW_MAX_CHARS} caracteres.`,
      );
    }
    const voice = await this.getEffectiveVoice(key);
    const response = await this.aiEngine.runSpeech(
      VOICE_TTS_APP_KEY,
      { text: sample },
      {
        voice: voice.voice,
        responseFormat: 'mp3',
        speed: voice.speed,
        vol: voice.vol,
      },
    );
    if (!response.success || !response.audioBase64) {
      throw new VendixHttpException(
        ErrorCodes.AI_PROVIDER_001,
        response.error ?? 'No se pudo sintetizar la muestra de voz.',
      );
    }
    return {
      audioBase64: response.audioBase64,
      contentType: response.contentType || 'audio/mpeg',
    };
  }

  async getAgentStatuses(storeId: number): Promise<AgentStatusView[]> {
    const [resolved, row] = await Promise.all([
      this.entitlements.resolveEffectiveEntitlements(storeId),
      this.prisma.store_settings.findUnique({
        where: { store_id: storeId },
        select: { settings: true },
      }),
    ]);
    const settings = isRecord(row?.settings) ? row?.settings : {};

    return RUNTIME_AGENT_KEYS.map((agentKey) => {
      const label = AGENT_LABELS[agentKey];
      const planRow = resolved.rows.find(
        (r) => r.agent_key === agentKey && r.capability_key === 'agent',
      );
      const plan_includes = planRow?.enabled === true;
      const block = (settings as Record<string, unknown>)[agentKey];
      const store_enabled = isRecord(block) && block.enabled === true;

      let state: AgentStatusView['state'];
      if (!resolved.found || !resolved.hasPlan) state = 'no_subscription';
      else if (!plan_includes) state = 'off_by_plan';
      else if (!store_enabled) state = 'off_by_store';
      else state = 'on';

      return {
        agent_key: agentKey,
        label,
        state,
        plan_includes,
        store_enabled,
        reason: agentStatusReason(state, label),
      };
    });
  }
}
