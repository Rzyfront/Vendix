import { Body, Controller, Get, Header, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { DeclineDocumentDto, SignDocumentDto, VerifyOtpDto } from '../../store/documents/signatures/dto/signature.dto';
import { ClientMeta, SignaturePublicService } from '../../store/documents/signatures/signature-public.service';

function metaOf(req: Request): ClientMeta {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, user_agent: typeof ua === 'string' ? ua : null };
}

/**
 * Public signing page of a document (P4.2):
 * `/api/ecommerce/documents/sign/:token` (the store comes from the domain).
 * Any token problem is the same generic 404.
 */
@Controller('ecommerce/documents/sign')
@Public()
export class EcommerceDocumentsSigningController {
  constructor(
    private readonly signing: SignaturePublicService,
    private readonly responseService: ResponseService,
  ) {}

  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async view(@Param('token') token: string, @Req() req: Request) {
    return this.responseService.success(await this.signing.view(token, metaOf(req)));
  }

  @Post(':token/otp')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async sendOtp(@Param('token') token: string, @Req() req: Request) {
    return this.responseService.success(await this.signing.sendOtp(token, metaOf(req)), 'Código enviado');
  }

  @Post(':token/otp/verify')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async verifyOtp(@Param('token') token: string, @Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.responseService.success(await this.signing.verifyOtp(token, dto.code, metaOf(req)), 'Código verificado');
  }

  @Post(':token/sign')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async sign(@Param('token') token: string, @Body() dto: SignDocumentDto, @Req() req: Request) {
    return this.responseService.created(await this.signing.sign(token, dto, metaOf(req)), 'Documento firmado');
  }

  @Post(':token/decline')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async decline(@Param('token') token: string, @Body() dto: DeclineDocumentDto, @Req() req: Request) {
    return this.responseService.success(await this.signing.decline(token, dto.reason, metaOf(req)), 'Firma rechazada');
  }
}
