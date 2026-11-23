import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseService } from '../../../common/responses/response.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AIVoiceProfilesService } from './ai-voice-profiles.service';
import {
  CreateAIVoiceProfileDto,
  UpdateAIVoiceProfileDto,
  VoicePreviewDto,
} from './dto';

/**
 * F8 T49 — voice catalog. Same guard and role as the rest of
 * `superadmin/ai-engine/*`: super admin only, nothing for the store.
 */
@ApiTags('Admin AI Voices')
@Controller('superadmin/ai-engine/voices')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AIVoiceProfilesController {
  constructor(
    private readonly voices: AIVoiceProfilesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List the voice catalog' })
  async list() {
    return this.responseService.success(
      await this.voices.list(),
      'AI voices retrieved',
    );
  }

  // Static segment first: it must not be captured by `:id`.
  @Get('speech-configs')
  @ApiOperation({ summary: 'Active speech providers a voice can belong to' })
  async speechConfigs() {
    return this.responseService.success(
      await this.voices.listSpeechConfigs(),
      'AI speech providers retrieved',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Register a voice' })
  async create(@Body() dto: CreateAIVoiceProfileDto) {
    return this.responseService.created(
      await this.voices.create(dto, RequestContextService.getUserId() ?? null),
      'AI voice created',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit, activate or deactivate a voice' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAIVoiceProfileDto,
  ) {
    return this.responseService.updated(
      await this.voices.update(
        id,
        dto,
        RequestContextService.getUserId() ?? null,
      ),
      'AI voice updated',
    );
  }

  @Post(':id/preview')
  @ApiOperation({ summary: 'Short audio sample of a catalog voice' })
  async preview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoicePreviewDto,
  ) {
    return this.responseService.success(
      await this.voices.preview(id, dto?.text),
      'Voice preview generated',
    );
  }
}
