import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AISkillsService } from './ai-skills.service';
import { SkillRepository } from '../../../ai-engine/skills/skill.repository';
import { SkillValidator } from '../../../ai-engine/skills/skill-validator';
import {
  fakeSkillPrisma,
  readSeedSkills,
  seedPublished,
} from '../../../ai-engine/skills/skill.test-helper';

function setup() {
  const prisma = fakeSkillPrisma();
  prisma.users = {
    findMany: jest.fn(async () => [
      { id: 7, first_name: 'Ana', last_name: 'Pérez' },
    ]),
  };
  prisma.help_articles = {
    findUnique: jest.fn(async ({ where }: any) =>
      where.id === 10
        ? { status: 'PUBLISHED' }
        : where.id === 11
          ? { status: 'DRAFT' }
          : null,
    ),
  };
  prisma.videos = {
    findUnique: jest.fn(async ({ where }: any) =>
      where.id === 20 ? { status: 'PUBLISHED' } : null,
    ),
  };
  const registry = {
    getAll: () => [{ name: 'close_cash_session' }, { name: 'open_cash_session' }],
    getAliases: () => ({ old_close: 'close_cash_session' }),
  };
  const repository = new SkillRepository(prisma);
  const validator = new SkillValidator(registry as any, prisma);
  const search = { search: jest.fn().mockResolvedValue([{ key: 'k', title: 't', module: null, score: 0.03 }]) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const events = { emit: jest.fn() };
  const service = new AISkillsService(
    repository,
    validator,
    search as any,
    audit as any,
    events as any,
    prisma,
  );
  return { prisma, service, audit, events, search, repository };
}

const dto = {
  key: 'guia-de-prueba',
  title: 'Guía de prueba',
  module: 'caja',
  body: '# Guía\nPaso 1.',
  candidate_tools: ['close_cash_session'],
};

describe('AISkillsService (T33)', () => {
  it('create makes a draft at version 1 with its version row and an audit row', async () => {
    const { service, prisma, audit } = setup();
    const skill = await service.create(dto, 7);
    expect(skill).toMatchObject({ status: 'draft', version: 1, published_version: null });
    expect(prisma.versions).toHaveLength(1);
    expect(prisma.versions[0]).toMatchObject({ skill_id: skill.id, version: 1, author_user_id: 7 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        action: 'CREATE',
        resource: 'ai_agent_skills',
        resourceId: skill.id,
      }),
    );
  });

  it('rejects a duplicate or malformed key', async () => {
    const { service } = setup();
    await service.create(dto, 7);
    await expect(service.create(dto, 7)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.create({ ...dto, key: 'Mala Clave' }, 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('every save creates version N+1 and earlier versions stay immutable', async () => {
    const { service, prisma } = setup();
    const skill = await service.create(dto, 7);
    const v1 = { ...prisma.versions[0] };
    const second = await service.update(skill.id, { body: 'cuerpo dos', change_note: 'segunda' }, 8);
    const third = await service.update(skill.id, { title: 'Otro título' }, 8);
    expect([second.version, third.version]).toEqual([2, 3]);
    expect(prisma.versions.map((v: any) => v.version)).toEqual([1, 2, 3]);
    expect(prisma.versions[0]).toEqual(v1); // history never rewritten
    expect(prisma.versions[1]).toMatchObject({
      body: 'cuerpo dos',
      change_note: 'segunda',
      author_user_id: 8,
      title: 'Guía de prueba',
    });
    // Omitted fields keep their current value.
    expect(third.body).toBe('cuerpo dos');
    expect(third.title).toBe('Otro título');
  });

  it('restore creates a NEW version carrying the old content and audits it', async () => {
    const { service, prisma, audit } = setup();
    const skill = await service.create(dto, 7);
    await service.update(skill.id, { body: 'cuerpo dos' }, 7);
    const restored = await service.restore(skill.id, 1, 9);
    expect(restored.version).toBe(3);
    expect(restored.body).toBe(dto.body);
    expect(prisma.versions).toHaveLength(3);
    expect(prisma.versions[2]).toMatchObject({
      version: 3,
      body: dto.body,
      author_user_id: 9,
      change_note: 'Restaurada desde la versión 1',
    });
    expect(prisma.versions[1].body).toBe('cuerpo dos'); // untouched
    expect(audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: 9,
        action: 'RESTORE',
        oldValues: { version: 2 },
        newValues: { version: 3, restored_from: 1 },
      }),
    );
    await expect(service.restore(skill.id, 99, 9)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('publish validates, sets published_version, emits the event and audits previous -> new', async () => {
    const { service, audit, events } = setup();
    const skill = await service.create(dto, 7);
    await service.update(skill.id, { body: 'cuerpo dos' }, 7);
    const published = await service.publish(skill.id, 7);
    expect(published).toMatchObject({ status: 'published', published_version: 2 });
    expect(events.emit).toHaveBeenCalledWith(
      'ai.skill.published',
      expect.objectContaining({ skill_id: skill.id, key: dto.key, version: 2 }),
    );
    expect(audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'PUBLISH',
        userId: 7,
        oldValues: { status: 'draft', published_version: null },
        newValues: { status: 'published', published_version: 2 },
      }),
    );
    // Publishing the same version again is a no-op (no second event).
    events.emit.mockClear();
    await service.publish(skill.id, 7);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('an invalid skill cannot be published (unknown tool, oversized, unpublished links, secrets)', async () => {
    const { service, events, prisma } = setup();
    const bad = await service.create(
      {
        ...dto,
        key: 'mala',
        candidate_tools: ['herramienta_inventada'],
        body: 'x'.repeat(8100),
        help_article_id: 11,
        video_id: 99,
      },
      7,
    );
    const error: any = await service.publish(bad.id, 7).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    const codes = error.getResponse().issues.map((i: any) => i.code).sort();
    expect(codes).toEqual(
      [
        'SKILL_HELP_ARTICLE_INVALID',
        'SKILL_TOKEN_LIMIT',
        'SKILL_UNKNOWN_TOOL',
        'SKILL_VIDEO_INVALID',
      ].sort(),
    );
    expect(events.emit).not.toHaveBeenCalled();
    expect(prisma.skills.find((s: any) => s.key === 'mala').status).toBe('draft');

    const secret = await service.create(
      { ...dto, key: 'secreta', body: 'usa Bearer abcdef123456 para entrar' },
      7,
    );
    await expect(service.publish(secret.id, 7)).rejects.toBeInstanceOf(BadRequestException);

    // A tool alias and published links are accepted.
    const ok = await service.create(
      { ...dto, key: 'buena', candidate_tools: ['old_close'], help_article_id: 10, video_id: 20 },
      7,
    );
    await expect(service.publish(ok.id, 7)).resolves.toMatchObject({ status: 'published' });
  });

  it('archive audits previous -> new and emits the event; already archived is a no-op', async () => {
    const { service, audit, events } = setup();
    const skill = await service.create(dto, 7);
    await service.publish(skill.id, 7);
    const archived = await service.archive(skill.id, 7);
    expect(archived.status).toBe('archived');
    expect(events.emit).toHaveBeenLastCalledWith(
      'ai.skill.archived',
      expect.objectContaining({ key: dto.key }),
    );
    expect(audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'ARCHIVE',
        oldValues: { status: 'published', published_version: 1 },
        newValues: { status: 'archived', published_version: 1 },
      }),
    );
    events.emit.mockClear();
    await service.archive(skill.id, 7);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('lists versions with author name, filters the list and diffs two versions', async () => {
    const { service, prisma } = setup();
    seedPublished(prisma, readSeedSkills()[0]);
    const skill = await service.create(dto, 7);
    await service.update(skill.id, { body: 'cuerpo dos' }, 7);
    const versions = await service.versions(skill.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0].author).toEqual({ id: 7, name: 'Ana Pérez' });

    const diff = await service.diff(skill.id, 1, 2);
    expect(diff.from.body).toBe(dto.body);
    expect(diff.to.body).toBe('cuerpo dos');
    await expect(service.diff(skill.id, 1, 9)).rejects.toBeInstanceOf(NotFoundException);

    expect((await service.list({ status: 'draft' })).map((s) => s.key)).toEqual([dto.key]);
    expect((await service.list({ module: 'caja' })).length).toBeGreaterThan(1);
  });

  it('search-test delegates to the published-only search with a larger limit', async () => {
    const { service, search } = setup();
    await expect(service.searchTest('cierre')).resolves.toEqual([
      { key: 'k', title: 't', module: null, score: 0.03 },
    ]);
    expect(search.search).toHaveBeenCalledWith('cierre', { limit: 10 });
  });

  it('unknown skill ids are 404', async () => {
    const { service } = setup();
    await expect(service.get(404)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.publish(404, 1)).rejects.toBeInstanceOf(NotFoundException);
  });
});
