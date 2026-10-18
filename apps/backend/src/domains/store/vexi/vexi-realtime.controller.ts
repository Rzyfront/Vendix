import { Body, Controller, Post, UseGuards } from '@nestjs/common';

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
   * G revalidates the server session, current permissions, agent scope and
   * subscription inline on every call. OFF preserves the legacy read bridge.
   */
  @Post('tool-call')
  @SkipSubscriptionGate()
  async callTool(@Body() dto: RealtimeToolCallDto) {
    {
      const result = await this.realtime.executeSessionToolCall(
        dto.session_id,
        dto.name,
        dto.arguments,
        dto.call_id,
      );
      // `proposal` is for the authenticated browser ONLY. It must never be
      // concatenated with `output` sent back to the realtime provider.
      return this.responseService.success(
        { call_id: dto.call_id, ...result },
        'Tool processed',
      );
    }
  }

  /**
   * Closes the billing loop. Quota is charged here rather than at session
   * start because the duration is only known once the peer connection ends.
   */
  @Post('session/close')
  @SkipSubscriptionGate()
  async closeSession(@Body() dto: CloseRealtimeSessionDto) {
    {
      await this.realtime.closeSession(dto.session_id, dto.duration_seconds);
      return this.responseService.success(
        { duration_seconds: dto.duration_seconds },
        'Session closed',
      );
    }
  }
}
