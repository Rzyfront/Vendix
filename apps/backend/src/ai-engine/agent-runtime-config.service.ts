import { Injectable } from '@nestjs/common';
import { Prisma, store_subscription_state_enum } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import { VendixHttpException, ErrorCodes } from '../common/errors';
import { AIEngineService } from './ai-engine.service';
import { AgentQuotaService } from '../domains/store/subscriptions/services/agent-quota.service';
import { subscriptionStateToGateMode } from '../domains/store/subscriptions/services/subscription-access.service';

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
  state:
    | 'on'
    | 'off_by_plan'
    | 'off_by_store'
    | 'no_subscription'
    | 'subscription_blocked';
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
  /** F8 T49 — catalog voice of this agent; `null` goes back to the fallback. */
  voice_profile_id?: number | null;
}

/** Catalog voice as the agent sheet shows it. Never carries provider secrets. */
export interface AgentVoiceProfileView {
  id: number;
  name: string;
  voice_id: string;
  language: string;
  provider: string;
  config_label: string;
  is_active: boolean;
}

const VOICE_PROFILE_SELECT = {
  id: true,
  name: true,
  voice_id: true,
  language: true,
  speed: true,
  vol: true,
  is_active: true,
  config: {
    select: {
      id: true,
      label: true,
      provider: true,
      model_id: true,
      is_active: true,
    },
  },
} satisfies Prisma.ai_voice_profilesSelect;

type VoiceProfileRow = Prisma.ai_voice_profilesGetPayload<{
  select: typeof VOICE_PROFILE_SELECT;
}>;

const toProfileView = (row: VoiceProfileRow): AgentVoiceProfileView => ({
  id: row.id,
  name: row.name,
  voice_id: row.voice_id,
  language: row.language,
  provider: row.config.provider,
  config_label: row.config.label,
  // A voice whose provider is off cannot read: the sheet must say so.
  is_active: row.is_active && row.config.is_active,
});

