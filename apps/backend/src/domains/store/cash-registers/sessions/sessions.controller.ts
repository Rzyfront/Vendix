import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  HttpCode,
  HttpStatus,
  UseGuards,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SessionsService } from './sessions.service';
import { MovementsService } from '../movements/movements.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { OpenSessionDto } from '../dto/open-session.dto';
import { CloseSessionDto } from '../dto/close-session.dto';
import { CreateMovementDto } from '../dto/create-movement.dto';
import { QuerySessionDto } from '../dto/query-session.dto';

@Controller('store/cash-registers/sessions')
@UseGuards(PermissionsGuard)
export class SessionsController {
  constructor(
    private readonly sessions_service: SessionsService,
    private readonly movements_service: MovementsService,
    private readonly response_service: ResponseService,
  ) {}

  // --- Static routes FIRST ---

  @Get('active')
  @Permissions('store:cash_registers:read')
  async getActiveSession(@Request() req: any) {
    const session = await this.sessions_service.getActiveSession(req.user.id);
    return this.response_service.success(session);
  }

  @Post('open')
  @Permissions('store:cash_registers:open_session')
  @HttpCode(HttpStatus.CREATED)
  async openSession(@Body() dto: OpenSessionDto) {
    const session = await this.sessions_service.openSession(dto);
    return this.response_service.success(session, 'Session opened successfully');
  }

  @Get()
  @Permissions('store:cash_registers:read')
  async findAll(@Query() query: QuerySessionDto) {
    const result = await this.sessions_service.findAll(query);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- SSE routes ---

  @Sse(':id/ai-summary')
  @Permissions('store:cash_registers:read')
  streamAISummary(@Param('id') id: string): Observable<MessageEvent> {
    return this.sessions_service.streamClosingSummary(+id);
  }

  // --- Parameter routes AFTER ---

  @Get(':id')
  @Permissions('store:cash_registers:read')
  async findOne(@Param('id') id: string) {
    const session = await this.sessions_service.findOne(+id);
    return this.response_service.success(session);
  }

  @Get(':id/report')
  @Permissions('store:cash_registers:reports')
  async getReport(@Param('id') id: string) {
    const report = await this.sessions_service.getSessionReport(+id);
    return this.response_service.success(report);
  }

  @Post(':id/close')
  @Permissions('store:cash_registers:close_session')
  @HttpCode(HttpStatus.OK)
  async closeSession(
    @Param('id') id: string,
    @Body() dto: CloseSessionDto,
  ) {
    const session = await this.sessions_service.closeSession(+id, dto);
    return this.response_service.success(session, 'Session closed successfully');
  }

  @Post(':id/suspend')
  @Permissions('store:cash_registers:close_session')
  @HttpCode(HttpStatus.OK)
  async suspendSession(@Param('id') id: string) {
    const session = await this.sessions_service.suspendSession(+id);
    return this.response_service.success(
      session,
      'Session suspended successfully',
    );
  }

  // --- Movement sub-resource ---

  @Get(':sessionId/movements')
  @Permissions('store:cash_registers:movements')
  async getMovements(@Param('sessionId') sessionId: string) {
    const movements = await this.movements_service.findBySession(+sessionId);
    return this.response_service.success(movements);
  }

  @Post(':sessionId/movements')
  @Permissions('store:cash_registers:movements')
  @HttpCode(HttpStatus.CREATED)
  async createMovement(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateMovementDto,
  ) {
    const movement = await this.movements_service.createManualMovement(
      +sessionId,
      dto,
    );
    return this.response_service.success(
      movement,
      'Movement recorded successfully',
    );
  }
}
