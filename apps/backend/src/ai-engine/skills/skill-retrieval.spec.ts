import { KnowledgeSearchService } from '../embeddings/knowledge-search.service';
import { SkillIndexerService } from './skill-indexer.service';
import { SkillRepository } from './skill.repository';
import { SkillSearchService } from './skill-search.service';
import { buildSkillDocument } from './skill-document';
import {
  fakeSkillPrisma,
  readSeedSkills,
  seedPublished,
} from './skill.test-helper';

/** Process questions a store owner would type, with the skill that answers each. */
const QUESTIONS: Array<[string, string]> = [
  ['cierre-de-caja', 'cómo cierro la caja al final del turno'],
  ['cierre-de-caja', 'hago el arqueo de caja con el efectivo contado'],
  ['cierre-de-caja', 'me dio diferencia al cerrar la caja registradora'],
  ['cierre-de-caja', 'cierre de caja'],
  ['apertura-de-caja', 'cómo abro la caja registradora al empezar el día'],
  ['apertura-de-caja', 'abrir turno con la base inicial en efectivo'],
  ['apertura-de-caja', 'dice que ya hay una sesión abierta para la caja'],
  ['apertura-de-caja', 'apertura de caja'],
  ['crear-producto', 'cómo creo un producto nuevo'],
  ['crear-producto', 'dar de alta un artículo en el catálogo con su precio'],
  ['crear-producto', 'agregar un producto con código de barras y stock inicial'],
  ['crear-producto', 'quiero registrar un producto que no existe'],
  ['ajuste-de-inventario', 'cómo ajusto el inventario después de contar'],
  ['ajuste-de-inventario', 'el stock del sistema no cuadra con lo físico'],
  ['ajuste-de-inventario', 'mercancía dañada o vencida cómo la descuento'],
  ['ajuste-de-inventario', 'corregir las existencias de una bodega'],
  ['orden-de-compra', 'cómo hago una orden de compra a un proveedor'],
  ['orden-de-compra', 'recibir la mercancía que llegó del proveedor'],
  ['orden-de-compra', 'quiero pedirle mercancía a un proveedor'],
  ['orden-de-compra', 'recepción parcial de una orden de compra'],
  ['registrar-gasto', 'cómo registro un gasto'],
  ['registrar-gasto', 'anotar el pago del arriendo del local'],
  ['registrar-gasto', 'subir la factura de un gasto y extraer los datos'],
  ['registrar-gasto', 'aprobar un gasto que quedó pendiente'],
  ['crear-cliente', 'cómo creo un cliente nuevo'],
  ['crear-cliente', 'registrar un cliente con su cédula o NIT'],
  ['crear-cliente', 'cómo evito crear clientes duplicados'],
  ['crear-cliente', 'agregar un cliente con correo y teléfono'],
  ['emitir-factura-electronica', 'cómo emito una factura electrónica'],
  ['emitir-factura-electronica', 'enviar la factura a la DIAN'],
  ['emitir-factura-electronica', 'la DIAN rechazó mi factura qué hago'],
  ['emitir-factura-electronica', 'mi resolución de numeración se quedó sin saldo'],
  ['cobrar-venta-pos', 'cómo cobro una venta en el punto de venta'],
  ['cobrar-venta-pos', 'cobrar en el POS con tarjeta o efectivo'],
  ['cobrar-venta-pos', 'el cobro se bloquea por falta de stock'],
  ['cobrar-venta-pos', 'registrar el pago de una venta de mostrador'],
  ['memoria-de-la-tienda-vex', 'cómo hago que Vex recuerde una preferencia'],
  ['memoria-de-la-tienda-vex', 'borrar un recuerdo de la memoria de Vex'],
  ['memoria-de-la-tienda-vex', 'la memoria llegó a su tope'],
  ['memoria-de-la-tienda-vex', 'dónde veo lo que Vex guardó de mi tienda'],
];

