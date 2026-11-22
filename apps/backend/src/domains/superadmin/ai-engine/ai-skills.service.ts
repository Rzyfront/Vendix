import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditService } from '../../../common/audit/audit.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  SkillSearchHit,
  SkillSearchService,
} from '../../../ai-engine/skills/skill-search.service';
import { SkillValidator } from '../../../ai-engine/skills/skill-validator';
import {
  SkillRepository,
  skillContentOf,
} from '../../../ai-engine/skills/skill.repository';
import {
  SKILL_ARCHIVED_EVENT,
  SKILL_PUBLISHED_EVENT,
  SkillEventPayload,
} from '../../../ai-engine/skills/skill.events';
import {
  SKILL_AGENT_KEY_DEFAULT,
  SKILL_KEY_PATTERN,
  SkillContent,
  SkillRow,
  SkillValidationResult,
  SkillVersionRow,
} from '../../../ai-engine/skills/skill.types';
import {
  AISkillQueryDto,
  CreateAISkillDto,
  UpdateAISkillDto,
} from './dto/ai-skill.dto';

export const AI_SKILL_AUDIT_RESOURCE = 'ai_agent_skills';

export interface SkillVersionView {
  version: number;
  title: string;
  module: string | null;
  body: string;
  candidate_tools: string[];
  change_note: string | null;
  author: { id: number; name: string } | null;
  created_at: Date;
}

/**
 * Superadmin administration of skills (F4 T33). Every save inserts an
 * immutable version; publish/archive emit events that the indexer consumes;
 * create/update/publish/archive/restore leave an `audit_logs` row
 * (who, when, previous -> new version).
 */
