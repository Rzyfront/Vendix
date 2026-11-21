import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseService } from '../../../common/responses/response.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AISkillsService } from './ai-skills.service';
import {
  AISkillQueryDto,
  CreateAISkillDto,
  SearchTestAISkillDto,
  SkillDiffQueryDto,
  UpdateAISkillDto,
} from './dto/ai-skill.dto';

/** Same guard and role as `ai-agents.controller.ts`: super admin only. */
@ApiTags('Admin AI Skills')
@Controller('superadmin/ai-engine/skills')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AISkillsController {
  constructor(
    private readonly skills: AISkillsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List skills (filter by module and status)' })
  async list(@Query() query: AISkillQueryDto) {
    return this.responseService.success(
      await this.skills.list(query),
      'AI skills retrieved',
    );
  }

  // Static segments first: they must not be captured by `:id`.
  @Post('search-test')
  @ApiOperation({ summary: 'Probar búsqueda: top published skills with score' })
  async searchTest(@Body() dto: SearchTestAISkillDto) {
    return this.responseService.success(
      await this.skills.searchTest(dto.query),
      'AI skills search test',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a skill (draft, version 1)' })
  async create(@Request() req: any, @Body() dto: CreateAISkillDto) {
    return this.responseService.created(
      await this.skills.create(dto, req.user?.id ?? null),
      'AI skill created',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a skill' })
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(
      await this.skills.get(id),
      'AI skill retrieved',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Save a skill: creates a new immutable version' })
  async update(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAISkillDto,
  ) {
    return this.responseService.updated(
      await this.skills.update(id, dto, req.user?.id ?? null),
      'AI skill saved',
    );
  }

  @Get(':id/validation')
  @ApiOperation({ summary: 'Validate the latest saved version' })
  async validation(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(
      await this.skills.validate(id),
      'AI skill validation',
    );
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish the latest saved version (validated)' })
  async publish(@Request() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(
      await this.skills.publish(id, req.user?.id ?? null),
      'AI skill published',
    );
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive a skill (removed from search)' })
  async archive(@Request() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(
      await this.skills.archive(id, req.user?.id ?? null),
      'AI skill archived',
    );
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Version history with author' })
  async versions(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(
      await this.skills.versions(id),
      'AI skill versions retrieved',
    );
  }

  @Get(':id/versions/diff')
  @ApiOperation({ summary: 'Both versions content for comparison' })
  async diff(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SkillDiffQueryDto,
  ) {
    return this.responseService.success(
      await this.skills.diff(id, query.from, query.to),
      'AI skill versions diff',
    );
  }

  @Post(':id/versions/:version/restore')
  @ApiOperation({ summary: 'Restore = new version with the old content' })
  async restore(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.responseService.success(
      await this.skills.restore(id, version, req.user?.id ?? null),
      'AI skill restored',
    );
  }
}
