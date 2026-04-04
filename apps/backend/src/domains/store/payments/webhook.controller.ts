import {
  Controller,
  Post,
  Body,
  Headers,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { WebhookHandlerService } from './services/webhook-handler.service';
import { WompiWebhookValidatorService } from './services/wompi-webhook-validator.service';
import { WebhookEvent } from './interfaces';

@Public()
@ApiTags('Webhooks')
@Controller('store/webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookHandler: WebhookHandlerService,
    private readonly wompiWebhookValidator: WompiWebhookValidatorService,
  ) {}

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

  @Post('wompi')
  @ApiOperation({ summary: 'Handle Wompi webhooks (Nequi, PSE, Cards, Bancolombia)' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleWompiWebhook(@Body() body: any) {
    try {
      // Validate webhook signature using store-specific credentials
      const { valid, storeId } =
        await this.wompiWebhookValidator.validate(body);

      if (!valid) {
        this.logger.warn(
          `Rejected Wompi webhook — invalid signature (storeId: ${storeId ?? 'unknown'})`,
        );
        // Wompi requires 200 response; returning received: true prevents retries
        return { received: true };
      }

      const event: WebhookEvent = {
        processor: 'wompi',
        eventType: body.event || 'transaction.updated',
        data: body.data,
        rawBody: JSON.stringify(body),
        storeId: storeId ?? undefined,
      };

      await this.webhookHandler.handleWebhook(event);
      return { received: true };
    } catch (error) {
      this.logger.error(`Wompi webhook processing error: ${error.message}`);
      // Always return 200 to Wompi to prevent infinite retries
      return { received: true };
    }
  }
}
