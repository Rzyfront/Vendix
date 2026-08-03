import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { VexiRealtimeService } from './vexi-realtime.service';
import { ResponseService } from '../../../common/responses/response.service';
import {
  AiAccessGuard,
  RequireAIFeature,
} from '../subscriptions/guards/ai-access.guard';
import { SkipSubscriptionGate } from '../subscriptions/decorators/skip-subscription-gate.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { RequestContextService } from '@common/context/request-context.service';
import {
  CloseRealtimeSessionDto,
  CreateRealtimeSessionDto,
  RealtimeToolCallDto,
} from './dto';

/**
 * Vexi realtime voice.
 *
 * The browser negotiates WebRTC straight against the provider, so these
 * endpoints are the only two server touchpoints: one to mint a short-lived
 * credential plus the tool catalog, one to execute the tools the model asks
 * for. Audio never transits this process.
 *
 * Restricted to owner and admin — the tool catalog surfaces P&L, customer
 * segments and stock levels.
 */
@Controller('store/vexi/realtime')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class VexiRealtimeController {
  constructor(
    private readonly realtime: VexiRealtimeService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('session')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('realtime_voice')
  async createSession(@Body() dto: CreateRealtimeSessionDto) {
    const grant = await this.realtime.createSession(dto);
    return this.responseService.success(grant, 'Realtime session granted');
  }

  /**
   * Bridges one `function_call` from the live session into the tool registry.
   *
   * Not gated by `AiAccessGuard`: the session was already authorized when it
   * was granted, and re-running the gate on every tool call would let a
   * mid-session cap rollover strand the model waiting on a result it can
   * never receive. The read-only + permission checks still run in the service.
   */
  @Post('tool-call')
  @SkipSubscriptionGate()
  async callTool(@Body() dto: RealtimeToolCallDto) {
    const output = await this.realtime.executeToolCall(
      dto.name,
      dto.arguments,
    );
    return this.responseService.success(
      { call_id: dto.call_id, output },
      'Tool executed',
    );
  }

  /**
   * Closes the billing loop. Quota is charged here rather than at session
   * start because the duration is only known once the peer connection ends.
   */
  @Post('session/close')
  @SkipSubscriptionGate()
  async closeSession(@Body() dto: CloseRealtimeSessionDto) {
    const requestId =
      RequestContextService.getContext()?.request_id ??
      `vexi-voice-${randomUUID()}`;

    await this.realtime.consumeSessionQuota(dto.duration_seconds, requestId);
    return this.responseService.success(
      { duration_seconds: dto.duration_seconds },
      'Session closed',
    );
  }
}
