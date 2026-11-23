import { createVexLearningBlockTools, toVideoBlockRef } from './vex-learning-blocks.tools';
import { vexLearningBlockKind } from './vex-learning-blocks.kinds';
import { createHelpTools } from './help.tools';
import { TOOL_DISCOVERY_QUERIES_ES } from '../tool-discovery-queries.es';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Vex shows help-center content inside the chat. Pins: (a) the block is built
 * only from the PUBLISHED row (the model never passes a URL); (b) the envelope
 * carries the panel view so the stream emits a `ui_block` frame of the right
 * kind; (c) unpublished / missing content answers a guided error and never
 * touches the block service; (d) the tools are discoverable and loaded with
 * the help tools.
 */
type Row = Record<string, any>;

const VIDEO: Row = {
  id: 17,
  title: 'Cómo crear un producto rápido en Vendix',
  slug: 'como-crear-un-producto-rapido',
  summary: 'Crea un producto en un minuto',
  video_url: 'https://www.youtube.com/watch?v=abc123',
  video_source: 'YOUTUBE',
  external_id: 'abc123',
  duration_seconds: 0,
  thumbnail_url: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
};

function build(over: { videos?: Row[]; hits?: Row[]; article?: Row | null; path?: Row | null } = {}) {
  const videos = over.videos ?? [VIDEO];
  const blocks = {
    create: jest.fn().mockImplementation(async (input: any) => ({
      id: 'blk_v1',
      version: 1,
      kind: input.kind,
      spec: input.spec,
      data: input.data,
    })),
    toUiBlock: jest.fn().mockImplementation(async (b: any) => ({
      block_id: b.id,
      kind: b.kind,
      version: b.version,
      spec: { kind: b.kind },
      data: b.data,
    })),
  };
  const knowledge = {
    search: jest.fn(async () => over.hits ?? []),
    resolvePublishedHitsForAgent: jest.fn(async (ids: { videos: number[] }) => ({
      articles: [],
      videos: videos.filter((v) => ids.videos.includes(v.id)),
      paths: [],
    })),
    findPublishedArticleForAgent: jest.fn(async () => over.article ?? null),
    findPublishedLearningPathForAgent: jest.fn(async () => over.path ?? null),
  };
  const tools = createVexLearningBlockTools({ blocks: blocks as any, knowledge: knowledge as any });
  const get = (name: string) => tools.find((t) => t.name === name) as RegisteredTool;
  const run = async (name: string, args: Row, ctx: Row = { user_id: 11, store_id: 7 }) =>
    JSON.parse(await get(name).handler!(args, ctx as any));
  return { tools, get, run, blocks, knowledge };
}

