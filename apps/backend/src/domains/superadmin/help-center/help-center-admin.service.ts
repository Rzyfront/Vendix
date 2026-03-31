import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { S3Service } from '../../../common/services/s3.service';
import { S3PathHelper } from '../../../common/helpers/s3-path.helper';
import { ImageContext } from '@common/config/image-presets';
import {
  CreateArticleDto,
  UpdateArticleDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  AdminArticleQueryDto,
} from './dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class HelpCenterAdminService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
  ) {}

  // ==========================================
  // ARTICLES CRUD
  // ==========================================

  async findAllArticles(query: AdminArticleQueryDto) {
    const { page = 1, limit = 20, status, type, category, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.help_articlesWhereInput = {
      ...(status && { status: status as any }),
      ...(type && { type: type as any }),
      ...(category && { category: { slug: category } }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' as const } },
          { summary: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.globalPrisma.help_articles.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
        include: {
          category: {
            select: { id: true, name: true, slug: true, icon: true },
          },
        },
      }),
      this.globalPrisma.help_articles.count({ where }),
    ]);

    // Sign cover_image_url for articles that have one
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

  async findArticleById(id: number) {
    const article = await this.globalPrisma.help_articles.findUnique({
      where: { id },
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
      },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    return {
      ...article,
      cover_image_url: article.cover_image_url
        ? await this.s3Service.signUrl(article.cover_image_url)
        : null,
      content: await this.s3Service.signMarkdownContent(article.content),
    };
  }

  async createArticle(userId: number, dto: CreateArticleDto) {
    const slug = this.generateSlug(dto.title);

    // Verify unique slug
    const existing = await this.globalPrisma.help_articles.findUnique({
      where: { slug },
    });

    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    // Verify category exists
    const category = await this.globalPrisma.help_article_categories.findUnique({
      where: { id: dto.category_id },
    });

    if (!category) {
      throw new BadRequestException('Category not found');
    }

    // Sanitize cover_image_url before storage
    const cover_image_url = dto.cover_image_url
      ? this.s3Service.sanitizeForStorage(dto.cover_image_url)
      : null;

    const article = await this.globalPrisma.help_articles.create({
      data: {
        title: dto.title,
        slug: finalSlug,
        summary: dto.summary,
        content: this.s3Service.sanitizeMarkdownContent(dto.content),
        type: dto.type as any,
        status: (dto.status || 'DRAFT') as any,
        category_id: dto.category_id,
        module: dto.module || null,
        tags: dto.tags || [],
        cover_image_url,
        is_featured: dto.is_featured || false,
        sort_order: dto.sort_order || 0,
        created_by_id: userId,
      },
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
      },
    });

    return {
      ...article,
      cover_image_url: article.cover_image_url
        ? await this.s3Service.signUrl(article.cover_image_url)
        : null,
      content: await this.s3Service.signMarkdownContent(article.content),
    };
  }

  async updateArticle(id: number, dto: UpdateArticleDto) {
    const article = await this.globalPrisma.help_articles.findUnique({
      where: { id },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    // If title changed, regenerate slug
    let slug: string | undefined;
    if (dto.title && dto.title !== article.title) {
      const newSlug = this.generateSlug(dto.title);
      const existing = await this.globalPrisma.help_articles.findFirst({
        where: { slug: newSlug, id: { not: id } },
      });
      slug = existing ? `${newSlug}-${Date.now()}` : newSlug;
    }

    // If category_id changed, verify it exists
    if (dto.category_id && dto.category_id !== article.category_id) {
      const category = await this.globalPrisma.help_article_categories.findUnique({
        where: { id: dto.category_id },
      });
      if (!category) {
        throw new BadRequestException('Category not found');
      }
    }

    // Sanitize cover_image_url
    const cover_image_url = dto.cover_image_url !== undefined
      ? this.s3Service.sanitizeForStorage(dto.cover_image_url)
      : undefined;

    const updated = await this.globalPrisma.help_articles.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(slug && { slug }),
        ...(dto.summary && { summary: dto.summary }),
        ...(dto.content !== undefined && { content: this.s3Service.sanitizeMarkdownContent(dto.content) }),
        ...(dto.type && { type: dto.type as any }),
        ...(dto.status && { status: dto.status as any }),
        ...(dto.category_id && { category_id: dto.category_id }),
        ...(dto.module !== undefined && { module: dto.module || null }),
        ...(dto.tags && { tags: dto.tags }),
        ...(cover_image_url !== undefined && { cover_image_url }),
        ...(dto.is_featured !== undefined && { is_featured: dto.is_featured }),
        ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
        updated_at: new Date(),
      },
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
      },
    });

    return {
      ...updated,
      cover_image_url: updated.cover_image_url
        ? await this.s3Service.signUrl(updated.cover_image_url)
        : null,
      content: await this.s3Service.signMarkdownContent(updated.content),
    };
  }

  async deleteArticle(id: number) {
    const article = await this.globalPrisma.help_articles.findUnique({
      where: { id },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    await this.globalPrisma.help_articles.delete({ where: { id } });

    return { deleted: true };
  }

  async getArticleStats() {
    const [total, published, draft, archived, totalViews] = await Promise.all([
      this.globalPrisma.help_articles.count(),
      this.globalPrisma.help_articles.count({ where: { status: 'PUBLISHED' } }),
      this.globalPrisma.help_articles.count({ where: { status: 'DRAFT' } }),
      this.globalPrisma.help_articles.count({ where: { status: 'ARCHIVED' } }),
      this.globalPrisma.help_articles.aggregate({ _sum: { view_count: true } }),
    ]);

    return {
      total,
      published,
      draft,
      archived,
      total_views: totalViews._sum.view_count || 0,
    };
  }

  // ==========================================
  // CATEGORIES CRUD
  // ==========================================

  async findAllCategories() {
    return this.globalPrisma.help_article_categories.findMany({
      orderBy: { sort_order: 'asc' },
      include: {
        _count: {
          select: { articles: true },
        },
      },
    });
  }

  async createCategory(dto: CreateCategoryDto) {
    const slug = this.generateSlug(dto.name);

    const existing = await this.globalPrisma.help_article_categories.findUnique({
      where: { slug },
    });

    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    return this.globalPrisma.help_article_categories.create({
      data: {
        name: dto.name,
        slug: finalSlug,
        description: dto.description || null,
        icon: dto.icon || null,
        sort_order: dto.sort_order || 0,
        is_active: dto.is_active !== undefined ? dto.is_active : true,
      },
    });
  }

  async updateCategory(id: number, dto: UpdateCategoryDto) {
    const category = await this.globalPrisma.help_article_categories.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    // If name changed, regenerate slug
    let slug: string | undefined;
    if (dto.name && dto.name !== category.name) {
      const newSlug = this.generateSlug(dto.name);
      const existing = await this.globalPrisma.help_article_categories.findFirst({
        where: { slug: newSlug, id: { not: id } },
      });
      slug = existing ? `${newSlug}-${Date.now()}` : newSlug;
    }

    return this.globalPrisma.help_article_categories.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(slug && { slug }),
        ...(dto.description !== undefined && { description: dto.description || null }),
        ...(dto.icon !== undefined && { icon: dto.icon || null }),
        ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        updated_at: new Date(),
      },
    });
  }

  async deleteCategory(id: number) {
    const category = await this.globalPrisma.help_article_categories.findUnique({
      where: { id },
      include: { _count: { select: { articles: true } } },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (category._count.articles > 0) {
      throw new BadRequestException(
        'Cannot delete category with associated articles. Remove or reassign articles first.',
      );
    }

    await this.globalPrisma.help_article_categories.delete({ where: { id } });

    return { deleted: true };
  }

  // ==========================================
  // IMAGE UPLOAD
  // ==========================================

  async uploadArticleImage(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'image/bmp', 'image/tiff', 'image/svg+xml',
      'image/heic', 'image/heif', 'image/avif',
    ];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException('Only image files are allowed (JPEG, PNG, WebP, GIF, BMP, TIFF, SVG, HEIC, AVIF)');
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('Image file must be smaller than 10MB');
    }

    const path = this.s3PathHelper.buildHelpCenterPath();
    const fileName = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    const key = `${path}/${fileName}`;

    const result = await this.s3Service.uploadImage(file.buffer, key, {
      context: ImageContext.HELP_CENTER,
    });

    return {
      key: result.key,
      url: await this.s3Service.signUrl(result.key),
    };
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private generateSlug(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, ''); // Trim hyphens
  }
}
