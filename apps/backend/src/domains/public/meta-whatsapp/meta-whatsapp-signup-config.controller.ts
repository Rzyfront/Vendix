import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { MetaWhatsappSignupConfigService } from './meta-whatsapp-signup-config.service';

@Controller('public/meta/whatsapp/signup-config')
export class MetaWhatsappSignupConfigController {
  constructor(
    private readonly signupConfigService: MetaWhatsappSignupConfigService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async getSignupConfig() {
    const config = await this.signupConfigService.getPublicSignupConfig();
    return this.responseService.success(config);
  }
}
