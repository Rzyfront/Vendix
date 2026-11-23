export const SKILL_PUBLISHED_EVENT = 'ai.skill.published';
export const SKILL_ARCHIVED_EVENT = 'ai.skill.archived';

export interface SkillEventPayload {
  skill_id: number;
  key: string;
  version: number;
  actor_user_id: number | null;
}
