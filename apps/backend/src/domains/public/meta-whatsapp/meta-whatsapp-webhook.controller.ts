import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { MetaWhatsappWebhookService } from './meta-whatsapp-webhook.service';

@Controller('public/meta/whatsapp/webhook')
export class MetaWhatsappWebhookController {
  constructor(
    private readonly webhookService: MetaWhatsappWebhookService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): Promise<string> {
    return this.webhookService.verify(mode, token, challenge);
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(
    @Body() payload: any,
    @Req() req: any,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const result = await this.webhookService.ingest(
      payload,
      req.rawBody,
      signature,
    );
    return this.responseService.success(result, 'Webhook recibido');
  }
}
