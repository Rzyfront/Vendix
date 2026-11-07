import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowBoardAllQueryDto, WorkflowBoardQueryDto } from '../dto/workflow-operation.dto';
import { WorkflowBoardService } from './workflow-board.service';

/** Kanban by stage of one flow. Dragging a card is `POST tasks/:id/complete`. */
@Controller('store/workflows/board')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowBoardController {
  constructor(
    private readonly board: WorkflowBoardService,
    private readonly responseService: ResponseService,
  ) {}

  /** P5.5: every flow in four columns. Static routes go before `:definitionId`. */
  @Get()
  @Permissions('store:workflows:read')
  async getAll(@Query() query: WorkflowBoardAllQueryDto) {
    return this.responseService.success(await this.board.boardAll(query));
  }

  /** Flows, roles and branches the general board can filter by. */
  @Get('filters')
  @Permissions('store:workflows:read')
  async filters() {
    return this.responseService.success(await this.board.filters());
  }

  /** Branches of the store, for the "Sede" select of the start dialog. */
  @Get('locations')
  @Permissions('store:workflows:read', 'store:workflows:start', 'store:workflows:task')
  async locations() {
    return this.responseService.success(await this.board.locations());
  }

  @Get(':definitionId')
  @Permissions('store:workflows:read')
  async get(
    @Param('definitionId', ParseIntPipe) definitionId: number,
    @Query() query: WorkflowBoardQueryDto,
  ) {
    return this.responseService.success(await this.board.board(definitionId, query));
  }
}
