import { AIToolRegistry } from '../ai-tool-registry';
import { createSkillTools } from './skill.tools';
import { SkillRepository } from '../../skills/skill.repository';
import { SkillSearchService } from '../../skills/skill-search.service';
import { KnowledgeSearchService } from '../../embeddings/knowledge-search.service';
import {
  fakeSkillPrisma,
  readSeedSkills,
  seedPublished,
} from '../../skills/skill.test-helper';

function setup() {
  const prisma = fakeSkillPrisma();
  readSeedSkills().forEach((s) => seedPublished(prisma, s));
  const repository = new SkillRepository(prisma);
  const knowledge = new KnowledgeSearchService(
    { $transaction: jest.fn().mockRejectedValue(new Error('no index')) } as any,
    { configuration: jest.fn().mockRejectedValue(new Error('no app')) } as any,
  );
  const search = new SkillSearchService(repository, knowledge);
  const tools = createSkillTools({
    search: (q, l) => search.search(q, { limit: l }),
    load: (k) => search.load(k),
  });
  const run = (name: string, args: Record<string, unknown>) =>
    tools.find((t) => t.name === name)!.handler!(args, {} as any);
  return { prisma, repository, tools, run };
}

describe('skill tools', () => {
  it('register in the tool registry as public read-only tools (no open tool, valid catalog entry)', () => {
    const { tools } = setup();
    const registry = new AIToolRegistry({} as any);
    expect(() => registry.registerMany(tools)).not.toThrow();
    expect(tools.map((t) => t.name)).toEqual(['search_skills', 'load_skill']);
    for (const t of tools) expect(t.readOnly).toBe(true);
  });

  it('search_skills returns key, title, module and score for published skills only', async () => {
    const { run, repository } = setup();
    await repository.create(
      'borrador',
      {
        title: 'Cierre de caja borrador',
        module: 'caja',
        body: 'cierre de caja arqueo',
        candidate_tools: [],
        help_article_id: null,
        video_id: null,
        agent_keys: ['vex'],
      },
      1,
      null,
    );
    const out = JSON.parse(await run('search_skills', { query: 'cómo cierro la caja' }));
    expect(out.results[0]).toMatchObject({
      key: 'cierre-de-caja',
      title: 'Cierre de caja',
      module: 'caja',
    });
    expect(typeof out.results[0].score).toBe('number');
    expect(out.results.map((r: any) => r.key)).not.toContain('borrador');
  });

  it('search_skills says so when nothing matches', async () => {
    const { run } = setup();
    const out = JSON.parse(await run('search_skills', { query: 'zzzz qqqq' }));
    expect(out.results).toEqual([]);
  });

  it('load_skill returns the PUBLISHED version body within the token limit', async () => {
    const { run, prisma, repository } = setup();
    const row = prisma.skills.find((s: any) => s.key === 'cierre-de-caja');
    await repository.saveVersion(row.id, { ...row, body: 'BORRADOR NUEVO' }, 1, null);
    const out = JSON.parse(await run('load_skill', { key: 'cierre-de-caja' }));
    expect(out).toMatchObject({ key: 'cierre-de-caja', version: 1, truncated: false });
    expect(out.body).toContain('Cierre de caja');
    expect(out.body).not.toContain('BORRADOR NUEVO');
    expect(out.estimated_tokens).toBeLessThanOrEqual(2000);
    expect(out.candidate_tools).toContain('close_cash_session');
  });

  it('load_skill truncates an oversized legacy body to the playbook budget', async () => {
    const { run, prisma } = setup();
    const row = prisma.skills[0];
    prisma.versions[0].body = Array.from({ length: 900 }, (_, i) => `línea ${i} con texto de relleno largo`).join('\n');
    const out = JSON.parse(await run('load_skill', { key: row.key }));
    expect(out.truncated).toBe(true);
    expect(out.estimated_tokens).toBeLessThanOrEqual(2000);
  });

  it('load_skill never serves a draft, an archived or an unknown key', async () => {
    const { run, repository, prisma } = setup();
    await repository.create(
      'solo-borrador',
      { title: 't', module: null, body: 'b', candidate_tools: [], help_article_id: null, video_id: null, agent_keys: ['vex'] },
      1,
      null,
    );
    await repository.archive(prisma.skills[0].id, 1);
    for (const key of ['solo-borrador', prisma.skills[0].key, 'no-existe']) {
      const out = JSON.parse(await run('load_skill', { key }));
      expect(out.error_code).toBe('SKILL_NOT_FOUND');
    }
  });
});
