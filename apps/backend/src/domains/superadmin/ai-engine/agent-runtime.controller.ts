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
import { AgentRuntimeConfigService } from '../../../ai-engine/agent-runtime-config.service';
import { ResponseService } from '../../../common/responses/response.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { UpdateAgentRuntimeDto, VoicePreviewDto } from './dto';

/**
 * Single sheet per agent (Vex, Vexi): model, provider and voice for every
 * store at once. Declared before `:agentKey` routes so `stores/:id/status`
 * is never read as an agent key.
 */
@ApiTags('Admin AI Agent Runtime')
@Controller('superadmin/ai-engine/agent-runtime')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AgentRuntimeController {
  constructor(
    private readonly runtime: AgentRuntimeConfigService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('stores/:storeId/status')
  @ApiOperation({ summary: 'Why Vex/Vexi are on or off for a store' })
  async storeStatus(@Param('storeId', ParseIntPipe) storeId: number) {
    const agents = await this.runtime.getAgentStatuses(storeId);
    return this.responseService.success(
      { agents },
      'Agent status retrieved successfully',
    );
  }

  @Get(':agentKey')
  @ApiOperation({ summary: 'Agent sheet (model, provider, voice)' })
  async getSheet(@Param('agentKey') agentKey: string) {
    const sheet = await this.runtime.getAgentSheet(agentKey);
    return this.responseService.success(sheet, 'Agent sheet retrieved');
  }

  @Patch(':agentKey')
  @ApiOperation({ summary: 'Update the agent sheet' })
  async updateSheet(
    @Param('agentKey') agentKey: string,
    @Body() dto: UpdateAgentRuntimeDto,
  ) {
    const userId = RequestContextService.getUserId() ?? 0;
    const sheet = await this.runtime.updateAgentSheet(agentKey, dto, userId);
    return this.responseService.updated(
      sheet,
      'Agent sheet updated successfully',
    );
  }

  @Post(':agentKey/voice-preview')
  @ApiOperation({ summary: 'Short audio sample with the agent voice' })
  async voicePreview(
    @Param('agentKey') agentKey: string,
    @Body() dto: VoicePreviewDto,
  ) {
    const audio = await this.runtime.previewVoice(agentKey, dto?.text);
    return this.responseService.success(audio, 'Voice preview generated');
  }
}
