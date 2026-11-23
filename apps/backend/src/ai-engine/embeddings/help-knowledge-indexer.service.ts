import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { catalogHash, KnowledgeType } from '../tools/tool-catalog';
import { EmbeddingService } from './embedding.service';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { intentTsQuery } from './knowledge-search.service';

/** Events emitted by the help-center / video-library admin services (payload `{ id }`). */
export const HELP_ARTICLE_CHANGED = 'help.article.changed';
export const HELP_VIDEO_CHANGED = 'help.video.changed';
// Same event the superadmin series service emits (LEARNING_PATH_CHANGED_EVENT,
// payload `{ series_id, status }`); `{ id }` is still accepted.
export const HELP_SERIES_CHANGED = 'help.learning_path.changed';

/** Help documents are platform-managed: the release tool indexer must never retire them. */
export const HELP_MANAGED_RELEASE = 'managed';

export type HelpKnowledgeType = Extract<
  KnowledgeType,
  'help_article' | 'help_video' | 'learning_path'
>;
export const HELP_KNOWLEDGE_TYPES: readonly HelpKnowledgeType[] = [
  'help_article',
  'help_video',
  'learning_path',
];

/** D4: videos are NOT transcribed; below this much publisher-written text they are flagged. */
export const VIDEO_SEARCH_TEXT_MIN_CHARS = 120;
const ARTICLE_CHUNK_MAX_CHARS = 1800;
const VECTOR_MIN_SIMILARITY = 0.35;

export interface VideoSearchSource {
  title: string;
  summary?: string | null;
  description?: string | null;
  tags?: string[] | null;
  keywords?: string[] | null;
  module?: string | null;
  category?: { name?: string | null; description?: string | null } | null;
}

