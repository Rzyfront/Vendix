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
import { WorkflowTrackingPublicService } from '../../store/workflows/tracking/workflow-tracking-public.service';
import { InitPublicUploadDto, ReplyTrackingDto } from './dto/init-public-upload.dto';
import { readRawBody } from './raw-body.util';

/**
 * Tracking portal of the external requester:
 * `/api/ecommerce/workflows/tracking/:token` (the store comes from the domain).
 */
@Controller('ecommerce/workflows/tracking')
@Public()
export class EcommerceWorkflowsTrackingController {
  constructor(
    private readonly tracking: WorkflowTrackingPublicService,
    private readonly responseService: ResponseService,
  ) {}

  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async get(@Param('token') token: string) {
    return this.responseService.success(await this.tracking.get(token));
  }

  @Post(':token/messages')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async reply(@Param('token') token: string, @Body() dto: ReplyTrackingDto) {
    return this.responseService.created(await this.tracking.reply(token, dto.message), 'Mensaje enviado');
  }

  @Post(':token/requirements/:key/uploads')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async initUpload(
    @Param('token') token: string,
    @Param('key') key: string,
    @Body() dto: InitPublicUploadDto,
  ) {
    return this.responseService.created(
      await this.tracking.initUpload(token, key, dto),
      'Subida iniciada',
    );
  }

  @Put(':token/requirements/:key/uploads/:uploadId/parts/:n')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async putPart(
    @Param('token') token: string,
    @Param('key') key: string,
    @Param('uploadId') uploadId: string,
    @Param('n', ParseIntPipe) n: number,
    @Req() req: Request,
  ) {
    const body = await readRawBody(req, UPLOAD_CHUNK_BYTES);
    return this.responseService.success(await this.tracking.putPart(token, key, uploadId, n, body));
  }

  @Post(':token/requirements/:key/uploads/:uploadId/complete')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async complete(
    @Param('token') token: string,
    @Param('key') key: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.responseService.success(await this.tracking.completeUpload(token, key, uploadId));
  }
}
