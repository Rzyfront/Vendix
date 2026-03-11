import {
  Controller,
  Get,
  Post,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ArticlesService } from './articles.service';
import { ArticleQueryDto } from './dto/article-query.dto';
import { Public } from '../../../common/decorators/public.decorator';

@ApiTags('Help Center - Articles')
@Controller('help-center/articles')
export class ArticlesController {
  constructor(private readonly articles_service: ArticlesService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List published help articles (paginated, filterable)' })
  async findAll(@Query() query: ArticleQueryDto) {
    return this.articles_service.findAll(query);
  }

  @Get('search')
  @Public()
  @ApiOperation({ summary: 'Search help articles by title, summary, and content' })
  async search(
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    return this.articles_service.search(q, limit ? +limit : 10);
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
