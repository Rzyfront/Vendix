import { ToolCatalogIndexerService } from '../tools/tool-catalog-indexer.service';
import { KnowledgeSearchService } from '../embeddings/knowledge-search.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { fixture, context } from '../../../test/agentic/f-recipe.fixtures';
const scoped = <T>(cb: () => T) =>
  RequestContextService.runIsolated(context, cb);
const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
function setup() {
  const f = fixture();
  const raw = jest.fn(async (sql: string) =>
    sql.includes('document_key')
      ? [
          {
            id: 9,
            document_key: `recipe:${f.recipe.recipe_key}:${f.recipe.version}`,
            content_hash: f.recipe.content_hash,
            indexed_hash: f.recipe.content_hash,
            embedding_fingerprint: 'model',
          },
        ]
      : [{ id: 41 }],
  );
  const tx = { $executeRawUnsafe: jest.fn(), $queryRawUnsafe: raw };
  const prisma = {
    $transaction: jest.fn((cb) => cb(tx)),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    ai_knowledge_documents: {
      upsert: jest.fn(async ({ create }) => ({ id: 9, ...create })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const knowledge = {
    configuration: jest.fn().mockResolvedValue({ fingerprint: 'model' }),
    generate: jest.fn().mockResolvedValue({ vector, fingerprint: 'model' }),
  };
  const embeddings = { storeGlobalKnowledgeEmbedding: jest.fn() };
  const repo = {
    live: jest.fn().mockResolvedValue(f.recipe),
    approvedGlobal: jest.fn().mockResolvedValue(f.recipe),
  };
  const indexer = new ToolCatalogIndexerService(
    f.registry,
    prisma as never,
    embeddings as never,
    knowledge as never,
    {} as never,
    undefined,
    undefined,
    repo as never,
    f.quality,
  );
  return {
    ...f,
    raw,
    prisma,
    knowledge,
    embeddings,
    repo,
    indexer,
    search: new KnowledgeSearchService(prisma as never, knowledge as never),
  };
}
describe('F separate publication/index/retrieval namespaces', () => {
  beforeEach(() => {
    process.env.AI_RECIPE_REVIEW_KEY = 'ab'.repeat(32);
  });
  afterEach(() => {
    delete process.env.AI_RECIPE_REVIEW_KEY;
  });
  it('private embedding uses real positive scope, owner metadata and sanitized content; no B global docs', () =>
    scoped(async () => {
      const f = setup();
      expect(await f.indexer.indexRecipe(f.recipe)).toBe(true);
      const [sql, ...args] = f.prisma.$executeRawUnsafe.mock.calls[0];
      expect(sql).toContain("SELECT 'store'");
      expect(sql).toContain('user_id=$7');
      expect(sql).toContain("status='approved'");
      expect(args[0]).not.toMatch(/private-trace|00000000|source_trace/);
      expect(args[2]).toContain('"owner_user_id":11');
      expect(f.prisma.ai_knowledge_documents.upsert).not.toHaveBeenCalled();
    }));
  it('candidate/unapproved never embeds or writes schema', () =>
    scoped(async () => {
      const f = setup();
      f.repo.live.mockResolvedValue(null);
      expect(await f.indexer.indexRecipe(f.recipe)).toBe(false);
      expect(f.knowledge.generate).not.toHaveBeenCalled();
      expect(f.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    }));
  it('withdrawal during provider await fences private vector write', () =>
    scoped(async () => {
      const f = setup();
      f.knowledge.generate.mockImplementation(async () => {
        f.repo.live.mockResolvedValue(null);
        return { vector, fingerprint: 'model' };
      });
      expect(await f.indexer.indexRecipe(f.recipe)).toBe(false);
      expect(f.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    }));
  it('global index uses B document ID, approved-only reconstruction and zero private refs', () =>
    scoped(async () => {
      const f = setup();
      f.recipe.knowledge_scope = 'global';
      f.recipe.store_id = f.recipe.organization_id = f.recipe.user_id = null;
      f.recipe.source_trace_ids =
        f.recipe.source_objective_ids =
        f.recipe.source_evidence_refs =
        f.recipe.source_script_refs =
          [];
      // Publication signature validation is separately exercised in quality specs; this tests transport only.
      jest.spyOn(f.quality, 'publicationValid').mockReturnValue(true);
      expect(await f.indexer.indexRecipe(f.recipe)).toBe(true);
      const create =
        f.prisma.ai_knowledge_documents.upsert.mock.calls[0][0].create;
      expect(create.entity_type).toBe('recipe');
      expect(create.knowledge_scope).toBe('global');
      expect(create.store_id).toBeNull();
      expect(JSON.stringify(create)).not.toContain('private-trace');
      expect(f.embeddings.storeGlobalKnowledgeEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 9, type: 'recipe' }),
      );
    }));
  it('private retrieval SQL binds explicit owner/tenant/authorized IDs and approval/hash, never OR sentinel', () =>
    scoped(async () => {
      const f = setup();
      expect(await f.search.rankPrivateRecipes('cliente', [41])).toEqual([41]);
      for (const [sql, ...params] of f.raw.mock.calls) {
        expect(sql).toContain("r.knowledge_scope='store'");
        expect(sql).toContain("e.entity_type='recipe'");
        expect(sql).toContain("e.metadata->>'owner_user_id'=$3::text");
        expect(sql).toContain("e.metadata->>'content_hash'=r.content_hash");
        expect(sql).not.toMatch(/store_id=0| OR /);
        expect(params.slice(0, 4)).toEqual([7, 3, 11, [41]]);
      }
    }));
  it('private index unavailable falls back locally; no static ALS or unauthorized-ID expansion', async () => {
    const f = setup();
    await expect(
      f.search.rankPrivateRecipes('cliente', [41]),
    ).rejects.toThrow();
    await scoped(async () => {
      await expect(f.search.rankPrivateRecipes('cliente', [0])).rejects.toThrow(
        'RECIPE_SEARCH_IDS',
      );

      expect(await f.search.rankPrivateRecipes('cliente', [41])).toEqual([41]);
    });
  });
  it('global rank accepts only recipe docs passed by authorized service and F flag; no candidate by generic search', () =>
    scoped(async () => {
      const f = setup();

      const doc = {
        key: 'recipe:workflow:1',
        name: 'recipe:41',
        version: '1',
        domain: 'recipes',
        hash: f.recipe.content_hash,
        content: 'Crear cliente',
        lexicalText: 'cliente',
        metadata: { entity_type: 'recipe' },
        dependencies: [],
        aliases: [],
      };
      expect(
        await f.search.rank('cliente', [doc], 'owner-sig', undefined, 'recipe'),
      ).toHaveProperty('names', ['recipe:41']);

      expect(
        await f.search.rank('cliente', [doc], 'owner-sig', undefined, 'recipe'),
      ).toHaveProperty('names', ['recipe:41']);
    }));
});
