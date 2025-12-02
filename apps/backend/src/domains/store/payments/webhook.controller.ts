import {
  Controller,
  Post,
  Body,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WebhookHandlerService } from './services/webhook-handler.service';
import { WebhookEvent } from './interfaces';

@ApiTags('Webhooks')
@Controller('store/webhooks')
export class WebhookController {
  constructor(private readonly webhookHandler: WebhookHandlerService) {}

  @Post('stripe')
  @ApiOperation({ summary: 'Handle Stripe webhooks' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleStripeWebhook(
    @Body() body: any,
    @Headers('stripe-signature') signature: string,
  ) {
    try {
      const event: WebhookEvent = {
        processor: 'stripe',
        eventType: body.type,
        data: body.data,
        signature,
        rawBody: JSON.stringify(body),
      };

      await this.webhookHandler.handleWebhook(event);
      return { received: true };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Post('paypal')
  @ApiOperation({ summary: 'Handle PayPal webhooks' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handlePaypalWebhook(
    @Body() body: any,
    @Headers('paypal-auth-algo') authAlgo: string,
    @Headers('paypal-transmission-id') transmissionId: string,
    @Headers('paypal-cert-id') certId: string,
    @Headers('paypal-transmission-sig') transmissionSig: string,
    @Headers('paypal-transmission-time') transmissionTime: string,
  ) {
    try {
      const event: WebhookEvent = {
        processor: 'paypal',
        eventType: body.event_type,
        data: body,
        signature: transmissionSig,
        rawBody: JSON.stringify(body),
      };

      await this.webhookHandler.handleWebhook(event);
      return { received: true };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Post('bank-transfer')
  @ApiOperation({ summary: 'Handle bank transfer webhooks' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleBankTransferWebhook(@Body() body: any) {
    try {
      const event: WebhookEvent = {
        processor: 'bank_transfer',
        eventType: body.eventType,
        data: body,
        rawBody: JSON.stringify(body),
      };

      await this.webhookHandler.handleWebhook(event);
      return { received: true };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
