import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AuditAction, AuditService } from '../../../common/audit/audit.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import {
  VOICE_PREVIEW_DEFAULT_TEXT,
  VOICE_PREVIEW_MAX_CHARS,
  VOICE_TTS_APP_KEY,
} from '../../../ai-engine/agent-runtime-config.service';
import {
  CreateAIVoiceProfileDto,
  UpdateAIVoiceProfileDto,
} from './dto/ai-voice-profile.dto';

export const AI_VOICE_PROFILE_AUDIT_RESOURCE = 'ai_voice_profiles';

/**
 * What the catalog shows of a provider config. Deliberately a closed list of
 * columns: `api_key_ref` and `settings` never leave through this module.
 */
const SPEECH_CONFIG_SELECT = {
  id: true,
  label: true,
  provider: true,
  sdk_type: true,
  model_id: true,
  is_active: true,
} satisfies Prisma.ai_engine_configsSelect;

const PROFILE_SELECT = {
  id: true,
  name: true,
  voice_id: true,
  language: true,
  speed: true,
  vol: true,
  sample_text: true,
  is_active: true,
  created_at: true,
  updated_at: true,
  config: { select: SPEECH_CONFIG_SELECT },
  agents: { select: { key: true }, orderBy: { key: 'asc' } },
} satisfies Prisma.ai_voice_profilesSelect;

type ProfileRow = Prisma.ai_voice_profilesGetPayload<{
  select: typeof PROFILE_SELECT;
}>;

export interface AIVoiceProfileView {
  id: number;
  name: string;
  voice_id: string;
  language: string;
  speed: number | null;
  vol: number | null;
  sample_text: string | null;
  is_active: boolean;
  config: {
    id: number;
    label: string;
    provider: string;
    sdk_type: string;
    model_id: string;
    is_active: boolean;
  };
  /** Keys of the agents that read with this voice, e.g. `['vex']`. */
  assigned_agents: string[];
  created_at: Date | null;
  updated_at: Date | null;
}

const numberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toView = (row: ProfileRow): AIVoiceProfileView => ({
  id: row.id,
  name: row.name,
  voice_id: row.voice_id,
  language: row.language,
  speed: numberOrNull(row.speed),
  vol: numberOrNull(row.vol),
  sample_text: row.sample_text,
  is_active: row.is_active,
  config: row.config,
  assigned_agents: row.agents.map((a) => a.key),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

/**
 * F8 T49 — the voice catalog a super admin builds: register a voice of a
 * speech provider, listen to it, turn it on or off. Assigning a voice to an
 * agent happens on the agent sheet (`AgentRuntimeConfigService`), not here.
 *
 * There is no delete: a voice is retired with `is_active = false`, and only
 * once no agent reads with it.
 */
@Injectable()
export class AIVoiceProfilesService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly audit: AuditService,
    private readonly aiEngine: AIEngineService,
  ) {}

  async list(): Promise<AIVoiceProfileView[]> {
    const rows = await this.prisma.ai_voice_profiles.findMany({
      select: PROFILE_SELECT,
      orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toView);
  }

  /** Active speech providers a voice can be registered under. */
  async listSpeechConfigs() {
    const rows = await this.prisma.ai_engine_configs.findMany({
      where: { is_active: true, model_type: 'speech' },
      select: SPEECH_CONFIG_SELECT,
      orderBy: [{ provider: 'asc' }, { label: 'asc' }],
    });
    return rows.map(({ is_active: _active, ...config }) => config);
  }

  async create(
    dto: CreateAIVoiceProfileDto,
    userId: number | null,
  ): Promise<AIVoiceProfileView> {
    const voiceId = dto.voice_id.trim();
    await this.assertSpeechConfig(dto.config_id);
    await this.assertUnique(dto.config_id, voiceId);

    const row = await this.prisma.ai_voice_profiles.create({
      data: {
        config_id: dto.config_id,
        voice_id: voiceId,
        name: dto.name.trim(),
        language: dto.language?.trim() || 'es',
        speed: dto.speed ?? null,
        vol: dto.vol ?? null,
        sample_text: dto.sample_text?.trim() || null,
        is_active: dto.is_active ?? true,
      },
      select: PROFILE_SELECT,
    });
    const view = toView(row);
    await this.audit.log({
      userId: userId ?? undefined,
      action: AuditAction.CREATE,
      resource: AI_VOICE_PROFILE_AUDIT_RESOURCE,
      resourceId: row.id,
      newValues: view,
    });
    return view;
  }

  async update(
    id: number,
    dto: UpdateAIVoiceProfileDto,
    userId: number | null,
  ): Promise<AIVoiceProfileView> {
    const before = await this.load(id);

    const configId = dto.config_id ?? before.config.id;
    const voiceId = dto.voice_id?.trim() ?? before.voice_id;
    if (dto.config_id !== undefined && dto.config_id !== before.config.id) {
      await this.assertSpeechConfig(dto.config_id);
    }
    if (configId !== before.config.id || voiceId !== before.voice_id) {
      await this.assertUnique(configId, voiceId, id);
    }
    // Turning off a voice an agent reads with would silently move that agent
    // to the fallback voice in every store. The operator reassigns first.
    if (dto.is_active === false && before.is_active && before.agents.length) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `Esta voz está asignada a ${before.agents
          .map((a) => a.key)
          .join(', ')}. Asigna otra voz a ese agente antes de desactivarla.`,
      );
    }

    const data: Prisma.ai_voice_profilesUncheckedUpdateInput = {
      updated_at: new Date(),
    };
    if (dto.config_id !== undefined) data.config_id = dto.config_id;
    if (dto.voice_id !== undefined) data.voice_id = voiceId;
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.language !== undefined) data.language = dto.language.trim();
    if (dto.speed !== undefined) data.speed = dto.speed;
    if (dto.vol !== undefined) data.vol = dto.vol;
    if (dto.sample_text !== undefined) {
      data.sample_text = dto.sample_text?.trim() || null;
    }
    if (dto.is_active !== undefined) data.is_active = dto.is_active;

    const row = await this.prisma.ai_voice_profiles.update({
      where: { id },
      data,
      select: PROFILE_SELECT,
    });
    const view = toView(row);
    await this.audit.log({
      userId: userId ?? undefined,
      action: AuditAction.UPDATE,
      resource: AI_VOICE_PROFILE_AUDIT_RESOURCE,
      resourceId: id,
      oldValues: toView(before),
      newValues: view,
    });
    return view;
  }

  /**
   * «Escuchar»: a short sample with exactly the provider, model and voice the
   * runtime would use. Works on an inactive voice too — listening is how the
   * operator decides whether to activate it.
   */
  async preview(
    id: number,
    text?: string,
  ): Promise<{ audioBase64: string; contentType: string }> {
    const profile = await this.load(id);
    const sample =
      (text ?? '').trim() || profile.sample_text || VOICE_PREVIEW_DEFAULT_TEXT;
    if (sample.length > VOICE_PREVIEW_MAX_CHARS) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `El texto de muestra admite máximo ${VOICE_PREVIEW_MAX_CHARS} caracteres.`,
      );
    }
    if (!profile.config.is_active) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El proveedor de esta voz está inactivo. Actívalo para escucharla.',
      );
    }

    const speed = numberOrNull(profile.speed);
    const vol = numberOrNull(profile.vol);
    const response = await this.aiEngine.runSpeech(
      VOICE_TTS_APP_KEY,
      { text: sample },
      {
        model: profile.config.model_id,
        voice: profile.voice_id,
        responseFormat: 'mp3',
        ...(speed !== null ? { speed } : {}),
        ...(vol !== null ? { vol } : {}),
      },
      { configId: profile.config.id },
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

  private async load(id: number): Promise<ProfileRow> {
    const row = await this.prisma.ai_voice_profiles.findUnique({
      where: { id },
      select: PROFILE_SELECT,
    });
    if (!row) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Voz no encontrada.',
      );
    }
    return row;
  }

  private async assertSpeechConfig(configId: number): Promise<void> {
    const config = await this.prisma.ai_engine_configs.findUnique({
      where: { id: configId },
      select: { id: true, is_active: true, model_type: true },
    });
    if (!config || !config.is_active || config.model_type !== 'speech') {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El proveedor elegido no existe, está inactivo o no es de voz.',
      );
    }
  }

  private async assertUnique(
    configId: number,
    voiceId: string,
    exceptId?: number,
  ): Promise<void> {
    const clash = await this.prisma.ai_voice_profiles.findFirst({
      where: {
        config_id: configId,
        voice_id: voiceId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Esa voz ya está registrada para este proveedor como «${clash.name}».`,
      );
    }
  }
}
