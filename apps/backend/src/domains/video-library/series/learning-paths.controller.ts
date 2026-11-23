import { Body, Controller, Get, Param, ParseIntPipe, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LearningPathsService } from './learning-paths.service';
import { LearningProgressDto } from './dto/learning-progress.dto';

/**
 * Store help center: learning paths (published video series) and the
 * progress of the authenticated user. Uses the global JWT guard and returns
 * raw payloads like the rest of the help center endpoints.
 */
@ApiTags('Store Help - Learning paths')
@Controller('store/help')
export class LearningPathsController {
  constructor(
    private readonly learningPaths: LearningPathsService,
  ) {}

  @Get('learning-paths')
  @ApiOperation({ summary: 'List published learning paths with user progress counts' })
  async list(@Request() req: any) {
    return this.learningPaths.list(req.user.id);
  }

  @Get('learning-paths/:id')
  @ApiOperation({ summary: 'Get one published learning path with ordered items and progress' })
  async getOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.learningPaths.getOne(id, req.user.id);
  }

  @Post('learning-progress')
  @ApiOperation({ summary: 'Save the current user progress for a video' })
  async saveProgress(@Body() dto: LearningProgressDto, @Request() req: any) {
    return this.learningPaths.saveProgress(req.user.id, dto);
  }
}
