import {
  buildToolErrorEnvelope,
  buildToolSuccessEnvelope,
  RegisteredTool,
  ToolExecutionContext,
} from '../interfaces/tool.interface';
import type {
  AgentHelpVideo,
  HelpKnowledgeIndexerService,
} from '../../embeddings/help-knowledge-indexer.service';
import type { VexBlockService } from '../../../domains/store/vex/services/vex-block.service';

/**
 * Help-center slice these tools read. Published rows only: every method is a
 * `*ForAgent` read of `HelpKnowledgeIndexerService`, so a draft, archived or
 * stale index entry never reaches the chat.
 */
export type VexLearningKnowledge = Pick<
  HelpKnowledgeIndexerService,
  | 'search'
  | 'resolvePublishedHitsForAgent'
  | 'findPublishedArticleForAgent'
  | 'findPublishedLearningPathForAgent'
>;

export interface VexLearningBlockToolDeps {
  blocks: Pick<VexBlockService, 'create' | 'toUiBlock'>;
  knowledge: VexLearningKnowledge;
}

/** Same caps the block validator enforces (`vex-block.service.ts`). */
const MAX_TEXT = 500;
const MAX_TITLE = 255;
const MAX_SLUG = 280;
const MAX_ARTICLE_CONTENT = 20000;
const MAX_PATH_ITEMS = 20;

const positiveInt = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const httpUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
};

const clip = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.slice(0, max) : null;

/**
 * Block-ready video reference, built only from the published row: the model
 * never supplies a URL, so it cannot point the player at an arbitrary site.
 * Null when the row has nothing playable.
 */
export function toVideoBlockRef(v: AgentHelpVideo) {
  const video_url = httpUrl(v.video_url);
  if (!video_url || !v.title || !v.slug) return null;
  return {
    id: v.id,
    title: v.title.slice(0, MAX_TITLE),
    slug: v.slug.slice(0, MAX_SLUG),
    summary: clip(v.summary, MAX_TEXT),
    video_url,
    video_source: v.video_source,
    external_id: clip(v.external_id, 255),
    duration_seconds:
      Number.isSafeInteger(v.duration_seconds) && v.duration_seconds > 0
        ? v.duration_seconds
        : 0,
    thumbnail_url: httpUrl(v.thumbnail_url),
  };
}

/**
 * Vex shows help-center content inside the chat: the `video` block (player
 * handed to the page media dock), the `help_article` block (the post as in
 * the help center) and the `learning_path` block (ordered playlist with the
 * caller's progress). The block kinds, their validation and the panel
 * components already exist (T29/T30); these are the tools that create them.
 *
 * `readOnly` like the other `vex_*` block tools: persisting a block writes
 * only the conversation's own `ai_ui_blocks` row, no business record.
 */
