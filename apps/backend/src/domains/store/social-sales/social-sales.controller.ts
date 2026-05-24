import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { CompleteWhatsappEmbeddedSignupDto } from './dto';
import { MetaWhatsappEmbeddedSignupService } from './meta-whatsapp-embedded-signup.service';

@Controller('store/social-sales')
@UseGuards(PermissionsGuard)
export class SocialSalesController {
  constructor(
    private readonly metaWhatsappService: MetaWhatsappEmbeddedSignupService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('meta/readiness')
  @Permissions('store:social_sales:read')
  async getMetaReadiness() {
    const result = await this.metaWhatsappService.getReadiness();
    return this.responseService.success(result, 'Estado Meta obtenido');
  }

  @Get('channels/whatsapp')
  @Permissions('store:social_sales:read')
  async getWhatsappChannel() {
    const result = await this.metaWhatsappService.getWhatsappChannel();
    return this.responseService.success(result, 'Canal WhatsApp obtenido');
  }

  @Post('channels/whatsapp/embedded-signup/complete')
  @Permissions('store:social_sales:manage')
  @HttpCode(HttpStatus.OK)
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
  async disconnectWhatsapp() {
    const result = await this.metaWhatsappService.disconnectWhatsapp();
    return this.responseService.success(result, 'WhatsApp desconectado');
  }
}
