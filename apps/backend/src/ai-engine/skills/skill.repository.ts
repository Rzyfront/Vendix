import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  PublishedSkill,
  SkillContent,
  SkillRow,
  SkillStatus,
  SkillVersionRow,
} from './skill.types';

export interface SkillListFilter {
  module?: string;
  status?: SkillStatus;
}

const contentOf = (row: SkillContent): SkillContent => ({
  title: row.title,
  module: row.module ?? null,
  body: row.body,
  candidate_tools: row.candidate_tools ?? [],
  help_article_id: row.help_article_id ?? null,
  video_id: row.video_id ?? null,
  agent_keys: row.agent_keys ?? [],
});

/**
 * Persistence of skills. Versions are insert-only: every save inserts a new
 * `ai_agent_skill_versions` row inside the same transaction that moves the
 * skill's current content; nothing here updates or deletes a version row.
 */
@Injectable()
export class SkillRepository {
  constructor(private readonly prisma: GlobalPrismaService) {}

  list(filter: SkillListFilter = {}): Promise<SkillRow[]> {
    return this.prisma.ai_agent_skills.findMany({
      where: {
        ...(filter.module ? { module: filter.module } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ module: 'asc' }, { title: 'asc' }],
    }) as Promise<SkillRow[]>;
  }

  findById(id: number): Promise<SkillRow | null> {
    return this.prisma.ai_agent_skills.findUnique({
      where: { id },
    }) as Promise<SkillRow | null>;
  }

  findByKey(key: string): Promise<SkillRow | null> {
    return this.prisma.ai_agent_skills.findUnique({
      where: { key },
    }) as Promise<SkillRow | null>;
  }

  versions(skillId: number): Promise<SkillVersionRow[]> {
    return this.prisma.ai_agent_skill_versions.findMany({
      where: { skill_id: skillId },
      orderBy: { version: 'desc' },
    }) as Promise<SkillVersionRow[]>;
  }

  version(skillId: number, version: number): Promise<SkillVersionRow | null> {
    return this.prisma.ai_agent_skill_versions.findUnique({
      where: { skill_id_version: { skill_id: skillId, version } },
    }) as Promise<SkillVersionRow | null>;
  }

  /** New skill: draft, version 1 (skill row and its first version row together). */
  create(
    key: string,
    input: SkillContent,
    authorId: number | null,
    changeNote: string | null,
  ): Promise<SkillRow> {
    const content = contentOf(input); // only editable fields ever reach the row
    return this.prisma.$transaction(async (tx: any) => {
      const skill = (await tx.ai_agent_skills.create({
        data: {
          key,
          ...content,
          status: 'draft',
          version: 1,
          published_version: null,
          created_by_user_id: authorId,
          updated_by_user_id: authorId,
          updated_at: new Date(),
        },
      })) as SkillRow;
      await tx.ai_agent_skill_versions.create({
        data: {
          skill_id: skill.id,
          version: 1,
          ...content,
          change_note: changeNote,
          author_user_id: authorId,
        },
      });
      return skill;
    });
  }

  /**
   * Save = insert version N+1 and move the skill's latest content to it.
   * The published version (and therefore what Vex reads) is untouched until
   * `publish`.
   */
  saveVersion(
    id: number,
    input: SkillContent,
    authorId: number | null,
    changeNote: string | null,
  ): Promise<SkillRow> {
    const content = contentOf(input); // only editable fields ever reach the row
    return this.prisma.$transaction(async (tx: any) => {
      const current = (await tx.ai_agent_skills.findUnique({
        where: { id },
      })) as SkillRow | null;
      if (!current) throw new Error('SKILL_NOT_FOUND');
      const next = current.version + 1;
      await tx.ai_agent_skill_versions.create({
        data: {
          skill_id: id,
          version: next,
          ...content,
          change_note: changeNote,
          author_user_id: authorId,
        },
      });
      return (await tx.ai_agent_skills.update({
        where: { id },
        data: {
          ...content,
          version: next,
          updated_by_user_id: authorId,
          updated_at: new Date(),
        },
      })) as SkillRow;
    });
  }

  /** Publish the latest saved version. */
  publish(id: number, version: number, authorId: number | null): Promise<SkillRow> {
    return this.prisma.ai_agent_skills.update({
      where: { id },
      data: {
        status: 'published',
        published_version: version,
        published_at: new Date(),
        updated_by_user_id: authorId,
        updated_at: new Date(),
      },
    }) as Promise<SkillRow>;
  }

  archive(id: number, authorId: number | null): Promise<SkillRow> {
    return this.prisma.ai_agent_skills.update({
      where: { id },
      data: {
        status: 'archived',
        updated_by_user_id: authorId,
        updated_at: new Date(),
      },
    }) as Promise<SkillRow>;
  }

  /** Published skills resolved to the content of their published version. */
  async listPublished(
    filter: { agent_key?: string } = {},
  ): Promise<PublishedSkill[]> {
    const skills = (await this.prisma.ai_agent_skills.findMany({
      where: {
        status: 'published',
        published_version: { not: null },
        ...(filter.agent_key
          ? { agent_keys: { has: filter.agent_key } }
          : {}),
      },
      orderBy: { key: 'asc' },
    })) as SkillRow[];
    return this.resolvePublished(skills);
  }

  async findPublishedByKey(key: string): Promise<PublishedSkill | null> {
    const skill = (await this.prisma.ai_agent_skills.findFirst({
      where: { key, status: 'published', published_version: { not: null } },
    })) as SkillRow | null;
    return skill ? ((await this.resolvePublished([skill]))[0] ?? null) : null;
  }

  async findPublishedById(id: number): Promise<PublishedSkill | null> {
    const skill = (await this.prisma.ai_agent_skills.findFirst({
      where: { id, status: 'published', published_version: { not: null } },
    })) as SkillRow | null;
    return skill ? ((await this.resolvePublished([skill]))[0] ?? null) : null;
  }

  private async resolvePublished(skills: SkillRow[]): Promise<PublishedSkill[]> {
    if (!skills.length) return [];
    const rows = (await this.prisma.ai_agent_skill_versions.findMany({
      where: {
        OR: skills.map((s) => ({
          skill_id: s.id,
          version: s.published_version as number,
        })),
      },
    })) as SkillVersionRow[];
    const byKey = new Map(rows.map((r) => [`${r.skill_id}:${r.version}`, r]));
    return skills.flatMap((s) => {
      const row = byKey.get(`${s.id}:${s.published_version}`);
      return row
        ? [
            {
              skill_id: s.id,
              key: s.key,
              version: row.version,
              content: contentOf(row),
            },
          ]
        : [];
    });
  }
}

export { contentOf as skillContentOf };
