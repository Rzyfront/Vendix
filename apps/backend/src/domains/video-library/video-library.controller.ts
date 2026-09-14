import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { VideoLibraryService } from './video-library.service';
import { VideoQueryDto, VideoSearchQueryDto } from './dto/video-query.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Video Library')
@Controller('video-library')
export class VideoLibraryController {
  constructor(private readonly videoLibraryService: VideoLibraryService) {}

  @Get('videos')
  @Public()
  @ApiOperation({ summary: 'List published videos (paginated, filterable by category and module)' })
  async findAll(@Query() query: VideoQueryDto) {
    return this.videoLibraryService.findAll(query);
  }

  @Get('videos/search')
  @Public()
  @ApiOperation({ summary: 'Search published videos by title, summary or tags' })
  async search(@Query() query: VideoSearchQueryDto) {
    return this.videoLibraryService.search(query.q, query.limit ?? 10);
  }

  @Get('videos/:slug')
  @Public()
  @ApiOperation({ summary: 'Get published video by slug with related videos' })
  async findBySlug(@Param('slug') slug: string) {
    return this.videoLibraryService.findBySlug(slug);
  }

  @Post('videos/:id/view')
  @Public()
  @ApiOperation({ summary: 'Increment video view count' })
  async incrementView(@Param('id') id: string) {
    return this.videoLibraryService.incrementView(+id);
  }

  @Get('categories')
  @Public()
  @ApiOperation({ summary: 'List active video categories with published video counts' })
  async getCategories() {
    return this.videoLibraryService.getCategories();
  }
}
