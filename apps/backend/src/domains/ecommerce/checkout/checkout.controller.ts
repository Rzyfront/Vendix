import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validateOrReject, ValidationError } from 'class-validator';
import { CheckoutService } from './checkout.service';
import { CheckoutDto } from './dto/checkout.dto';
import { WhatsappCheckoutDto } from './dto/whatsapp-checkout.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalAuth } from '@common/decorators/optional-auth.decorator';

@Controller('ecommerce/checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(private readonly checkout_service: CheckoutService) {}

  /**
   * Returns whether the current ecommerce store has invoicing enabled
   * (fiscal_status.invoicing.state === 'ACTIVE'). Used by guest checkout to
   * decide if the optional invoice data section should be shown.
   *
   * Public-friendly: works with @OptionalAuth() so guests can call it. Store
   * context is resolved from the ecommerce domain by DomainResolverMiddleware.
   */
  @Get('eligibility')
  @OptionalAuth()
  async getEligibility() {
    const data = await this.checkout_service.getInvoicingEligibility();
    return { success: true, data };
  }

  @Get('payment-methods')
  @OptionalAuth()
  async getPaymentMethods(@Query('shipping_type') shippingType?: string) {
    // store_id se resuelve automáticamente desde el dominio
    // shipping_type filters payment methods by processing_mode:
    // - pickup: DIRECT + ONLINE
    // - delivery/carrier/etc: ONLINE + ON_DELIVERY
    const data = await this.checkout_service.getPaymentMethods(shippingType);
    return { success: true, data };
  }

  /**
   * Checkout endpoint. Accepts `multipart/form-data` so the customer can
   * optionally attach a payment receipt (`file`) when paying with
   * bank_transfer / voucher. The actual CheckoutDto travels as a JSON string
   * under the `data` field — global ValidationPipe cannot validate it
   * automatically because multipart fields arrive as strings, so we
   * parse + transform + validate manually here before delegating to the
   * service.
   *
   * Backwards-compatibility: JSON-body clients still work because Nest's
   * FileInterceptor falls through gracefully when `Content-Type` is
   * `application/json` — in that case `file` is undefined and the parsed
   * body is `dto` directly under @Body().
   */
  @Post()
  @OptionalAuth()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async checkout(
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const dto = await this.parseCheckoutBody(body);
    // store_id y user_id se resuelven automáticamente
    const data = await this.checkout_service.checkout(dto, file);
    return { success: true, data };
  }

  /**
   * Resolve and validate the CheckoutDto from a hybrid body shape:
   *  - multipart: a `data` field carrying the DTO as a JSON string.
   *  - JSON: the body itself is already the DTO.
   */
  private async parseCheckoutBody(body: any): Promise<CheckoutDto> {
    let raw: any = body;
    if (body && typeof body === 'object' && typeof body.data === 'string') {
      try {
        raw = JSON.parse(body.data);
      } catch {
        throw new BadRequestException(
          'El campo "data" del formulario debe ser JSON válido',
        );
      }
    }

    const instance = plainToInstance(CheckoutDto, raw ?? {});
    try {
      await validateOrReject(instance, {
        whitelist: true,
        forbidNonWhitelisted: false,
      });
    } catch (errors) {
      const messages = this.collectValidationMessages(
        errors as ValidationError[],
      );
      throw new BadRequestException(messages);
    }
    return instance;
  }

  private collectValidationMessages(errors: ValidationError[]): string[] {
    const out: string[] = [];
    const walk = (err: ValidationError) => {
      if (err.constraints) {
        for (const msg of Object.values(err.constraints)) out.push(msg);
      }
      if (err.children?.length) err.children.forEach(walk);
    };
    errors.forEach(walk);
    return out.length ? out : ['Checkout payload validation failed'];
  }

  @Post('prepare-wompi')
  @OptionalAuth()
  async prepareWompiPayment(
    @Body()
    dto: {
      order_id: number;
      amount: number;
      currency?: string;
      customer_email?: string;
      redirect_url?: string;
      public_order_token?: string;
    },
  ) {
    const data = await this.checkout_service.prepareWompiPayment(dto);
    return { success: true, data };
  }

  /**
   * Force-confirm a Wompi payment for an order by polling the Wompi API
   * directly. Called by the frontend widget callback so the user sees the
   * correct order/payment state immediately on return — does not replace
   * the canonical webhook flow, only complements it.
   *
   * Auth: customer JWT (same JwtAuthGuard as the rest of /ecommerce/checkout).
   * Tenant: store context resolved from x-store-id header (CheckoutService
   * uses StorePrismaService which scopes by store).
   */
  @Post('confirm-wompi-payment/:orderId')
  @OptionalAuth()
  async confirmWompiPayment(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: { public_order_token?: string },
  ) {
    const data = await this.checkout_service.confirmWompiPayment(
      orderId,
      dto.public_order_token,
    );
    return { success: true, data };
  }

  @OptionalAuth()
  @Post('whatsapp')
  async whatsappCheckout(@Body() dto: WhatsappCheckoutDto) {
    const data = await this.checkout_service.whatsappCheckout(dto);
    return { success: true, data };
  }
}
