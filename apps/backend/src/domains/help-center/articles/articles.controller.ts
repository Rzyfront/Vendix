import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ArticlesService } from './articles.service';
import { ArticleQueryDto } from './dto/article-query.dto';
import { ArticleSearchQueryDto } from './dto/article-search-query.dto';
import { Public } from '../../../common/decorators/public.decorator';

@ApiTags('Help Center - Articles')
@Controller('help-center/articles')
export class ArticlesController {
  constructor(private readonly articles_service: ArticlesService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List published help articles (paginated, filterable)',
  })
  async findAll(@Query() query: ArticleQueryDto) {
    return this.articles_service.findAll(query);
  }

  @Get('search')
  @Public()
  @ApiOperation({
    summary:
      'Buscar en los artículos de ayuda por palabras clave. Devuelve título, ' +
      'resumen y un adelanto de cada artículo; el texto completo se lee ' +
      'después con el slug del artículo',
  })
  async search(@Query() query: ArticleSearchQueryDto) {
    return this.articles_service.search(
      query.q,
      query.limit ?? 10,
      query.include_content ?? false,
    );
  }

  @Get(':slug')
  @Public()
  @ApiOperation({ summary: 'Get article by slug (increments view count)' })
  async findBySlug(@Param('slug') slug: string) {
    return this.articles_service.findBySlug(slug);
  }

  @Post(':id/view')
  @Public()
  @ApiOperation({ summary: 'Increment article view count' })
  async incrementView(@Param('id') id: string) {
    return this.articles_service.incrementView(+id);
  }
}
