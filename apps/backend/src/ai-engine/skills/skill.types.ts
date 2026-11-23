export type SkillStatus = 'draft' | 'published' | 'archived';

export const SKILL_STATUSES: readonly SkillStatus[] = [
  'draft',
  'published',
  'archived',
];

/** Editable content of a skill; exactly what one immutable version stores. */
export interface SkillContent {
  title: string;
  module: string | null;
  body: string;
  candidate_tools: string[];
  help_article_id: number | null;
  video_id: number | null;
  agent_keys: string[];
}

export interface SkillRow extends SkillContent {
  id: number;
  key: string;
  status: SkillStatus;
  /** Latest saved version. */
  version: number;
  /** Version Vex currently reads (null = never published). */
  published_version: number | null;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SkillVersionRow extends SkillContent {
  id: number;
  skill_id: number;
  version: number;
  change_note: string | null;
  author_user_id: number | null;
  created_at: Date;
}

/** A published skill resolved to the content of its published version. */
export interface PublishedSkill {
  skill_id: number;
  key: string;
  version: number;
  content: SkillContent;
}

export interface SkillValidationIssue {
  code:
    | 'SKILL_TITLE_REQUIRED'
    | 'SKILL_BODY_REQUIRED'
    | 'SKILL_TOKEN_LIMIT'
    | 'SKILL_UNKNOWN_TOOL'
    | 'SKILL_UNSAFE_CONTENT'
    | 'SKILL_AGENT_KEYS_REQUIRED'
    | 'SKILL_HELP_ARTICLE_INVALID'
    | 'SKILL_VIDEO_INVALID';
  field: string;
  message: string;
}

export interface SkillValidationResult {
  valid: boolean;
  issues: SkillValidationIssue[];
  estimated_tokens: number;
}

export const SKILL_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Same budget `load_playbook` gives a process (INITIAL_TOKENS). */
export const SKILL_MAX_TOKENS = 2000;
export const SKILL_AGENT_KEY_DEFAULT = 'vex';
/** Managed rows: release-owned indexers must never retire or overwrite them. */
export const MANAGED_RELEASE_HASH = 'managed';
