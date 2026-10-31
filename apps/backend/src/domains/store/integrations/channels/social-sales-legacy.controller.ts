import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { CompleteWhatsappEmbeddedSignupDto } from './dto';
import { MetaWhatsappEmbeddedSignupService } from './meta-whatsapp-embedded-signup.service';

const SUCCESSOR = '/api/store/integrations/channels';

/**
 * @deprecated Use `ChannelsController` (`/api/store/integrations/channels`).
 *
 * Kept only because the mobile app (`apps/mobile/src/core/api/endpoints.ts`)
 * still calls `/api/store/social-sales/*`. Remove it once mobile migrates.
 * Responses carry `Deprecation: true` and a `Link` to the successor route.
 */
@Controller('store/social-sales')
@UseGuards(PermissionsGuard)
export class SocialSalesLegacyController {
  constructor(
    private readonly metaWhatsappService: MetaWhatsappEmbeddedSignupService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('meta/readiness')
  @Permissions('store:social_sales:read')
  @Header('Deprecation', 'true')
  @Header('Link', `<${SUCCESSOR}/meta/readiness>; rel="successor-version"`)
  async getMetaReadiness() {
    const result = await this.metaWhatsappService.getReadiness();
    return this.responseService.success(result, 'Estado Meta obtenido');
  }

  @Get('channels/whatsapp')
  @Permissions('store:social_sales:read')
  @Header('Deprecation', 'true')
  @Header('Link', `<${SUCCESSOR}/whatsapp>; rel="successor-version"`)
  async getWhatsappChannel() {
    const result = await this.metaWhatsappService.getWhatsappChannel();
    return this.responseService.success(result, 'Canal WhatsApp obtenido');
  }

  @Post('channels/whatsapp/embedded-signup/complete')
  @Permissions('store:social_sales:manage')
  @HttpCode(HttpStatus.OK)
  @Header('Deprecation', 'true')
  @Header(
    'Link',
    `<${SUCCESSOR}/whatsapp/embedded-signup/complete>; rel="successor-version"`,
  )
  async completeWhatsappEmbeddedSignup(
    @Body() dto: CompleteWhatsappEmbeddedSignupDto,
  ) {
    const result = await this.metaWhatsappService.completeEmbeddedSignup(dto);
    return this.responseService.success(
      result,
      'WhatsApp conectado correctamente',
    );
  }

  @Post('channels/whatsapp/disconnect')
  @Permissions('store:social_sales:manage')
  @HttpCode(HttpStatus.OK)
  @Header('Deprecation', 'true')
  @Header('Link', `<${SUCCESSOR}/whatsapp/disconnect>; rel="successor-version"`)
  async disconnectWhatsapp() {
    const result = await this.metaWhatsappService.disconnectWhatsapp();
    return this.responseService.success(result, 'WhatsApp desconectado');
  }
}
