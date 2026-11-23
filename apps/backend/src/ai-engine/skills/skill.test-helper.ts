import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SkillContent,
  SkillRow,
  SkillVersionRow,
} from './skill.types';

export interface SeedSkill extends SkillContent {
  key: string;
}

/** Parses the seed migration so specs run against the exact shipped bodies. */
export function readSeedSkills(): SeedSkill[] {
  const sql = readFileSync(
    join(
      __dirname,
      '../../../prisma/migrations/20261224110000_ai_agent_skills_seed/migration.sql',
    ),
    'utf8',
  );
  const re =
    /INSERT INTO ai_agent_skills\s*\([^)]*\)\s*VALUES\s*\(\s*'([^']+)',\s*'((?:[^']|'')*)',\s*'([^']+)',\s*\$sk\$([\s\S]*?)\$sk\$,\s*ARRAY\[([^\]]*)\]/g;
  const out: SeedSkill[] = [];
  for (const m of sql.matchAll(re))
    out.push({
      key: m[1],
      title: m[2].replace(/''/g, "'"),
      module: m[3],
      body: m[4],
      candidate_tools: [...m[5].matchAll(/'([^']+)'/g)].map((t) => t[1]),
      help_article_id: null,
      video_id: null,
      agent_keys: ['vex'],
    });
  return out;
}

type Where = Record<string, any>;
function matches(row: Record<string, any>, where: Where = {}): boolean {
  return Object.entries(where).every(([field, cond]) => {
    if (field === 'OR')
      return (cond as Where[]).some((w) => matches(row, w));
    const value = row[field];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('not' in cond) return value !== cond.not;
      if ('has' in cond) return Array.isArray(value) && value.includes(cond.has);
      if ('in' in cond) return cond.in.includes(value);
    }
    return value === cond;
  });
}

/** In-memory stand-in for the two skill tables (+ transaction passthrough). */
export function fakeSkillPrisma() {
  const skills: SkillRow[] = [];
  const versions: SkillVersionRow[] = [];
  const prisma: any = {
    skills,
    versions,
    ai_agent_skills: {
      findMany: jest.fn(async ({ where }: { where?: Where } = {}) =>
        skills.filter((s) => matches(s, where)).map((s) => ({ ...s })),
      ),
      findUnique: jest.fn(async ({ where }: { where: Where }) => {
        const s = skills.find((row) => matches(row, where));
        return s ? { ...s } : null;
      }),
      findFirst: jest.fn(async ({ where }: { where: Where }) => {
        const s = skills.find((row) => matches(row, where));
        return s ? { ...s } : null;
      }),
      create: jest.fn(async ({ data }: { data: Partial<SkillRow> }) => {
        const row = {
          id: Math.max(0, ...skills.map((x) => x.id)) + 1,
          help_article_id: null,
          video_id: null,
          published_at: null,
          created_at: new Date(),
          ...data,
        } as SkillRow;
        skills.push(row);
        return { ...row };
      }),
      update: jest.fn(
        async ({ where, data }: { where: Where; data: Partial<SkillRow> }) => {
          const row = skills.find((s) => matches(s, where));
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return { ...row };
        },
      ),
    },
    ai_agent_skill_versions: {
      findMany: jest.fn(async ({ where }: { where?: Where } = {}) =>
        versions
          .filter((v) => matches(v, where))
          .map((v) => ({ ...v }))
          .sort((a, b) => b.version - a.version),
      ),
      findUnique: jest.fn(async ({ where }: { where: Where }) => {
        const key = where.skill_id_version;
        const v = versions.find(
          (row) => row.skill_id === key.skill_id && row.version === key.version,
        );
        return v ? { ...v } : null;
      }),
      create: jest.fn(async ({ data }: { data: Partial<SkillVersionRow> }) => {
        if (
          versions.some(
            (v) => v.skill_id === data.skill_id && v.version === data.version,
          )
        )
          throw new Error('unique violation (skill_id, version)');
        const row = {
          id: Math.max(0, ...versions.map((x) => x.id)) + 1,
          created_at: new Date(),
          ...data,
        } as SkillVersionRow;
        versions.push(row);
        return { ...row };
      }),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  return prisma;
}

/** Inserts a skill the way the seed migration does: published, version 1. */
export function seedPublished(prisma: any, seed: SeedSkill): SkillRow {
  const now = new Date();
  const { key, ...content } = seed;
  const skill = {
    id: prisma.skills.length + 1,
    key,
    ...content,
    status: 'published',
    version: 1,
    published_version: 1,
    created_by_user_id: null,
    updated_by_user_id: null,
    published_at: now,
    created_at: now,
    updated_at: now,
  } as SkillRow;
  prisma.skills.push(skill);
  prisma.versions.push({
    id: prisma.versions.length + 1,
    skill_id: skill.id,
    version: 1,
    ...content,
    change_note: 'Versión inicial (semilla)',
    author_user_id: null,
    created_at: now,
  } as SkillVersionRow);
  return skill;
}
