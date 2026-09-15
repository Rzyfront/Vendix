import { Injectable, NotFoundException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { S3Service } from '../../../common/services/s3.service';
import { ArticleQueryDto } from './dto/article-query.dto';
import { Prisma } from '@prisma/client';

/**
 * Palabras que no discriminan nada en una pregunta en español. Exigirlas en el
 * AND deja fuera artículos que sí responden; el filtro es lo que permite que
 * "cómo hago una transferencia entre bodegas" busque de verdad por
 * `transferencia` y `bodegas`.
 */
import {
  tokenizeQuery,
  calculateRelevance,
} from '../../../common/helpers/keywords.helper';

function byRelevance<
  T extends {
    title: string;
    summary: string;
    content: string;
    tags: string[];
    keywords?: string[];
  },
>(articles: T[], tokens: string[]): T[] {
  if (!tokens.length) return articles;
  return articles
    .map((article, index) => ({
      article,
      index,
      score: calculateRelevance(article, tokens),
    }))
    // `index` desempata para que el orden sea estable: a igual puntaje manda el
    // criterio de la consulta (más leídos primero).
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.article);
}

/** Primeras líneas del artículo, sin encabezados markdown ni marcas. */
function previewOf(content: string): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 300 ? `${plain.slice(0, 300)}…` : plain;
}

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async findAll(query: ArticleQueryDto) {
    const { page = 1, limit = 10, category, type, module, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.help_articlesWhereInput = {
      status: 'PUBLISHED',
      ...(category && {
        category: { slug: category },
      }),
      ...(type && { type: type as any }),
      ...(module && { module }),
      ...(query.search && (() => {
        const cleanSearch = query.search.trim();
        const searchTokens = tokenizeQuery(cleanSearch);
        return {
          OR: [
            { title: { contains: cleanSearch, mode: 'insensitive' } },
            { summary: { contains: cleanSearch, mode: 'insensitive' } },
            { content: { contains: cleanSearch, mode: 'insensitive' } },
            { tags: { has: cleanSearch.toLowerCase() } },
            { keywords: { has: cleanSearch.toLowerCase() } },
            ...searchTokens.flatMap((t) => [
              { title: { contains: t, mode: 'insensitive' as const } },
              { summary: { contains: t, mode: 'insensitive' as const } },
              { tags: { has: t } },
              { keywords: { has: t } },
            ]),
          ],
        };
      })()),
    };

    const [data, total] = await Promise.all([
      this.prisma.help_articles.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { is_featured: 'desc' },
          { view_count: 'desc' },
          { created_at: 'desc' },
        ],
        include: {
          category: {
            select: { id: true, name: true, slug: true, icon: true },
          },
        },
      }),
      this.prisma.help_articles.count({ where }),
    ]);

    const signedData = await Promise.all(
      data.map(async (article) => ({
        ...article,
        cover_image_url: article.cover_image_url
          ? await this.s3Service.signUrl(article.cover_image_url)
          : null,
        content: await this.s3Service.signMarkdownContent(article.content),
      })),
    );

    if (search) {
      const tokens = tokenizeQuery(search);
      signedData.sort(
        (a, b) => calculateRelevance(b, tokens) - calculateRelevance(a, tokens),
      );
    }

    return {
      data: signedData,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Búsqueda por palabras, no por frase.
   *
   * Antes era un `contains` de la cadena completa sobre título, resumen y
   * contenido. Eso hace que cualquier pregunta redactada como la escribe una
   * persona —"cómo pongo multitarifa a un producto"— devuelva cero resultados,
   * porque esa cadena literal no aparece en ningún artículo. Vexi es el
   * consumidor que más sufre el defecto: el system prompt le pide pasar "las
   * palabras de la persona", así que fallaba por diseño y concluía que nada
   * estaba documentado.
   *
   * Se parte en palabras y se descartan las vacías. La intersección (AND) es el
   * candidato preciso; si devuelve menos de los que caben se completa con la
   * unión (OR), porque media coincidencia es mejor respuesta que ninguna. El
   * conjunto resultante se ordena por relevancia —título y etiquetas pesan más
   * que el cuerpo— y recién ahí se corta: sin ese orden manda `view_count` y
   * los artículos más leídos de la tienda tapan al que de verdad responde.
   */
  async search(q: string, limit = 10, includeContent = false) {
    if (!q || q.trim().length < 2) {
      return [];
    }

    const search_term = q.trim();
    const tokens = tokenizeQuery(search_term);

    const matching = (token: string): Prisma.help_articlesWhereInput => ({
      OR: [
        { title: { contains: token, mode: 'insensitive' } },
        { summary: { contains: token, mode: 'insensitive' } },
        { content: { contains: token, mode: 'insensitive' } },
        // Las etiquetas son el único lugar donde caben las grafías que el texto
        // no usa —"multitarifa" cuando el artículo escribe "multi-tarifa"—.
        { tags: { has: token } },
        { keywords: { has: token } },
      ],
    });

    // Sin tokens útiles (la persona escribió solo palabras vacías) se conserva
    // el comportamiento anterior sobre la frase entera.
    const clauses = tokens.length
      ? tokens.map(matching)
      : [matching(search_term)];

    const query = (where: Prisma.help_articlesWhereInput, take = limit) =>
      this.prisma.help_articles.findMany({
        where: { status: 'PUBLISHED', ...where },
        take,
        orderBy: { view_count: 'desc' },
        include: {
          category: {
            select: { id: true, name: true, slug: true, icon: true },
          },
        },
      });

    // El AND es la respuesta precisa; el OR es el respaldo. Los dos se ordenan
    // por relevancia antes de devolverse: sin eso manda `view_count` y los
    // artículos más leídos de la tienda tapan al que de verdad responde.
    //
    // El AND también se completa con el OR cuando devuelve poco, porque basta
    // un verbo de relleno que ningún artículo use —"cómo CAMBIO las unidades de
    // medida"— para que la intersección se quede casi vacía.
    const strict = await query({ AND: clauses });
    let candidates = strict;

    if (strict.length < limit && clauses.length > 1) {
      const seen = new Set(strict.map((article) => article.id));
      const loose = (
        await query({ OR: clauses }, Math.min(60, limit * 5))
      ).filter((article) => !seen.has(article.id));
      candidates = [...strict, ...loose];
    }

    // El puntaje decide sobre el conjunto entero, no por lote: un artículo que
    // solo acierta dos de tres palabras PERO las tiene en el título responde
    // mejor que uno que las tiene las tres perdidas en el cuerpo.
    const results = byRelevance(candidates, tokens).slice(0, limit);

    return Promise.all(
      results.map(async (article) => {
        const { content, ...rest } = article;
        return {
          ...rest,
          cover_image_url: article.cover_image_url
            ? await this.s3Service.signUrl(article.cover_image_url)
            : null,
          // El adelanto va siempre; el cuerpo entero solo si lo piden.
          //
          // Un resultado de búsqueda cargaba hasta diez artículos completos
          // —entre 2 y 6 KB cada uno—, que ni el listado del centro de ayuda ni
          // el overlay renderizan, y que en el agente ocupaban decenas de miles
          // de caracteres de contexto por consulta. Además ahorra diez pasadas
          // de `signMarkdownContent` por búsqueda.
          content_preview: previewOf(content),
          ...(includeContent
            ? { content: await this.s3Service.signMarkdownContent(content) }
            : {}),
        };
      }),
    );
  }

  async findBySlug(slug: string) {
    const article = await this.prisma.help_articles.findUnique({
      where: { slug },
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
      },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    // Increment view count atomically
    await this.prisma.help_articles.update({
      where: { id: article.id },
      data: { view_count: { increment: 1 } },
    });

    return {
      ...article,
      view_count: article.view_count + 1,
      cover_image_url: article.cover_image_url
        ? await this.s3Service.signUrl(article.cover_image_url)
        : null,
      content: await this.s3Service.signMarkdownContent(article.content),
    };
  }

  async incrementView(id: number) {
    const article = await this.prisma.help_articles.findUnique({
      where: { id },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    await this.prisma.help_articles.update({
      where: { id },
      data: { view_count: { increment: 1 } },
    });

    return { view_count: article.view_count + 1 };
  }
}
