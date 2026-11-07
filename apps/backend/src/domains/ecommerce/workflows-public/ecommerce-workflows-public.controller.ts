import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { SubmitPublicWorkflowFormDto } from './dto/submit-public-workflow-form.dto';
import { WorkflowPublicFormService } from './workflow-public-form.service';

/**
 * Public form by link: `GET|POST /api/ecommerce/workflows/forms/:token`. It
 * lives under `/ecommerce/` because that is where the global
 * `DomainResolverMiddleware` resolves the store from the hostname.
 */
@Controller('ecommerce/workflows/forms')
@Public()
export class EcommerceWorkflowsPublicController {
  constructor(
    private readonly forms: WorkflowPublicFormService,
    private readonly responseService: ResponseService,
  ) {}

  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async get(@Param('token') token: string) {
    return this.responseService.success(await this.forms.get(token));
  }

  @Post(':token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async submit(@Param('token') token: string, @Body() dto: SubmitPublicWorkflowFormDto) {
    const result = await this.forms.submit(token, dto);
    return this.responseService.created(result, 'Solicitud recibida');
  }
}