const positiveOf = (v: unknown): number | undefined => {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

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

/** How the status names a subscription state that blocks the agent. */
const BLOCKING_STATE_LABEL: Partial<
  Record<store_subscription_state_enum, string>
> = {
  suspended: 'suspendida',
  blocked: 'bloqueada',
  cancelled: 'cancelada',
  expired: 'vencida',
  grace_hard: 'en periodo de gracia',
};

/**
 * States without a usable subscription: the gate blocks them and the status
 * reads them as «no active subscription», like a missing record.
 */
const NO_SUBSCRIPTION_STATES: ReadonlySet<store_subscription_state_enum> =
  new Set<store_subscription_state_enum>(['draft', 'no_plan']);

export function agentStatusReason(
  state: AgentStatusView['state'],
  label: string,
  subscriptionState?: store_subscription_state_enum,
): string | null {
  switch (state) {
    case 'no_subscription':
      return 'La tienda no tiene una suscripción activa.';
    case 'subscription_blocked': {
      // The state, never a cause: a retired plan locks a store that owes
      // nothing, so the text must not say «falta de pago».
      const named =
        (subscriptionState && BLOCKING_STATE_LABEL[subscriptionState]) ??
        'inactiva';
      return `La suscripción de la tienda está ${named}; ${label} no responde hasta que vuelva a estar activa.`;
    }
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

    const [profileRow, availableProfiles] = await Promise.all([
      agent.voice_profile_id
        ? this.prisma.ai_voice_profiles.findUnique({
            where: { id: agent.voice_profile_id },
            select: VOICE_PROFILE_SELECT,
          })
        : null,
      this.prisma.ai_voice_profiles.findMany({
        where: { is_active: true, config: { is_active: true } },
        select: VOICE_PROFILE_SELECT,
        orderBy: [{ name: 'asc' }],
      }),
    ]);

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
            // With an app linked the app owns the prompt (the agent's own
            // `system_prompt` is ignored at runtime), so the sheet edits this.
            system_prompt: app.system_prompt,
          }
        : null,
      prompt_source: app ? ('application' as const) : ('agent' as const),
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
        // F8 T49 — when set and active this is THE voice; the three keys
        // above are the read-only fallback of the transition.
        profile: profileRow ? toProfileView(profileRow) : null,
      },
      available_voice_profiles: availableProfiles.map((row) => {
        const { is_active: _active, ...view } = toProfileView(row);
        return view;
      }),
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
    if (dto.system_prompt !== undefined) {
      if (agent.app_key) {
        // The linked app owns the prompt (Vex: `vex_assistant`; Vexi since
        // R1: `vexi_storefront`). An empty value never wipes the app prompt.
        if (dto.system_prompt !== null && dto.system_prompt.trim()) {
          await this.prisma.ai_engine_applications.update({
            where: { key: agent.app_key },
            data: { system_prompt: dto.system_prompt, updated_at: new Date() },
          });
        }
      } else {
        agentData.system_prompt = dto.system_prompt;
      }
    }
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

    // The sheet sends the voice on every save. Re-sending the one already
    // assigned is not a change, so it is neither validated nor written: an
    // operator must still be able to save the prompt of an agent whose voice
    // provider was turned off.
    if (
      dto.voice_profile_id !== undefined &&
      dto.voice_profile_id !== (agent.voice_profile_id ?? null)
    ) {
      if (dto.voice_profile_id !== null) {
        const profile = await this.prisma.ai_voice_profiles.findUnique({
          where: { id: dto.voice_profile_id },
          select: VOICE_PROFILE_SELECT,
        });
        if (!profile || !profile.is_active || !profile.config.is_active) {
          throw new VendixHttpException(
            ErrorCodes.SYS_VALIDATION_001,
            'La voz elegida no existe o está inactiva.',
          );
        }
      }
      // Only this agent's row: Vex and Vexi choose their voice separately.
      await this.prisma.ai_agents.update({
        where: { id: agent.id },
        data: {
          voice_profile_id: dto.voice_profile_id,
          updated_at: new Date(),
        },
      });
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
    const agent = await this.loadAgent(agentKey);
    const key = agentKey as RuntimeAgentKey;
    const sample = (text ?? '').trim() || VOICE_PREVIEW_DEFAULT_TEXT;
    if (sample.length > VOICE_PREVIEW_MAX_CHARS) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `El texto de muestra admite máximo ${VOICE_PREVIEW_MAX_CHARS} caracteres.`,
      );
    }
    const voice = await this.getEffectiveVoice(key);
    // Same precedence as the runtime (`VexiSpeechService.resolveParams`): the
    // preview must sound like the next answer will.
    const profile = agent.voice_profile_id
      ? await this.prisma.ai_voice_profiles.findUnique({
          where: { id: agent.voice_profile_id },
          select: VOICE_PROFILE_SELECT,
        })
      : null;
    const useProfile =
      !!profile && profile.is_active && profile.config.is_active;
    const response = useProfile
      ? await this.aiEngine.runSpeech(
          VOICE_TTS_APP_KEY,
          { text: sample },
          {
            model: profile.config.model_id,
            voice: profile.voice_id,
            responseFormat: 'mp3',
            speed: positiveOf(profile.speed) ?? voice.speed,
            vol: positiveOf(profile.vol) ?? voice.vol,
          },
          { configId: profile.config.id },
        )
      : await this.aiEngine.runSpeech(
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

      // Same order as the gate: the subscription state blocks before the
      // plan rows are read, with the agent's own degradation for grace_hard.
      const subscriptionBlocks =
        resolved.state !== undefined &&
        subscriptionStateToGateMode(resolved.state, {
          enabled: true,
          degradation: planRow?.on_limit ?? 'warn',
        }).mode === 'block';

      let state: AgentStatusView['state'];
      if (
        !resolved.found ||
        !resolved.hasPlan ||
        (resolved.state !== undefined &&
          NO_SUBSCRIPTION_STATES.has(resolved.state))
      ) {
        state = 'no_subscription';
      } else if (subscriptionBlocks) state = 'subscription_blocked';
      else if (!plan_includes) state = 'off_by_plan';
      else if (!store_enabled) state = 'off_by_store';
      else state = 'on';

      return {
        agent_key: agentKey,
        label,
        state,
        plan_includes,
        store_enabled,
        reason: agentStatusReason(state, label, resolved.state),
      };
    });
  }
}
