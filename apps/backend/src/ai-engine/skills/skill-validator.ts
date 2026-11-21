import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { estimateSkillTokens } from './skill-document';
import {
  SKILL_MAX_TOKENS,
  SkillContent,
  SkillValidationIssue,
  SkillValidationResult,
} from './skill.types';

/** Same secret shapes the playbook validator rejects in published content. */
const UNSAFE_CONTENT =
  /(?:Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{16,}|-----BEGIN.*PRIVATE KEY|https?:\/\/[^\s]+(?:X-Amz-|token=))/i;

/**
 * Publication gate for skills. Mirrors the playbook validator's rules: token
 * budget, candidate tools must exist in the tool registry, no secrets, and
 * linked help article / video must exist and be published. An invalid skill
 * can be saved as a draft but never published.
 */
@Injectable()
export class SkillValidator {
  constructor(
    private readonly registry: AIToolRegistry,
    private readonly prisma: GlobalPrismaService,
  ) {}

  async validate(content: SkillContent): Promise<SkillValidationResult> {
    const issues: SkillValidationIssue[] = [];
    const add = (
      code: SkillValidationIssue['code'],
      field: string,
      message: string,
    ) => issues.push({ code, field, message });

    if (!content.title?.trim())
      add('SKILL_TITLE_REQUIRED', 'title', 'La skill necesita un título.');
    if (!content.body?.trim())
      add('SKILL_BODY_REQUIRED', 'body', 'La skill necesita un cuerpo.');
    const tokens = estimateSkillTokens(content.body ?? '');
    if (tokens > SKILL_MAX_TOKENS)
      add(
        'SKILL_TOKEN_LIMIT',
        'body',
        `El cuerpo tiene unos ${tokens} tokens; el máximo es ${SKILL_MAX_TOKENS}.`,
      );
    if (UNSAFE_CONTENT.test(`${content.title}\n${content.body}`))
      add(
        'SKILL_UNSAFE_CONTENT',
        'body',
        'El contenido incluye una credencial o un enlace firmado.',
      );
    if (!content.agent_keys?.length)
      add(
        'SKILL_AGENT_KEYS_REQUIRED',
        'agent_keys',
        'Indica al menos un agente al que aplica la skill.',
      );

    const known = new Set([
      ...this.registry.getAll().map((tool) => tool.name),
      ...Object.keys(this.registry.getAliases()),
    ]);
    for (const tool of content.candidate_tools ?? [])
      if (!known.has(tool))
        add(
          'SKILL_UNKNOWN_TOOL',
          'candidate_tools',
          `La herramienta «${tool}» no existe en el catálogo.`,
        );

    if (content.help_article_id != null) {
      const article = await this.prisma.help_articles.findUnique({
        where: { id: content.help_article_id },
        select: { status: true },
      });
      if (!article || article.status !== 'PUBLISHED')
        add(
          'SKILL_HELP_ARTICLE_INVALID',
          'help_article_id',
          'El artículo de ayuda no existe o no está publicado.',
        );
    }
    if (content.video_id != null) {
      const video = await this.prisma.videos.findUnique({
        where: { id: content.video_id },
        select: { status: true },
      });
      if (!video || video.status !== 'PUBLISHED')
        add(
          'SKILL_VIDEO_INVALID',
          'video_id',
          'El video no existe o no está publicado.',
        );
    }
    return { valid: issues.length === 0, issues, estimated_tokens: tokens };
  }
}