@Injectable()
export class AISkillsService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly validator: SkillValidator,
    private readonly search: SkillSearchService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly prisma: GlobalPrismaService,
  ) {}

  list(query: AISkillQueryDto): Promise<SkillRow[]> {
    return this.repository.list({
      module: query.module,
      status: query.status,
    });
  }

  async get(id: number): Promise<SkillRow> {
    return this.require(id);
  }

  async create(dto: CreateAISkillDto, userId: number | null): Promise<SkillRow> {
    if (!SKILL_KEY_PATTERN.test(dto.key))
      throw new BadRequestException({
        error_code: 'AI_SKILL_KEY_INVALID',
        message: 'La clave debe ser un slug en minúsculas (ej. cierre-de-caja).',
      });
    if (await this.repository.findByKey(dto.key))
      throw new ConflictException({
        error_code: 'AI_SKILL_KEY_DUPLICATE',
        message: `Ya existe una skill con la clave «${dto.key}».`,
      });
    const content: SkillContent = {
      title: dto.title,
      module: dto.module ?? null,
      body: dto.body,
      candidate_tools: dto.candidate_tools ?? [],
      help_article_id: dto.help_article_id ?? null,
      video_id: dto.video_id ?? null,
      agent_keys: dto.agent_keys ?? [SKILL_AGENT_KEY_DEFAULT],
    };
    const skill = await this.repository.create(
      dto.key,
      content,
      userId,
      dto.change_note ?? 'Versión inicial',
    );
    await this.record('CREATE', skill, userId, null, {
      version: skill.version,
      status: skill.status,
    });
    return skill;
  }

  /** Save = new immutable version N+1; what Vex reads changes only on publish. */
  async update(
    id: number,
    dto: UpdateAISkillDto,
    userId: number | null,
  ): Promise<SkillRow> {
    const current = await this.require(id);
    const base = skillContentOf(current);
    const content: SkillContent = {
      title: dto.title ?? base.title,
      module: dto.module !== undefined ? dto.module : base.module,
      body: dto.body ?? base.body,
      candidate_tools: dto.candidate_tools ?? base.candidate_tools,
      help_article_id:
        dto.help_article_id !== undefined
          ? dto.help_article_id
          : base.help_article_id,
      video_id: dto.video_id !== undefined ? dto.video_id : base.video_id,
      agent_keys: dto.agent_keys ?? base.agent_keys,
    };
    const saved = await this.repository.saveVersion(
      id,
      content,
      userId,
      dto.change_note ?? null,
    );
    await this.record(
      'UPDATE',
      saved,
      userId,
      { version: current.version },
      { version: saved.version },
    );
    return saved;
  }

  validate(id: number): Promise<SkillValidationResult> {
    return this.require(id).then((skill) =>
      this.validator.validate(skillContentOf(skill)),
    );
  }

  /** Publishes the latest saved version, only if it passes validation. */
  async publish(id: number, userId: number | null): Promise<SkillRow> {
    const current = await this.require(id);
    const validation = await this.validator.validate(skillContentOf(current));
    if (!validation.valid)
      throw new BadRequestException({
        error_code: 'AI_SKILL_INVALID',
        message: 'La skill no cumple las validaciones y no se puede publicar.',
        issues: validation.issues,
      });
    if (
      current.status === 'published' &&
      current.published_version === current.version
    )
      return current;
    const published = await this.repository.publish(
      id,
      current.version,
      userId,
    );
    await this.record(
      'PUBLISH',
      published,
      userId,
      {
        status: current.status,
        published_version: current.published_version,
      },
      {
        status: published.status,
        published_version: published.published_version,
      },
    );
    this.emit(SKILL_PUBLISHED_EVENT, published, userId);
    return published;
  }

  async archive(id: number, userId: number | null): Promise<SkillRow> {
    const current = await this.require(id);
    if (current.status === 'archived') return current;
    const archived = await this.repository.archive(id, userId);
    await this.record(
      'ARCHIVE',
      archived,
      userId,
      {
        status: current.status,
        published_version: current.published_version,
      },
      { status: archived.status, published_version: archived.published_version },
    );
    this.emit(SKILL_ARCHIVED_EVENT, archived, userId);
    return archived;
  }

  async versions(id: number): Promise<SkillVersionView[]> {
    await this.require(id);
    const rows = await this.repository.versions(id);
    const ids = [
      ...new Set(
        rows.flatMap((r) => (r.author_user_id ? [r.author_user_id] : [])),
      ),
    ];
    const users = ids.length
      ? await this.prisma.users.findMany({
          where: { id: { in: ids } },
          select: { id: true, first_name: true, last_name: true },
        })
      : [];
    const names = new Map(
      users.map((u) => [u.id, `${u.first_name} ${u.last_name}`.trim()]),
    );
    return rows.map((r) => ({
      version: r.version,
      title: r.title,
      module: r.module,
      body: r.body,
      candidate_tools: r.candidate_tools,
      change_note: r.change_note,
      author: r.author_user_id
        ? {
            id: r.author_user_id,
            name: names.get(r.author_user_id) ?? `Usuario ${r.author_user_id}`,
          }
        : null,
      created_at: r.created_at,
    }));
  }

  /** Both versions' content, so the UI can render the comparison. */
  async diff(
    id: number,
    from: number,
    to: number,
  ): Promise<{ from: SkillVersionRow; to: SkillVersionRow }> {
    await this.require(id);
    const [a, b] = await Promise.all([
      this.repository.version(id, from),
      this.repository.version(id, to),
    ]);
    if (!a || !b)
      throw new NotFoundException({
        error_code: 'AI_SKILL_VERSION_NOT_FOUND',
        message: 'Una de las versiones a comparar no existe.',
      });
    return { from: a, to: b };
  }

  /** Restore = NEW version carrying the old content; history is never rewritten. */
  async restore(
    id: number,
    version: number,
    userId: number | null,
  ): Promise<SkillRow> {
    const current = await this.require(id);
    const old = await this.repository.version(id, version);
    if (!old)
      throw new NotFoundException({
        error_code: 'AI_SKILL_VERSION_NOT_FOUND',
        message: `La versión ${version} no existe.`,
      });
    const restored = await this.repository.saveVersion(
      id,
      skillContentOf(old),
      userId,
      `Restaurada desde la versión ${version}`,
    );
    await this.record(
      'RESTORE',
      restored,
      userId,
      { version: current.version },
      { version: restored.version, restored_from: version },
    );
    return restored;
  }

  /** "Probar búsqueda": what Vex would find for a question (published only). */
  searchTest(query: string): Promise<SkillSearchHit[]> {
    return this.search.search(query, { limit: 10 });
  }

  private async require(id: number): Promise<SkillRow> {
    const skill = await this.repository.findById(id);
    if (!skill)
      throw new NotFoundException({
        error_code: 'AI_SKILL_NOT_FOUND',
        message: 'La skill no existe.',
      });
    return skill;
  }

  private emit(event: string, skill: SkillRow, userId: number | null): void {
    const payload: SkillEventPayload = {
      skill_id: skill.id,
      key: skill.key,
      version: skill.published_version ?? skill.version,
      actor_user_id: userId,
    };
    this.events.emit(event, payload);
  }

  private record(
    action: string,
    skill: SkillRow,
    userId: number | null,
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.log({
      userId: userId ?? undefined,
      action,
      resource: AI_SKILL_AUDIT_RESOURCE,
      resourceId: skill.id,
      oldValues: oldValues ?? undefined,
      newValues,
      metadata: { skill_key: skill.key, title: skill.title },
    });
  }
}