export function createVexLearningBlockTools({
  blocks,
  knowledge,
}: VexLearningBlockToolDeps): RegisteredTool[] {
  const conversationIdOf = (args: Record<string, any>): number | null =>
    positiveInt(args.conversation_id);

  const fail = (tool: string, error: string, next: string) =>
    JSON.stringify(buildToolErrorEnvelope(tool, error, next));

  const notFound = (tool: string, what: string) =>
    fail(
      tool,
      `No encontré ${what} publicado en el centro de ayuda de Vendix.`,
      'Díselo a la persona con claridad y, si sirve, busca con search_help. NO inventes títulos ni enlaces.',
    );

  const needsConversation = (tool: string) =>
    fail(
      tool,
      'Falta conversation_id: no sé en qué conversación mostrar el bloque.',
      'Vuelve a llamar pasando el conversation_id del turno actual.',
    );

  async function render(
    tool: string,
    conversationId: number,
    kind: 'video' | 'help_article' | 'learning_path',
    data: Record<string, any>,
    extra: Record<string, unknown>,
  ): Promise<string> {
    try {
      const block = await blocks.create({
        conversation_id: conversationId,
        kind,
        spec: {},
        data,
      });
      return JSON.stringify(
        buildToolSuccessEnvelope(tool, {
          block_id: block.id,
          kind,
          version: block.version,
          ...extra,
          block: await blocks.toUiBlock(block),
          instruction:
            'Ya quedó en el chat: la persona lo ve y lo reproduce ahí mismo. Responde en una o dos frases citando el título exacto; no pegues enlaces ni repitas el contenido.',
        }),
      );
    } catch (error: any) {
      return fail(
        tool,
        error?.message ?? 'No pude mostrarlo en el chat.',
        'Dile a la persona el título del contenido y que lo encuentra en el centro de ayuda.',
      );
    }
  }

  async function findVideo(args: Record<string, any>): Promise<AgentHelpVideo | null> {
    const id = positiveInt(args.video_id);
    if (id) {
      const { videos } = await knowledge.resolvePublishedHitsForAgent({
        articles: [],
        videos: [id],
        paths: [],
      });
      return videos[0] ?? null;
    }
    const query = text(args.query);
    if (query.length < 2) return null;
    const hits = await knowledge.search(query, { types: ['help_video'], limit: 5 });
    const ids = hits.filter((h) => h.type === 'help_video').map((h) => h.id);
    if (!ids.length) return null;
    const { videos } = await knowledge.resolvePublishedHitsForAgent({
      articles: [],
      videos: ids,
      paths: [],
    });
    // Best hit first: search order wins, unpublished hits already dropped.
    const byId = new Map(videos.map((v) => [v.id, v]));
    return ids.map((i) => byId.get(i)).find((v): v is AgentHelpVideo => !!v) ?? null;
  }

  return [
    {
      name: 'vex_show_help_video',
      access: 'public',
      accessReason:
        "Shows a published, platform-wide help video in the caller's own Vex conversation; reads no store data.",
      version: '1',
      domain: 'vex_blocks',
      readOnly: true,
      description:
        'Muestra en el chat un video tutorial PUBLICADO del centro de ayuda de Vendix con su reproductor: la persona le da play y lo ve ahí mismo (se puede minimizar y seguir chateando). Úsala SIEMPRE que la persona pida ver, mostrar, poner o reproducir un video o tutorial, o pregunte «muéstrame cómo…» y prefiera video. Pasa video_id (de search_help o get_learning_path) o, si no lo tienes, query con lo que quiere aprender y se elige el mejor video. Nunca digas que no puedes reproducir videos: esta tool lo hace. Si no hay video publicado sobre el tema, dilo; NO inventes enlaces.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description: 'Conversación donde se muestra. Opcional: el servidor usa la actual.',
          },
          video_id: { type: 'number', description: 'ID del video (de search_help o get_learning_path).' },
          query: {
            type: 'string',
            description: 'Si no tienes video_id: lo que la persona quiere aprender, con sus palabras (ej. «crear un producto»).',
          },
          autoplay: { type: 'boolean', description: 'true si la persona pidió reproducirlo ya.' },
        },
      },
      discovery: { dependencies: ['search_help'] },
      handler: async (args) => {
        const tool = 'vex_show_help_video';
        const conversationId = conversationIdOf(args);
        if (!conversationId) return needsConversation(tool);
        if (!positiveInt(args.video_id) && text(args.query).length < 2)
          return fail(tool, 'Falta video_id o query.', 'Pasa el video_id de search_help o las palabras de la persona en query.');
        const found = await findVideo(args);
        if (!found) return notFound(tool, 'un video');
        const video = toVideoBlockRef(found);
        if (!video)
          return fail(
            tool,
            `El video «${found.title}» no tiene un enlace reproducible.`,
            'Dile a la persona el título y ofrécele el paso a paso con get_help_article o search_help.',
          );
        return render(
          tool,
          conversationId,
          'video',
          { video, ...(args.autoplay === true ? { autoplay: true } : {}) },
          { video: { id: video.id, title: video.title } },
        );
      },
    },
    {
      name: 'vex_show_help_article',
      access: 'public',
      accessReason:
        "Shows a published, platform-wide help article in the caller's own Vex conversation; reads no store data.",
      version: '1',
      domain: 'vex_blocks',
      readOnly: true,
      description:
        'Muestra en el chat un artículo PUBLICADO del centro de ayuda (el paso a paso) tal como se ve en el centro de ayuda, con su video si tiene uno. Úsala cuando la persona prefiera el paso a paso o pida ver la guía. Pasa id o slug (de search_help). No copies el contenido en tu respuesta: ya queda en el chat.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description: 'Conversación donde se muestra. Opcional: el servidor usa la actual.',
          },
          id: { type: 'number', description: 'ID del artículo (de search_help).' },
          slug: { type: 'string', description: 'Slug del artículo (alternativa al id).' },
        },
      },
      discovery: { dependencies: ['search_help'] },
      handler: async (args) => {
        const tool = 'vex_show_help_article';
        const conversationId = conversationIdOf(args);
        if (!conversationId) return needsConversation(tool);
        const id = positiveInt(args.id);
        const slug = text(args.slug);
        if (!id && !slug) return fail(tool, 'Falta id o slug.', 'Usa search_help para obtenerlos.');
        const found = await knowledge.findPublishedArticleForAgent(id ? { id } : { slug });
        if (!found) return notFound(tool, 'un artículo');
        const { article } = found;
        const content = typeof article.content === 'string' ? article.content : '';
        if (!content.trim())
          return fail(tool, `El artículo «${article.title}» no tiene contenido.`, 'Dile a la persona el título y que lo abra en el centro de ayuda.');
        const video = found.video ? toVideoBlockRef(found.video) : null;
        return render(
          tool,
          conversationId,
          'help_article',
          {
            article: {
              id: article.id,
              title: article.title.slice(0, MAX_TITLE),
              slug: article.slug.slice(0, MAX_SLUG),
              summary: clip(article.summary, MAX_TEXT),
              content: content.slice(0, MAX_ARTICLE_CONTENT),
              type: clip(article.type, 50),
              module: clip(article.module, 50),
              cover_image_url: httpUrl(article.cover_image_url),
              video,
            },
          },
          { article: { id: article.id, title: article.title }, has_video: !!video },
        );
      },
    },
    {
      name: 'vex_show_learning_path',
      access: 'public',
      accessReason:
        "Shows a published learning path in the caller's own Vex conversation; the progress shown is the caller's own.",
      version: '1',
      domain: 'vex_blocks',
      readOnly: true,
      description:
        'Muestra en el chat una ruta de aprendizaje PUBLICADA (serie de videos en orden) como lista de reproducción con el progreso de la persona; los videos se reproducen ahí mismo y avanza solo al siguiente. Pasa id o slug (de search_help o get_learning_path).',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description: 'Conversación donde se muestra. Opcional: el servidor usa la actual.',
          },
          id: { type: 'number', description: 'ID de la ruta.' },
          slug: { type: 'string', description: 'Slug de la ruta (alternativa al id).' },
        },
      },
      discovery: { dependencies: ['get_learning_path'] },
      handler: async (args, context: ToolExecutionContext) => {
        const tool = 'vex_show_learning_path';
        const conversationId = conversationIdOf(args);
        if (!conversationId) return needsConversation(tool);
        const id = positiveInt(args.id);
        const slug = text(args.slug);
        if (!id && !slug) return fail(tool, 'Falta id o slug.', 'Usa get_learning_path o search_help para obtenerlos.');
        const path = await knowledge.findPublishedLearningPathForAgent(
          id ? { id } : { slug },
          positiveInt(context?.user_id),
        );
        if (!path) return notFound(tool, 'una ruta de aprendizaje');
        const { series, videos, articles, progress } = path;
        const videoById = new Map(videos.map((v) => [v.id, v]));
        const articleById = new Map(articles.map((a) => [a.id, a]));
        const progressByVideo = new Map(progress.map((p) => [p.video_id, p]));
        const items = series.items
          .flatMap((item) => {
            const row = videoById.get(item.video_id);
            const video = row ? toVideoBlockRef(row) : null;
            if (!video) return []; // unpublished or unplayable: skipped, never invented
            const article = item.article_id ? articleById.get(item.article_id) : undefined;
            const p = progressByVideo.get(item.video_id);
            return [
              {
                position: item.position,
                video,
                article: article
                  ? { id: article.id, title: article.title.slice(0, MAX_TITLE), slug: article.slug.slice(0, MAX_SLUG) }
                  : null,
                progress: p
                  ? {
                      seconds_watched: Math.max(0, Math.floor(Number(p.seconds_watched) || 0)),
                      completed: p.completed === true,
                    }
                  : null,
              },
            ];
          })
          .slice(0, MAX_PATH_ITEMS);
        if (!items.length) return notFound(tool, 'ningún video de esa ruta');
        return render(
          tool,
          conversationId,
          'learning_path',
          {
            series: {
              id: series.id,
              title: series.title.slice(0, MAX_TITLE),
              summary: clip(series.summary, MAX_TEXT),
              items,
            },
          },
          { series: { id: series.id, title: series.title }, total: items.length },
        );
      },
    },
  ];
}
