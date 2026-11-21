import { Injectable } from '@nestjs/common';
import { KnowledgeSearchService } from '../embeddings/knowledge-search.service';
import { catalogHash } from '../tools/tool-catalog';
import { buildSkillDocument, estimateSkillTokens } from './skill-document';
import { SkillRepository } from './skill.repository';
import { SKILL_AGENT_KEY_DEFAULT, SKILL_MAX_TOKENS } from './skill.types';

export interface SkillSearchHit {
  key: string;
  title: string;
  module: string | null;
  score: number;
}

export interface LoadedSkill {
  key: string;
  title: string;
  module: string | null;
  version: number;
  body: string;
  candidate_tools: string[];
  help_article_id: number | null;
  video_id: number | null;
  estimated_tokens: number;
  truncated: boolean;
}

/**
 * Search/load over PUBLISHED skills only. Ranking is the shared
 * `KnowledgeSearchService.rank` (lexical + vector fusion) over the published
 * version of each skill; drafts and archived skills are never candidates.
 */
@Injectable()
export class SkillSearchService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly knowledge: KnowledgeSearchService,
  ) {}

  async search(
    query: string,
    options: { limit?: number; agent_key?: string } = {},
  ): Promise<SkillSearchHit[]> {
    const agentKey = options.agent_key ?? SKILL_AGENT_KEY_DEFAULT;
    const limit = Math.min(10, Math.max(1, options.limit ?? 5));
    const published = await this.repository.listPublished({
      agent_key: agentKey,
    });
    if (!published.length || !query?.trim()) return [];
    const documents = published.map(buildSkillDocument);
    const ranking = await this.knowledge.rank(
      query,
      documents,
      catalogHash({ skills: agentKey }),
      undefined,
      'skill',
    );
    const byName = new Map(published.map((s) => [s.key, s]));
    return ranking.names
      .filter((name) => (ranking.scores?.[name] ?? 0) > 0)
      .slice(0, limit)
      .flatMap((name) => {
        const skill = byName.get(name);
        return skill
          ? [
              {
                key: skill.key,
                title: skill.content.title,
                module: skill.content.module,
                score: Math.round((ranking.scores?.[name] ?? 0) * 10000) / 10000,
              },
            ]
          : [];
      });
  }

  /** Body of the PUBLISHED version, bounded to the playbook token budget. */
  async load(key: string): Promise<LoadedSkill | null> {
    const skill = await this.repository.findPublishedByKey(key);
    if (!skill) return null;
    const lines = skill.content.body.split('\n');
    let truncated = false;
    while (
      lines.length &&
      estimateSkillTokens(lines.join('\n')) > SKILL_MAX_TOKENS
    ) {
      lines.pop();
      truncated = true;
    }
    const body = lines.join('\n');
    return {
      key: skill.key,
      title: skill.content.title,
      module: skill.content.module,
      version: skill.version,
      body,
      candidate_tools: skill.content.candidate_tools,
      help_article_id: skill.content.help_article_id,
      video_id: skill.content.video_id,
      estimated_tokens: estimateSkillTokens(body),
      truncated,
    };
  }
}
