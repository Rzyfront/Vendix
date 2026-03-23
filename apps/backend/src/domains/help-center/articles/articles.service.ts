import { Injectable, NotFoundException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { S3Service } from '../../../common/services/s3.service';
import { ArticleQueryDto } from './dto/article-query.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async findAll(query: ArticleQueryDto) {
    const { page = 1, limit = 10, category, type, module } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.help_articlesWhereInput = {
      status: 'PUBLISHED',
      ...(category && {
        category: { slug: category },
      }),
      ...(type && { type: type as any }),
      ...(module && { module }),
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

  async search(q: string, limit = 10) {
    if (!q || q.trim().length < 2) {
      return [];
    }

    const search_term = q.trim();

    const results = await this.prisma.help_articles.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [
          { title: { contains: search_term, mode: 'insensitive' } },
          { summary: { contains: search_term, mode: 'insensitive' } },
          { content: { contains: search_term, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { view_count: 'desc' },
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
      },
    });

    const signedResults = await Promise.all(
      results.map(async (article) => ({
        ...article,
        cover_image_url: article.cover_image_url
          ? await this.s3Service.signUrl(article.cover_image_url)
          : null,
        content: await this.s3Service.signMarkdownContent(article.content),
      })),
    );

    return signedResults;
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
