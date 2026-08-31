import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { CrmPublicService } from '../services/crm-public.service';
import { CrmContactDto } from '../dto/crm-contact.dto';
import { Public } from '../../../../common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';

/**
 * Superficie pública de la CRM Landing bajo `/ecommerce/crm/*` — el prefijo
 * es lo que activa DomainResolverMiddleware (hostname del storefront o
 * ?store_id=), así que NO se toca el middleware. Handlers @Public().
 */
@Controller('ecommerce/crm')
export class CrmPublicController {
  constructor(
    private readonly crmPublicService: CrmPublicService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get('landing')
  async getLanding() {
    const result = await this.crmPublicService.getPublicLanding();
    return this.responseService.success(result);
  }

  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Post('contact')
  async submitContact(@Body() dto: CrmContactDto) {
    const result = await this.crmPublicService.submitContact(dto);
    return this.responseService.created(
      result,
      '¡Gracias! Te contactaremos pronto.',
    );
  }
}
