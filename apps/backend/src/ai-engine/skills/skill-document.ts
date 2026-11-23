import { normalizeSearchText } from '../../common/utils/search-text.util';
import { catalogHash, ToolDocument } from '../tools/tool-catalog';
import { PublishedSkill, SkillContent } from './skill.types';

export const skillDocumentKey = (key: string): string => `skill:${key}`;

/** ~4 bytes per token for Spanish markdown; the budget is advisory, not billing. */
export const estimateSkillTokens = (text: string): number =>
  Math.ceil(Buffer.byteLength(text, 'utf8') / 4);

export function skillContentHash(key: string, content: SkillContent): string {
  return catalogHash({
    key,
    title: content.title,
    module: content.module,
    body: content.body,
    candidate_tools: [...content.candidate_tools].sort(),
    agent_keys: [...content.agent_keys].sort(),
  });
}

/**
 * Searchable document for a published skill. It is a `ToolDocument` so the
 * shared `KnowledgeSearchService.rank` (lexical + vector fusion) is reused
 * unchanged; `entity_type: 'skill'` selects the skill namespace.
 */
export function buildSkillDocument(skill: PublishedSkill): ToolDocument {
  const { key, version, content } = skill;
  const hash = skillContentHash(key, content);
  const text = [
    `# ${content.title}`,
    ...(content.module ? [`Módulo: ${content.module}`] : []),
    '',
    content.body,
  ].join('\n');
  const lexicalText = [
    key,
    key.replace(/-/g, ' '),
    content.title,
    content.module ?? '',
    ...content.candidate_tools.map((t) => t.replace(/_/g, ' ')),
    content.body,
  ]
    .map(
      (s) =>
        s
          .match(/.{1,500}/gs)
          ?.map(normalizeSearchText)
          .join(' ') ?? '',
    )
    .join(' ');
  return {
    key: skillDocumentKey(key),
    name: key,
    version: String(version),
    domain: content.module ?? 'general',
    hash,
    content: text,
    lexicalText,
    aliases: [content.title],
    dependencies: [],
    metadata: {
      entity_type: 'skill',
      origin: 'managed',
      skill_id: skill.skill_id,
      skill_key: key,
      title: content.title,
      module: content.module,
      version,
    },
  };
}
