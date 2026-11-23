// --- AI Skills (Vex Plus F4 T33): guías de Vex editables sin deploy ---

export type AISkillStatus = 'draft' | 'published' | 'archived';

export const AI_SKILL_STATUS_LABELS: Record<AISkillStatus, string> = {
  draft: 'Borrador',
  published: 'Publicada',
  archived: 'Archivada',
};

export interface AISkill {
  id: number;
  key: string;
  title: string;
  module: string | null;
  body: string;
  candidate_tools: string[];
  help_article_id: number | null;
  video_id: number | null;
  agent_keys: string[];
  status: AISkillStatus;
  /** Latest saved version. */
  version: number;
  /** Version currently published (null = never published). */
  published_version: number | null;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
  versions?: AISkillVersion[];
}

export interface AISkillVersion {
  version: number;
  title: string;
  module?: string | null;
  body: string;
  candidate_tools?: string[];
  change_note: string | null;
  author: { id: number; name: string } | null;
  created_at: string;
}

export interface AISkillQueryDto {
  module?: string;
  status?: AISkillStatus | '';
}

export interface AISkillWriteDto {
  key?: string;
  title: string;
  module: string | null;
  body: string;
  candidate_tools: string[];
  help_article_id: number | null;
  video_id: number | null;
  agent_keys: string[];
  change_note: string | null;
}

export interface AISkillSearchResult {
  key: string;
  title: string;
  module: string | null;
  score: number;
}