/** Text a video is indexed with: everything its publication already says (no STT). */
export function computeVideoSearchText(video: VideoSearchSource): string {
  const tags = (video.tags ?? []).filter(Boolean);
  const keywords = (video.keywords ?? []).filter(Boolean);
  return [
    video.title,
    video.summary,
    video.description,
    tags.length ? `Etiquetas: ${tags.join(', ')}` : null,
    keywords.length ? `Palabras clave: ${keywords.join(', ')}` : null,
    video.module ? `Módulo: ${video.module}` : null,
    video.category?.name
      ? `Categoría: ${video.category.name}${
          video.category.description ? ` - ${video.category.description}` : ''
        }`
      : null,
  ]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Characters of publisher-written text besides the title. Module and category
 * are generic and shared by many videos, so they do not count as evidence.
 */
export function videoSearchTextLength(video: VideoSearchSource): number {
  return [
    video.summary,
    video.description,
    ...(video.tags ?? []),
    ...(video.keywords ?? []),
  ]
    .map((part) => (part ?? '').trim())
    .join('').length;
}

export function isVideoSearchTextInsufficient(
  video: VideoSearchSource,
): boolean {
  return videoSearchTextLength(video) < VIDEO_SEARCH_TEXT_MIN_CHARS;
}

export interface ArticleSource {
  id: number;
  title: string;
  slug: string;
  summary: string;
  content: string;
  tags?: string[] | null;
  keywords?: string[] | null;
  module?: string | null;
  category?: { name?: string | null } | null;
}

export interface ArticleChunk {
  index: number;
  heading: string | null;
  text: string;
}

function splitLong(text: string): string[] {
  if (text.length <= ARTICLE_CHUNK_MAX_CHARS) return [text];
  const out: string[] = [];
  let current = '';
  for (const paragraph of text.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length + 2 > ARTICLE_CHUNK_MAX_CHARS) {
      out.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
    while (current.length > ARTICLE_CHUNK_MAX_CHARS) {
      out.push(current.slice(0, ARTICLE_CHUNK_MAX_CHARS));
      current = current.slice(ARTICLE_CHUNK_MAX_CHARS);
    }
  }
  if (current) out.push(current);
  return out;
}

/** Chunk an article by markdown sections (`#`..`###`); chunk 0 carries the title/summary/tags. */
export function chunkArticle(article: ArticleSource): ArticleChunk[] {
  const sections: Array<{ heading: string | null; lines: string[] }> = [
    { heading: null, lines: [] },
  ];
  let inFence = false;
  for (const line of (article.content ?? '').split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = !inFence && /^#{1,3}\s+(.+)$/.exec(line);
    if (heading) sections.push({ heading: heading[1].trim(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  const tags = [...(article.tags ?? []), ...(article.keywords ?? [])].filter(
    Boolean,
  );
  const head = [
    article.title,
    article.summary,
    tags.length ? `Etiquetas: ${tags.join(', ')}` : null,
    article.module ? `Módulo: ${article.module}` : null,
    article.category?.name ? `Categoría: ${article.category.name}` : null,
  ]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join('\n');

  const chunks: ArticleChunk[] = [];
  sections.forEach((section, i) => {
    const body = section.lines.join('\n').trim();
    if (i > 0 && !body && !section.heading) return;
    const parts = body ? splitLong(body) : [''];
    parts.forEach((part, j) => {
      const title = j === 0 ? section.heading : `${section.heading ?? ''} (cont.)`;
      const text = [
        i === 0 && j === 0 ? head : article.title,
        title && i > 0 ? title : null,
        part,
      ]
        .filter(Boolean)
        .join('\n');
      chunks.push({ index: chunks.length, heading: section.heading, text });
    });
  });
  return chunks.filter((c) => c.text.trim());
}

interface HelpDocument {
  key: string;
  type: HelpKnowledgeType;
  name: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface HelpSearchHit {
  type: HelpKnowledgeType;
  id: number;
  document_key: string;
  score: number;
}

interface RawHit {
  id: number;
  document_key: string;
  entity_type: HelpKnowledgeType;
  metadata: { source_id?: number } | null;
  rank?: number | null;
  similarity?: number | null;
}

/**
 * Minimal structural view of the F4 delegates the generated client may not type
 * yet. The agent reads also go through it: `help_articles.video_id` is F4 too.
 */
interface F4Delegates {
  help_articles: {
    findFirst(args: unknown): Promise<AgentHelpArticle | null>;
    findMany<T>(args: unknown): Promise<T[]>;
  };
  videos: {
    findFirst<T>(args: unknown): Promise<T | null>;
    findMany(args: unknown): Promise<AgentHelpVideo[]>;
  };
  video_series: {
    findUnique(args: unknown): Promise<SeriesRow | null>;
    findFirst(args: unknown): Promise<AgentLearningPath | null>;
    findMany<T = { id: number }>(args: unknown): Promise<T[]>;
  };
  video_series_items: {
    findMany(args: unknown): Promise<Array<{ series_id: number }>>;
  };
  user_learning_progress: {
    findMany(args: unknown): Promise<AgentLearningProgress[]>;
    upsert(args: unknown): Promise<AgentLearningProgress>;
  };
}

// ── Agent-facing rows (Vex help tools, T28) ─────────────────────────────

/** An article or learning path addressed by id, or by slug when there is no id. */
export interface AgentHelpRef {
  id?: number | null;
  slug?: string | null;
}

export interface AgentHelpArticleRef {
  id: number;
  title: string;
  slug: string;
  summary: string;
}

export interface AgentHelpArticleHit extends AgentHelpArticleRef {
  video_id: number | null;
}

export interface AgentHelpArticle extends AgentHelpArticleHit {
  content: string;
  type: string;
  module: string | null;
  cover_image_url: string | null;
}

export interface AgentHelpVideo {
  id: number;
  title: string;
  slug: string;
  summary: string;
  video_url: string;
  video_source: string;
  external_id: string | null;
  duration_seconds: number;
  thumbnail_url: string | null;
}

export interface AgentLearningPathSummary {
  id: number;
  title: string;
  slug: string;
  summary: string | null;
  module?: string | null;
}

export interface AgentLearningPath {
  id: number;
  title: string;
  slug: string;
  summary: string | null;
  items: Array<{ video_id: number; article_id: number | null; position: number }>;
}

export interface AgentLearningProgress {
  video_id: number;
  series_id: number | null;
  seconds_watched: number;
  completed: boolean;
}

/** Fields left undefined keep their stored value on update. */
export interface AgentLearningProgressInput {
  video_id: number;
  series_id?: number | null;
  seconds_watched?: number;
  completed?: boolean;
}

/** Columns the agent may see of a video: enough to play it, nothing editorial. */
const AGENT_VIDEO_SELECT = {
  id: true,
  title: true,
  slug: true,
  summary: true,
  video_url: true,
  video_source: true,
  external_id: true,
  duration_seconds: true,
  thumbnail_url: true,
} as const;

const AGENT_ARTICLE_REF_SELECT = {
  id: true,
  title: true,
  slug: true,
  summary: true,
} as const;

function agentWhere(ref: AgentHelpRef): { id: number } | { slug: string } | null {
  if (ref.id) return { id: ref.id };
  const slug = ref.slug?.trim();
  return slug ? { slug } : null;
}

interface SeriesRow {
  id: number;
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  module?: string | null;
  status: string;
  items: Array<{ video_id: number; position: number }>;
}

@Injectable()
export class HelpKnowledgeIndexerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HelpKnowledgeIndexerService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly embeddings: EmbeddingService,
    private readonly knowledgeEmbeddings: KnowledgeEmbeddingService,
  ) {}

  private get f4(): F4Delegates {
    return this.prisma as unknown as F4Delegates;
  }

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    // Index what was published before this feature existed; never block boot.
    void this.backfill().catch((error: Error) =>
      this.logger.warn(`Help knowledge backfill failed: ${error.message}`),
    );
  }

  // ── Events ────────────────────────────────────────────────────────────

  @OnEvent(HELP_ARTICLE_CHANGED, { async: true })
  async onArticleChanged(payload: { id: number }): Promise<void> {
    await this.safely(`article ${payload?.id}`, () =>
      this.syncArticle(payload.id),
    );
  }

  @OnEvent(HELP_VIDEO_CHANGED, { async: true })
  async onVideoChanged(payload: { id: number }): Promise<void> {
    await this.safely(`video ${payload?.id}`, async () => {
      await this.syncVideo(payload.id);
      // A path embeds the titles of its videos: refresh the ones containing it.
      const rows = await this.f4.video_series_items.findMany({
        where: { video_id: payload.id },
        select: { series_id: true },
      });
      for (const seriesId of new Set(rows.map((r) => r.series_id)))
        await this.syncSeries(seriesId);
    });
  }

  @OnEvent(HELP_SERIES_CHANGED, { async: true })
  async onSeriesChanged(payload: {
    id?: number;
    series_id?: number;
  }): Promise<void> {
    const seriesId = payload?.series_id ?? payload?.id;
    if (!seriesId) return;
    await this.safely(`series ${seriesId}`, () => this.syncSeries(seriesId));
  }

  private async safely(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (error) {
      this.logger.warn(
        `Help knowledge sync (${label}) failed: ${(error as Error).message}`,
      );
    }
  }

  // ── Sync (published → index, anything else → retire) ─────────────────

  async syncArticle(id: number): Promise<void> {
    const article = await this.prisma.help_articles.findUnique({
      where: { id },
      include: { category: { select: { name: true } } },
    });
    if (!article || article.status !== 'PUBLISHED') {
      await this.retirePrefix(`help_article:${id}:`, []);
      return;
    }
    const chunks = chunkArticle(article);
    const keys: string[] = [];
    for (const chunk of chunks) {
      const key = `help_article:${article.id}:${chunk.index}`;
      keys.push(key);
      await this.upsertDocument({
        key,
        type: 'help_article',
        name: article.title,
        content: chunk.text,
        metadata: {
          source_id: article.id,
          slug: article.slug,
          title: article.title,
          section: chunk.heading,
          chunk: chunk.index,
          module: article.module ?? null,
        },
      });
    }
    await this.retirePrefix(`help_article:${article.id}:`, keys);
  }

  async syncVideo(id: number): Promise<void> {
    const video = await this.prisma.videos.findUnique({
      where: { id },
      include: { category: { select: { name: true, description: true } } },
    });
    const key = `help_video:${id}`;
    if (!video || video.status !== 'PUBLISHED') {
      await this.retirePrefix(key, []);
      return;
    }
    await this.upsertDocument({
      key,
      type: 'help_video',
      name: video.title,
      content: computeVideoSearchText(video),
      metadata: {
        source_id: video.id,
        slug: video.slug,
        title: video.title,
        module: video.module ?? null,
        search_text_insufficient: isVideoSearchTextInsufficient(video),
      },
    });
  }

  async syncSeries(id: number): Promise<void> {
    const key = `learning_path:${id}`;
    const series = await this.f4.video_series.findUnique({
      where: { id },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!series || series.status !== 'PUBLISHED') {
      await this.retirePrefix(key, []);
      return;
    }
    const videos = series.items.length
      ? await this.prisma.videos.findMany({
          where: {
            id: { in: series.items.map((i) => i.video_id) },
            status: 'PUBLISHED',
          },
          select: { id: true, title: true },
        })
      : [];
    const titles = new Map(videos.map((v) => [v.id, v.title]));
    const steps = series.items
      .map((i) => titles.get(i.video_id))
      .filter((t): t is string => Boolean(t));
    const content = [
      series.title,
      series.summary,
      series.description,
      series.module ? `Módulo: ${series.module}` : null,
      steps.length ? `Ruta de aprendizaje: ${steps.join(' > ')}` : null,
    ]
      .map((part) => (part ?? '').trim())
      .filter(Boolean)
      .join('\n');
    await this.upsertDocument({
      key,
      type: 'learning_path',
      name: series.title,
      content,
      metadata: {
        source_id: series.id,
        slug: series.slug,
        title: series.title,
        module: series.module ?? null,
      },
    });
  }

  /** Index everything published and retire managed docs whose source is gone. */
  async backfill(): Promise<{ articles: number; videos: number; paths: number }> {
    const [articles, videos, paths] = await Promise.all([
      this.prisma.help_articles.findMany({
        where: { status: 'PUBLISHED' },
        select: { id: true },
      }),
      this.prisma.videos.findMany({
        where: { status: 'PUBLISHED' },
        select: { id: true },
      }),
      this.f4.video_series.findMany({
        where: { status: 'PUBLISHED' },
        select: { id: true },
      }),
    ]);
    for (const { id } of articles)
      await this.safely(`article ${id}`, () => this.syncArticle(id));
    for (const { id } of videos)
      await this.safely(`video ${id}`, () => this.syncVideo(id));
    for (const { id } of paths)
      await this.safely(`series ${id}`, () => this.syncSeries(id));

    await this.retireOrphans('help_article', articles.map((a) => a.id));
    await this.retireOrphans('help_video', videos.map((v) => v.id));
    await this.retireOrphans('learning_path', paths.map((p) => p.id));
    return {
      articles: articles.length,
      videos: videos.length,
      paths: paths.length,
    };
  }

  private async retireOrphans(
    type: HelpKnowledgeType,
    liveIds: number[],
  ): Promise<void> {
    const rows = await this.prisma.ai_knowledge_documents.findMany({
      where: {
        knowledge_scope: 'global',
        entity_type: type,
        store_id: null,
        organization_id: null,
        release_hash: HELP_MANAGED_RELEASE,
        status: { not: 'retired' },
      },
      select: { document_key: true },
    });
    const live = new Set(liveIds);
    const orphans = rows
      .map((r) => r.document_key)
      .filter((key) => !live.has(Number(key.split(':')[1])));
    if (orphans.length)
      await this.prisma.ai_knowledge_documents.updateMany({
        where: {
          document_key: { in: orphans },
          release_hash: HELP_MANAGED_RELEASE,
        },
        data: { active: false, status: 'retired', updated_at: new Date() },
      });
  }

  // ── Document writer (reuses the global embedding path) ───────────────

  private async retirePrefix(prefix: string, keepKeys: string[]) {
    await this.prisma.ai_knowledge_documents.updateMany({
      where: {
        knowledge_scope: 'global',
        store_id: null,
        organization_id: null,
        release_hash: HELP_MANAGED_RELEASE,
        document_key: { startsWith: prefix, notIn: keepKeys },
        status: { not: 'retired' },
      },
      data: { active: false, status: 'retired', updated_at: new Date() },
    });
  }

  private async upsertDocument(doc: HelpDocument): Promise<void> {
    const metadata = { ...doc.metadata, origin: 'managed', entity_type: doc.type };
    const hash = catalogHash([doc.type, doc.name, doc.content, metadata]);
    const configuration = await this.knowledgeEmbeddings
      .configuration()
      .catch(() => null);
    const old = await this.prisma.ai_knowledge_documents.findUnique({
      where: { document_key: doc.key },
    });
    if (
      old?.active &&
      old.status === 'ready' &&
      old.content_hash === hash &&
      old.indexed_hash === hash &&
      old.embedding_fingerprint === (configuration?.fingerprint ?? null)
    )
      return;
    const data = {
      entity_type: doc.type,
      knowledge_scope: 'global',
      store_id: null,
      organization_id: null,
      canonical_name: doc.name.slice(0, 150),
      version: '1',
      content: doc.content,
      lexical_text: doc.content,
      metadata: metadata as Prisma.InputJsonObject,
      content_hash: hash,
      release_hash: HELP_MANAGED_RELEASE,
      status: 'ready',
      active: true,
      indexed_hash: hash,
      embedding_fingerprint: null,
      error_code: null,
      updated_at: new Date(),
    };
    const saved = await this.prisma.ai_knowledge_documents.upsert({
      where: { document_key: doc.key },
      create: { document_key: doc.key, ...data },
      update: data,
    });
    if (!configuration) return; // Lexical search works with no embedding app/budget.
    try {
      await this.embeddings.storeGlobalKnowledgeEmbedding({
        documentId: saved.id,
        type: doc.type,
        content: doc.content,
        hash,
        fingerprint: configuration.fingerprint,
      });
      await this.prisma.ai_knowledge_documents.updateMany({
        where: { id: saved.id, content_hash: hash, status: 'ready' },
        data: {
          embedding_fingerprint: configuration.fingerprint,
          updated_at: new Date(),
        },
      });
    } catch {
      await this.prisma.ai_knowledge_documents.updateMany({
        where: { id: saved.id, content_hash: hash },
        data: { error_code: 'KNOWLEDGE_INDEX_FAILED', updated_at: new Date() },
      });
    }
  }

  // ── Hybrid search (lexical + vector, RRF) ────────────────────────────

  /**
   * Hits are ordered by fused relevance. A hit needs lexical evidence or a
   * vector similarity above threshold: nothing is returned "by rank alone".
   * Callers must resolve each hit against its source row (published only).
   */
  async search(
    query: string,
    options: { types?: HelpKnowledgeType[]; limit?: number } = {},
  ): Promise<HelpSearchHit[]> {
    const text = (query ?? '').trim().slice(0, 500);
    if (!text) return [];
    const types = options.types?.length ? options.types : [...HELP_KNOWLEDGE_TYPES];
    const limit = Math.max(1, Math.min(20, options.limit ?? 5));
    const scope = `knowledge_scope = 'global' AND store_id IS NULL AND organization_id IS NULL
      AND active = true AND status = 'ready' AND release_hash = 'managed'`;

    const tsQuery = intentTsQuery(text);
    const lexical = tsQuery
      ? await this.prisma
          .$queryRawUnsafe<RawHit[]>(
            `SELECT id, document_key, entity_type, metadata,
                ts_rank_cd(search_vector, to_tsquery('spanish', $2)) AS rank
              FROM ai_knowledge_documents WHERE ${scope}
                AND entity_type = ANY($1::text[])
                AND search_vector @@ to_tsquery('spanish', $2)
              ORDER BY rank DESC, id LIMIT 30`,
            types,
            tsQuery,
          )
          .catch(() => [] as RawHit[])
      : [];

    let vector: RawHit[] = [];
    try {
      const { fingerprint } = await this.knowledgeEmbeddings.configuration();
      const generated = await this.knowledgeEmbeddings.generate(text, fingerprint);
      vector = (
        await this.prisma.$queryRawUnsafe<RawHit[]>(
          `SELECT d.id, d.document_key, d.entity_type, d.metadata,
              1 - (e.embedding <=> $2::vector) AS similarity
            FROM ai_knowledge_documents d JOIN ai_embeddings e
              ON e.entity_id = d.id AND e.entity_type = d.entity_type
            WHERE d.knowledge_scope = 'global' AND d.store_id IS NULL AND d.organization_id IS NULL
              AND d.active = true AND d.status = 'ready' AND d.release_hash = 'managed'
              AND d.entity_type = ANY($1::text[])
              AND d.embedding_fingerprint = $3 AND d.indexed_hash = d.content_hash
              AND e.knowledge_scope = 'global' AND e.store_id = 0 AND e.organization_id = 0
              AND e.metadata->>'fingerprint' = $3 AND e.metadata->>'content_hash' = d.content_hash
              AND e.embedding IS NOT NULL
            ORDER BY e.embedding <=> $2::vector, d.id LIMIT 30`,
          types,
          `[${generated.vector.join(',')}]`,
          fingerprint,
        )
      ).filter((hit) => Number(hit.similarity ?? 0) >= VECTOR_MIN_SIMILARITY);
    } catch {
      /* lexical only: provider/app/budget unavailable */
    }

    const fused = new Map<string, HelpSearchHit & { raw: number }>();
    const add = (hits: RawHit[]) =>
      hits.forEach((hit, i) => {
        const sourceId = Number(hit.metadata?.source_id);
        if (!Number.isInteger(sourceId)) return;
        const id = `${hit.entity_type}:${sourceId}`;
        const current = fused.get(id) ?? {
          type: hit.entity_type,
          id: sourceId,
          document_key: hit.document_key,
          score: 0,
          raw: 0,
        };
        // Callers dedupe by source: each ranking counts a source once (best chunk).
        current.raw += 1 / (60 + i + 1);
        fused.set(id, current);
      });
    add(dedupeBySource(lexical));
    add(dedupeBySource(vector));

    const max = 2 / 61;
    return [...fused.values()]
      .sort((a, b) => b.raw - a.raw || a.id - b.id)
      .slice(0, limit)
      .map(({ raw, ...hit }) => ({
        ...hit,
        score: Math.round(Math.min(1, raw / max) * 100) / 100,
      }));
  }

  // ── Agent reads (Vex help tools, T28) ─────────────────────────────────
  // The help tools never query the database themselves
  // (scripts/check-tools-no-prisma.sh): every row they hand to the model comes
  // from these methods, PUBLISHED only, and learning progress is always the
  // caller's own (the user id the tool takes from its execution context).

  /** Published rows behind search hits: a stale or unpublished index entry resolves to nothing. */
  async resolvePublishedHitsForAgent(ids: {
    articles: number[];
    videos: number[];
    paths: number[];
  }): Promise<{
    articles: AgentHelpArticleHit[];
    videos: AgentHelpVideo[];
    paths: AgentLearningPathSummary[];
  }> {
    const [articles, videos, paths] = await Promise.all([
      ids.articles.length
        ? this.f4.help_articles.findMany<AgentHelpArticleHit>({
            where: { id: { in: ids.articles }, status: 'PUBLISHED' },
            select: { ...AGENT_ARTICLE_REF_SELECT, video_id: true },
          })
        : [],
      ids.videos.length
        ? this.f4.videos.findMany({
            where: { id: { in: ids.videos }, status: 'PUBLISHED' },
            select: AGENT_VIDEO_SELECT,
          })
        : [],
      ids.paths.length
        ? this.f4.video_series.findMany<AgentLearningPathSummary>({
            where: { id: { in: ids.paths }, status: 'PUBLISHED' },
            select: { id: true, title: true, slug: true, summary: true },
          })
        : [],
    ]);
    return { articles, videos, paths };
  }

  /** One PUBLISHED article (by id or slug) and its linked video when that video is published too. */
  async findPublishedArticleForAgent(
    ref: AgentHelpRef,
  ): Promise<{ article: AgentHelpArticle; video: AgentHelpVideo | null } | null> {
    const by = agentWhere(ref);
    if (!by) return null;
    const article = await this.f4.help_articles.findFirst({
      where: { status: 'PUBLISHED', ...by },
    });
    if (!article) return null;
    const video = article.video_id
      ? await this.f4.videos.findFirst<AgentHelpVideo>({
          where: { id: article.video_id, status: 'PUBLISHED' },
          select: AGENT_VIDEO_SELECT,
        })
      : null;
    return { article, video };
  }

  /** Up to 20 PUBLISHED learning paths, in catalog order. */
  listPublishedLearningPathsForAgent(): Promise<AgentLearningPathSummary[]> {
    return this.f4.video_series.findMany<AgentLearningPathSummary>({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sort_order: 'asc' }, { title: 'asc' }],
      select: { id: true, title: true, slug: true, summary: true, module: true },
      take: 20,
    });
  }

  /**
   * A PUBLISHED learning path with its items in order, the PUBLISHED videos and
   * articles they point to, and `userId`'s own progress on those videos (none
   * without a user).
   */
  async findPublishedLearningPathForAgent(
    ref: AgentHelpRef,
    userId: number | null,
  ): Promise<{
    series: AgentLearningPath;
    videos: AgentHelpVideo[];
    articles: AgentHelpArticleRef[];
    progress: AgentLearningProgress[];
  } | null> {
    const by = agentWhere(ref);
    if (!by) return null;
    const series = await this.f4.video_series.findFirst({
      where: { status: 'PUBLISHED', ...by },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!series) return null;
    const videoIds = series.items.map((i) => i.video_id);
    const articleIds = series.items
      .map((i) => i.article_id)
      .filter((v): v is number => !!v);
    const [videos, articles, progress] = await Promise.all([
      videoIds.length
        ? this.f4.videos.findMany({
            where: { id: { in: videoIds }, status: 'PUBLISHED' },
            select: AGENT_VIDEO_SELECT,
          })
        : [],
      articleIds.length
        ? this.f4.help_articles.findMany<AgentHelpArticleRef>({
            where: { id: { in: articleIds }, status: 'PUBLISHED' },
            select: AGENT_ARTICLE_REF_SELECT,
          })
        : [],
      userId && videoIds.length
        ? this.f4.user_learning_progress.findMany({
            where: { user_id: userId, video_id: { in: videoIds } },
          })
        : [],
    ]);
    return { series, videos, articles, progress };
  }

  /**
   * Saves `userId`'s own progress on a PUBLISHED video (one row per user and
   * video). On update only the given fields change. `null` when the video is
   * not published, and then nothing is written.
   */
  async saveLearningProgressForAgent(
    userId: number,
    input: AgentLearningProgressInput,
  ): Promise<{
    video: { id: number; title: string };
    progress: AgentLearningProgress;
  } | null> {
    const video = await this.f4.videos.findFirst<{ id: number; title: string }>({
      where: { id: input.video_id, status: 'PUBLISHED' },
      select: { id: true, title: true },
    });
    if (!video) return null;
    const { series_id, seconds_watched, completed } = input;
    const now = new Date();
    const progress = await this.f4.user_learning_progress.upsert({
      where: { user_id_video_id: { user_id: userId, video_id: input.video_id } },
      create: {
        user_id: userId,
        video_id: input.video_id,
        series_id: series_id ?? null,
        seconds_watched: seconds_watched ?? 0,
        completed: completed ?? false,
        completed_at: completed ? now : null,
      },
      update: {
        ...(series_id ? { series_id } : {}),
        ...(seconds_watched !== undefined ? { seconds_watched } : {}),
        ...(completed !== undefined
          ? { completed, completed_at: completed ? now : null }
          : {}),
        updated_at: now,
      },
    });
    return { video, progress };
  }
}

function dedupeBySource(hits: RawHit[]): RawHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.entity_type}:${hit.metadata?.source_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