function build() {
  const prisma = fakeSkillPrisma();
  const seeds = readSeedSkills();
  seeds.forEach((s) => seedPublished(prisma, s));
  const repository = new SkillRepository(prisma);
  // Lexical path: the shared ranker degrades to the local index when no
  // provider/DB index is reachable, exactly as in production without embeddings.
  const knowledge = new KnowledgeSearchService(
    {
      $transaction: jest.fn().mockRejectedValue(new Error('no index')),
    } as any,
    { configuration: jest.fn().mockRejectedValue(new Error('no app')) } as any,
  );
  const search = new SkillSearchService(repository, knowledge);
  return { prisma, repository, search, seeds };
}

describe('skill retrieval (T32)', () => {
  it('ships the seeded skills with real tools only', () => {
    const seeds = readSeedSkills();
    expect(seeds.length).toBeGreaterThanOrEqual(8);
    expect(seeds.length).toBeLessThanOrEqual(10);
    for (const s of seeds) expect(s.candidate_tools.length).toBeGreaterThan(0);
  });

  it('ranks the right skill in the top 3 for >= 90% of process questions', async () => {
    const { search, seeds } = build();
    const keys = new Set(seeds.map((s) => s.key));
    QUESTIONS.forEach(([key]) => expect(keys.has(key)).toBe(true));
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(40);
    const misses: string[] = [];
    for (const [key, question] of QUESTIONS) {
      const top = (await search.search(question, { limit: 3 })).map(
        (h) => h.key,
      );
      if (!top.includes(key)) misses.push(`${question} -> ${top.join(',')}`);
    }
    const hitRate = 1 - misses.length / QUESTIONS.length;
    if (hitRate < 0.9) console.log(misses);
    expect(hitRate).toBeGreaterThanOrEqual(0.9);
  });

  it('returns key, title, module and score', async () => {
    const { search } = build();
    const [hit] = await search.search('cómo cierro la caja');
    expect(hit).toMatchObject({
      key: 'cierre-de-caja',
      title: 'Cierre de caja',
      module: 'caja',
    });
    expect(hit.score).toBeGreaterThan(0);
  });

  it('never returns a draft, and a draft edit does not change what Vex reads', async () => {
    const { prisma, repository, search } = build();
    // A draft with text that matches strongly.
    await repository.create(
      'borrador-secreto',
      {
        title: 'Guía secreta de cierre de caja',
        module: 'caja',
        body: 'cierre de caja cierre de caja arqueo efectivo contado',
        candidate_tools: [],
        help_article_id: null,
        video_id: null,
        agent_keys: ['vex'],
      },
      7,
      null,
    );
    const hits = await search.search('cierre de caja arqueo', { limit: 10 });
    expect(hits.map((h) => h.key)).not.toContain('borrador-secreto');
    expect(await search.load('borrador-secreto')).toBeNull();

    // Editing a published skill saves version 2 but Vex still reads version 1.
    const published = prisma.skills.find((s: any) => s.key === 'cierre-de-caja');
    await repository.saveVersion(
      published.id,
      { ...published, body: 'CUERPO NUEVO SIN PUBLICAR', title: 'Cierre' },
      7,
      'edición',
    );
    const loaded = await search.load('cierre-de-caja');
    expect(loaded?.version).toBe(1);
    expect(loaded?.body).not.toContain('CUERPO NUEVO');
  });

  it('archiving removes a skill from search and load', async () => {
    const { prisma, repository, search } = build();
    const before = await search.search('cómo abro la caja registradora');
    expect(before.map((h) => h.key)).toContain('apertura-de-caja');
    const skill = prisma.skills.find((s: any) => s.key === 'apertura-de-caja');
    await repository.archive(skill.id, 7);
    const after = await search.search('cómo abro la caja registradora', {
      limit: 10,
    });
    expect(after.map((h) => h.key)).not.toContain('apertura-de-caja');
    expect(await search.load('apertura-de-caja')).toBeNull();
  });

  it('only returns skills that apply to the asking agent', async () => {
    const { prisma, search } = build();
    prisma.skills.find((s: any) => s.key === 'cierre-de-caja').agent_keys = [
      'vexi',
    ];
    const hits = await search.search('cierre de caja', { limit: 10 });
    expect(hits.map((h) => h.key)).not.toContain('cierre-de-caja');
  });

  // Moved from tools/domains/skill.tools.spec.ts: what `load_skill` serves is
  // decided here, the tool only passes it through.
  it('load returns the PUBLISHED version body within the token limit', async () => {
    const { prisma, repository, search } = build();
    const row = prisma.skills.find((s: any) => s.key === 'cierre-de-caja');
    await repository.saveVersion(row.id, { ...row, body: 'BORRADOR NUEVO' }, 1, null);
    const out = await search.load('cierre-de-caja');
    expect(out).toMatchObject({ key: 'cierre-de-caja', version: 1, truncated: false });
    expect(out?.body).toContain('Cierre de caja');
    expect(out?.body).not.toContain('BORRADOR NUEVO');
    expect(out?.estimated_tokens).toBeLessThanOrEqual(2000);
    expect(out?.candidate_tools).toContain('close_cash_session');
  });

  it('load truncates an oversized legacy body to the playbook budget', async () => {
    const { prisma, search } = build();
    const row = prisma.skills[0];
    prisma.versions[0].body = Array.from(
      { length: 900 },
      (_, i) => `línea ${i} con texto de relleno largo`,
    ).join('\n');
    const out = await search.load(row.key);
    expect(out?.truncated).toBe(true);
    expect(out?.estimated_tokens).toBeLessThanOrEqual(2000);
  });

  it('load never serves a draft, an archived or an unknown key', async () => {
    const { prisma, repository, search } = build();
    await repository.create(
      'solo-borrador',
      { title: 't', module: null, body: 'b', candidate_tools: [], help_article_id: null, video_id: null, agent_keys: ['vex'] },
      1,
      null,
    );
    await repository.archive(prisma.skills[0].id, 1);
    for (const key of ['solo-borrador', prisma.skills[0].key, 'no-existe']) {
      expect(await search.load(key)).toBeNull();
    }
  });
});

