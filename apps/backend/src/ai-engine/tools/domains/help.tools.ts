import { RegisteredTool, ToolExecutionContext } from '../interfaces/tool.interface';
import {
  AgentHelpVideo,
  HelpKnowledgeIndexerService,
  HelpKnowledgeType,
  HelpSearchHit,
} from '../../embeddings/help-knowledge-indexer.service';
import {
  LEARNING_FORMAT_DELIVERY_TEXT,
  LEARNING_FORMAT_KEY,
  LEARNING_FORMAT_VALUES_TEXT,
} from '../../memory/learning-format';

/**
 * Agent-facing slice of the help knowledge service. These tools never read the
 * database themselves: search, published-only rows and the caller's own
 * learning progress all come from its `*ForAgent` methods.
 */
export type HelpKnowledgeForAgent = Pick<
  HelpKnowledgeIndexerService,
  | 'search'
  | 'resolvePublishedHitsForAgent'
  | 'findPublishedArticleForAgent'
  | 'listPublishedLearningPathsForAgent'
  | 'findPublishedLearningPathForAgent'
  | 'saveLearningProgressForAgent'
>;

export interface HelpToolDeps {
  knowledge: HelpKnowledgeForAgent;
}

const MAX_CONTENT_CHARS = 8000;

const LEARNING_FORMAT_RULE = `Si la persona quiere aprender algo y la memoria de la tienda NO tiene \`${LEARNING_FORMAT_KEY}\`, pregúntale «¿Video o paso a paso?» y, con su respuesta, llama a \`remember\` con key \`${LEARNING_FORMAT_KEY}\`: ${LEARNING_FORMAT_VALUES_TEXT}. Si ya existe \`${LEARNING_FORMAT_KEY}\`, úsalo sin preguntar: ${LEARNING_FORMAT_DELIVERY_TEXT}. Cita siempre el título devuelto.`;

const json = (value: unknown) => JSON.stringify(value);
const guidedError = (error: string, next_step?: string) =>
  json({ error, ...(next_step ? { next_step } : {}) });

const positiveInt = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const videoRef = (v: AgentHelpVideo) => ({
  id: v.id, title: v.title, slug: v.slug, summary: v.summary,
  video_url: v.video_url ?? null, video_source: v.video_source ?? null,
  external_id: v.external_id ?? null, duration_seconds: v.duration_seconds ?? 0,
  thumbnail_url: v.thumbnail_url ?? null,
});

const NOT_FOUND =
  'No encontré nada publicado en el centro de ayuda de Vendix sobre eso. Díselo a la persona con claridad: no tengo un artículo ni un video sobre ese tema. NO inventes pasos, títulos ni enlaces.';

