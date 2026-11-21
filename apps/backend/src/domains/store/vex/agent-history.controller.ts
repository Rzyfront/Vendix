import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ResponseService } from '../../../common/responses/response.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import {
  AgentHistoryService,
  HISTORY_MAX_LIMIT,
} from './services/agent-history.service';

export class AgentHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HISTORY_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsIn(['vex', 'vexi'])
  agent?: 'vex' | 'vexi';
}

/**
 * Read-only history of the store's agents (T18). Owner/admin only, and
 * deliberately NOT behind `VexEnabledGuard`: the history must stay readable
 * after an agent is switched off. The store comes from the request context.
 */
@Controller('store/ai-agents/history')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class AgentHistoryController {
  constructor(
    private readonly history: AgentHistoryService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('changes')
  async changes(@Query() query: AgentHistoryQueryDto) {
    const page = await this.history.listChanges(query);
    return this.responseService.paginated(
      page.items,
      page.total,
      page.page,
      page.limit,
      'Historial de cambios de los agentes',
    );
  }

  @Get('conversations')
  async conversations(@Query() query: AgentHistoryQueryDto) {
    const page = await this.history.listConversations(query);
    return this.responseService.paginated(
      page.items,
      page.total,
      page.page,
      page.limit,
      'Conversaciones de la tienda con los agentes',
    );
  }
}