describe('skill indexer (managed documents)', () => {
  function indexer() {
    const { prisma, repository } = build();
    const docs = new Map<string, any>();
    const knowledgePrisma: any = {
      ai_knowledge_documents: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const row = docs.get(where.document_key);
          const next = row
            ? { ...row, ...update }
            : { ...create, id: docs.size + 1 };
          docs.set(where.document_key, next);
          return next;
        }),
        findUnique: jest.fn(async ({ where }: any) => docs.get(where.document_key) ?? null),
        findMany: jest.fn(async ({ where }: any) =>
          [...docs.values()].filter(
            (d) =>
              d.entity_type === where.entity_type &&
              d.release_hash === where.release_hash &&
              d.active === where.active,
          ),
        ),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const row of docs.values())
            if (
              (where.id === undefined || where.id === row.id) &&
              (where.document_key === undefined ||
                where.document_key === row.document_key) &&
              (where.content_hash === undefined ||
                where.content_hash === row.content_hash) &&
              (where.release_hash === undefined ||
                where.release_hash === row.release_hash)
            ) {
              Object.assign(row, data);
              count++;
            }
          return { count };
        }),
      },
    };
    const embeddings = { storeGlobalKnowledgeEmbedding: jest.fn() };
    const knowledge = {
      configuration: jest.fn().mockResolvedValue({ fingerprint: 'fp1' }),
    };
    const service = new SkillIndexerService(
      repository,
      knowledgePrisma,
      embeddings as any,
      knowledge as any,
    );
    return { prisma, repository, service, docs, embeddings, knowledge };
  }

  it('indexes a published skill as a managed global document with an embedding', async () => {
    const { service, docs, embeddings, prisma } = indexer();
    const skill = prisma.skills.find((s: any) => s.key === 'cierre-de-caja');
    expect(await service.indexSkill(skill.id)).toBe(true);
    expect(docs.get('skill:cierre-de-caja')).toMatchObject({
      entity_type: 'skill',
      knowledge_scope: 'global',
      store_id: null,
      organization_id: null,
      release_hash: 'managed',
      metadata: { origin: 'managed', entity_type: 'skill' },
      status: 'ready',
      active: true,
      embedding_fingerprint: 'fp1',
    });
    expect(embeddings.storeGlobalKnowledgeEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'skill', fingerprint: 'fp1' }),
    );
  });

  it('keeps the lexical document when the embedding fails', async () => {
    const { service, docs, embeddings, prisma } = indexer();
    embeddings.storeGlobalKnowledgeEmbedding.mockRejectedValue(new Error('x'));
    await service.indexSkill(prisma.skills[0].id);
    expect([...docs.values()][0]).toMatchObject({
      active: true,
      status: 'ready',
      error_code: 'KNOWLEDGE_INDEX_FAILED',
      embedding_fingerprint: null,
    });
  });

  it('retires the document on archive and never touches non-managed rows', async () => {
    const { service, docs, prisma, repository } = indexer();
    const skill = prisma.skills.find((s: any) => s.key === 'cierre-de-caja');
    await service.indexSkill(skill.id);
    docs.set('tool:x:1', {
      id: 99,
      document_key: 'tool:x:1',
      entity_type: 'tool',
      release_hash: 'abc',
      active: true,
      status: 'ready',
    });
    await repository.archive(skill.id, 1);
    await service.onArchived({
      skill_id: skill.id,
      key: skill.key,
      version: 1,
      actor_user_id: 1,
    });
    expect(docs.get('skill:cierre-de-caja')).toMatchObject({
      active: false,
      status: 'retired',
    });
    expect(docs.get('tool:x:1')).toMatchObject({ active: true });
  });

  it('boot backfill indexes new/changed published skills, skips current ones, retires unpublished', async () => {
    const { service, docs, prisma, embeddings } = indexer();
    const first = await service.backfill();
    expect(first.indexed).toBe(prisma.skills.length);
    embeddings.storeGlobalKnowledgeEmbedding.mockClear();
    expect((await service.backfill()).indexed).toBe(0);
    expect(embeddings.storeGlobalKnowledgeEmbedding).not.toHaveBeenCalled();

    // Content hash changes (a new published version) -> reindexed.
    const skill = prisma.skills.find((s: any) => s.key === 'crear-cliente');
    prisma.versions.push({
      ...prisma.versions.find((v: any) => v.skill_id === skill.id),
      id: 500,
      version: 2,
      body: 'cuerpo nuevo publicado',
    });
    skill.version = 2;
    skill.published_version = 2;
    expect((await service.backfill()).indexed).toBe(1);
    expect(docs.get('skill:crear-cliente').content).toContain('cuerpo nuevo');

    // Unpublished (archived) skill -> its document is retired.
    skill.status = 'archived';
    expect((await service.backfill()).retired).toBe(1);
    expect(docs.get('skill:crear-cliente').active).toBe(false);
  });

  it('document hash is stable per content and changes with the body', () => {
    const [seed] = readSeedSkills();
    const a = buildSkillDocument({
      skill_id: 1,
      key: seed.key,
      version: 1,
      content: seed,
    });
    const b = buildSkillDocument({
      skill_id: 1,
      key: seed.key,
      version: 1,
      content: { ...seed },
    });
    const c = buildSkillDocument({
      skill_id: 1,
      key: seed.key,
      version: 2,
      content: { ...seed, body: `${seed.body}\nmás` },
    });
    expect(a.hash).toBe(b.hash);
    expect(c.hash).not.toBe(a.hash);
    expect(a.key).toBe(`skill:${seed.key}`);
  });
});