export function createHelpTools(deps: HelpToolDeps): RegisteredTool[] {
  const { knowledge } = deps;

  async function resolveHits(hits: HelpSearchHit[]) {
    const ids = (type: HelpKnowledgeType) =>
      hits.filter((h) => h.type === type).map((h) => h.id);
    const { articles, videos, paths } = await knowledge.resolvePublishedHitsForAgent({
      articles: ids('help_article'),
      videos: ids('help_video'),
      paths: ids('learning_path'),
    });
    const rows: Record<HelpKnowledgeType, Map<number, { id: number; title: string; slug: string; summary?: string | null }>> = {
      help_article: new Map(articles.map((r) => [r.id, r])),
      help_video: new Map(videos.map((r) => [r.id, r])),
      learning_path: new Map(paths.map((r) => [r.id, r])),
    };
    const typeName = { help_article: 'article', help_video: 'video', learning_path: 'learning_path' } as const;
    // Only rows that still exist and are published: a stale index entry never reaches the model.
    return hits.flatMap((hit) => {
      const row = rows[hit.type].get(hit.id);
      return row
        ? [{ type: typeName[hit.type], id: row.id, title: row.title, slug: row.slug, summary: row.summary ?? '', score: hit.score }]
        : [];
    });
  }

  return [
    {
      name: 'search_help',
      access: 'public',
      accessReason: 'Searches the published, platform-wide help center; no store data.',
      version: '1',
      domain: 'help',
      readOnly: true,
      description: `Busca en el centro de ayuda de Vendix (artículos, videos y rutas de aprendizaje publicados) para responder «cómo hago X». Devuelve solo contenido real: type (article|video|learning_path), id, title, slug, summary y score. Si no hay resultados responde found=false: dile a la persona que no encontraste nada, NUNCA inventes un artículo o video. ${LEARNING_FORMAT_RULE}`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Lo que la persona quiere aprender, con sus palabras.' },
          type: { type: 'string', enum: ['article', 'video', 'learning_path'], description: 'Opcional: limita el tipo de resultado.' },
          limit: { type: 'number', description: 'Máximo de resultados (1-10, por defecto 5).' },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (query.length < 2) return guidedError('query es obligatorio.', 'Pasa las palabras de la persona.');
        const typeMap: Record<string, HelpKnowledgeType> = {
          article: 'help_article', video: 'help_video', learning_path: 'learning_path',
        };
        const only = typeof args.type === 'string' ? typeMap[args.type] : undefined;
        const limit = Math.min(positiveInt(args.limit) ?? 5, 10);
        const hits = await knowledge.search(query, { types: only ? [only] : undefined, limit });
        const items = await resolveHits(hits);
        if (!items.length) return json({ found: false, items: [], message: NOT_FOUND });
        return json({
          found: true,
          items,
          instruction: `Cita el título exacto de lo que recomiendes. ${LEARNING_FORMAT_RULE}`,
        });
      },
    },
    {
      name: 'get_help_article',
      access: 'public',
      accessReason: 'Reads a published help article, platform-wide content.',
      version: '1',
      domain: 'help',
      readOnly: true,
      description: `Trae un artículo PUBLICADO del centro de ayuda (por id o slug) con su contenido markdown y el video enlazado si lo tiene. Un borrador o archivado se responde como no encontrado. ${LEARNING_FORMAT_RULE}`,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'ID del artículo (de search_help).' },
          slug: { type: 'string', description: 'Slug del artículo (alternativa al id).' },
        },
      },
      handler: async (args) => {
        const id = positiveInt(args.id);
        const slug = typeof args.slug === 'string' ? args.slug.trim() : '';
        if (!id && !slug) return guidedError('Falta id o slug.', 'Usa search_help para obtenerlos.');
        const found = await knowledge.findPublishedArticleForAgent(id ? { id } : { slug });
        if (!found) return json({ found: false, message: NOT_FOUND });
        const { article, video } = found;
        const content = article.content ?? '';
        return json({
          found: true,
          article: {
            id: article.id, title: article.title, slug: article.slug, summary: article.summary,
            type: article.type ?? null, module: article.module ?? null,
            cover_image_url: article.cover_image_url ?? null,
            content: content.slice(0, MAX_CONTENT_CHARS),
            content_truncated: content.length > MAX_CONTENT_CHARS,
          },
          video: video ? videoRef(video) : null,
          instruction: 'Cita el título del artículo; si hay video enlazado, ofrécelo.',
        });
      },
    },
    {
      name: 'get_learning_path',
      access: 'public',
      accessReason: 'Published learning paths are platform-wide; progress is the caller\'s own.',
      version: '1',
      domain: 'help',
      readOnly: true,
      description:
        'Devuelve una ruta de aprendizaje PUBLICADA (serie de videos ordenada por id o slug) con el progreso del usuario actual en cada video y el siguiente video por ver. Sin id ni slug lista las rutas publicadas. Cita el título de la ruta.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'ID de la ruta (de search_help).' },
          slug: { type: 'string', description: 'Slug de la ruta (alternativa al id).' },
        },
      },
      handler: async (args, context: ToolExecutionContext) => {
        const id = positiveInt(args.id);
        const slug = typeof args.slug === 'string' ? args.slug.trim() : '';
        if (!id && !slug) {
          const paths = await knowledge.listPublishedLearningPathsForAgent();
          return paths.length
            ? json({ found: true, paths })
            : json({ found: false, paths: [], message: NOT_FOUND });
        }
        const userId = positiveInt(context?.user_id);
        const path = await knowledge.findPublishedLearningPathForAgent(id ? { id } : { slug }, userId);
        if (!path) return json({ found: false, message: NOT_FOUND });
        const { series, videos, articles, progress } = path;
        const videoById = new Map(videos.map((v) => [v.id, v]));
        const articleById = new Map(articles.map((a) => [a.id, a]));
        const progressByVideo = new Map(progress.map((p) => [p.video_id, p]));
        const steps = series.items.flatMap((item) => {
          const video = videoById.get(item.video_id);
          if (!video) return []; // unpublished videos are skipped, never invented
          const p = progressByVideo.get(item.video_id);
          const article = item.article_id ? articleById.get(item.article_id) : undefined;
          return [{
            position: item.position,
            video: videoRef(video),
            article: article ? { id: article.id, title: article.title, slug: article.slug, summary: article.summary } : null,
            progress: p ? { seconds_watched: p.seconds_watched, completed: p.completed } : null,
          }];
        });
        const next = steps.find((s) => !s.progress?.completed);
        return json({
          found: true,
          series: { id: series.id, title: series.title, slug: series.slug, summary: series.summary ?? '', items: steps },
          completed_count: steps.filter((s) => s.progress?.completed).length,
          total: steps.length,
          next_video_id: next ? next.video.id : null,
        });
      },
    },
    {
      name: 'mark_learning_progress',
      access: 'public',
      accessReason: "Writes only the caller's own learning progress; no business data.",
      version: '1',
      domain: 'help',
      description:
        'Guarda el avance del usuario actual en un video del centro de ayuda (segundos vistos y si lo completó). Es un registro personal de bajo riesgo: no pide confirmación. Úsalo cuando la persona diga que ya vio o terminó un video.',
      parameters: {
        type: 'object',
        properties: {
          video_id: { type: 'number', description: 'ID del video.' },
          series_id: { type: 'number', description: 'ID de la ruta a la que pertenece (opcional).' },
          seconds_watched: { type: 'number', description: 'Segundos vistos (opcional).' },
          completed: { type: 'boolean', description: 'true si terminó el video.' },
        },
        required: ['video_id'],
      },
      handler: async (args, context: ToolExecutionContext) => {
        const userId = positiveInt(context?.user_id);
        if (!userId) return guidedError('Sin usuario en contexto: el avance es personal.');
        const videoId = positiveInt(args.video_id);
        if (!videoId) return guidedError('video_id inválido.', 'Obtén el id con search_help o get_learning_path.');
        const seriesId = positiveInt(args.series_id);
        const seconds = Number.isFinite(Number(args.seconds_watched)) ? Math.max(0, Math.floor(Number(args.seconds_watched))) : undefined;
        const completed = typeof args.completed === 'boolean' ? args.completed : undefined;
        const saved = await knowledge.saveLearningProgressForAgent(userId, {
          video_id: videoId, series_id: seriesId, seconds_watched: seconds, completed,
        });
        if (!saved) return json({ found: false, message: NOT_FOUND });
        return json({
          saved: true,
          video: { id: saved.video.id, title: saved.video.title },
          progress: { seconds_watched: saved.progress.seconds_watched, completed: saved.progress.completed },
        });
      },
    },
  ];
}
