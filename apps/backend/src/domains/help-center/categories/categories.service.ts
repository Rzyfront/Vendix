import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async findAll() {
    return this.prisma.help_article_categories.findMany({
      where: { is_active: true },
      orderBy: { sort_order: 'asc' },
      include: {
        _count: {
          select: {
            articles: {
              where: { status: 'PUBLISHED' },
            },
          },
        },
      },
    });
  }
}
