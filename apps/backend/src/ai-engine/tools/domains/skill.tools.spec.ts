import { AIToolRegistry } from '../ai-tool-registry';
import { createSkillTools, SkillToolsDeps } from './skill.tools';
import type { LoadedSkill, SkillSearchHit } from '../../skills/skill-search.service';

/**
 * The tools only see `SkillSearchService`. What it serves (published version
 * only, token budget, drafts/archived/unknown keys never served) is pinned in
 * `skills/skill-retrieval.spec.ts`; here the tools must pass it through as is.
 */
const CIERRE: LoadedSkill = {
  key: 'cierre-de-caja',
  title: 'Cierre de caja',
  module: 'caja',
  version: 1,
  body: '# Cierre de caja\n1. Cuenta el efectivo.',
  candidate_tools: ['close_cash_session'],
  help_article_id: null,
  video_id: null,
  estimated_tokens: 12,
  truncated: false,
};

function setup(results: SkillSearchHit[] = [{ key: 'cierre-de-caja', title: 'Cierre de caja', module: 'caja', score: 0.42 }]) {
  const skills = {
    search: jest.fn(async (): Promise<SkillSearchHit[]> => results),
    load: jest.fn(async (key: string): Promise<LoadedSkill | null> => (key === CIERRE.key ? CIERRE : null)),
  };
  const tools = createSkillTools({ skills: skills as unknown as SkillToolsDeps['skills'] });
  const run = (name: string, args: Record<string, unknown>) =>
    tools.find((t) => t.name === name)!.handler!(args, {} as never);
  return { skills, tools, run };
}

describe('skill tools', () => {
  it('register in the tool registry as public read-only tools (no open tool, valid catalog entry)', () => {
    const { tools } = setup();
    const registry = new AIToolRegistry({} as never);
    expect(() => registry.registerMany(tools)).not.toThrow();
    expect(tools.map((t) => t.name)).toEqual(['search_skills', 'load_skill']);
    for (const t of tools) expect(t.readOnly).toBe(true);
  });

  it('search_skills returns key, title, module and score from the published-only search', async () => {
    const { run, skills } = setup();
    const out = JSON.parse(await run('search_skills', { query: 'cómo cierro la caja', limit: 3 }));
    expect(out.results[0]).toMatchObject({
      key: 'cierre-de-caja',
      title: 'Cierre de caja',
      module: 'caja',
    });
    expect(typeof out.results[0].score).toBe('number');
    expect(out.next_step).toMatch(/load_skill/);
    expect(skills.search).toHaveBeenCalledWith('cómo cierro la caja', { limit: 3 });
  });

  it('search_skills says so when nothing matches', async () => {
    const { run } = setup([]);
    const out = JSON.parse(await run('search_skills', { query: 'zzzz qqqq' }));
    expect(out.results).toEqual([]);
    expect(out.next_step).toMatch(/No hay una guía publicada/);
  });

  it('load_skill returns the published version the service serves, as is', async () => {
    const { run, skills } = setup();
    const out = JSON.parse(await run('load_skill', { key: 'cierre-de-caja' }));
    expect(out).toEqual(CIERRE);
    expect(skills.load).toHaveBeenCalledWith('cierre-de-caja');
  });

  it('load_skill answers SKILL_NOT_FOUND when the service serves nothing', async () => {
    const { run } = setup();
    for (const key of ['solo-borrador', 'no-existe']) {
      const out = JSON.parse(await run('load_skill', { key }));
      expect(out.error_code).toBe('SKILL_NOT_FOUND');
      expect(out.next_step).toMatch(/search_skills/);
    }
  });
});