describe('vex-learning-blocks.tools · mostrar ayuda en el chat', () => {
  it('declares three public, read-only vex_* tools', () => {
    const { tools } = build();
    expect(tools.map((t) => t.name)).toEqual([
      'vex_show_help_video',
      'vex_show_help_article',
      'vex_show_learning_path',
    ]);
    for (const t of tools) {
      expect(t.access).toBe('public');
      expect(t.readOnly).toBe(true);
      expect(t.domain).toBe('vex_blocks');
      expect(TOOL_DISCOVERY_QUERIES_ES[t.name]?.length).toBeGreaterThan(0);
    }
  });

  it('vex_show_help_video by id renders a video block from the published row', async () => {
    const { run, blocks } = build();
    const out = await run('vex_show_help_video', { conversation_id: 5, video_id: 17, autoplay: true });
    expect(blocks.create).toHaveBeenCalledWith({
      conversation_id: 5,
      kind: 'video',
      spec: {},
      data: {
        video: {
          id: 17,
          title: VIDEO.title,
          slug: VIDEO.slug,
          summary: VIDEO.summary,
          video_url: VIDEO.video_url,
          video_source: 'YOUTUBE',
          external_id: 'abc123',
          duration_seconds: 0,
          thumbnail_url: VIDEO.thumbnail_url,
        },
        autoplay: true,
      },
    });
    expect(out.tool).toBe('vex_show_help_video');
    expect(out.data.block_id).toBe('blk_v1');
    expect(out.data.kind).toBe('video');
    expect(out.data.block.kind).toBe('video');
    expect(out.data.video).toEqual({ id: 17, title: VIDEO.title });
  });

  it('vex_show_help_video by query picks the best published video hit', async () => {
    const other = { ...VIDEO, id: 16, title: 'Cómo crear un producto completo' };
    const { run, knowledge, blocks } = build({
      videos: [VIDEO, other],
      hits: [
        { type: 'help_video', id: 99, score: 0.9 }, // stale/unpublished: dropped
        { type: 'help_video', id: 16, score: 0.8 },
        { type: 'help_video', id: 17, score: 0.7 },
      ],
    });
    const out = await run('vex_show_help_video', { conversation_id: 5, query: 'crear un producto' });
    expect(knowledge.search).toHaveBeenCalledWith('crear un producto', { types: ['help_video'], limit: 5 });
    expect(blocks.create.mock.calls[0][0].data.video.id).toBe(16);
    expect(out.data.video.id).toBe(16);
  });

  it('never takes a URL from the model and refuses rows without a playable URL', async () => {
    const { run, blocks } = build({ videos: [{ ...VIDEO, video_url: 'javascript:alert(1)' }] });
    const out = await run('vex_show_help_video', {
      conversation_id: 5,
      video_id: 17,
      video_url: 'https://evil.example/x',
    });
    expect(out.error).toMatch(/no tiene un enlace reproducible/);
    expect(blocks.create).not.toHaveBeenCalled();
  });

  it('guided errors without touching the block service', async () => {
    const { run, blocks } = build({ videos: [] });
    expect((await run('vex_show_help_video', { conversation_id: 5 })).error).toMatch(/video_id o query/);
    expect((await run('vex_show_help_video', { video_id: 17 })).error).toMatch(/conversation_id/);
    const missing = await run('vex_show_help_video', { conversation_id: 5, video_id: 17 });
    expect(missing.error).toMatch(/No encontré un video publicado/);
    expect(missing.next_step).toMatch(/NO inventes/);
    expect(blocks.create).not.toHaveBeenCalled();
  });

  it('a block validation failure answers an error envelope, not a throw', async () => {
    const { run, blocks } = build();
    blocks.create.mockRejectedValueOnce(new Error('Bloque video inválido: x'));
    const out = await run('vex_show_help_video', { conversation_id: 5, video_id: 17 });
    expect(out.error).toBe('Bloque video inválido: x');
  });

  it('vex_show_help_article renders the post with its linked video', async () => {
    const article = {
      id: 3, title: 'Crear producto', slug: 'crear-producto', summary: 's', content: '# Pasos',
      type: 'GUIDE', module: 'products', cover_image_url: 'not a url', video_id: 17,
    };
    const { run, blocks } = build({ article: { article, video: VIDEO } });
    const out = await run('vex_show_help_article', { conversation_id: 5, slug: 'crear-producto' });
    const data = blocks.create.mock.calls[0][0].data;
    expect(blocks.create.mock.calls[0][0].kind).toBe('help_article');
    expect(data.article).toEqual({
      id: 3, title: 'Crear producto', slug: 'crear-producto', summary: 's', content: '# Pasos',
      type: 'GUIDE', module: 'products', cover_image_url: null, video: toVideoBlockRef(VIDEO as any),
    });
    expect(out.data.has_video).toBe(true);
  });

  it('vex_show_help_article preserves stored S3 keys for cover_image_url and markdown images', async () => {
    const article = {
      id: 45,
      title: 'Cómo crear un producto',
      slug: 'como-crear-un-producto-1777651688059',
      summary: 'Guía paso a paso',
      content:
        'Paso 1\n![image](global/help-center/articles/1777651583587-step1.webp)',
      type: 'GUIDE',
      module: 'products',
      cover_image_url: 'global/help-center/articles/cover.webp',
      video_id: null,
    };
    const { run, blocks } = build({ article: { article, video: null } });
    await run('vex_show_help_article', {
      conversation_id: 5,
      id: 45,
    });
    const data = blocks.create.mock.calls[0][0].data;
    expect(data.article.cover_image_url).toBe(
      'global/help-center/articles/cover.webp',
    );
    expect(data.article.content).toBe(article.content);
  });

  it('vex_show_learning_path renders the playlist with the caller progress, skipping unpublished videos', async () => {
    const path = {
      series: {
        id: 2, title: 'Productos desde cero', slug: 'productos', summary: null,
        items: [
          { video_id: 17, article_id: 3, position: 1 },
          { video_id: 40, article_id: null, position: 2 },
        ],
      },
      videos: [VIDEO],
      articles: [{ id: 3, title: 'Crear producto', slug: 'crear-producto', summary: 's' }],
      progress: [{ video_id: 17, series_id: 2, seconds_watched: 30, completed: false }],
    };
    const { run, blocks, knowledge } = build({ path });
    const out = await run('vex_show_learning_path', { conversation_id: 5, id: 2 });
    expect(knowledge.findPublishedLearningPathForAgent).toHaveBeenCalledWith({ id: 2 }, 11);
    expect(blocks.create.mock.calls[0][0]).toEqual({
      conversation_id: 5,
      kind: 'learning_path',
      spec: {},
      data: {
        series: {
          id: 2, title: 'Productos desde cero', summary: null,
          items: [{
            position: 1,
            video: toVideoBlockRef(VIDEO as any),
            article: { id: 3, title: 'Crear producto', slug: 'crear-producto' },
            progress: { seconds_watched: 30, completed: false },
          }],
        },
      },
    });
    expect(out.data.total).toBe(1);
  });

  it('the help tools load the show-in-chat tools and tell the model to use them', () => {
    const help = createHelpTools({ knowledge: {} as any });
    const byName = new Map(help.map((t) => [t.name, t]));
    expect(byName.get('search_help')!.discovery?.dependencies).toContain('vex_show_help_video');
    expect(byName.get('get_help_article')!.discovery?.dependencies).toContain('vex_show_help_article');
    expect(byName.get('get_learning_path')!.discovery?.dependencies).toContain('vex_show_learning_path');
    expect(byName.get('search_help')!.description).toContain('vex_show_help_video');
    expect(byName.get('search_help')!.description).toContain('nunca digas que no puedes mostrar o reproducir videos');
  });

  it('maps each show tool to the block kind the stream emits (and nothing else)', () => {
    // `AIAgentService.uiBlockOf` and `AiChatService.renderBlockRefsOf` read this
    // helper, so the `ui_block` frame and the recovered refs share the kind.
    expect(vexLearningBlockKind('vex_show_help_video')).toBe('video');
    expect(vexLearningBlockKind('vex_show_help_article')).toBe('help_article');
    expect(vexLearningBlockKind('vex_show_learning_path')).toBe('learning_path');
    expect(vexLearningBlockKind('search_help')).toBeNull();
    expect(vexLearningBlockKind('constructor')).toBeNull();
  });
});
