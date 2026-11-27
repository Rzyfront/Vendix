import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { OptionalAuth } from '@common/decorators/optional-auth.decorator';
import { extractClientIp } from '@common/utils/client-ip.util';
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { VexiPublicService, VexiPublicVisitor } from './vexi-public.service';
import {
  CreateVexiPublicSessionDto,
  VexiPublicMessageDto,
} from './dto/vexi-public.dto';

/** Header carrying the opaque session token minted by `POST sessions`. */
export const VEXI_SESSION_HEADER = 'x-vexi-session';

/**
 * Vexi público F2 — the storefront chat. Lives under `/ecommerce/` so
 * `DomainResolverMiddleware` resolves the store from the public domain.
 *
 * Text only, by decision (D1): there is deliberately no voice, transcription
 * or TTS route here. Writes never happen here either: the replies carry
 * proposal cards that the visitor's browser executes through the existing
 * public checkout, booking and PQR endpoints.
 */
@Controller('ecommerce/vexi')
export class VexiPublicController {
  constructor(private readonly vexiPublic: VexiPublicService) {}

  @Public()
  @Get('config')
  @Header('Cache-Control', 'no-store')
  async config(@Req() req: Request) {
    const storeId = Number((req as any).domain_context?.store_id);
    const data = await this.vexiPublic.getConfig(storeId);
    return { success: true, data };
  }

  @OptionalAuth()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('sessions')
  @HttpCode(201)
  async createSession(
    @Req() req: Request,
    @Body() dto: CreateVexiPublicSessionDto,
  ) {
    const data = await this.vexiPublic.createSession(this.visitor(req), dto);
    return { success: true, data };
  }

  @OptionalAuth()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('sessions/:sessionId/messages')
  @HttpCode(200)
  async sendMessage(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Headers(VEXI_SESSION_HEADER) token: string | undefined,
    @Body() dto: VexiPublicMessageDto,
  ) {
    const data = await this.vexiPublic.sendMessage(
      this.visitor(req),
      sessionId,
      token,
      dto,
    );
    return { success: true, data };
  }

  private visitor(req: Request): VexiPublicVisitor {
    const storeId = Number((req as any).domain_context?.store_id);
    if (!Number.isInteger(storeId) || storeId <= 0)
      throw new VendixHttpException(ErrorCodes.VEXI_PUBLIC_DISABLED);
    const user = (req as any).user ?? null;
    return {
      store_id: storeId,
      ip: extractClientIp(req),
      user_agent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      user: user
        ? { id: user.id, store_id: user.store_id, roles: user.roles }
        : null,
    };
  }
}
