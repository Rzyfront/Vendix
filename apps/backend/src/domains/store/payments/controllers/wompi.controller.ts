import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { WompiClient } from '../processors/wompi/wompi.client';
import { WompiEnvironment } from '../processors/wompi/wompi.types';
import { StorePaymentMethodsService } from '../services/store-payment-methods.service';
import { RequestContextService } from '@common/context/request-context.service';

@ApiTags('Wompi')
@Controller('store/payments/wompi')
@UseGuards(JwtAuthGuard)
export class WompiController {
  private readonly logger = new Logger(WompiController.name);

  constructor(
    private readonly wompiClient: WompiClient,
    private readonly storePaymentMethods: StorePaymentMethodsService,
  ) {}

  /**
   * Resolve the store's Wompi config (decrypted)
   */
  private async resolveWompiConfig(): Promise<Record<string, any>> {
    // Find the store's enabled Wompi payment method
    const methods = await this.storePaymentMethods.getEnabledForStore();
    const wompiMethod = methods.find(
      (m: any) => m.system_payment_method?.type === 'wompi',
    );

    if (!wompiMethod) {
      throw new BadRequestException('Wompi no está configurado para esta tienda');
    }

    // Get decrypted config
    return this.storePaymentMethods.getDecryptedConfig(wompiMethod.id);
  }

  /**
   * Configure the WompiClient with decrypted store credentials
   */
  private configureClient(config: Record<string, any>): void {
    this.wompiClient.configure({
      public_key: config.public_key,
      private_key: config.private_key,
      events_secret: config.events_secret || '',
      integrity_secret: config.integrity_secret || '',
      environment: (config.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
    });
  }

  @Post('prepare')
  @ApiOperation({ summary: 'Prepare Wompi payment data for frontend Widget/checkout' })
  @ApiResponse({ status: 200, description: 'Payment preparation data' })
  async preparePayment(
    @Body() dto: { order_id: number; amount: number; currency?: string; customer_email?: string; redirect_url?: string },
  ) {
    const config = await this.resolveWompiConfig();
    this.configureClient(config);

    const storeId = RequestContextService.getStoreId();
    const reference = `vendix_${storeId}_${dto.order_id}_${Date.now()}`;
    const amountInCents = Math.round(dto.amount * 100);
    const currency = dto.currency || 'COP';

    const integritySignature = this.wompiClient.generateIntegritySignature(
      reference,
      amountInCents,
      currency,
    );

    const tokens = await this.wompiClient.getAcceptanceTokens();

    return {
      success: true,
      data: {
        public_key: config.public_key,
        currency,
        amount_in_cents: amountInCents,
        reference,
        signature_integrity: integritySignature,
        redirect_url: dto.redirect_url || '',
        acceptance_token: tokens.acceptance_token,
        accept_personal_auth: tokens.personal_auth_token,
        customer_email: dto.customer_email || '',
      },
    };
  }

  @Get('financial-institutions')
  @ApiOperation({ summary: 'Get PSE financial institutions list' })
  @ApiResponse({ status: 200, description: 'List of banks for PSE' })
  async getFinancialInstitutions() {
    const config = await this.resolveWompiConfig();
    this.configureClient(config);
    const institutions = await this.wompiClient.getFinancialInstitutions();
    return { data: institutions };
  }

  @Post('test-connection')
  @ApiOperation({ summary: 'Test Wompi credentials by fetching merchant data' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  async testConnection(
    @Body() body?: { public_key?: string; private_key?: string; environment?: string },
  ) {
    try {
      // Use credentials from request body (modal pre-save) or from stored config (post-save)
      let config: Record<string, any>;

      if (body?.public_key && body?.private_key) {
        config = {
          public_key: body.public_key,
          private_key: body.private_key,
          environment: body.environment || 'SANDBOX',
        };
      } else {
        config = await this.resolveWompiConfig();
      }

      this.configureClient(config);
      await this.wompiClient.getAcceptanceTokens();

      return {
        success: true,
        message: 'Conexión exitosa con Wompi',
        environment: config.environment || 'SANDBOX',
      };
    } catch (error) {
      return {
        success: false,
        message: `Error de conexión: ${error.message}`,
      };
    }
  }
}
