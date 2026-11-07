import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { UPLOAD_CHUNK_BYTES } from '../../store/workflows/public-link/workflow-public-uploads.service';
import { InitPublicUploadDto } from './dto/init-public-upload.dto';
import { SubmitPublicWorkflowFormDto } from './dto/submit-public-workflow-form.dto';
import { readRawBody } from './raw-body.util';
import { WorkflowPublicFormService } from './workflow-public-form.service';

/**
 * Public form by link: `GET|POST /api/ecommerce/workflows/forms/:token`, its
 * captcha challenge and the chunked uploads of its file fields. It lives under
 * `/ecommerce/` because that is where the global `DomainResolverMiddleware`
 * resolves the store from the hostname.
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

  @Get(':token/captcha')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async captcha(@Param('token') token: string) {
    return this.responseService.success(await this.forms.captchaChallenge(token));
  }

  @Post(':token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async submit(@Param('token') token: string, @Body() dto: SubmitPublicWorkflowFormDto) {
    const result = await this.forms.submit(token, dto);
    return this.responseService.created(result, 'Solicitud recibida');
  }

  @Post(':token/uploads')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async initUpload(@Param('token') token: string, @Body() dto: InitPublicUploadDto) {
    return this.responseService.created(await this.forms.initUpload(token, dto), 'Subida iniciada');
  }

  @Put(':token/uploads/:uploadId/parts/:n')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async putPart(
    @Param('token') token: string,
    @Param('uploadId') uploadId: string,
    @Param('n', ParseIntPipe) n: number,
    @Req() req: Request,
  ) {
    const body = await readRawBody(req, UPLOAD_CHUNK_BYTES);
    return this.responseService.success(await this.forms.putUploadPart(token, uploadId, n, body));
  }

  @Post(':token/uploads/:uploadId/complete')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async complete(@Param('token') token: string, @Param('uploadId') uploadId: string) {
    return this.responseService.success(await this.forms.completeUpload(token, uploadId));
  }
}
