import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { LandingLeadService } from './landing-lead.service';
import { LandingLeadDto } from './landing-page.dto';

/**
 * Public side of the landing published on its own domain (Fase 6). Under
 * `/ecommerce/` so the domain resolver middleware sets the store from the
 * hostname (or `x-store-id`); the store never comes from the body.
 *
 * - `GET` returns the landing's own hostname and its offer. The landing
 *   content itself still comes from `GET /ecommerce/crm/landing`, unchanged.
 * - `POST lead` is the landing form on that domain: the same body and
 *   customer handling as `POST /ecommerce/crm/contact`, plus the lead's
 *   origin, offer and date in the CRM.
 */
@Controller('ecommerce/landing-page')
export class LandingPagePublicController {
  constructor(
    private readonly leads: LandingLeadService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get()
  async get() {
    const page = await this.leads.getPublished();
    if (!page) throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    return this.responseService.success(page);
  }

  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Post('lead')
  async lead(@Body() dto: LandingLeadDto) {
    const result = await this.leads.submitLead(dto);
    return this.responseService.created(result, '¡Gracias! Te contactaremos pronto.');
  }
}
